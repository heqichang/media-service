import { EventEmitter } from 'events';
import { LiveTranscodeConfig } from '../types';
import prisma from '../config/prisma';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

export interface TranscodeSession {
  id: string;
  liveRoomId: string;
  name: string;
  config: LiveTranscodeConfig;
  outputUrl: string;
  outputPath: string;
  status: 'running' | 'stopped' | 'failed' | 'switched';
  latencyMs: number;
  startedAt: Date;
  isBackup: boolean;
  mainTranscodeId?: string;
}

class LiveTranscodeService extends EventEmitter {
  private activeTranscodes: Map<string, TranscodeSession[]> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.setMaxListeners(100);
    this.startHealthCheck();
  }

  private startHealthCheck(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(() => {
      this.checkAllTranscodes();
    }, config.live.transcode.checkInterval);
  }

  private async checkAllTranscodes(): Promise<void> {
    const transcodes = await prisma.liveTranscode.findMany({
      where: { status: 'RUNNING' },
      include: { liveRoom: true },
    });

    for (const t of transcodes) {
      try {
        const latency = await this.measureLatency(t.outputUrl || '');
        await prisma.liveTranscode.update({
          where: { id: t.id },
          data: { latencyMs: latency, lastCheckAt: new Date() },
        });

        if (latency > config.live.transcode.maxLatencyMs && !t.isBackup) {
          this.emit('transcode:high-latency', {
            transcodeId: t.id,
            liveRoomId: t.liveRoomId,
            latency,
          });

          if (config.live.transcode.autoSwitchBackup) {
            this.switchToBackup(t.liveRoomId, t.id);
          }
        }
      } catch (error: any) {
        await prisma.liveTranscode.update({
          where: { id: t.id },
          data: { status: 'FAILED', errorMessage: error.message },
        });
        this.emit('transcode:error', { transcodeId: t.id, error: error.message });
      }
    }
  }

  private async measureLatency(outputUrl: string): Promise<number> {
    if (!outputUrl || !outputUrl.startsWith('http')) return 0;

    const start = Date.now();
    try {
      const response = await fetch(outputUrl, { method: 'HEAD' });
      if (response.ok) {
        return Date.now() - start;
      }
    } catch {
      return Date.now() - start;
    }
    return Date.now() - start;
  }

  async startTranscode(
    liveRoomId: string,
    transcodeConfig: LiveTranscodeConfig,
    inputUrl: string
  ): Promise<TranscodeSession> {
    const outputId = uuidv4();
    const outputDir = path.join(config.live.hls.segmentDir, liveRoomId, outputId);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputUrl = `/hls/${liveRoomId}/${outputId}/index.m3u8`;
    const outputPath = path.join(outputDir, 'index.m3u8');

    const transcode = await prisma.liveTranscode.create({
      data: {
        liveRoomId,
        name: transcodeConfig.name,
        width: transcodeConfig.width,
        height: transcodeConfig.height,
        videoBitrate: transcodeConfig.videoBitrate,
        audioBitrate: transcodeConfig.audioBitrate,
        videoCodec: (transcodeConfig.videoCodec || 'h264').toUpperCase() as any,
        audioCodec: (transcodeConfig.audioCodec || 'aac').toUpperCase() as any,
        framerate: transcodeConfig.framerate,
        status: 'RUNNING',
        outputUrl,
        outputPath,
        isBackup: transcodeConfig.isBackup || false,
        startedAt: new Date(),
      },
    });

    const session: TranscodeSession = {
      id: transcode.id,
      liveRoomId,
      name: transcodeConfig.name,
      config: transcodeConfig,
      outputUrl,
      outputPath,
      status: 'running',
      latencyMs: 0,
      startedAt: new Date(),
      isBackup: transcodeConfig.isBackup || false,
    };

    if (!this.activeTranscodes.has(liveRoomId)) {
      this.activeTranscodes.set(liveRoomId, []);
    }
    this.activeTranscodes.get(liveRoomId)!.push(session);

    this.emit('transcode:start', session);

    return session;
  }

  async startTranscodes(
    liveRoomId: string,
    configs: LiveTranscodeConfig[],
    inputUrl: string
  ): Promise<TranscodeSession[]> {
    const sessions: TranscodeSession[] = [];

    for (const config of configs) {
      const session = await this.startTranscode(liveRoomId, config, inputUrl);
      sessions.push(session);
    }

    return sessions;
  }

  async stopTranscode(liveRoomId: string, transcodeId: string): Promise<void> {
    const sessions = this.activeTranscodes.get(liveRoomId);
    if (!sessions) return;

    const session = sessions.find(s => s.id === transcodeId);
    if (session) {
      session.status = 'stopped';
      const index = sessions.indexOf(session);
      sessions.splice(index, 1);
    }

    await prisma.liveTranscode.update({
      where: { id: transcodeId },
      data: { status: 'STOPPED', stoppedAt: new Date() },
    });

    this.emit('transcode:stop', { liveRoomId, transcodeId });
  }

  async stopAllTranscodes(liveRoomId: string): Promise<void> {
    const sessions = this.activeTranscodes.get(liveRoomId);
    if (!sessions) return;

    for (const session of sessions) {
      session.status = 'stopped';
      await prisma.liveTranscode.update({
        where: { id: session.id },
        data: { status: 'STOPPED', stoppedAt: new Date() },
      });
    }

    this.activeTranscodes.delete(liveRoomId);
    this.emit('transcode:stop-all', { liveRoomId });
  }

  async switchToBackup(liveRoomId: string, mainTranscodeId: string): Promise<TranscodeSession | null> {
    const backups = await prisma.liveTranscode.findMany({
      where: {
        liveRoomId,
        isBackup: true,
        mainTranscodeId,
        status: { not: 'RUNNING' },
      },
    });

    if (backups.length === 0) return null;

    const backup = backups[0];

    await prisma.liveTranscode.update({
      where: { id: mainTranscodeId },
      data: { status: 'SWITCHED', errorMessage: 'Switched to backup due to high latency' },
    });

    await prisma.liveTranscode.update({
      where: { id: backup.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    const sessions = this.activeTranscodes.get(liveRoomId);
    if (sessions) {
      const mainSession = sessions.find(s => s.id === mainTranscodeId);
      if (mainSession) mainSession.status = 'switched';

      const backupSession = sessions.find(s => s.id === backup.id);
      if (backupSession) backupSession.status = 'running';
    }

    this.emit('transcode:backup-switch', {
      liveRoomId,
      mainTranscodeId,
      backupTranscodeId: backup.id,
    });

    return sessions?.find(s => s.id === backup.id) || null;
  }

  async createBackupTranscode(
    liveRoomId: string,
    mainTranscodeId: string,
    config: LiveTranscodeConfig
  ): Promise<TranscodeSession> {
    const backupConfig: LiveTranscodeConfig = {
      ...config,
      isBackup: true,
      name: `${config.name}_backup`,
    };

    const session = await this.startTranscode(
      liveRoomId,
      backupConfig,
      ''
    );

    await prisma.liveTranscode.update({
      where: { id: session.id },
      data: { mainTranscodeId, status: 'STOPPED' },
    });

    session.mainTranscodeId = mainTranscodeId;
    session.status = 'stopped';

    return session;
  }

  getActiveTranscodes(liveRoomId: string): TranscodeSession[] {
    return this.activeTranscodes.get(liveRoomId) || [];
  }

  getRunningTranscodes(liveRoomId: string): TranscodeSession[] {
    return this.getActiveTranscodes(liveRoomId).filter(t => t.status === 'running');
  }

  async getTranscodeHistory(liveRoomId: string, limit = 50): Promise<any[]> {
    return prisma.liveTranscode.findMany({
      where: { liveRoomId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { template: true },
    });
  }

  async getTranscodeStats(liveRoomId: string): Promise<any> {
    const transcodes = await prisma.liveTranscode.findMany({
      where: { liveRoomId },
    });

    const running = transcodes.filter(t => t.status === 'RUNNING');
    const avgLatency = running.length > 0
      ? running.reduce((sum, t) => sum + t.latencyMs, 0) / running.length
      : 0;

    return {
      totalTranscodes: transcodes.length,
      runningCount: running.length,
      averageLatency: Math.round(avgLatency),
      maxLatency: Math.max(...running.map(t => t.latencyMs), 0),
      resolutions: running.map(t => ({
        id: t.id,
        name: t.name,
        resolution: `${t.width}x${t.height}`,
        bitrate: t.videoBitrate,
        latency: t.latencyMs,
        isBackup: t.isBackup,
      })),
    };
  }

  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.removeAllListeners();
  }
}

export const liveTranscodeService = new LiveTranscodeService();
