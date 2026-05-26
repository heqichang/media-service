import { Request, Response } from 'express';
import { successResponse, errorResponse } from '../utils/response';
import { videoEditService } from '../services/video-edit.service';
import { exportService } from '../services/export.service';
import { exportQueue } from '../queues';
import { FFmpegService } from '../services/ffmpeg.service';
import path from 'path';
import { config } from '../config';
import prisma from '../config/prisma';

export class VideoEditController {
  static async createProject(req: Request, res: Response) {
    try {
      const { name, title, description, videoId, width, height, fps } = req.body;
      const userId = (req as any).userId;
      const projectName = name || title;

      if (!projectName) {
        return errorResponse(res, 'Name is required', 400);
      }

      const project = await videoEditService.createProject(
        { name: projectName, description, videoId, width, height, fps },
        userId
      );

      successResponse(res, project, 'Project created successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getProjects(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;
      const search = req.query.search as string;
      const userId = (req as any).userId;

      const result = await videoEditService.getProjects(userId, page, pageSize, search);
      successResponse(res, result);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getProject(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const project = await videoEditService.getProject(id);

      if (!project) {
        return errorResponse(res, 'Project not found', 404);
      }

      successResponse(res, project);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async updateProject(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { name, title, description, thumbnailUrl, width, height, fps } = req.body;

      const project = await videoEditService.updateProject(id, {
        name: name || title,
        description,
        thumbnailUrl,
        width,
        height,
        fps,
      });

      successResponse(res, project, 'Project updated successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async deleteProject(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await videoEditService.deleteProject(id);
      successResponse(res, null, 'Project deleted successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async duplicateProject(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { title } = req.body;
      const userId = (req as any).userId;

      if (!title) {
        return errorResponse(res, 'New title is required', 400);
      }

      const newProject = await videoEditService.duplicateProject(id, title, userId);
      successResponse(res, newProject, 'Project duplicated successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getTimeline(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const timeline = await videoEditService.getTimeline(projectId);

      if (!timeline) {
        return errorResponse(res, 'Timeline not found', 404);
      }

      successResponse(res, timeline);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async addTrack(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const { type, name, index, locked, muted, visible, volume } = req.body;

      const track = await videoEditService.addTrack(projectId, {
        type,
        name,
        index,
        locked,
        muted,
        visible,
        volume,
      });

      successResponse(res, track, 'Track added successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async updateTrack(req: Request, res: Response) {
    try {
      const { projectId, trackId } = req.params;
      const { name, locked, muted, visible, volume } = req.body;

      const track = await videoEditService.updateTrack(projectId, trackId, {
        name,
        locked,
        muted,
        visible,
        volume,
      } as any);

      successResponse(res, track, 'Track updated successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async deleteTrack(req: Request, res: Response) {
    try {
      const { projectId, trackId } = req.params;
      await videoEditService.deleteTrack(projectId, trackId);
      successResponse(res, null, 'Track deleted successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async addClip(req: Request, res: Response) {
    try {
      const { projectId, trackId } = req.params;
      const {
        sourcePath,
        sourceType,
        startTime,
        endTime,
        sourceIn,
        sourceOut,
        name,
        speed,
        volume,
        rotation,
        scale,
        positionX,
        positionY,
        opacity,
      } = req.body;

      const clip = await videoEditService.addClip(projectId, trackId, {
        sourcePath,
        sourceType,
        startTime,
        endTime,
        sourceIn,
        sourceOut,
        name,
        speed,
        volume,
        rotation,
        scale,
        positionX,
        positionY,
        opacity,
      });

      successResponse(res, clip, 'Clip added successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async addVideoAsClip(req: Request, res: Response) {
    try {
      const { projectId, trackId } = req.params;
      const { videoId, startTime = 0 } = req.body;

      const video = await prisma.video.findUnique({
        where: { id: videoId },
      });

      if (!video) {
        return errorResponse(res, 'Video not found', 404);
      }

      let sourcePath: string;
      if (video.uploadId) {
        sourcePath = path.join(config.upload.tempDir, video.uploadId, video.fileName);
      } else if (video.originalPath) {
        sourcePath = video.originalPath;
      } else {
        return errorResponse(res, 'Video source not found', 400);
      }

      const metadata = await FFmpegService.getMetadata(sourcePath);
      const duration = metadata.duration;

      const clip = await videoEditService.addClip(projectId, trackId, {
        sourcePath,
        sourceType: 'video',
        startTime,
        endTime: startTime + duration,
        sourceIn: 0,
        sourceOut: duration,
        name: video.title,
        speed: 1,
        volume: 1,
      });

      successResponse(res, clip, 'Video added to timeline successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async updateClip(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;

      const clip = await videoEditService.updateClip(projectId, clipId, req.body);
      successResponse(res, clip, 'Clip updated successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async deleteClip(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;
      await videoEditService.deleteClip(projectId, clipId);
      successResponse(res, null, 'Clip deleted successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async moveClip(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;
      const { newTrackId, newStartTime } = req.body;

      const timeline = await videoEditService.moveClip(
        projectId,
        clipId,
        newTrackId,
        newStartTime
      );

      successResponse(res, timeline, 'Clip moved successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async splitClip(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;
      const { time } = req.body;

      const result = await videoEditService.splitClip(projectId, clipId, { time });
      successResponse(res, result, 'Clip split successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async mergeClips(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const { clipId1, clipId2 } = req.body;

      const result = await videoEditService.mergeClips(projectId, clipId1, clipId2);
      successResponse(res, result, 'Clips merged successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async trimClip(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;
      const { trimStart, trimEnd } = req.body;

      const result = await videoEditService.trimClip(projectId, clipId, trimStart, trimEnd);
      successResponse(res, result, 'Clip trimmed successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async cutClip(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;
      const { startTime, endTime } = req.body;

      const result = await videoEditService.cutClip(projectId, clipId, startTime, endTime);
      successResponse(res, result, 'Clip cut successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async addEffect(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;

      const effect = await videoEditService.addEffect(projectId, clipId, req.body);
      successResponse(res, effect, 'Effect added successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async updateEffect(req: Request, res: Response) {
    try {
      const { projectId, effectId } = req.params;

      const effect = await videoEditService.updateEffect(projectId, effectId, req.body);
      successResponse(res, effect, 'Effect updated successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async deleteEffect(req: Request, res: Response) {
    try {
      const { projectId, effectId } = req.params;
      await videoEditService.deleteEffect(projectId, effectId);
      successResponse(res, null, 'Effect deleted successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async addTransition(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;
      const { transitionType, duration } = req.body;

      const effect = await videoEditService.addTransition(
        projectId,
        clipId,
        transitionType,
        duration
      );

      successResponse(res, effect, 'Transition added successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async addFilter(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;
      const { filterType, parameters } = req.body;

      const effect = await videoEditService.addFilter(
        projectId,
        clipId,
        filterType,
        parameters
      );

      successResponse(res, effect, 'Filter added successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async addTextOverlay(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;
      const { textType, parameters } = req.body;

      const effect = await videoEditService.addTextOverlay(
        projectId,
        clipId,
        textType,
        parameters
      );

      successResponse(res, effect, 'Text overlay added successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async addPip(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;

      const effect = await videoEditService.addPip(projectId, clipId, req.body);
      successResponse(res, effect, 'PIP added successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async addSpeedEffect(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;
      const { speed } = req.body;

      const effect = await videoEditService.addSpeedEffect(projectId, clipId, speed);
      successResponse(res, effect, 'Speed effect added successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async addAudioEffect(req: Request, res: Response) {
    try {
      const { projectId, clipId } = req.params;

      const effect = await videoEditService.addAudioEffect(projectId, clipId, req.body);
      successResponse(res, effect, 'Audio effect added successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async undo(req: Request, res: Response) {
    try {
      const { projectId } = req.params;

      const canUndo = videoEditService.canUndo(projectId);
      if (!canUndo) {
        return errorResponse(res, 'Nothing to undo', 400);
      }

      const timeline = await videoEditService.undo(projectId);
      successResponse(res, timeline, 'Undo successful');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async redo(req: Request, res: Response) {
    try {
      const { projectId } = req.params;

      const canRedo = videoEditService.canRedo(projectId);
      if (!canRedo) {
        return errorResponse(res, 'Nothing to redo', 400);
      }

      const timeline = await videoEditService.redo(projectId);
      successResponse(res, timeline, 'Redo successful');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getUndoRedoStatus(req: Request, res: Response) {
    try {
      const { projectId } = req.params;

      successResponse(res, {
        canUndo: videoEditService.canUndo(projectId),
        canRedo: videoEditService.canRedo(projectId),
      });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async startExport(req: Request, res: Response) {
    try {
      const { projectId } = req.params;

      const exportJobId = await videoEditService.startExport(projectId, req.body);

      const job = await exportQueue.add({
        exportJobId,
      });

      successResponse(
        res,
        { exportJobId, jobId: job.id },
        'Export started successfully'
      );
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getExportStatus(req: Request, res: Response) {
    try {
      const { exportJobId } = req.params;

      const job = await videoEditService.getExportStatus(exportJobId);

      if (!job) {
        return errorResponse(res, 'Export job not found', 404);
      }

      const queueJobs = await exportQueue.getJobs(['active', 'waiting', 'delayed']);
      const queueJob = queueJobs.find((j) => j.data.exportJobId === exportJobId);

      let progress = job.progress;
      if (queueJob) {
        const jobProgress = await queueJob.progress();
        if (jobProgress !== undefined) {
          progress = jobProgress as number;
        }
      }

      let outputUrl = null;
      if (job.outputPath) {
        outputUrl = exportService.getOutputUrl(job.outputPath);
      }

      successResponse(res, {
        ...job,
        progress,
        outputUrl,
      });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getProjectExports(req: Request, res: Response) {
    try {
      const { projectId } = req.params;

      const exports = await videoEditService.getProjectExports(projectId);

      const result = exports.map((exp) => ({
        ...exp,
        outputUrl: exp.outputPath ? exportService.getOutputUrl(exp.outputPath) : null,
      }));

      successResponse(res, { exports: result });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async cancelExport(req: Request, res: Response) {
    try {
      const { exportJobId } = req.params;

      const queueJobs = await exportQueue.getJobs(['active', 'waiting', 'delayed']);
      for (const job of queueJobs) {
        if (job.data.exportJobId === exportJobId) {
          await job.remove();
        }
      }

      await videoEditService.cancelExport(exportJobId);
      successResponse(res, null, 'Export cancelled successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getEffectTypes(req: Request, res: Response) {
    try {
      const types = videoEditService.getEffectTypes();
      successResponse(res, types);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getPreviewFrame(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const time = parseFloat(req.query.time as string);
      const width = parseInt(req.query.width as string);
      const height = parseInt(req.query.height as string);

      if (isNaN(time)) {
        return errorResponse(res, 'Time parameter is required', 400);
      }

      const frame = await videoEditService.getPreviewFrame(projectId, time, width, height);
      
      const relativePath = path.relative(config.upload.tempDir, frame.filePath);
      const previewUrl = `/uploads/edits/temp/${path.basename(frame.filePath)}`;

      successResponse(res, {
        ...frame,
        previewUrl,
      });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async analyzeVideo(req: Request, res: Response) {
    try {
      const { videoId } = req.body;

      const video = await prisma.video.findUnique({
        where: { id: videoId },
      });

      if (!video) {
        return errorResponse(res, 'Video not found', 404);
      }

      let sourcePath: string;
      if (video.uploadId) {
        sourcePath = path.join(config.upload.tempDir, video.uploadId, video.fileName);
      } else if (video.originalPath) {
        sourcePath = video.originalPath;
      } else {
        return errorResponse(res, 'Video source not found', 400);
      }

      const metadata = await FFmpegService.getMetadata(sourcePath);

      successResponse(res, {
        metadata,
        sourcePath,
        duration: metadata.duration,
        canEdit: true,
      });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }
}
