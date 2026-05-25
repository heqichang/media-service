import { EventEmitter } from 'events';
import { LiveRoomStats } from '../types';
import prisma from '../config/prisma';
import { liveStreamService } from './live-stream.service';
import { liveTranscodeService } from './live-transcode.service';
import { liveRecordService } from './live-record.service';
import { liveInteractService } from './live-interact.service';
import { livePlayService } from './live-play.service';
import { v4 as uuidv4 } from 'uuid';

class LiveRoomService extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  async createRoom(data: {
    title: string;
    description?: string;
    coverUrl?: string;
    categoryId?: string;
    isPublic?: boolean;
    isRecorded?: boolean;
    recordFormat?: string;
    maxBitrate?: number;
    viewPassword?: string;
  }): Promise<any> {
    const streamKey = liveStreamService.generateStreamKey();

    const room = await prisma.liveRoom.create({
      data: {
        title: data.title,
        description: data.description,
        coverUrl: data.coverUrl,
        categoryId: data.categoryId,
        streamKey,
        viewPassword: data.viewPassword,
        status: 'NOT_STARTED',
        isPublic: data.isPublic !== false,
        isRecorded: data.isRecorded !== false,
        recordFormat: (data.recordFormat || 'FLV').toUpperCase() as any,
        maxBitrate: data.maxBitrate,
      },
      include: {
        category: true,
      },
    });

    liveStreamService.updateStreamKeyCache(streamKey, room.id);

    this.emit('room:create', room);

    return room;
  }

  async getRoom(id: string): Promise<any> {
    return prisma.liveRoom.findUnique({
      where: { id },
      include: {
        category: true,
        streams: { orderBy: { createdAt: 'desc' } },
        transcodes: { orderBy: { createdAt: 'desc' } },
        recordings: { orderBy: { createdAt: 'desc' }, take: 10 },
        plans: { orderBy: { scheduledAt: 'asc' } },
      },
    });
  }

  async getRooms(params: {
    page?: number;
    pageSize?: number;
    status?: string;
    categoryId?: string;
    search?: string;
  }): Promise<{ items: any[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const where: any = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.categoryId) {
      where.categoryId = params.categoryId;
    }

    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { description: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [rooms, total] = await Promise.all([
      prisma.liveRoom.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.liveRoom.count({ where }),
    ]);

    return {
      items: rooms,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async updateRoom(id: string, data: {
    title?: string;
    description?: string;
    coverUrl?: string;
    categoryId?: string;
    isPublic?: boolean;
    isRecorded?: boolean;
    recordFormat?: string;
    maxBitrate?: number;
    viewPassword?: string | null;
  }): Promise<any> {
    const room = await prisma.liveRoom.update({
      where: { id },
      data: {
        ...data,
        recordFormat: data.recordFormat ? (data.recordFormat.toUpperCase() as any) : undefined,
      },
      include: { category: true },
    });

    this.emit('room:update', room);

    return room;
  }

  async verifyPassword(id: string, password: string): Promise<boolean> {
    const room = await prisma.liveRoom.findUnique({
      where: { id },
      select: { viewPassword: true },
    });

    if (!room) return false;

    if (!room.viewPassword) return true;

    return room.viewPassword === password;
  }

  async deleteRoom(id: string): Promise<void> {
    const room = await prisma.liveRoom.findUnique({
      where: { id },
      include: { streams: { where: { status: 'PUSHING' } } },
    });

    if (!room) return;

    if (room.status !== 'BANNED' && room.streams.length > 0) {
      throw new Error('Cannot delete room while streaming');
    }

    await prisma.liveRoom.delete({
      where: { id },
    });

    this.emit('room:delete', { id });
  }

  async banRoom(id: string, reason?: string): Promise<any> {
    const room = await prisma.liveRoom.update({
      where: { id },
      data: {
        status: 'BANNED',
        banReason: reason,
      },
    });

    for (const stream of await prisma.liveStream.findMany({
      where: { liveRoomId: id, status: 'PUSHING' },
    })) {
      await liveStreamService.unregisterStream(id, stream.id);
    }

    this.emit('room:ban', { id, reason });

    return room;
  }

  async unbanRoom(id: string): Promise<any> {
    const room = await prisma.liveRoom.update({
      where: { id },
      data: {
        status: 'NOT_STARTED',
        banReason: null,
      },
    });

    this.emit('room:unban', { id });

    return room;
  }

  async resetStreamKey(id: string): Promise<{ streamKey: string }> {
    const room = await prisma.liveRoom.findUnique({
      where: { id },
      select: { streamKey: true },
    });

    if (room) {
      liveStreamService.removeStreamKeyCache(room.streamKey);
    }

    const newKey = liveStreamService.generateStreamKey();

    await prisma.liveRoom.update({
      where: { id },
      data: { streamKey: newKey },
    });

    liveStreamService.updateStreamKeyCache(newKey, id);

    this.emit('room:reset-key', { id, newKey });

    return { streamKey: newKey };
  }

  async createPlan(data: {
    liveRoomId: string;
    title: string;
    scheduledAt: Date;
    duration: number;
    description?: string;
  }): Promise<any> {
    const plan = await prisma.livePlan.create({
      data,
    });

    this.emit('plan:create', plan);

    return plan;
  }

  async getPlans(liveRoomId: string): Promise<any[]> {
    return prisma.livePlan.findMany({
      where: { liveRoomId },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async deletePlan(id: string): Promise<void> {
    await prisma.livePlan.delete({
      where: { id },
    });

    this.emit('plan:delete', { id });
  }

  async getRoomStats(id: string): Promise<LiveRoomStats> {
    const room = await prisma.liveRoom.findUnique({
      where: { id },
      include: {
        streams: true,
        recordings: true,
      },
    });

    if (!room) {
      throw new Error('Live room not found');
    }

    const [danmakuCount, giftCount, likeCount] = await Promise.all([
      prisma.danmaku.count({ where: { liveRoomId: id } }),
      prisma.liveGiftLog.count({ where: { liveRoomId: id } }),
      prisma.liveLike.count({ where: { liveRoomId: id } }),
    ]);

    const totalStreamDuration = room.streams.reduce((sum, s) => sum + (s.duration || 0), 0);
    const totalRecordDuration = room.recordings.reduce((sum, r) => sum + (r.duration || 0), 0);

    return {
      liveRoomId: id,
      viewCount: room.viewCount,
      peakViewers: room.peakViewers,
      likeCount: room.likeCount,
      danmakuCount,
      giftCount,
      duration: Math.max(room.duration, totalStreamDuration, totalRecordDuration),
      startTime: room.startTime || undefined,
      endTime: room.endTime || undefined,
    };
  }

  async updatePeakViewers(liveRoomId: string, count: number): Promise<void> {
    const room = await prisma.liveRoom.findUnique({
      where: { id: liveRoomId },
      select: { peakViewers: true },
    });

    if (room && count > room.peakViewers) {
      await prisma.liveRoom.update({
        where: { id: liveRoomId },
        data: { peakViewers: count },
      });
    }
  }

  async getRoomByStreamKey(streamKey: string): Promise<any> {
    return prisma.liveRoom.findUnique({
      where: { streamKey },
      include: { category: true },
    });
  }

  async updatePlayUrls(liveRoomId: string, urls: {
    hls?: string | null;
    flv?: string | null;
    rtc?: string | null;
  }): Promise<void> {
    await prisma.liveRoom.update({
      where: { id: liveRoomId },
      data: {
        playUrlHls: urls.hls || undefined,
        playUrlFlv: urls.flv || undefined,
        playUrlRtc: urls.rtc || undefined,
      },
    });
  }

  async updateLiveRoomStatus(liveRoomId: string, status: string): Promise<any> {
    const data: any = { status: status as any };

    if (status === 'LIVING') {
      data.startTime = new Date();
      data.endTime = null;
    } else if (status === 'ENDED') {
      const room = await prisma.liveRoom.findUnique({
        where: { id: liveRoomId },
        select: { startTime: true },
      });
      if (room && room.startTime) {
        data.endTime = new Date();
        data.duration = Math.floor((Date.now() - room.startTime.getTime()) / 1000);
      }
    }

    return prisma.liveRoom.update({
      where: { id: liveRoomId },
      data,
    });
  }
}

export const liveRoomService = new LiveRoomService();
