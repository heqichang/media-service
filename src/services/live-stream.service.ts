import { EventEmitter } from 'events';
import { LiveStreamAuthResult, LiveStreamMetrics } from '../types';
import prisma from '../config/prisma';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export interface StreamSession {
  liveRoomId: string;
  streamId: string;
  streamKey: string;
  protocol: 'rtmp' | 'srt';
  streamIndex: number;
  isPrimary: boolean;
  connectedAt: Date;
  pushIp: string;
  metrics: LiveStreamMetrics;
}

class LiveStreamService extends EventEmitter {
  private activeStreams: Map<string, StreamSession[]> = new Map();
  private streamKeyToRoom: Map<string, string> = new Map();

  constructor() {
    super();
    this.setMaxListeners(100);
    this.initializeStreamKeyCache();
  }

  private async initializeStreamKeyCache() {
    const rooms = await prisma.liveRoom.findMany({
      select: { id: true, streamKey: true },
    });
    for (const room of rooms) {
      this.streamKeyToRoom.set(room.streamKey, room.id);
    }
  }

  generateStreamKey(): string {
    const length = config.live.auth.streamKeyLength;
    return crypto.randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .substring(0, length);
  }

  async authenticatePush(streamKey: string, pushIp: string, protocol: 'rtmp' | 'srt'): Promise<LiveStreamAuthResult> {
    const liveRoomId = this.streamKeyToRoom.get(streamKey);

    if (!liveRoomId) {
      return { allowed: false, reason: 'Invalid stream key' };
    }

    const room = await prisma.liveRoom.findUnique({
      where: { id: liveRoomId },
      include: { streams: { where: { status: 'PUSHING' } } },
    });

    if (!room) {
      return { allowed: false, reason: 'Live room not found' };
    }

    if (room.status === 'BANNED') {
      return { allowed: false, reason: 'Live room is banned' };
    }

    if (room.status === 'ENDED') {
      return { allowed: false, reason: 'Live room has ended' };
    }

    if (room.maxBitrate && room.streams.length > 0) {
      const totalBitrate = room.streams.reduce((sum, s) => sum + (s.bitrate || 0), 0);
      if (totalBitrate >= room.maxBitrate) {
        return { allowed: false, reason: 'Maximum bitrate exceeded' };
      }
    }

    return {
      allowed: true,
      liveRoomId: room.id,
      streamKey,
    };
  }

  async registerStream(
    liveRoomId: string,
    streamKey: string,
    pushIp: string,
    protocol: 'rtmp' | 'srt',
    metrics?: Partial<LiveStreamMetrics>
  ): Promise<StreamSession> {
    const room = await prisma.liveRoom.findUnique({
      where: { id: liveRoomId },
      include: { streams: true },
    });

    if (!room) {
      throw new Error('Live room not found');
    }

    const streamIndex = room.streams.length;
    const isPrimary = streamIndex === 0;
    const streamId = uuidv4();

    const stream = await prisma.liveStream.create({
      data: {
        liveRoomId,
        streamIndex,
        streamName: `${room.title}_stream_${streamIndex}`,
        protocol: protocol.toUpperCase() as any,
        status: 'PUSHING',
        isPrimary,
        connectedAt: new Date(),
        pushIp,
        bitrate: metrics?.bitrate,
        width: metrics?.width,
        height: metrics?.height,
        codec: metrics?.codec,
        metadata: metrics as any,
      },
    });

    const session: StreamSession = {
      liveRoomId,
      streamId: stream.id,
      streamKey,
      protocol,
      streamIndex,
      isPrimary,
      connectedAt: new Date(),
      pushIp,
      metrics: {
        liveRoomId,
        bitrate: metrics?.bitrate || 0,
        width: metrics?.width || 0,
        height: metrics?.height || 0,
        codec: metrics?.codec || '',
        fps: metrics?.fps || 0,
        latencyMs: metrics?.latencyMs || 0,
        connectedAt: new Date(),
      },
    };

    if (!this.activeStreams.has(liveRoomId)) {
      this.activeStreams.set(liveRoomId, []);
    }
    this.activeStreams.get(liveRoomId)!.push(session);

    if (isPrimary) {
      await prisma.liveRoom.update({
        where: { id: liveRoomId },
        data: {
          status: 'LIVING',
          startTime: new Date(),
        },
      });
    }

    this.emit('stream:start', session);

    return session;
  }

  async unregisterStream(liveRoomId: string, streamId: string): Promise<void> {
    const sessions = this.activeStreams.get(liveRoomId);
    if (!sessions) return;

    const session = sessions.find(s => s.streamId === streamId);
    if (!session) return;

    const sessionIndex = sessions.indexOf(session);
    sessions.splice(sessionIndex, 1);

    const disconnectedAt = new Date();
    const duration = Math.floor((disconnectedAt.getTime() - session.connectedAt.getTime()) / 1000);

    await prisma.liveStream.update({
      where: { id: streamId },
      data: {
        status: 'STOPPED',
        disconnectedAt,
        duration,
      },
    });

    const remainingStreams = await prisma.liveStream.count({
      where: { liveRoomId, status: 'PUSHING' },
    });

    if (remainingStreams === 0) {
      await this.endLiveRoom(liveRoomId);
    }

    this.emit('stream:end', session);
  }

  async handleStreamInterrupt(liveRoomId: string, streamId: string): Promise<void> {
    await prisma.liveStream.update({
      where: { id: streamId },
      data: { status: 'INTERRUPTED' },
    });

    this.emit('stream:interrupt', { liveRoomId, streamId });
  }

  async endLiveRoom(liveRoomId: string): Promise<void> {
    const room = await prisma.liveRoom.findUnique({
      where: { id: liveRoomId },
      include: { streams: { where: { status: 'PUSHING' } } },
    });

    if (!room) return;

    const endTime = new Date();
    const duration = room.startTime
      ? Math.floor((endTime.getTime() - room.startTime.getTime()) / 1000)
      : 0;

    await prisma.liveRoom.update({
      where: { id: liveRoomId },
      data: {
        status: 'ENDED',
        endTime,
        duration,
      },
    });

    for (const stream of room.streams) {
      await prisma.liveStream.update({
        where: { id: stream.id },
        data: {
          status: 'STOPPED',
          disconnectedAt: endTime,
          duration: stream.connectedAt
            ? Math.floor((endTime.getTime() - stream.connectedAt.getTime()) / 1000)
            : 0,
        },
      });
    }

    this.activeStreams.delete(liveRoomId);
    this.emit('room:end', { liveRoomId, duration });
  }

  updateStreamMetrics(liveRoomId: string, streamId: string, metrics: Partial<LiveStreamMetrics>): void {
    const sessions = this.activeStreams.get(liveRoomId);
    if (!sessions) return;

    const session = sessions.find(s => s.streamId === streamId);
    if (session) {
      session.metrics = { ...session.metrics, ...metrics };
      this.emit('stream:metrics', { liveRoomId, streamId, metrics: session.metrics });
    }
  }

  getActiveStreams(liveRoomId: string): StreamSession[] {
    return this.activeStreams.get(liveRoomId) || [];
  }

  getPrimaryStream(liveRoomId: string): StreamSession | undefined {
    const sessions = this.activeStreams.get(liveRoomId);
    return sessions?.find(s => s.isPrimary);
  }

  getAllActiveRooms(): string[] {
    return Array.from(this.activeStreams.keys());
  }

  isRoomActive(liveRoomId: string): boolean {
    const sessions = this.activeStreams.get(liveRoomId);
    return sessions !== undefined && sessions.length > 0;
  }

  async getStreamHistory(liveRoomId: string, limit = 50): Promise<any[]> {
    return prisma.liveStream.findMany({
      where: { liveRoomId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getStreamStats(liveRoomId: string): Promise<any> {
    const streams = await prisma.liveStream.findMany({
      where: { liveRoomId },
    });

    const totalDuration = streams.reduce((sum, s) => sum + (s.duration || 0), 0);
    const totalStreams = streams.length;
    const activeStreams = streams.filter(s => s.status === 'PUSHING').length;

    return {
      totalDuration,
      totalStreams,
      activeStreams,
      protocols: [...new Set(streams.map(s => s.protocol))],
      bitrates: streams.map(s => ({
        streamId: s.id,
        bitrate: s.bitrate,
        resolution: s.width && s.height ? `${s.width}x${s.height}` : null,
      })),
    };
  }
}

export const liveStreamService = new LiveStreamService();
