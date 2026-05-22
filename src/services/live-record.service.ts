import { EventEmitter } from 'events';
import { LiveRecordConfig } from '../types';
import prisma from '../config/prisma';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

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
}

class LiveRecordService extends EventEmitter {
  private activeRecords: Map<string, RecordSession[]> = new Map();
  private sliceTimers: Map<string, NodeJS.Timeout> = new Map();

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
    const filePath = path.join(config.live.record.outputDir, `${fileName}.${format.toLowerCase()}`);

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

    await this.stopRecordingSegment(liveRoomId, parentRecordingId, true);

    const newRecordingId = uuidv4();
    const newFileName = `${liveRoomId}_${Date.now()}`;
    const newFilePath = path.join(config.live.record.outputDir, `${newFileName}.${format.toLowerCase()}`);

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

    for (const session of sessions) {
      session.status = 'stopped';
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
}

export const liveRecordService = new LiveRecordService();
