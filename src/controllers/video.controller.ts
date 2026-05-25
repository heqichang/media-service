import { Request, Response } from 'express';
import { successResponse, errorResponse } from '../utils/response';
import prisma from '../config/prisma';
import { transcodeQueue, thumbnailQueue } from '../queues';
import { TranscodeTemplateService } from '../services/transcode-template.service';
import { FFmpegService } from '../services/ffmpeg.service';
import { config } from '../config';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { TranscodeOptions } from '../types';
import { VideoStatus } from '@prisma/client';

export class VideoController {
  static async getVideos(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;
      const search = req.query.search as string;
      const categoryId = req.query.categoryId as string;
      const status = req.query.status as string;
      const tag = req.query.tag as string;

      const where: any = {};

      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (categoryId) {
        where.categoryId = categoryId;
      }

      if (status) {
        where.status = status;
      }

      if (tag) {
        where.tags = {
          some: {
            tag: {
              name: { equals: tag, mode: 'insensitive' },
            },
          },
        };
      }

      const [videos, total] = await Promise.all([
        prisma.video.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            category: true,
            tags: { include: { tag: true } },
            transcodeTasks: { take: 5, orderBy: { createdAt: 'desc' } },
            thumbnails: { take: 3 },
            playlists: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.video.count({ where }),
      ]);

      successResponse(res, {
        items: videos,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getVideo(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const video = await prisma.video.findUnique({
        where: { id },
        include: {
          category: true,
          tags: { include: { tag: true } },
          transcodeTasks: { orderBy: { createdAt: 'desc' } },
          thumbnails: true,
          playlists: true,
        },
      });

      if (!video) {
        return errorResponse(res, 'Video not found', 404);
      }

      await prisma.video.update({
        where: { id },
        data: { views: { increment: 1 } },
      });

      successResponse(res, video);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async updateVideo(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { title, description, categoryId, tags, isPublic, expiresAt } = req.body;

      const video = await prisma.video.findUnique({ where: { id } });

      if (!video) {
        return errorResponse(res, 'Video not found', 404);
      }

      const updateData: any = {
        title,
        description,
        categoryId,
        isPublic,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      };

      if (tags && Array.isArray(tags)) {
        updateData.tags = {
          deleteMany: {},
          create: tags.map((tagName: string) => ({
            tag: {
              connectOrCreate: {
                where: { name: tagName },
                create: { name: tagName },
              },
            },
          })),
        };
      }

      const updatedVideo = await prisma.video.update({
        where: { id },
        data: updateData,
        include: {
          category: true,
          tags: { include: { tag: true } },
        },
      });

      successResponse(res, updatedVideo, 'Video updated successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async deleteVideo(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const video = await prisma.video.findUnique({ where: { id } });

      if (!video) {
        return errorResponse(res, 'Video not found', 404);
      }

      await prisma.$transaction([
        prisma.videoTag.deleteMany({ where: { videoId: id } }),
        prisma.transcodeTask.deleteMany({ where: { videoId: id } }),
        prisma.thumbnail.deleteMany({ where: { videoId: id } }),
        prisma.playlist.deleteMany({ where: { videoId: id } }),
        prisma.video.delete({ where: { id } }),
      ]);

      successResponse(res, null, 'Video deleted successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async publishVideo(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const video = await prisma.video.findUnique({ where: { id } });

      if (!video) {
        return errorResponse(res, 'Video not found', 404);
      }

      if (video.status !== 'TRANSCODED' && video.status !== 'PUBLISHED') {
        return errorResponse(res, 'Video must be transcoded before publishing', 400);
      }

      const updatedVideo = await prisma.video.update({
        where: { id },
        data: { status: 'PUBLISHED' },
      });

      successResponse(res, updatedVideo, 'Video published successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async extractMetadata(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const video = await prisma.video.findUnique({ where: { id } });

      if (!video) {
        return errorResponse(res, 'Video not found', 404);
      }

      let filePath: string;
      if (video.uploadId) {
        filePath = path.join(config.upload.tempDir, video.uploadId, video.fileName);
      } else if (video.originalPath) {
        filePath = video.originalPath;
      } else {
        return errorResponse(res, 'Video file path not found', 400);
      }

      const metadata = await FFmpegService.getMetadata(filePath);

      const updatedVideo = await prisma.video.update({
        where: { id },
        data: {
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          bitrate: metadata.bitrate,
          format: metadata.format,
          metadata: metadata as any,
        },
      });

      successResponse(res, { metadata, video: updatedVideo }, 'Metadata extracted successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async startTranscode(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { templateId, templateIds, options, isABR = false } = req.body;

      const video = await prisma.video.findUnique({ where: { id } });

      if (!video) {
        return errorResponse(res, 'Video not found', 404);
      }

      if (video.status !== 'UPLOADED' && video.status !== 'TRANSCODED' && video.status !== 'FAILED') {
        return errorResponse(res, 'Video is not ready for transcoding', 400);
      }

      let inputPath: string;
      if (video.uploadId) {
        inputPath = path.join(config.upload.tempDir, video.uploadId, video.fileName);
      } else if (video.originalPath) {
        inputPath = video.originalPath;
      } else {
        return errorResponse(res, 'Video input path not found', 400);
      }

      const outputDir = path.join(config.upload.tempDir, video.id, 'transcoded');

      if (isABR) {
        const renditions = TranscodeTemplateService.getABRRenditions();

        const job = await transcodeQueue.add({
          videoId: id,
          inputPath,
          options: {
            ...renditions[0],
            isHls: true,
          } as TranscodeOptions,
          outputDir: path.join(outputDir, 'abr'),
        });

        successResponse(
          res,
          { jobId: job.id, videoId: id, type: 'ABR' },
          'ABR transcode job started successfully'
        );
      } else if (templateIds && Array.isArray(templateIds)) {
        const jobs: any[] = [];

        for (const tid of templateIds) {
          const template = await TranscodeTemplateService.getTemplateById(tid);
          if (!template) continue;

          const job = await transcodeQueue.add({
            videoId: id,
            inputPath,
            templateId: tid,
            options: TranscodeTemplateService.templateToOptions(template),
            outputDir: path.join(outputDir, tid),
          });

          jobs.push({ jobId: job.id, templateId: tid, templateName: template.name });
        }

        successResponse(res, { videoId: id, jobs }, 'Transcode jobs started successfully');
      } else if (templateId) {
        const template = await TranscodeTemplateService.getTemplateById(templateId);

        if (!template) {
          return errorResponse(res, 'Transcode template not found', 404);
        }

        const job = await transcodeQueue.add({
          videoId: id,
          inputPath,
          templateId,
          options: TranscodeTemplateService.templateToOptions(template),
          outputDir,
        });

        successResponse(
          res,
          { jobId: job.id, videoId: id, templateId, templateName: template.name },
          'Transcode job started successfully'
        );
      } else if (options) {
        const job = await transcodeQueue.add({
          videoId: id,
          inputPath,
          options,
          outputDir,
        });

        successResponse(res, { jobId: job.id, videoId: id }, 'Transcode job started successfully');
      } else {
        return errorResponse(res, 'Either templateId, templateIds, or options must be provided', 400);
      }
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getTranscodeStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const tasks = await prisma.transcodeTask.findMany({
        where: { videoId: id },
        orderBy: { createdAt: 'desc' },
        include: { template: true },
      });

      const jobs = await transcodeQueue.getJobs(['active', 'waiting', 'delayed']);
      const jobStatuses = jobs
        .filter((j) => j.data.videoId === id)
        .map(async (j) => ({
          jobId: j.id,
          progress: await j.progress(),
          state: await j.getState(),
        }));

      successResponse(res, {
        tasks,
        queueJobs: await Promise.all(jobStatuses),
      });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async generateThumbnails(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { timePoint, count, interval, width, height, format = 'jpg', quality, sprite = false } = req.body;

      const video = await prisma.video.findUnique({ where: { id } });

      if (!video) {
        return errorResponse(res, 'Video not found', 404);
      }

      let inputPath: string;
      if (video.uploadId) {
        inputPath = path.join(config.upload.tempDir, video.uploadId, video.fileName);
      } else if (video.originalPath) {
        inputPath = video.originalPath;
      } else {
        return errorResponse(res, 'Video input path not found', 400);
      }

      const outputDir = path.join(config.upload.tempDir, video.id, 'thumbnails');

      const job = await thumbnailQueue.add({
        videoId: id,
        inputPath,
        options: {
          timePoint,
          count,
          interval,
          width,
          height,
          format,
          quality,
          sprite,
        },
        outputDir,
      });

      successResponse(res, { jobId: job.id, videoId: id }, 'Thumbnail generation job started');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getThumbnailStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const thumbnails = await prisma.thumbnail.findMany({
        where: { videoId: id },
        orderBy: { createdAt: 'desc' },
      });

      successResponse(res, { thumbnails });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }
}
