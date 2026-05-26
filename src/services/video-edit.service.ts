import { EventEmitter } from 'events';
import prisma from '../config/prisma';
import { config } from '../config';
import { timelineService } from './timeline.service';
import { effectService } from './effect.service';
import { exportService } from './export.service';
import { videoEditHistoryService } from './video-edit-history.service';
import {
  CreateProjectRequest,
  UpdateProjectRequest,
  TrackData,
  ClipData,
  EffectData,
  ExportRequest,
  SplitClipRequest,
} from '../types';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

export class VideoEditService extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    exportService.ensureDirectories();
  }

  async createProject(request: CreateProjectRequest, userId?: string) {
    const width = request.width || config.videoEdit.defaultWidth;
    const height = request.height || config.videoEdit.defaultHeight;
    const fps = request.fps || config.videoEdit.defaultFps;

    const project = await prisma.videoEditProject.create({
      data: {
        name: request.name,
        description: request.description,
        videoId: request.videoId,
        userId,
        width,
        height,
        fps,
      },
    });

    const timeline = await timelineService.createTimeline(project.id, width, height);

    const result = await prisma.videoEditProject.findUnique({
      where: { id: project.id },
      include: {
        timeline: {
          include: {
            tracks: {
              orderBy: { index: 'asc' },
              include: {
                clips: {
                  orderBy: { startTime: 'asc' },
                  include: { effects: true },
                },
              },
            },
          },
        },
      },
    });

    if (result && result.timeline) {
      const snapshot = videoEditHistoryService.createSnapshot(
        project.id,
        result.timeline.tracks,
        result.timeline.duration
      );
      videoEditHistoryService.saveState(project.id, 'create_project', snapshot);
    }

    this.emit('project:created', result);

    return result;
  }

  async getProject(projectId: string) {
    return prisma.videoEditProject.findUnique({
      where: { id: projectId },
      include: {
        timeline: {
          include: {
            tracks: {
              orderBy: { index: 'asc' },
              include: {
                clips: {
                  orderBy: { startTime: 'asc' },
                  include: { effects: true },
                },
              },
            },
          },
        },
        exportJobs: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
        video: true,
      },
    });
  }

  async getProjects(userId?: string, page = 1, pageSize = 20, search?: string) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [projects, total] = await Promise.all([
      prisma.videoEditProject.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          timeline: {
            include: {
              _count: { select: { tracks: true } },
            },
          },
          exportJobs: { take: 1, orderBy: { createdAt: 'desc' } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.videoEditProject.count({ where }),
    ]);

    return {
      items: projects,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async updateProject(projectId: string, request: UpdateProjectRequest) {
    const project = await prisma.videoEditProject.update({
      where: { id: projectId },
      data: {
        name: request.name,
        description: request.description,
        thumbnailUrl: request.thumbnailUrl,
        width: request.width,
        height: request.height,
        fps: request.fps,
      },
      include: {
        timeline: {
          include: {
            tracks: {
              orderBy: { index: 'asc' },
              include: {
                clips: {
                  orderBy: { startTime: 'asc' },
                  include: { effects: true },
                },
              },
            },
          },
        },
      },
    });

    this.emit('project:updated', project);
    return project;
  }

  async deleteProject(projectId: string) {
    await prisma.videoEditProject.delete({
      where: { id: projectId },
    });

    videoEditHistoryService.clearHistory(projectId);
    this.emit('project:deleted', projectId);

    return true;
  }

  async getTimeline(projectId: string) {
    return timelineService.getTimeline(projectId);
  }

  async addTrack(projectId: string, trackData: TrackData) {
    const timeline = await this.getTimeline(projectId);
    if (!timeline) throw new Error('Timeline not found');

    this.saveSnapshot(projectId, 'add_track');

    const track = await timelineService.addTrack(projectId, trackData);
    this.emit('track:added', { projectId, track });
    return track;
  }

  async updateTrack(projectId: string, trackId: string, updates: Partial<TrackData>) {
    this.saveSnapshot(projectId, 'update_track');
    const track = await timelineService.updateTrack(projectId, trackId, updates);
    this.emit('track:updated', { projectId, trackId, track });
    return track;
  }

  async deleteTrack(projectId: string, trackId: string) {
    this.saveSnapshot(projectId, 'delete_track');
    const result = await timelineService.deleteTrack(projectId, trackId);
    this.emit('track:deleted', { projectId, trackId });
    return result;
  }

  async addClip(projectId: string, trackId: string, clipData: ClipData) {
    const timeline = await this.getTimeline(projectId);
    if (!timeline) throw new Error('Timeline not found');

    const overlap = await timelineService.checkOverlap(
      trackId,
      clipData.startTime,
      clipData.endTime
    );

    if (overlap) {
      const gapStart = await timelineService.findGap(
        trackId,
        clipData.endTime - clipData.startTime,
        clipData.startTime
      );
      if (gapStart !== null) {
        clipData.startTime = gapStart;
        clipData.endTime = gapStart + (clipData.endTime - clipData.startTime);
      }
    }

    this.saveSnapshot(projectId, 'add_clip');

    const clip = await timelineService.addClip(projectId, trackId, clipData);
    this.emit('clip:added', { projectId, trackId, clip });
    return clip;
  }

  async updateClip(projectId: string, clipId: string, updates: Partial<ClipData>) {
    this.saveSnapshot(projectId, 'update_clip');
    const clip = await timelineService.updateClip(projectId, clipId, updates);
    this.emit('clip:updated', { projectId, clipId, clip });
    return clip;
  }

  async deleteClip(projectId: string, clipId: string) {
    this.saveSnapshot(projectId, 'delete_clip');
    const result = await timelineService.deleteClip(projectId, clipId);
    this.emit('clip:deleted', { projectId, clipId });
    return result;
  }

  async moveClip(projectId: string, clipId: string, newTrackId: string, newStartTime: number) {
    this.saveSnapshot(projectId, 'move_clip');
    const timeline = await timelineService.moveClip(projectId, clipId, newTrackId, newStartTime);
    this.emit('clip:moved', { projectId, clipId, newTrackId, newStartTime });
    return timeline;
  }

  async splitClip(projectId: string, clipId: string, request: SplitClipRequest) {
    this.saveSnapshot(projectId, 'split_clip');
    const result = await timelineService.splitClip(projectId, clipId, request.time);
    this.emit('clip:split', { projectId, clipId, splitTime: request.time });
    return result;
  }

  async mergeClips(projectId: string, clipId1: string, clipId2: string) {
    this.saveSnapshot(projectId, 'merge_clips');
    const result = await timelineService.mergeClips(projectId, clipId1, clipId2);
    this.emit('clips:merged', { projectId, clipId1, clipId2 });
    return result;
  }

  async trimClip(projectId: string, clipId: string, trimStart: number, trimEnd: number) {
    this.saveSnapshot(projectId, 'trim_clip');
    const result = await timelineService.trimClip(projectId, clipId, trimStart, trimEnd);
    this.emit('clip:trimmed', { projectId, clipId, trimStart, trimEnd });
    return result;
  }

  async cutClip(projectId: string, clipId: string, startTime: number, endTime: number) {
    this.saveSnapshot(projectId, 'cut_clip');
    const clip = await prisma.clip.findUnique({ where: { id: clipId } });
    if (!clip) throw new Error('Clip not found');

    const duration = endTime - startTime;
    const result = await timelineService.updateClip(projectId, clipId, {
      startTime,
      endTime,
      sourceIn: clip.sourceIn + (startTime - clip.startTime) * clip.speed,
      sourceOut: clip.sourceIn + (endTime - clip.startTime) * clip.speed,
    } as any);

    this.emit('clip:cut', { projectId, clipId, startTime, endTime });
    return result;
  }

  async addEffect(projectId: string, clipId: string, effectData: EffectData) {
    this.saveSnapshot(projectId, 'add_effect');
    const effect = await effectService.addEffect(projectId, clipId, effectData);
    this.emit('effect:added', { projectId, clipId, effect });
    return effect;
  }

  async updateEffect(projectId: string, effectId: string, updates: Partial<EffectData>) {
    this.saveSnapshot(projectId, 'update_effect');
    const effect = await effectService.updateEffect(projectId, effectId, updates);
    this.emit('effect:updated', { projectId, effectId, effect });
    return effect;
  }

  async deleteEffect(projectId: string, effectId: string) {
    this.saveSnapshot(projectId, 'delete_effect');
    const result = await effectService.deleteEffect(projectId, effectId);
    this.emit('effect:deleted', { projectId, effectId });
    return result;
  }

  async addTransition(projectId: string, clipId: string, transitionType: string, duration: number) {
    this.saveSnapshot(projectId, 'add_transition');
    const effect = await effectService.addTransition(projectId, clipId, transitionType, { duration });
    this.emit('transition:added', { projectId, clipId, transitionType, duration });
    return effect;
  }

  async addFilter(projectId: string, clipId: string, filterType: string, parameters: any) {
    this.saveSnapshot(projectId, 'add_filter');
    const effect = await effectService.addFilter(projectId, clipId, filterType, parameters);
    this.emit('filter:added', { projectId, clipId, filterType });
    return effect;
  }

  async addTextOverlay(projectId: string, clipId: string, textType: string, parameters: any) {
    this.saveSnapshot(projectId, 'add_text');
    const effect = await effectService.addTextOverlay(projectId, clipId, textType, parameters);
    this.emit('text:added', { projectId, clipId, textType });
    return effect;
  }

  async addPip(projectId: string, clipId: string, parameters: any) {
    this.saveSnapshot(projectId, 'add_pip');
    const effect = await effectService.addPip(projectId, clipId, parameters);
    this.emit('pip:added', { projectId, clipId });
    return effect;
  }

  async addSpeedEffect(projectId: string, clipId: string, speed: number) {
    this.saveSnapshot(projectId, 'add_speed');
    const effect = await effectService.addSpeedEffect(projectId, clipId, { speed });
    this.emit('speed:added', { projectId, clipId, speed });
    return effect;
  }

  async addAudioEffect(projectId: string, clipId: string, parameters: any) {
    this.saveSnapshot(projectId, 'add_audio_effect');
    const effect = await effectService.addAudioEffect(projectId, clipId, parameters);
    this.emit('audio_effect:added', { projectId, clipId });
    return effect;
  }

  async undo(projectId: string) {
    const snapshot = videoEditHistoryService.undo(projectId);
    if (!snapshot) return null;

    await this.applySnapshot(projectId, snapshot);
    this.emit('timeline:undone', { projectId });

    return this.getTimeline(projectId);
  }

  async redo(projectId: string) {
    const snapshot = videoEditHistoryService.redo(projectId);
    if (!snapshot) return null;

    await this.applySnapshot(projectId, snapshot);
    this.emit('timeline:redone', { projectId });

    return this.getTimeline(projectId);
  }

  canUndo(projectId: string): boolean {
    return videoEditHistoryService.canUndo(projectId);
  }

  canRedo(projectId: string): boolean {
    return videoEditHistoryService.canRedo(projectId);
  }

  private async saveSnapshot(projectId: string, action: string) {
    const timeline = await this.getTimeline(projectId);
    if (timeline) {
      const snapshot = videoEditHistoryService.createSnapshot(
        projectId,
        timeline.tracks,
        timeline.duration
      );
      videoEditHistoryService.saveState(projectId, action, snapshot);
    }
  }

  private async applySnapshot(projectId: string, snapshot: any): Promise<void> {
    const timeline = await this.getTimeline(projectId);
    if (!timeline) return;

    await prisma.$transaction([
      prisma.effect.deleteMany({
        where: { clip: { track: { timelineId: timeline.id } } },
      }),
      prisma.clip.deleteMany({
        where: { track: { timelineId: timeline.id } },
      }),
      prisma.track.deleteMany({
        where: { timelineId: timeline.id },
      }),
    ]);

    for (const trackData of snapshot.tracks) {
      const track = await prisma.track.create({
        data: {
          timelineId: timeline.id,
          type: trackData.type,
          name: trackData.name,
          index: trackData.index,
          locked: trackData.locked,
          muted: trackData.muted,
          visible: trackData.visible,
          volume: trackData.volume,
        },
      });

      for (const clipData of trackData.clips) {
        const clip = await prisma.clip.create({
          data: {
            trackId: track.id,
            sourcePath: clipData.sourcePath,
            sourceType: clipData.sourceType,
            startTime: clipData.startTime,
            endTime: clipData.endTime,
            sourceIn: clipData.sourceIn,
            sourceOut: clipData.sourceOut,
            duration: clipData.duration,
            name: clipData.name,
            speed: clipData.speed,
            volume: clipData.volume,
            rotation: clipData.rotation,
            scale: clipData.scale,
            positionX: clipData.positionX,
            positionY: clipData.positionY,
            opacity: clipData.opacity,
            metadata: clipData.metadata,
          },
        });

        for (const effectData of clipData.effects) {
          await prisma.effect.create({
            data: {
              clipId: clip.id,
              type: effectData.type,
              subtype: effectData.subtype,
              name: effectData.name,
              startTime: effectData.startTime,
              endTime: effectData.endTime,
              duration: effectData.duration,
              parameters: effectData.parameters,
              transitionType: effectData.transitionType,
              filterType: effectData.filterType,
              textType: effectData.textType,
            },
          });
        }
      }
    }

    await prisma.timeline.update({
      where: { id: timeline.id },
      data: { duration: snapshot.duration },
    });

    await prisma.videoEditProject.update({
      where: { id: projectId },
      data: { duration: snapshot.duration },
    });
  }

  async startExport(projectId: string, exportOptions: ExportRequest): Promise<string> {
    const exportJobId = await exportService.createExportJob(projectId, exportOptions);
    this.emit('export:started', { projectId, exportJobId });
    return exportJobId;
  }

  async getExportStatus(exportJobId: string) {
    return exportService.getExportStatus(exportJobId);
  }

  async getProjectExports(projectId: string) {
    return exportService.getProjectExports(projectId);
  }

  async cancelExport(exportJobId: string) {
    await exportService.cancelExport(exportJobId);
    this.emit('export:cancelled', { exportJobId });
    return true;
  }

  getEffectTypes() {
    return {
      transitions: effectService.getTransitionTypes(),
      filters: effectService.getFilterTypes(),
      textTypes: effectService.getTextTypes(),
    };
  }

  async duplicateProject(projectId: string, newTitle: string, userId?: string) {
    const original = await this.getProject(projectId);
    if (!original) throw new Error('Project not found');

    const newProject = await this.createProject({
      name: newTitle,
      description: original.description || undefined,
      width: original.width,
      height: original.height,
      fps: original.fps,
    }, userId);

    if (original.timeline) {
      const snapshot = videoEditHistoryService.createSnapshot(
        projectId,
        original.timeline.tracks,
        original.timeline.duration
      );
      await this.applySnapshot(newProject.id, snapshot);
    }

    return this.getProject(newProject.id);
  }

  async getPreviewFrame(projectId: string, time: number, width?: number, height?: number) {
    const timeline = await this.getTimeline(projectId);
    if (!timeline) throw new Error('Timeline not found');

    const project = await prisma.videoEditProject.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new Error('Project not found');

    for (const track of timeline.tracks) {
      if (track.type !== 'VIDEO' || !track.visible) continue;

      for (const clip of track.clips) {
        if (time >= clip.startTime && time <= clip.endTime) {
          const clipTime = clip.sourceIn + (time - clip.startTime) * clip.speed;
          const outputPath = path.join(
            config.videoEdit.tempDir,
            `preview_${projectId}_${Date.now()}.jpg`
          );

          const { FFmpegService } = await import('./ffmpeg.service');
          const results = await FFmpegService.generateThumbnail(
            clip.sourcePath,
            config.videoEdit.tempDir,
            {
              timePoint: clipTime,
              width: width || Math.min(project.width, 640),
              height: height || Math.round((width || 640) * project.height / project.width),
              format: 'jpg',
              quality: 85,
            }
          );

          if (results.length > 0) {
            return results[0];
          }
        }
      }
    }

    throw new Error('No clip found at the specified time');
  }
}

export const videoEditService = new VideoEditService();
