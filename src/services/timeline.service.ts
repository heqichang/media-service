import prisma from '../config/prisma';
import { TrackData, ClipData } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class TimelineService {
  async getTimeline(projectId: string) {
    return prisma.timeline.findUnique({
      where: { projectId },
      include: {
        tracks: {
          orderBy: { index: 'asc' },
          include: {
            clips: {
              orderBy: { startTime: 'asc' },
              include: {
                effects: {
                  orderBy: { startTime: 'asc' },
                },
              },
            },
          },
        },
      },
    });
  }

  async createTimeline(projectId: string, width: number, height: number) {
    const timeline = await prisma.timeline.create({
      data: {
        projectId,
        duration: 0,
        tracks: {
          create: [
            { type: 'VIDEO', name: '视频轨 1', index: 0 },
            { type: 'AUDIO', name: '音频轨 1', index: 1 },
            { type: 'SUBTITLE', name: '字幕轨 1', index: 2 },
          ],
        },
      },
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
    });

    return timeline;
  }

  async addTrack(projectId: string, trackData: TrackData) {
    const timeline = await this.getTimeline(projectId);
    if (!timeline) {
      throw new Error('Timeline not found');
    }

    const maxIndex = timeline.tracks.reduce((max, t) => Math.max(max, t.index), -1);

    const track = await prisma.track.create({
      data: {
        timelineId: timeline.id,
        type: trackData.type,
        name: trackData.name,
        index: trackData.index !== undefined ? trackData.index : maxIndex + 1,
        locked: trackData.locked,
        muted: trackData.muted,
        visible: trackData.visible,
        volume: trackData.volume,
      },
      include: {
        clips: {
          orderBy: { startTime: 'asc' },
          include: { effects: true },
        },
      },
    });

    await this.recalculateTimelineDuration(projectId);

    return track;
  }

  async updateTrack(projectId: string, trackId: string, updates: Partial<TrackData>) {
    const track = await prisma.track.update({
      where: { id: trackId },
      data: {
        name: updates.name,
        locked: updates.locked,
        muted: updates.muted,
        visible: updates.visible,
        volume: updates.volume,
      },
      include: {
        clips: {
          orderBy: { startTime: 'asc' },
          include: { effects: true },
        },
      },
    });

    return track;
  }

  async deleteTrack(projectId: string, trackId: string) {
    const timeline = await this.getTimeline(projectId);
    if (!timeline) {
      throw new Error('Timeline not found');
    }

    if (timeline.tracks.length <= 1) {
      throw new Error('Cannot delete the last track');
    }

    await prisma.track.delete({
      where: { id: trackId },
    });

    await this.recalculateTimelineDuration(projectId);

    return true;
  }

  async addClip(projectId: string, trackId: string, clipData: ClipData) {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      include: { clips: true },
    });

    if (!track) {
      throw new Error('Track not found');
    }

    const duration = clipData.endTime - clipData.startTime;

    const clip = await prisma.clip.create({
      data: {
        trackId,
        sourcePath: clipData.sourcePath,
        sourceType: clipData.sourceType || 'video',
        startTime: clipData.startTime,
        endTime: clipData.endTime,
        sourceIn: clipData.sourceIn,
        sourceOut: clipData.sourceOut,
        duration,
        name: clipData.name,
        speed: clipData.speed || 1,
        volume: clipData.volume || 1,
        rotation: clipData.rotation || 0,
        scale: clipData.scale || 1,
        positionX: clipData.positionX || 0,
        positionY: clipData.positionY || 0,
        opacity: clipData.opacity || 1,
      },
      include: {
        effects: true,
      },
    });

    await this.recalculateTimelineDuration(projectId);

    return clip;
  }

  async updateClip(projectId: string, clipId: string, updates: Partial<ClipData>) {
    const data: any = {};

    if (updates.startTime !== undefined) data.startTime = updates.startTime;
    if (updates.endTime !== undefined) data.endTime = updates.endTime;
    if (updates.sourceIn !== undefined) data.sourceIn = updates.sourceIn;
    if (updates.sourceOut !== undefined) data.sourceOut = updates.sourceOut;
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.speed !== undefined) data.speed = updates.speed;
    if (updates.volume !== undefined) data.volume = updates.volume;
    if (updates.rotation !== undefined) data.rotation = updates.rotation;
    if (updates.scale !== undefined) data.scale = updates.scale;
    if (updates.positionX !== undefined) data.positionX = updates.positionX;
    if (updates.positionY !== undefined) data.positionY = updates.positionY;
    if (updates.opacity !== undefined) data.opacity = updates.opacity;

    if (updates.startTime !== undefined && updates.endTime !== undefined) {
      data.duration = updates.endTime - updates.startTime;
    }

    const clip = await prisma.clip.update({
      where: { id: clipId },
      data,
      include: {
        effects: true,
      },
    });

    await this.recalculateTimelineDuration(projectId);

    return clip;
  }

  async deleteClip(projectId: string, clipId: string) {
    await prisma.clip.delete({
      where: { id: clipId },
    });

    await this.recalculateTimelineDuration(projectId);

    return true;
  }

  async moveClip(projectId: string, clipId: string, newTrackId: string, newStartTime: number) {
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
    });

    if (!clip) {
      throw new Error('Clip not found');
    }

    const duration = clip.duration;
    const newEndTime = newStartTime + duration;

    await prisma.clip.update({
      where: { id: clipId },
      data: {
        trackId: newTrackId,
        startTime: newStartTime,
        endTime: newEndTime,
      },
    });

    await this.recalculateTimelineDuration(projectId);

    return this.getTimeline(projectId);
  }

  async splitClip(projectId: string, clipId: string, splitTime: number) {
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
    });

    if (!clip) {
      throw new Error('Clip not found');
    }

    if (splitTime <= clip.startTime || splitTime >= clip.endTime) {
      throw new Error('Split time must be within clip duration');
    }

    const leftEndTime = splitTime;
    const rightStartTime = splitTime;
    const leftSourceOut = clip.sourceIn + (splitTime - clip.startTime) * clip.speed;
    const rightSourceIn = leftSourceOut;

    const updatedClip = await prisma.clip.update({
      where: { id: clipId },
      data: {
        endTime: leftEndTime,
        sourceOut: leftSourceOut,
        duration: leftEndTime - clip.startTime,
      },
      include: { effects: true },
    });

    const newClip = await prisma.clip.create({
      data: {
        trackId: clip.trackId,
        sourcePath: clip.sourcePath,
        sourceType: clip.sourceType,
        startTime: rightStartTime,
        endTime: clip.endTime,
        sourceIn: rightSourceIn,
        sourceOut: clip.sourceOut,
        duration: clip.endTime - rightStartTime,
        name: clip.name ? `${clip.name} (2)` : undefined,
        speed: clip.speed,
        volume: clip.volume,
        rotation: clip.rotation,
        scale: clip.scale,
        positionX: clip.positionX,
        positionY: clip.positionY,
        opacity: clip.opacity,
      },
      include: { effects: true },
    });

    await this.recalculateTimelineDuration(projectId);

    return { leftClip: updatedClip, rightClip: newClip };
  }

  async mergeClips(projectId: string, clipId1: string, clipId2: string) {
    const clip1 = await prisma.clip.findUnique({ where: { id: clipId1 } });
    const clip2 = await prisma.clip.findUnique({ where: { id: clipId2 } });

    if (!clip1 || !clip2) {
      throw new Error('Both clips must exist');
    }

    if (clip1.trackId !== clip2.trackId) {
      throw new Error('Clips must be on the same track');
    }

    if (clip1.endTime !== clip2.startTime) {
      throw new Error('Clips must be adjacent');
    }

    if (clip1.sourcePath !== clip2.sourcePath) {
      throw new Error('Clips must have the same source to merge');
    }

    const mergedClip = await prisma.clip.update({
      where: { id: clipId1 },
      data: {
        endTime: clip2.endTime,
        sourceOut: clip2.sourceOut,
        duration: clip2.endTime - clip1.startTime,
      },
      include: { effects: true },
    });

    await prisma.clip.delete({
      where: { id: clipId2 },
    });

    await this.recalculateTimelineDuration(projectId);

    return mergedClip;
  }

  async trimClip(projectId: string, clipId: string, trimStart: number, trimEnd: number) {
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
    });

    if (!clip) {
      throw new Error('Clip not found');
    }

    const newStartTime = clip.startTime + trimStart;
    const newEndTime = clip.endTime - trimEnd;
    const newSourceIn = clip.sourceIn + trimStart * clip.speed;
    const newSourceOut = clip.sourceOut - trimEnd * clip.speed;

    if (newStartTime >= newEndTime) {
      throw new Error('Trim would result in zero duration clip');
    }

    const updatedClip = await prisma.clip.update({
      where: { id: clipId },
      data: {
        startTime: newStartTime,
        endTime: newEndTime,
        sourceIn: newSourceIn,
        sourceOut: newSourceOut,
        duration: newEndTime - newStartTime,
      },
      include: { effects: true },
    });

    await this.recalculateTimelineDuration(projectId);

    return updatedClip;
  }

  async recalculateTimelineDuration(projectId: string): Promise<void> {
    const timeline = await this.getTimeline(projectId);
    if (!timeline) return;

    let maxDuration = 0;
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.endTime > maxDuration) {
          maxDuration = clip.endTime;
        }
      }
    }

    await prisma.timeline.update({
      where: { id: timeline.id },
      data: { duration: maxDuration },
    });

    await prisma.videoEditProject.update({
      where: { id: projectId },
      data: { duration: maxDuration },
    });
  }

  async checkOverlap(trackId: string, startTime: number, endTime: number, excludeClipId?: string): Promise<boolean> {
    const clips = await prisma.clip.findMany({
      where: {
        trackId,
        id: excludeClipId ? { not: excludeClipId } : undefined,
        AND: [
          { startTime: { lt: endTime } },
          { endTime: { gt: startTime } },
        ],
      },
    });

    return clips.length > 0;
  }

  async findGap(trackId: string, duration: number, afterTime: number = 0): Promise<number | null> {
    const clips = await prisma.clip.findMany({
      where: { trackId },
      orderBy: { startTime: 'asc' },
    });

    if (clips.length === 0) {
      return afterTime;
    }

    if (clips[0].startTime - afterTime >= duration) {
      return afterTime;
    }

    for (let i = 0; i < clips.length - 1; i++) {
      const gap = clips[i + 1].startTime - clips[i].endTime;
      if (gap >= duration && clips[i].endTime >= afterTime) {
        return clips[i].endTime;
      }
    }

    return clips[clips.length - 1].endTime;
  }
}

export const timelineService = new TimelineService();
