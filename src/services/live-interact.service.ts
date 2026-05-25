import { EventEmitter } from 'events';
import {
  DanmakuMessage,
  GiftMessage,
  LikeMessage,
  OnlineUsersMessage,
  WebRtcSignalMessage,
} from '../types';
import prisma from '../config/prisma';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

export interface DanmakuCache {
  liveRoomId: string;
  messages: DanmakuMessage[];
}

class LiveInteractService extends EventEmitter {
  private danmakuCaches: Map<string, DanmakuCache> = new Map();
  private onlineUsers: Map<string, Map<string, { userId: string; userName: string; protocol: string; connectedAt: Date }>> = new Map();
  private danmakuTimers: Map<string, Map<string, number>> = new Map();
  private onlineUpdateTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.setMaxListeners(200);
    this.startOnlineUpdate();
  }

  private startOnlineUpdate(): void {
    if (this.onlineUpdateTimer) return;

    this.onlineUpdateTimer = setInterval(() => {
      this.broadcastOnlineCount();
    }, config.live.interact.onlineUpdateInterval);
  }

  private broadcastOnlineCount(): void {
    for (const [liveRoomId, users] of this.onlineUsers) {
      const activeUsers = Array.from(users.values()).filter(u => u.connectedAt);
      const message: OnlineUsersMessage = {
        liveRoomId,
        count: activeUsers.length,
        users: activeUsers.map(u => ({ userId: u.userId, userName: u.userName })),
      };
      this.emit('online:update', message);
    }
  }

  async sendDanmaku(
    liveRoomId: string,
    userId: string,
    userName: string,
    content: string,
    color = '#FFFFFF',
    fontSize = 24,
    mode = 1
  ): Promise<DanmakuMessage | null> {
    if (content.length > config.live.interact.danmakuMaxLength) {
      return null;
    }

    const roomKey = `${liveRoomId}_${userId}`;
    const now = Date.now();

    if (!this.danmakuTimers.has(liveRoomId)) {
      this.danmakuTimers.set(liveRoomId, new Map());
    }

    const userTimers = this.danmakuTimers.get(liveRoomId)!;
    const lastTime = userTimers.get(roomKey) || 0;

    if (now - lastTime < config.live.interact.danmakuRateLimit * 1000) {
      return null;
    }

    userTimers.set(roomKey, now);

    const message: DanmakuMessage = {
      id: uuidv4(),
      liveRoomId,
      userId,
      userName,
      content,
      color,
      fontSize,
      mode,
      timestamp: new Date(),
    };

    const bannedWords = await this.getBannedWords();
    const isBanned = bannedWords.some(word => content.includes(word));

    if (isBanned) {
      await prisma.danmaku.create({
        data: {
          id: message.id,
          liveRoomId: message.liveRoomId,
          userId: message.userId,
          userName: message.userName,
          content: message.content,
          color: message.color,
          fontSize: message.fontSize,
          mode: message.mode,
          status: 'BANNED',
        },
      });
      return null;
    }

    await prisma.danmaku.create({
      data: {
        id: message.id,
        liveRoomId: message.liveRoomId,
        userId: message.userId,
        userName: message.userName,
        content: message.content,
        color: message.color,
        fontSize: message.fontSize,
        mode: message.mode,
        status: 'NORMAL',
      },
    });

    this.cacheDanmaku(message);

    this.emit('danmaku:new', message);

    return message;
  }

  private cacheDanmaku(message: DanmakuMessage): void {
    if (!this.danmakuCaches.has(message.liveRoomId)) {
      this.danmakuCaches.set(message.liveRoomId, {
        liveRoomId: message.liveRoomId,
        messages: [],
      });
    }

    const cache = this.danmakuCaches.get(message.liveRoomId)!;
    cache.messages.push(message);

    if (cache.messages.length > config.live.interact.maxDanmakuCache) {
      cache.messages.shift();
    }
  }

  getCachedDanmakus(liveRoomId: string): DanmakuMessage[] {
    return this.danmakuCaches.get(liveRoomId)?.messages || [];
  }

  async getDanmakuHistory(
    liveRoomId: string,
    limit = 100,
    offset = 0
  ): Promise<any[]> {
    return prisma.danmaku.findMany({
      where: {
        liveRoomId,
        status: { not: 'BANNED' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async hideDanmaku(danmakuId: string): Promise<void> {
    await prisma.danmaku.update({
      where: { id: danmakuId },
      data: { status: 'HIDDEN' },
    });

    this.emit('danmaku:hide', { danmakuId });
  }

  async banDanmaku(danmakuId: string): Promise<void> {
    await prisma.danmaku.update({
      where: { id: danmakuId },
      data: { status: 'BANNED' },
    });

    this.emit('danmaku:ban', { danmakuId });
  }

  async sendGift(
    liveRoomId: string,
    giftId: string,
    userId: string,
    userName: string,
    quantity = 1
  ): Promise<GiftMessage | null> {
    const gift = await prisma.gift.findUnique({
      where: { id: giftId },
    });

    if (!gift || gift.status === 'DISABLED') {
      return null;
    }

    const totalValue = gift.value * quantity;

    const giftLog = await prisma.liveGiftLog.create({
      data: {
        liveRoomId,
        giftId,
        userId,
        userName,
        quantity,
        totalValue,
      },
    });

    const message: GiftMessage = {
      id: giftLog.id,
      liveRoomId,
      giftId,
      giftName: gift.name,
      userId,
      userName,
      quantity,
      totalValue,
      iconUrl: gift.iconUrl || undefined,
      timestamp: new Date(),
    };

    this.emit('gift:new', message);

    return message;
  }

  async getGiftList(): Promise<any[]> {
    return prisma.gift.findMany({
      where: { status: 'ENABLED' },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createGift(
    name: string,
    iconUrl: string,
    price: number,
    value: number,
    sortOrder = 0
  ): Promise<any> {
    return prisma.gift.create({
      data: {
        name,
        iconUrl,
        price,
        value,
        sortOrder,
      },
    });
  }

  async updateGift(
    giftId: string,
    data: {
      name?: string;
      iconUrl?: string;
      price?: number;
      value?: number;
      status?: 'ENABLED' | 'DISABLED';
      sortOrder?: number;
    }
  ): Promise<any> {
    return prisma.gift.update({
      where: { id: giftId },
      data,
    });
  }

  async sendLike(
    liveRoomId: string,
    userId: string,
    count = 1
  ): Promise<LikeMessage> {
    await prisma.liveLike.create({
      data: {
        liveRoomId,
        userId,
      },
    });

    await prisma.liveRoom.update({
      where: { id: liveRoomId },
      data: { likeCount: { increment: count } },
    });

    const message: LikeMessage = {
      liveRoomId,
      userId,
      count,
      timestamp: new Date(),
    };

    this.emit('like:new', message);

    return message;
  }

  async getLikeCount(liveRoomId: string): Promise<number> {
    const room = await prisma.liveRoom.findUnique({
      where: { id: liveRoomId },
      select: { likeCount: true },
    });

    return room?.likeCount || 0;
  }

  userJoin(
    liveRoomId: string,
    userId: string,
    userName: string,
    protocol: string = 'hls'
  ): void {
    if (!this.onlineUsers.has(liveRoomId)) {
      this.onlineUsers.set(liveRoomId, new Map());
    }

    const roomUsers = this.onlineUsers.get(liveRoomId)!;
    roomUsers.set(userId, {
      userId,
      userName,
      protocol,
      connectedAt: new Date(),
    });

    this.emit('user:join', { liveRoomId, userId, userName, protocol });

    prisma.liveViewer.create({
      data: {
        liveRoomId,
        userId,
        userName,
        protocol: protocol.toUpperCase() as any,
      },
    }).catch(() => {
    });
  }

  userLeave(liveRoomId: string, userId: string): void {
    const roomUsers = this.onlineUsers.get(liveRoomId);
    if (!roomUsers) return;

    roomUsers.delete(userId);

    this.emit('user:leave', { liveRoomId, userId });

    prisma.liveViewer.updateMany({
      where: {
        liveRoomId,
        userId,
        isActive: true,
      },
      data: {
        isActive: false,
        disconnectedAt: new Date(),
      },
    }).catch(() => {
    });
  }

  getOnlineUsers(liveRoomId: string): Array<{ userId: string; userName: string; protocol: string }> {
    const roomUsers = this.onlineUsers.get(liveRoomId);
    if (!roomUsers) return [];

    return Array.from(roomUsers.values());
  }

  getOnlineCount(liveRoomId: string): number {
    return this.onlineUsers.get(liveRoomId)?.size || 0;
  }

  async handleWebRtcSignal(message: WebRtcSignalMessage): Promise<void> {
    this.emit('webrtc:signal', message);
  }

  async getGiftHistory(
    liveRoomId: string,
    limit = 50
  ): Promise<any[]> {
    return prisma.liveGiftLog.findMany({
      where: { liveRoomId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { gift: true },
    });
  }

  async getGiftStats(liveRoomId: string): Promise<any> {
    const gifts = await prisma.liveGiftLog.findMany({
      where: { liveRoomId },
      include: { gift: true },
    });

    const totalValue = gifts.reduce((sum, g) => sum + g.totalValue, 0);
    const totalCount = gifts.reduce((sum, g) => sum + g.quantity, 0);

    const giftSummary: Record<string, { name: string; count: number; value: number }> = {};
    for (const g of gifts) {
      if (!giftSummary[g.giftId]) {
        giftSummary[g.giftId] = {
          name: g.gift.name,
          count: 0,
          value: 0,
        };
      }
      giftSummary[g.giftId].count += g.quantity;
      giftSummary[g.giftId].value += g.totalValue;
    }

    return {
      totalValue,
      totalCount,
      giftCount: gifts.length,
      giftSummary: Object.values(giftSummary),
    };
  }

  private async getBannedWords(): Promise<string[]> {
    return [];
  }

  async clearRoomUsers(liveRoomId: string): Promise<void> {
    this.onlineUsers.delete(liveRoomId);
    this.danmakuCaches.delete(liveRoomId);
    this.emit('room:clear', { liveRoomId });
  }

  destroy(): void {
    if (this.onlineUpdateTimer) {
      clearInterval(this.onlineUpdateTimer);
      this.onlineUpdateTimer = null;
    }
    this.danmakuCaches.clear();
    this.onlineUsers.clear();
    this.danmakuTimers.clear();
    this.removeAllListeners();
  }
}

export const liveInteractService = new LiveInteractService();
