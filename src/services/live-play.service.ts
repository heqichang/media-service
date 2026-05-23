import { EventEmitter } from 'events';
import { PlayAuthResult } from '../types';
import prisma from '../config/prisma';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export interface PlaySession {
  liveRoomId: string;
  userId: string;
  protocol: 'hls' | 'flv' | 'webrtc';
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

class LivePlayService extends EventEmitter {
  private playSessions: Map<string, PlaySession> = new Map();
  private protocolCounters: Map<string, Map<string, number>> = new Map();

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  async authorizePlay(
    liveRoomId: string,
    userId: string,
    protocol: 'hls' | 'flv' | 'webrtc',
    token?: string
  ): Promise<PlayAuthResult> {
    const room = await prisma.liveRoom.findUnique({
      where: { id: liveRoomId },
    });

    if (!room) {
      return { allowed: false, reason: 'Live room not found' };
    }

    if (room.status === 'BANNED') {
      return { allowed: false, reason: 'Live room is banned' };
    }

    if (!room.isPublic && !token) {
      return { allowed: false, reason: 'Private stream requires authentication' };
    }

    if (room.status === 'NOT_STARTED') {
      return { allowed: false, reason: 'Stream has not started' };
    }

    if (room.status === 'ENDED') {
      return { allowed: false, reason: 'Stream has ended' };
    }

    if (token) {
      const session = this.playSessions.get(token);
      if (!session || session.expiresAt < new Date()) {
        return { allowed: false, reason: 'Invalid or expired token' };
      }

      if (session.liveRoomId !== liveRoomId) {
        return { allowed: false, reason: 'Token does not match room' };
      }

      return {
        allowed: true,
        token,
        expiresAt: session.expiresAt,
      };
    }

    const newToken = this.generateToken();
    const expiresAt = new Date(Date.now() + config.live.auth.playTokenExpiry * 1000);

    const session: PlaySession = {
      liveRoomId,
      userId,
      protocol,
      token: newToken,
      expiresAt,
      createdAt: new Date(),
    };

    this.playSessions.set(newToken, session);

    if (!this.protocolCounters.has(liveRoomId)) {
      this.protocolCounters.set(liveRoomId, new Map());
    }

    const counters = this.protocolCounters.get(liveRoomId)!;
    counters.set(protocol, (counters.get(protocol) || 0) + 1);

    await prisma.liveRoom.update({
      where: { id: liveRoomId },
      data: {
        viewCount: { increment: 1 },
      },
    });

    this.emit('play:authorize', { liveRoomId, userId, protocol });

    return {
      allowed: true,
      token: newToken,
      expiresAt,
    };
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async invalidateToken(token: string): Promise<void> {
    this.playSessions.delete(token);
    this.emit('play:invalidate', { token });
  }

  async getPlayUrls(liveRoomId: string, host?: string): Promise<{ hls?: string; flv?: string; webrtc?: string }> {
    const room = await prisma.liveRoom.findUnique({
      where: { id: liveRoomId },
    });

    if (!room) {
      return {};
    }

    const publicHost = host || config.server.publicHost || 'localhost';
    const baseHttpUrl = 'http://' + publicHost + ':' + config.server.port;
    const streamKey = room.streamKey;

    const urls: { hls?: string; flv?: string; webrtc?: string } = {};

    if (config.live.hls.enabled) {
      if (config.live.cdn.enabled && config.live.cdn.baseUrl) {
        urls.hls = `${config.live.cdn.baseUrl}${config.live.cdn.hlsPath}/${streamKey}/index.m3u8`;
      } else if (room.playUrlHls) {
        urls.hls = room.playUrlHls;
      } else {
        urls.hls = baseHttpUrl + '/hls/' + streamKey + '/index.m3u8';
      }
    }

    if (config.live.flv.enabled) {
      if (config.live.cdn.enabled && config.live.cdn.baseUrl) {
        urls.flv = `${config.live.cdn.baseUrl}${config.live.cdn.flvPath}/${streamKey}.flv`;
      } else if (room.playUrlFlv) {
        urls.flv = room.playUrlFlv;
      } else {
        urls.flv = baseHttpUrl + '/live/' + streamKey + '.flv';
      }
    }

    if (config.live.webrtc.enabled) {
      urls.webrtc = room.playUrlRtc || baseHttpUrl + '/webrtc/' + liveRoomId;
    }

    return urls;
  }

  async getCdnConfig(): Promise<{
    enabled: boolean;
    baseUrl: string;
    hlsPath: string;
    flvPath: string;
  }> {
    return {
      enabled: config.live.cdn.enabled,
      baseUrl: config.live.cdn.baseUrl,
      hlsPath: config.live.cdn.hlsPath,
      flvPath: config.live.cdn.flvPath,
    };
  }

  getProtocolStats(liveRoomId: string): Record<string, number> {
    const counters = this.protocolCounters.get(liveRoomId);
    if (!counters) return {};

    const result: Record<string, number> = {};
    for (const [protocol, count] of counters) {
      result[protocol] = count;
    }
    return result;
  }

  async getPlayHistory(
    liveRoomId: string,
    limit = 50
  ): Promise<any[]> {
    return prisma.liveViewer.findMany({
      where: { liveRoomId },
      orderBy: { connectedAt: 'desc' },
      take: limit,
    });
  }

  async getPlayStats(liveRoomId: string): Promise<any> {
    const viewers = await prisma.liveViewer.findMany({
      where: { liveRoomId },
    });

    const room = await prisma.liveRoom.findUnique({
      where: { id: liveRoomId },
      select: { viewCount: true, peakViewers: true },
    });

    const protocolStats: Record<string, number> = {};
    for (const v of viewers) {
      const proto = v.protocol.toLowerCase();
      protocolStats[proto] = (protocolStats[proto] || 0) + 1;
    }

    return {
      totalViews: room?.viewCount || 0,
      peakViewers: room?.peakViewers || 0,
      uniqueViewers: new Set(viewers.map(v => v.userId)).size,
      activeViewers: viewers.filter(v => v.isActive).length,
      protocolStats,
    };
  }

  cleanupExpiredSessions(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [token, session] of this.playSessions) {
      if (session.expiresAt < now) {
        this.playSessions.delete(token);
        cleaned++;

        const counters = this.protocolCounters.get(session.liveRoomId);
        if (counters) {
          const count = counters.get(session.protocol);
          if (count && count > 1) {
            counters.set(session.protocol, count - 1);
          } else {
            counters.delete(session.protocol);
          }
        }
      }
    }

    return cleaned;
  }

  destroy(): void {
    this.playSessions.clear();
    this.protocolCounters.clear();
    this.removeAllListeners();
  }
}

export const livePlayService = new LivePlayService();
