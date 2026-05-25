import { Request, Response } from 'express';
import { successResponse, errorResponse } from '../utils/response';
import { liveRoomService } from '../services/live-room.service';
import { liveStreamService } from '../services/live-stream.service';
import { liveTranscodeService } from '../services/live-transcode.service';
import { liveRecordService } from '../services/live-record.service';
import { livePlayService } from '../services/live-play.service';
import { config } from '../config';
import prisma from '../config/prisma';
import fs from 'fs';
import { LiveTranscodeConfig, LiveRecordConfig } from '../types';

export class LiveRoomController {
  static async createRoom(req: Request, res: Response) {
    try {
      const { title, description, coverUrl, categoryId, isPublic, isRecorded, recordFormat, maxBitrate, viewPassword } = req.body;

      if (!title) {
        return errorResponse(res, 'Title is required', 400);
      }

      const room = await liveRoomService.createRoom({
        title,
        description,
        coverUrl,
        categoryId,
        isPublic,
        isRecorded,
        recordFormat,
        maxBitrate,
        viewPassword,
      });

      successResponse(res, room, 'Live room created successfully', 201);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getRooms(req: Request, res: Response) {
    try {
      const { page, pageSize, status, categoryId, search } = req.query;

      const result = await liveRoomService.getRooms({
        page: page ? parseInt(page as string) : undefined,
        pageSize: pageSize ? parseInt(pageSize as string) : undefined,
        status: status as string | undefined,
        categoryId: categoryId as string | undefined,
        search: search as string | undefined,
      });

      successResponse(res, result);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getRoom(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const room = await liveRoomService.getRoom(id);

      if (!room) {
        return errorResponse(res, 'Live room not found', 404);
      }

      successResponse(res, room);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async updateRoom(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { title, description, coverUrl, categoryId, isPublic, isRecorded, recordFormat, maxBitrate, viewPassword } = req.body;

      const room = await liveRoomService.updateRoom(id, {
        title,
        description,
        coverUrl,
        categoryId,
        isPublic,
        isRecorded,
        recordFormat,
        maxBitrate,
        viewPassword,
      });

      successResponse(res, room, 'Live room updated successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async deleteRoom(req: Request, res: Response) {
    try {
      const { id } = req.params;

      await liveRoomService.deleteRoom(id);

      successResponse(res, null, 'Live room deleted successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async banRoom(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const room = await liveRoomService.banRoom(id, reason);

      successResponse(res, room, 'Live room banned successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async unbanRoom(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const room = await liveRoomService.unbanRoom(id);

      successResponse(res, room, 'Live room unbanned successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async resetStreamKey(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const result = await liveRoomService.resetStreamKey(id);

      successResponse(res, result, 'Stream key reset successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getRoomStats(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const stats = await liveRoomService.getRoomStats(id);

      successResponse(res, stats);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getStreamConfig(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const room = await liveRoomService.getRoom(id);

      if (!room) {
        return errorResponse(res, 'Live room not found', 404);
      }

      const host = config.server.publicHost || req.hostname || 'localhost';
      const pushUrl = `rtmp://${host}:${config.live.rtmp.port}/live`;
      const playUrls = await livePlayService.getPlayUrls(id, host);

      successResponse(res, {
        streamKey: room.streamKey,
        pushUrl,
        playUrls,
        status: room.status,
        rtmpPort: config.live.rtmp.port,
        httpPort: config.live.flv.port,
        host,
      });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getActiveStreams(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const streams = liveStreamService.getActiveStreams(id);

      successResponse(res, {
        active: streams.length > 0,
        streams,
        primary: liveStreamService.getPrimaryStream(id),
      });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getStreamHistory(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { limit } = req.query;

      const history = await liveStreamService.getStreamHistory(
        id,
        limit ? parseInt(limit as string) : undefined
      );

      successResponse(res, { history });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getStreamStats(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const stats = await liveStreamService.getStreamStats(id);

      successResponse(res, stats);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getTranscodeStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const transcodes = await prisma.liveTranscode.findMany({
        where: { liveRoomId: id, status: 'RUNNING' },
        orderBy: { createdAt: 'desc' },
        include: { template: true },
      });
      const history = await liveTranscodeService.getTranscodeHistory(id);

      successResponse(res, { active: transcodes, history });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getTranscodeStats(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const stats = await liveTranscodeService.getTranscodeStats(id);

      successResponse(res, stats);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async startTranscode(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { transcodeConfigs, templateIds } = req.body;

      if (!transcodeConfigs && !templateIds) {
        return errorResponse(res, 'transcodeConfigs or templateIds is required', 400);
      }

      const room = await prisma.liveRoom.findUnique({
        where: { id },
        include: { streams: { where: { status: 'PUSHING' } } },
      });

      if (!room) {
        return errorResponse(res, 'Live room not found', 404);
      }

      if (room.streams.length === 0) {
        return errorResponse(res, 'No active stream found', 400);
      }

      const stream = room.streams[0];
      const inputUrl = `rtmp://localhost:${config.live.rtmp.port}/live/${room.streamKey}`;

      let configs: LiveTranscodeConfig[] = [];

      if (templateIds && Array.isArray(templateIds)) {
        const templates = await prisma.transcodeTemplate.findMany({
          where: { id: { in: templateIds } },
        });

        configs = templates.map(t => ({
          name: t.name,
          width: t.width || 1920,
          height: t.height || 1080,
          videoBitrate: t.videoBitrate || 4000,
          audioBitrate: t.audioBitrate || 128,
          videoCodec: (t.videoCodec as any).toLowerCase() as any,
          audioCodec: (t.audioCodec as any).toLowerCase() as any,
          framerate: t.framerate,
        }));
      } else if (transcodeConfigs && Array.isArray(transcodeConfigs)) {
        configs = transcodeConfigs.map((c: any) => ({
          name: c.name,
          width: c.width,
          height: c.height,
          videoBitrate: c.videoBitrate,
          audioBitrate: c.audioBitrate,
          videoCodec: c.videoCodec,
          audioCodec: c.audioCodec,
          framerate: c.framerate,
          isBackup: c.isBackup,
        }));
      }

      const sessions = await liveTranscodeService.startTranscodes(id, configs, inputUrl);

      successResponse(res, { sessions, count: sessions.length }, 'Transcode started successfully', 201);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async stopTranscode(req: Request, res: Response) {
    try {
      const { id, transcodeId } = req.params;

      await liveTranscodeService.stopTranscode(id, transcodeId);

      successResponse(res, null, 'Transcode stopped successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getRecordings(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { limit, status } = req.query;

      const where: any = { liveRoomId: id };
      if (status) {
        where.status = status;
      }

      const history = await prisma.liveRecording.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit ? parseInt(limit as string) : 50,
        include: { video: true },
      });
      const active = liveRecordService.getActiveRecords(id);

      successResponse(res, { active, history });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getRecordingStats(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const stats = await liveRecordService.getRecordingStats(id);

      successResponse(res, stats);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async startRecording(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { format, sliceDuration, autoConvertVod } = req.body;

      const room = await prisma.liveRoom.findUnique({
        where: { id },
      });

      if (!room) {
        return errorResponse(res, 'Live room not found', 404);
      }

      const recordConfig: Partial<LiveRecordConfig> = {};
      if (format) recordConfig.format = format;
      if (sliceDuration) recordConfig.sliceDuration = sliceDuration;
      if (autoConvertVod) recordConfig.autoConvertVod = autoConvertVod;

      const session = await liveRecordService.startRecording(id, recordConfig);

      successResponse(res, session, 'Recording started successfully', 201);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async stopRecording(req: Request, res: Response) {
    try {
      const { id, recordingId } = req.params;

      await liveRecordService.stopRecordingSegment(id, recordingId);

      successResponse(res, null, 'Recording stopped successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async convertRecordingToVod(req: Request, res: Response) {
    try {
      const { id, recordingId } = req.params;

      const videoId = await liveRecordService.convertToVod(id, recordingId);

      if (!videoId) {
        return errorResponse(res, 'Failed to convert recording to VOD', 500);
      }

      successResponse(res, { videoId }, 'Recording converted to VOD successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async deleteRecording(req: Request, res: Response) {
    try {
      const { id, recordingId } = req.params;

      const recording = await prisma.liveRecording.findUnique({
        where: { id: recordingId },
      });

      if (!recording) {
        return errorResponse(res, 'Recording not found', 404);
      }

      if (recording.status === 'RECORDING') {
        await liveRecordService.stopRecordingSegment(id, recordingId);
      }

      if (recording.filePath && fs.existsSync(recording.filePath)) {
        try {
          fs.unlinkSync(recording.filePath);
        } catch {
        }
      }

      await prisma.liveRecording.delete({
        where: { id: recordingId },
      });

      successResponse(res, null, 'Recording deleted successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getPlayUrls(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const host = config.server.publicHost || req.hostname || 'localhost';
      const urls = await livePlayService.getPlayUrls(id, host);

      successResponse(res, urls);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getPlayStats(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const stats = await livePlayService.getPlayStats(id);

      successResponse(res, stats);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async createPlan(req: Request, res: Response) {
    try {
      const { liveRoomId, title, scheduledAt, duration, description } = req.body;

      if (!liveRoomId || !title || !scheduledAt || !duration) {
        return errorResponse(res, 'Missing required fields', 400);
      }

      const plan = await liveRoomService.createPlan({
        liveRoomId,
        title,
        scheduledAt: new Date(scheduledAt),
        duration,
        description,
      });

      successResponse(res, plan, 'Live plan created successfully', 201);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getPlans(req: Request, res: Response) {
    try {
      const { liveRoomId } = req.params;

      const plans = await liveRoomService.getPlans(liveRoomId);

      successResponse(res, { plans });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async deletePlan(req: Request, res: Response) {
    try {
      const { id } = req.params;

      await liveRoomService.deletePlan(id);

      successResponse(res, null, 'Live plan deleted successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getAllActiveRooms(req: Request, res: Response) {
    try {
      const roomIds = liveStreamService.getAllActiveRooms();

      successResponse(res, { activeRooms: roomIds, count: roomIds.length });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async verifyViewPassword(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { password } = req.body;

      if (password === undefined || password === null) {
        return errorResponse(res, 'Password is required', 400);
      }

      const isValid = await liveRoomService.verifyPassword(id, password);

      if (isValid) {
        successResponse(res, { valid: true }, 'Password verified successfully');
      } else {
        errorResponse(res, 'Invalid password', 401);
      }
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }
}
