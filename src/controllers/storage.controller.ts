import { Request, Response } from 'express';
import { successResponse, errorResponse } from '../utils/response';
import { storageService } from '../services/storage.service';
import { formatFileSize } from '../utils/response';

export class StorageController {
  static async getStats(req: Request, res: Response) {
    try {
      const stats = await storageService.getStorageStats();

      successResponse(res, {
        videos: {
          ...stats.videos,
          sizeFormatted: formatFileSize(stats.videos.size),
        },
        thumbnails: {
          ...stats.thumbnails,
          sizeFormatted: formatFileSize(stats.thumbnails.size),
        },
        total: {
          count: stats.videos.count + stats.thumbnails.count,
          size: stats.videos.size + stats.thumbnails.size,
          sizeFormatted: formatFileSize(stats.videos.size + stats.thumbnails.size),
        },
      });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getSignedUrl(req: Request, res: Response) {
    try {
      const { objectName, type = 'video' } = req.params;
      const expires = parseInt(req.query.expires as string) || 24 * 60 * 60;

      let url: string;

      if (type === 'thumbnail') {
        url = await storageService.getThumbnailUrl(objectName, expires);
      } else {
        url = await storageService.getVideoUrl(objectName, expires);
      }

      successResponse(res, { url, expires });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async listObjects(req: Request, res: Response) {
    try {
      const prefix = req.query.prefix as string;
      const bucket = req.query.bucket as string || 'videos';

      const objects = await storageService.listVideos(prefix);

      successResponse(
        res,
        objects.map((obj) => ({
          name: obj.name,
          size: obj.size,
          sizeFormatted: formatFileSize(obj.size || 0),
          lastModified: obj.lastModified,
          etag: obj.etag,
        }))
      );
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async deleteObject(req: Request, res: Response) {
    try {
      const { objectName, type = 'video' } = req.params;

      if (type === 'thumbnail') {
        await storageService.deleteThumbnail(objectName);
      } else {
        await storageService.deleteVideo(objectName);
      }

      successResponse(res, null, 'Object deleted successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }
}
