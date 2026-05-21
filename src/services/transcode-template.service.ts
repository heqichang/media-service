import { TranscodeTemplate, VideoCodec, AudioCodec } from '@prisma/client';
import prisma from '../config/prisma';
import { TranscodeOptions } from '../types';

const PRESET_TEMPLATES = [
  {
    name: '360P (低画质)',
    description: '适合移动网络和低带宽环境',
    width: 640,
    height: 360,
    videoBitrate: 800000,
    videoCodec: VideoCodec.H264,
    audioBitrate: 96000,
    audioCodec: AudioCodec.AAC,
    framerate: 25,
    crf: 28,
    preset: 'fast',
    outputFormat: 'mp4',
    isPreset: true,
  },
  {
    name: '720P (标准画质)',
    description: '适合大多数网络环境的推荐画质',
    width: 1280,
    height: 720,
    videoBitrate: 2500000,
    videoCodec: VideoCodec.H264,
    audioBitrate: 128000,
    audioCodec: AudioCodec.AAC,
    framerate: 30,
    crf: 23,
    preset: 'medium',
    outputFormat: 'mp4',
    isPreset: true,
  },
  {
    name: '1080P (高清)',
    description: '高清画质，适合大屏播放',
    width: 1920,
    height: 1080,
    videoBitrate: 5000000,
    videoCodec: VideoCodec.H264,
    audioBitrate: 192000,
    audioCodec: AudioCodec.AAC,
    framerate: 30,
    crf: 20,
    preset: 'medium',
    outputFormat: 'mp4',
    isPreset: true,
  },
  {
    name: '4K (超高清)',
    description: '超高清画质，需要高带宽',
    width: 3840,
    height: 2160,
    videoBitrate: 20000000,
    videoCodec: VideoCodec.H265,
    audioBitrate: 256000,
    audioCodec: AudioCodec.AAC,
    framerate: 30,
    crf: 18,
    preset: 'slow',
    outputFormat: 'mp4',
    isPreset: true,
  },
  {
    name: 'HLS 自适应码率',
    description: '生成多码率 HLS 流，支持自适应播放',
    width: 1920,
    height: 1080,
    videoBitrate: 5000000,
    videoCodec: VideoCodec.H264,
    audioBitrate: 192000,
    audioCodec: AudioCodec.AAC,
    framerate: 30,
    outputFormat: 'ts',
    isHls: true,
    isPreset: true,
  },
];

export class TranscodeTemplateService {
  static async initializePresets(): Promise<void> {
    for (const template of PRESET_TEMPLATES) {
      const existing = await prisma.transcodeTemplate.findFirst({
        where: { name: template.name, isPreset: true },
      });

      if (!existing) {
        await prisma.transcodeTemplate.create({
          data: template as any,
        });
      }
    }
  }

  static async getAllTemplates(includePresets = true): Promise<TranscodeTemplate[]> {
    return prisma.transcodeTemplate.findMany({
      where: includePresets ? undefined : { isPreset: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getTemplateById(id: string): Promise<TranscodeTemplate | null> {
    return prisma.transcodeTemplate.findUnique({
      where: { id },
    });
  }

  static async createTemplate(data: Omit<TranscodeTemplate, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>): Promise<TranscodeTemplate> {
    return prisma.transcodeTemplate.create({
      data: {
        ...data,
        isPreset: false,
      },
    });
  }

  static async updateTemplate(id: string, data: Partial<TranscodeTemplate>): Promise<TranscodeTemplate> {
    return prisma.transcodeTemplate.update({
      where: { id },
      data,
    });
  }

  static async deleteTemplate(id: string): Promise<void> {
    const template = await prisma.transcodeTemplate.findUnique({
      where: { id },
    });

    if (template?.isPreset) {
      throw new Error('Cannot delete preset templates');
    }

    await prisma.transcodeTemplate.delete({
      where: { id },
    });
  }

  static templateToOptions(template: TranscodeTemplate): TranscodeOptions {
    return {
      width: template.width || undefined,
      height: template.height || undefined,
      videoBitrate: template.videoBitrate || undefined,
      videoCodec: template.videoCodec.toLowerCase() as 'h264' | 'h265' | 'av1',
      audioBitrate: template.audioBitrate || undefined,
      audioCodec: template.audioCodec.toLowerCase() as 'aac' | 'mp3' | 'opus',
      framerate: template.framerate || undefined,
      crf: template.crf || undefined,
      preset: template.preset || undefined,
      outputFormat: template.outputFormat,
      isHls: template.isHls,
      isDash: template.isDash,
    };
  }

  static getABRRenditions(): TranscodeOptions[] {
    return [
      {
        width: 640,
        height: 360,
        videoBitrate: 800000,
        videoCodec: 'h264',
        audioBitrate: 96000,
        audioCodec: 'aac',
        framerate: 25,
        outputFormat: 'ts',
      },
      {
        width: 1280,
        height: 720,
        videoBitrate: 2500000,
        videoCodec: 'h264',
        audioBitrate: 128000,
        audioCodec: 'aac',
        framerate: 30,
        outputFormat: 'ts',
      },
      {
        width: 1920,
        height: 1080,
        videoBitrate: 5000000,
        videoCodec: 'h264',
        audioBitrate: 192000,
        audioCodec: 'aac',
        framerate: 30,
        outputFormat: 'ts',
      },
    ];
  }
}
