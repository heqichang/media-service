import { EventEmitter } from 'events';
import { LiveTranscodeConfig } from '../types';
import prisma from '../config/prisma';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

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
  process?: any;
}

class LiveTranscodeService extends EventEmitter {
  private activeTranscodes: Map<string, TranscodeSession[]> = new Map();
  private ffmpegProcesses: Map<string, any> = new Map();
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

  private buildFfmpegArgs(
    inputUrl: string,
    transcodeConfig: LiveTranscodeConfig,
    outputDir: string,
    outputId: string
  ): string[] {
    const videoBrKbps = Math.round((transcodeConfig.videoBitrate || 800000) / 1000);
    const audioBrKbps = Math.round((transcodeConfig.audioBitrate || 96000) / 1000);

    const args: string[] = [
      '-i', inputUrl,
      '-c:v', transcodeConfig.videoCodec === 'h264' ? 'libx264' : transcodeConfig.videoCodec === 'h265' ? 'libx265' : 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-b:v', `${videoBrKbps}k`,
      '-maxrate', `${Math.round(videoBrKbps * 1.2)}k`,
      '-bufsize', `${Math.round(videoBrKbps * 2)}k`,
    ];

    if (transcodeConfig.width && transcodeConfig.height) {
      args.push('-s', `${transcodeConfig.width}x${transcodeConfig.height}`);
    }

    if (transcodeConfig.framerate) {
      args.push('-r', String(transcodeConfig.framerate));
    }

    args.push(
      '-c:a', transcodeConfig.audioCodec === 'aac' ? 'aac' : 'libmp3lame',
      '-b:a', `${audioBrKbps}k`,
      '-ar', '44100',
      '-ac', '2',
    );

    args.push(
      '-f', 'hls',
      '-hls_time', String(config.live.hls.time),
      '-hls_list_size', String(config.live.hls.listSize),
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
      path.join(outputDir, 'index.m3u8'),
    );

    return args;
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

    if (inputUrl) {
      const ffmpegArgs = this.buildFfmpegArgs(inputUrl, transcodeConfig, outputDir, outputId);

      console.log('[LiveTranscode] Starting FFmpeg process:', {
        liveRoomId,
        name: transcodeConfig.name,
        resolution: `${transcodeConfig.width}x${transcodeConfig.height}`,
        bitrate: transcodeConfig.videoBitrate,
      });

      const proc = spawn(config.ffmpeg.ffmpegPath, ffmpegArgs, {
        stdio: 'pipe',
        shell: false,
      });

      if (proc.stderr) {
        proc.stderr.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            if (line.includes('error') || line.includes('Error')) {
              console.error(`[LiveTranscode][${transcodeConfig.name}]`, line);
            }
          }
        });
      }

      proc.on('error', (err: Error) => {
        console.error(`[LiveTranscode] FFmpeg error for ${transcodeConfig.name}:`, err.message);
        session.status = 'failed';
        prisma.liveTranscode.update({
          where: { id: transcode.id },
          data: { status: 'FAILED' },
        }).catch(console.error);
      });

      proc.on('exit', (code: number) => {
        console.log(`[LiveTranscode] FFmpeg exited with code ${code} for ${transcodeConfig.name}`);
        if (session.status === 'running') {
          session.status = code === 0 ? 'stopped' : 'failed';
          prisma.liveTranscode.update({
            where: { id: transcode.id },
            data: {
              status: code === 0 ? 'STOPPED' : 'FAILED',
              stoppedAt: new Date(),
            },
          }).catch(console.error);
        }
        this.ffmpegProcesses.delete(transcode.id);
      });

      session.process = proc;
      this.ffmpegProcesses.set(transcode.id, proc);
    }

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

      if (session.process) {
        try {
          session.process.kill('SIGTERM');
        } catch (err) {
          console.error('[LiveTranscode] Error killing FFmpeg process:', err);
        }
      }
    }

    this.ffmpegProcesses.delete(transcodeId);

    await prisma.liveTranscode.update({
      where: { id: transcodeId },
      data: { status: 'STOPPED', stoppedAt: new Date() },
    });

    this.emit('transcode:stop', { liveRoomId, transcodeId });
  }

  async stopAllTranscodes(liveRoomId: string): Promise<void> {
    const sessions = this.activeTranscodes.get(liveRoomId);
    if (!sessions) return;

    for (const session of [...sessions]) {
      session.status = 'stopped';

      if (session.process) {
        try {
          session.process.kill('SIGTERM');
        } catch (err) {
          console.error('[LiveTranscode] Error killing FFmpeg process:', err);
        }
      }

      await prisma.liveTranscode.update({
        where: { id: session.id },
        data: { status: 'STOPPED', stoppedAt: new Date() },
      });

      this.ffmpegProcesses.delete(session.id);
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
    for (const [id, proc] of this.ffmpegProcesses) {
      try {
        proc.kill('SIGTERM');
      } catch {}
    }
    this.ffmpegProcesses.clear();

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.removeAllListeners();
  }
}

export const liveTranscodeService = new LiveTranscodeService();
