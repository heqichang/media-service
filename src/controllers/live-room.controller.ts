import { Request, Response } from 'express';
import { successResponse, errorResponse } from '../utils/response';
import { liveRoomService } from '../services/live-room.service';
import { liveStreamService } from '../services/live-stream.service';
import { liveTranscodeService } from '../services/live-transcode.service';
import { liveRecordService } from '../services/live-record.service';
import { livePlayService } from '../services/live-play.service';
import { config } from '../config';

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

      const transcodes = liveTranscodeService.getActiveTranscodes(id);
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

  static async getRecordings(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { limit } = req.query;

      const history = await liveRecordService.getRecordingHistory(
        id,
        limit ? parseInt(limit as string) : undefined
      );
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
