import { Request, Response } from 'express';
import { successResponse, errorResponse } from '../utils/response';
import { liveInteractService } from '../services/live-interact.service';
import prisma from '../config/prisma';

export class LiveInteractController {
  static async sendDanmaku(req: Request, res: Response) {
    try {
      const { liveRoomId } = req.params;
      const { userId, userName, content, color, fontSize, mode } = req.body;

      if (!userId || !userName || !content) {
        return errorResponse(res, 'Missing required fields', 400);
      }

      const result = await liveInteractService.sendDanmaku(
        liveRoomId,
        userId,
        userName,
        content,
        color,
        fontSize,
        mode
      );

      if (!result) {
        return errorResponse(res, 'Failed to send danmaku', 429);
      }

      successResponse(res, result, 'Danmaku sent successfully', 201);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getDanmakus(req: Request, res: Response) {
    try {
      const { liveRoomId } = req.params;
      const { limit, offset } = req.query;

      const history = await liveInteractService.getDanmakuHistory(
        liveRoomId,
        limit ? parseInt(limit as string) : undefined,
        offset ? parseInt(offset as string) : undefined
      );

      const cached = liveInteractService.getCachedDanmakus(liveRoomId);

      successResponse(res, { history, recent: cached });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async hideDanmaku(req: Request, res: Response) {
    try {
      const { id } = req.params;

      await liveInteractService.hideDanmaku(id);

      successResponse(res, null, 'Danmaku hidden successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async banDanmaku(req: Request, res: Response) {
    try {
      const { id } = req.params;

      await liveInteractService.banDanmaku(id);

      successResponse(res, null, 'Danmaku banned successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async sendGift(req: Request, res: Response) {
    try {
      const { liveRoomId } = req.params;
      const { giftId, userId, userName, quantity } = req.body;

      if (!giftId || !userId || !userName) {
        return errorResponse(res, 'Missing required fields', 400);
      }

      const result = await liveInteractService.sendGift(
        liveRoomId,
        giftId,
        userId,
        userName,
        quantity || 1
      );

      if (!result) {
        return errorResponse(res, 'Failed to send gift', 400);
      }

      successResponse(res, result, 'Gift sent successfully', 201);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getGifts(req: Request, res: Response) {
    try {
      const gifts = await liveInteractService.getGiftList();

      successResponse(res, { gifts });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async createGift(req: Request, res: Response) {
    try {
      const { name, iconUrl, price, value, sortOrder } = req.body;

      if (!name || !iconUrl || price === undefined || value === undefined) {
        return errorResponse(res, 'Missing required fields', 400);
      }

      const gift = await liveInteractService.createGift(
        name,
        iconUrl,
        price,
        value,
        sortOrder
      );

      successResponse(res, gift, 'Gift created successfully', 201);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async updateGift(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { name, iconUrl, price, value, status, sortOrder } = req.body;

      const gift = await liveInteractService.updateGift(id, {
        name,
        iconUrl,
        price,
        value,
        status: status as any,
        sortOrder,
      });

      successResponse(res, gift, 'Gift updated successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getGiftHistory(req: Request, res: Response) {
    try {
      const { liveRoomId } = req.params;
      const { limit } = req.query;

      const history = await liveInteractService.getGiftHistory(
        liveRoomId,
        limit ? parseInt(limit as string) : undefined
      );

      successResponse(res, { history });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getGiftStats(req: Request, res: Response) {
    try {
      const { liveRoomId } = req.params;

      const stats = await liveInteractService.getGiftStats(liveRoomId);

      successResponse(res, stats);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async sendLike(req: Request, res: Response) {
    try {
      const { liveRoomId } = req.params;
      const { userId, count } = req.body;

      if (!userId) {
        return errorResponse(res, 'Missing required fields', 400);
      }

      const result = await liveInteractService.sendLike(
        liveRoomId,
        userId,
        count || 1
      );

      successResponse(res, result, 'Like sent successfully', 201);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getLikeCount(req: Request, res: Response) {
    try {
      const { liveRoomId } = req.params;

      const count = await liveInteractService.getLikeCount(liveRoomId);

      successResponse(res, { count });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getOnlineUsers(req: Request, res: Response) {
    try {
      const { liveRoomId } = req.params;

      const users = liveInteractService.getOnlineUsers(liveRoomId);
      const count = liveInteractService.getOnlineCount(liveRoomId);

      successResponse(res, { count, users });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getDanmakuStats(req: Request, res: Response) {
    try {
      const { liveRoomId } = req.params;

      const count = await prisma.danmaku.count({
        where: {
          liveRoomId,
          status: { not: 'BANNED' },
        },
      });

      successResponse(res, { count });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }
}
