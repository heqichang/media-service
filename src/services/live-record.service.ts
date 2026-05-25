import { EventEmitter } from 'events';
import { LiveRecordConfig } from '../types';
import prisma from '../config/prisma';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

export interface RecordSession {
  id: string;
  liveRoomId: string;
  format: string;
  status: 'recording' | 'stopped' | 'converting' | 'completed' | 'failed';
  filePath: string;
  startedAt: Date;
  stoppedAt?: Date;
  duration: number;
  segmentIndex: number;
  process?: any;
}

class LiveRecordService extends EventEmitter {
  private activeRecords: Map<string, RecordSession[]> = new Map();
  private sliceTimers: Map<string, NodeJS.Timeout> = new Map();
  private ffmpegProcesses: Map<string, any> = new Map();

  constructor() {
    super();
    this.setMaxListeners(100);
    this.ensureOutputDir();
  }

  private ensureOutputDir(): void {
    if (!fs.existsSync(config.live.record.outputDir)) {
      fs.mkdirSync(config.live.record.outputDir, { recursive: true });
    }
  }

  private buildRecordFfmpegArgs(
    inputUrl: string,
    format: string,
    outputPath: string
  ): string[] {
    const formatLower = format.toLowerCase();

    if (formatLower === 'hls') {
      const outputDir = path.dirname(outputPath);
      return [
        '-i', inputUrl,
        '-c', 'copy',
        '-f', 'hls',
        '-hls_time', String(config.live.hls.time),
        '-hls_list_size', '0',
        '-hls_flags', 'append_list',
        '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
        outputPath,
      ];
    }

    if (formatLower === 'mp4') {
      return [
        '-i', inputUrl,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-f', 'mp4',
        '-movflags', '+faststart',
        outputPath,
      ];
    }

    return [
      '-i', inputUrl,
      '-c', 'copy',
      '-f', formatLower,
      outputPath,
    ];
  }

  async startRecording(
    liveRoomId: string,
    recordConfig?: Partial<LiveRecordConfig>
  ): Promise<RecordSession> {
    const room = await prisma.liveRoom.findUnique({
      where: { id: liveRoomId },
    });

    if (!room) {
      throw new Error('Live room not found');
    }

    const format = (recordConfig?.format || room.recordFormat || config.live.record.defaultFormat).toUpperCase();
    const sliceDuration = recordConfig?.sliceDuration || config.live.record.sliceDuration;

    const recordingId = uuidv4();
    const fileName = `${liveRoomId}_${Date.now()}`;
    const fileExt = format.toLowerCase() === 'hls' ? 'm3u8' : format.toLowerCase();
    const filePath = path.join(config.live.record.outputDir, `${fileName}.${fileExt}`);

    const recording = await prisma.liveRecording.create({
      data: {
        liveRoomId,
        format: format as any,
        status: 'RECORDING',
        filePath,
        startedAt: new Date(),
        segmentIndex: 0,
        sliceDuration,
      },
    });

    const session: RecordSession = {
      id: recording.id,
      liveRoomId,
      format,
      status: 'recording',
      filePath,
      startedAt: new Date(),
      duration: 0,
      segmentIndex: 0,
    };

    if (!this.activeRecords.has(liveRoomId)) {
      this.activeRecords.set(liveRoomId, []);
    }
    this.activeRecords.get(liveRoomId)!.push(session);

    const inputUrl = `rtmp://127.0.0.1:${config.live.rtmp.port}/live/${room.streamKey}`;
    const ffmpegArgs = this.buildRecordFfmpegArgs(inputUrl, format, filePath);

    console.log('[LiveRecord] Starting FFmpeg recording:', {
      liveRoomId,
      format,
      filePath,
    });

    try {
      const proc = spawn(config.ffmpeg.ffmpegPath, ffmpegArgs, {
        stdio: 'pipe',
        shell: false,
      });

      if (proc.stderr) {
        proc.stderr.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            if (line.includes('error') || line.includes('Error')) {
              console.error(`[LiveRecord][${liveRoomId}]`, line);
            }
          }
        });
      }

      proc.on('error', (err: Error) => {
        console.error(`[LiveRecord] FFmpeg error for ${liveRoomId}:`, err.message);
        session.status = 'failed';
        prisma.liveRecording.update({
          where: { id: recording.id },
          data: { status: 'FAILED' },
        }).catch(console.error);
      });

      proc.on('exit', (code: number) => {
        console.log(`[LiveRecord] FFmpeg exited with code ${code} for ${liveRoomId}`);
        if (session.status === 'recording') {
          session.status = 'stopped';
        }
        this.ffmpegProcesses.delete(recording.id);
      });

      session.process = proc;
      this.ffmpegProcesses.set(recording.id, proc);
    } catch (error: any) {
      console.error('[LiveRecord] Failed to start FFmpeg:', error.message);
      session.status = 'failed';
      await prisma.liveRecording.update({
        where: { id: recording.id },
        data: { status: 'FAILED' },
      });
    }

    if (sliceDuration && sliceDuration > 0) {
      this.setupSliceTimer(liveRoomId, recording.id, sliceDuration, format);
    }

    this.emit('record:start', session);

    return session;
  }

  private setupSliceTimer(
    liveRoomId: string,
    recordingId: string,
    sliceDuration: number,
    format: string
  ): void {
    const timerKey = `${liveRoomId}_${recordingId}`;

    if (this.sliceTimers.has(timerKey)) {
      clearTimeout(this.sliceTimers.get(timerKey)!);
    }

    const timer = setTimeout(async () => {
      await this.sliceRecording(liveRoomId, recordingId, format);
    }, sliceDuration * 1000);

    this.sliceTimers.set(timerKey, timer);
  }

  private async sliceRecording(
    liveRoomId: string,
    parentRecordingId: string,
    format: string
  ): Promise<void> {
    const sessions = this.activeRecords.get(liveRoomId);
    if (!sessions) return;

    const parentSession = sessions.find(s => s.id === parentRecordingId);
    if (!parentSession || parentSession.status !== 'recording') return;

    if (parentSession.process) {
      try {
        parentSession.process.kill('SIGTERM');
      } catch {}
    }

    await this.stopRecordingSegment(liveRoomId, parentRecordingId, true);

    const newRecordingId = uuidv4();
    const newFileName = `${liveRoomId}_${Date.now()}`;
    const fileExt = format.toLowerCase() === 'hls' ? 'm3u8' : format.toLowerCase();
    const newFilePath = path.join(config.live.record.outputDir, `${newFileName}.${fileExt}`);

    const newRecording = await prisma.liveRecording.create({
      data: {
        liveRoomId,
        format: format as any,
        status: 'RECORDING',
        filePath: newFilePath,
        startedAt: new Date(),
        segmentIndex: parentSession.segmentIndex + 1,
        sliceDuration: config.live.record.sliceDuration,
      },
    });

    const newSession: RecordSession = {
      id: newRecording.id,
      liveRoomId,
      format,
      status: 'recording',
      filePath: newFilePath,
      startedAt: new Date(),
      duration: 0,
      segmentIndex: parentSession.segmentIndex + 1,
    };

    const room = await prisma.liveRoom.findUnique({
      where: { id: liveRoomId },
    });

    if (room) {
      const inputUrl = `rtmp://127.0.0.1:${config.live.rtmp.port}/live/${room.streamKey}`;
      const ffmpegArgs = this.buildRecordFfmpegArgs(inputUrl, format, newFilePath);

      try {
        const proc = spawn(config.ffmpeg.ffmpegPath, ffmpegArgs, {
          stdio: 'pipe',
          shell: false,
        });

        if (proc.stderr) {
          proc.stderr.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              if (line.includes('error') || line.includes('Error')) {
                console.error(`[LiveRecord][${liveRoomId}]`, line);
              }
            }
          });
        }

        proc.on('error', (err: Error) => {
          console.error(`[LiveRecord] FFmpeg error for slice ${liveRoomId}:`, err.message);
          newSession.status = 'failed';
        });

        proc.on('exit', (code: number) => {
          console.log(`[LiveRecord] FFmpeg slice exited with code ${code} for ${liveRoomId}`);
          if (newSession.status === 'recording') {
            newSession.status = 'stopped';
          }
          this.ffmpegProcesses.delete(newRecording.id);
        });

        newSession.process = proc;
        this.ffmpegProcesses.set(newRecording.id, proc);
      } catch (error: any) {
        console.error('[LiveRecord] Failed to start FFmpeg slice:', error.message);
        newSession.status = 'failed';
      }
    }

    sessions.push(newSession);

    const sliceDuration = config.live.record.sliceDuration;
    if (sliceDuration > 0) {
      this.setupSliceTimer(liveRoomId, newRecording.id, sliceDuration, format);
    }

    this.emit('record:slice', {
      liveRoomId,
      parentId: parentRecordingId,
      newId: newRecording.id,
      segmentIndex: newSession.segmentIndex,
    });
  }

  async stopRecordingSegment(
    liveRoomId: string,
    recordingId: string,
    isSlice = false
  ): Promise<void> {
    const sessions = this.activeRecords.get(liveRoomId);
    if (!sessions) return;

    const session = sessions.find(s => s.id === recordingId);
    if (!session) return;

    if (session.process) {
      try {
        session.process.kill('SIGTERM');
      } catch {}
    }

    this.ffmpegProcesses.delete(recordingId);

    const stoppedAt = new Date();
    const startMs = session.startedAt.getTime();
    const stopMs = stoppedAt.getTime();
    const duration = Math.floor((stopMs - startMs) / 1000);

    session.status = isSlice ? 'completed' : 'stopped';
    session.stoppedAt = stoppedAt;
    session.duration = duration;

    let fileSize: number | undefined;
    try {
      if (fs.existsSync(session.filePath)) {
        const stats = fs.statSync(session.filePath);
        fileSize = stats.size;
      }
    } catch {
    }

    await prisma.liveRecording.update({
      where: { id: recordingId },
      data: {
        status: isSlice ? 'COMPLETED' : 'STOPPED',
        stoppedAt,
        duration,
        fileSize: fileSize ? BigInt(fileSize) : undefined,
      },
    });

    const timerKey = `${liveRoomId}_${recordingId}`;
    if (this.sliceTimers.has(timerKey)) {
      clearTimeout(this.sliceTimers.get(timerKey)!);
      this.sliceTimers.delete(timerKey);
    }

    if (config.live.record.autoConvertVod && !isSlice) {
      await this.convertToVod(liveRoomId, recordingId);
    }

    this.emit('record:stop', {
      liveRoomId,
      recordingId,
      duration,
      isSlice,
    });
  }

  async stopAllRecordings(liveRoomId: string): Promise<void> {
    const sessions = this.activeRecords.get(liveRoomId);
    if (!sessions) return;

    for (const session of [...sessions]) {
      session.status = 'stopped';

      if (session.process) {
        try {
          session.process.kill('SIGTERM');
        } catch {}
      }

      this.ffmpegProcesses.delete(session.id);

      await this.stopRecordingSegment(liveRoomId, session.id);
    }

    this.activeRecords.delete(liveRoomId);
    this.emit('record:stop-all', { liveRoomId });
  }

  async convertToVod(
    liveRoomId: string,
    recordingId: string
  ): Promise<string | undefined> {
    const recording = await prisma.liveRecording.findUnique({
      where: { id: recordingId },
      include: { liveRoom: true },
    });

    if (!recording || !recording.filePath) return;

    await prisma.liveRecording.update({
      where: { id: recordingId },
      data: { status: 'CONVERTING' },
    });

    const videoId = uuidv4();

    try {
      const video = await prisma.video.create({
        data: {
          id: videoId,
          title: recording.liveRoom.title + '_Recording_' + new Date(recording.startedAt).toLocaleString(),
          description: recording.liveRoom.description || 'Live Recording',
          fileName: path.basename(recording.filePath),
          originalPath: recording.filePath,
          fileSize: recording.fileSize || BigInt(0),
          duration: recording.duration,
          status: 'UPLOADED',
          categoryId: recording.liveRoom.categoryId,
        },
      });

      await prisma.liveRecording.update({
        where: { id: recordingId },
        data: {
          status: 'COMPLETED',
          videoId: video.id,
        },
      });

      this.emit('record:convert-success', {
        liveRoomId,
        recordingId,
        videoId: video.id,
      });

      return video.id;
    } catch (error: any) {
      await prisma.liveRecording.update({
        where: { id: recordingId },
        data: { status: 'FAILED' },
      });
      this.emit('record:convert-error', {
        liveRoomId,
        recordingId,
        error: error.message,
      });
    }
  }

  getActiveRecords(liveRoomId: string): RecordSession[] {
    return this.activeRecords.get(liveRoomId) || [];
  }

  isRecording(liveRoomId: string): boolean {
    const sessions = this.activeRecords.get(liveRoomId);
    return sessions !== undefined && sessions.some(s => s.status === 'recording');
  }

  async getRecordingHistory(
    liveRoomId: string, limit = 50): Promise<any[]> {
    return prisma.liveRecording.findMany({
      where: { liveRoomId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { video: true },
    });
  }

  async getRecordingStats(liveRoomId: string): Promise<any> {
    const recordings = await prisma.liveRecording.findMany({
      where: { liveRoomId },
    });

    const totalDuration = recordings.reduce((sum, r) => sum + (r.duration || 0), 0);
    const totalSize = recordings.reduce((sum, r) => sum + Number(r.fileSize || 0), 0);

    return {
      totalRecordings: recordings.length,
      totalDuration,
      totalSize,
      completedCount: recordings.filter(r => r.status === 'COMPLETED').length,
      formats: [...new Set(recordings.map(r => r.format))],
    };
  }

  async uploadToStorage(recordingId: string): Promise<string | undefined> {
    const recording = await prisma.liveRecording.findUnique({
      where: { id: recordingId },
    });

    if (!recording || !recording.filePath) return;

    return recording.filePath;
  }

  cleanupOldRecords(maxAgeDays = 30): Promise<number> {
    return new Promise((resolve) => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

      prisma.liveRecording.findMany({
        where: {
          createdAt: { lt: cutoffDate },
          status: { in: ['COMPLETED', 'STOPPED'] },
        },
      }).then((oldRecords) => {
        let deletedCount = 0;
        for (const record of oldRecords) {
          if (record.filePath && fs.existsSync(record.filePath)) {
            try {
              fs.unlinkSync(record.filePath);
              deletedCount++;
            } catch {
            }
          }
        }
        resolve(deletedCount);
      });
    });
  }

  destroy(): void {
    for (const [id, proc] of this.ffmpegProcesses) {
      try {
        proc.kill('SIGTERM');
      } catch {}
    }
    this.ffmpegProcesses.clear();

    for (const [key, timer] of this.sliceTimers) {
      clearTimeout(timer);
    }
    this.sliceTimers.clear();

    this.removeAllListeners();
  }
}

export const liveRecordService = new LiveRecordService();
