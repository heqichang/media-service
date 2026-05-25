import { config } from '../config';
import prisma from '../config/prisma';
import { effectService } from './effect.service';
import { ExportRequest } from '../types';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export interface ExportResult {
  command: string;
  outputPath: string;
  process?: any;
}

export class ExportService {
  ensureDirectories(): void {
    if (!fs.existsSync(config.videoEdit.outputDir)) {
      fs.mkdirSync(config.videoEdit.outputDir, { recursive: true });
    }
    if (!fs.existsSync(config.videoEdit.tempDir)) {
      fs.mkdirSync(config.videoEdit.tempDir, { recursive: true });
    }
  }

  async createExportJob(
    projectId: string,
    exportOptions: ExportRequest
  ): Promise<string> {
    this.ensureDirectories();

    const project = await prisma.videoEditProject.findUnique({
      where: { id: projectId },
      include: {
        timeline: {
          include: {
            tracks: {
              orderBy: { index: 'asc' },
              include: {
                clips: {
                  orderBy: { startTime: 'asc' },
                  include: {
                    effects: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!project || !project.timeline) {
      throw new Error('Project or timeline not found');
    }

    const outputId = uuidv4();
    const outputFormat = exportOptions.format || 'mp4';
    const outputPath = path.join(config.videoEdit.outputDir, `${outputId}.${outputFormat}`);

    const qualityBitrates: Record<string, number> = {
      low: 2000000,
      medium: 5000000,
      high: 8000000,
      ultra: 16000000,
    };

    const bitrate = exportOptions.bitrate || 
      (exportOptions.quality ? qualityBitrates[exportOptions.quality] : 5000000);

    const exportJob = await prisma.exportJob.create({
      data: {
        projectId,
        format: outputFormat,
        videoCodec: exportOptions.videoCodec || 'h264',
        audioCodec: exportOptions.audioCodec || 'aac',
        width: exportOptions.width || project.width,
        height: exportOptions.height || project.height,
        bitrate,
        fps: exportOptions.fps || project.fps,
        quality: exportOptions.quality,
        outputPath,
        status: 'PENDING',
        metadata: {
          timeline: JSON.parse(JSON.stringify(project.timeline)),
          exportOptions,
        } as any,
      },
    });

    return exportJob.id;
  }

  async startExport(
    exportJobId: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const exportJob = await prisma.exportJob.findUnique({
      where: { id: exportJobId },
      include: { project: true },
    });

    if (!exportJob) {
      throw new Error('Export job not found');
    }

    const timelineData = exportJob.metadata as any;
    const timeline = timelineData.timeline;
    const exportOptions = timelineData.exportOptions;

    if (!timeline) {
      throw new Error('Timeline data not found in export job');
    }

    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });

    try {
      const result = await this.generateAndRunFFmpegCommand(
        timeline,
        exportJob,
        exportOptions,
        onProgress
      );

      const fileSize = fs.existsSync(exportJob.outputPath!) 
        ? BigInt(fs.statSync(exportJob.outputPath!).size) 
        : BigInt(0);

      await prisma.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          completedAt: new Date(),
          fileSize,
        },
      });

      return exportJob.outputPath!;
    } catch (error: any) {
      await prisma.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: 'FAILED',
          errorMessage: error.message,
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async generateAndRunFFmpegCommand(
    timeline: any,
    exportJob: any,
    exportOptions: ExportRequest,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const args: string[] = [];
    const inputs: string[] = [];
    const filterComplex: string[] = [];
    const streamMap: Map<string, number> = new Map();
    let streamIndex = 0;

    const videoTracks = timeline.tracks.filter((t: any) => t.type === 'VIDEO');
    const audioTracks = timeline.tracks.filter((t: any) => t.type === 'AUDIO');

    const allClips: any[] = [];
    for (const track of [...videoTracks, ...audioTracks]) {
      for (const clip of track.clips) {
        if (!inputs.includes(clip.sourcePath)) {
          inputs.push(clip.sourcePath);
          args.push('-i', clip.sourcePath);
          streamMap.set(clip.sourcePath, inputs.length - 1);
        }
        allClips.push({ ...clip, trackType: track.type, trackIndex: track.index });
      }
    }

    const clipStreams: Map<string, string> = new Map();

    for (const clip of allClips) {
      const inputIndex = streamMap.get(clip.sourcePath)!;
      const clipId = `clip_${clip.id}`;

      let videoFilter = `[${inputIndex}:v]`;
      let audioFilter = `[${inputIndex}:a]`;

      if (clip.trackType === 'VIDEO') {
        const seekStart = clip.sourceIn;
        const duration = clip.sourceOut - clip.sourceIn;

        videoFilter += `trim=start=${seekStart}:duration=${duration},setpts=PTS-STARTPTS`;
        audioFilter += `atrim=start=${seekStart}:duration=${duration},asetpts=PTS-STARTPTS`;

        const vFilters: string[] = [];
        const aFilters: string[] = [];

        if (clip.speed !== 1) {
          const speed = clip.speed;
          vFilters.push(`setpts=PTS/${speed}`);
          aFilters.push(`atempo=${speed}`);
        }

        if (clip.volume !== 1) {
          aFilters.push(`volume=${clip.volume}`);
        }

        if (clip.opacity !== 1) {
          vFilters.push(`format=rgba,colorchannelmixer=aa=${clip.opacity}`);
        }

        if (clip.rotation !== 0 || clip.scale !== 1 || clip.positionX !== 0 || clip.positionY !== 0) {
          let transform = '';
          if (clip.rotation !== 0) {
            const rad = (clip.rotation * Math.PI) / 180;
            transform += `rotate=${rad}:ow=rotw(${rad}):oh=roth(${rad}):fillcolor=none@0,`;
          }
          if (clip.scale !== 1) {
            transform += `scale=iw*${clip.scale}:ih*${clip.scale},`;
          }
          if (transform) {
            vFilters.push(transform.slice(0, -1));
          }
        }

        for (const effect of clip.effects) {
          const expr = effectService.buildFilterExpression(
            effect,
            exportJob.width,
            exportJob.height
          );
          if (expr) {
            if (effect.type === 'AUDIO') {
              const audioExpr = effectService.buildAudioFilter(effect);
              if (audioExpr) {
                aFilters.push(audioExpr);
              }
            } else {
              vFilters.push(expr);
            }
          }
        }

        if (vFilters.length > 0) {
          videoFilter += `,${vFilters.join(',')}`;
        }
        if (aFilters.length > 0) {
          audioFilter += `,${aFilters.join(',')}`;
        }

        const vStream = `${clipId}_v`;
        const aStream = `${clipId}_a`;
        filterComplex.push(`${videoFilter}[${vStream}]`);
        filterComplex.push(`${audioFilter}[${aStream}]`);
        clipStreams.set(clip.id + '_v', vStream);
        clipStreams.set(clip.id + '_a', aStream);
      } else if (clip.trackType === 'AUDIO') {
        const seekStart = clip.sourceIn;
        const duration = clip.sourceOut - clip.sourceIn;

        audioFilter += `atrim=start=${seekStart}:duration=${duration},asetpts=PTS-STARTPTS`;

        const aFilters: string[] = [];
        if (clip.speed !== 1) {
          aFilters.push(`atempo=${clip.speed}`);
        }
        if (clip.volume !== 1) {
          aFilters.push(`volume=${clip.volume}`);
        }

        for (const effect of clip.effects) {
          if (effect.type === 'AUDIO') {
            const audioExpr = effectService.buildAudioFilter(effect);
            if (audioExpr) {
              aFilters.push(audioExpr);
            }
          }
        }

        if (aFilters.length > 0) {
          audioFilter += `,${aFilters.join(',')}`;
        }

        const aStream = `${clipId}_a`;
        filterComplex.push(`${audioFilter}[${aStream}]`);
        clipStreams.set(clip.id + '_a', aStream);
      }
    }

    const trackOutputs: string[] = [];

    for (let trackIdx = 0; trackIdx < videoTracks.length; trackIdx++) {
      const track = videoTracks[trackIdx];
      const trackClips = track.clips.sort((a: any, b: any) => a.startTime - b.startTime);

      if (trackClips.length === 0) continue;

      const trackStream = `track_v_${trackIdx}`;
      const paddedClips: string[] = [];

      for (let i = 0; i < trackClips.length; i++) {
        const clip = trackClips[i];
        const clipVStream = clipStreams.get(clip.id + '_v')!;
        const prevClip = trackClips[i - 1];
        const gapStart = prevClip ? prevClip.endTime : 0;
        const gapDuration = clip.startTime - gapStart;

        if (gapDuration > 0.01) {
          const padStream = `pad_${trackIdx}_${i}`;
          filterComplex.push(
            `color=c=black@0:s=${exportJob.width}x${exportJob.height}:d=${gapDuration}:r=${exportJob.fps}[${padStream}]`
          );
          paddedClips.push(padStream);
        }

        paddedClips.push(clipVStream);

        if (i < trackClips.length - 1) {
          const nextClip = trackClips[i + 1];
          const transition = clip.effects.find((e: any) => e.type === 'TRANSITION');
          
          if (transition && transition.parameters.duration) {
            const transDur = transition.parameters.duration;
            const offset = clip.endTime - transDur;
            const nextVStream = clipStreams.get(nextClip.id + '_v')!;
            const transStream = `trans_${trackIdx}_${i}`;

            const transFilter = effectService.buildTransitionFilter(
              transition.transitionType,
              transDur,
              offset,
              clipVStream,
              nextVStream
            );
            filterComplex.push(`${transFilter}[${transStream}]`);
          }
        }
      }

      if (paddedClips.length > 1) {
        const concatInputs = paddedClips.map(c => `[${c}]`).join('');
        filterComplex.push(
          `${concatInputs}concat=n=${paddedClips.length}:v=1:a=0[${trackStream}]`
        );
      } else if (paddedClips.length === 1) {
        filterComplex.push(`[${paddedClips[0]}]copy[${trackStream}]`);
      }

      trackOutputs.push(trackStream);
    }

    if (trackOutputs.length > 0) {
      let overlayInput = `[${trackOutputs[0]}]`;
      
      for (let i = 1; i < trackOutputs.length; i++) {
        const overlayStream = `ov_${i}`;
        const bgStream = i === 1 ? trackOutputs[0] : `ov_${i - 1}`;
        filterComplex.push(
          `[${bgStream}][${trackOutputs[i]}]overlay=0:0:eof_action=pass[${overlayStream}]`
        );
        overlayInput = `[${overlayStream}]`;
      }

      filterComplex.push(`${overlayInput}format=yuv420p[outv]`);
    }

    const audioInputs: string[] = [];
    for (const track of audioTracks) {
      const trackClips = track.clips.sort((a: any, b: any) => a.startTime - b.startTime);
      const paddedClips: string[] = [];

      for (let i = 0; i < trackClips.length; i++) {
        const clip = trackClips[i];
        const clipAStream = clipStreams.get(clip.id + '_a');
        if (!clipAStream) continue;

        const prevClip = trackClips[i - 1];
        const gapStart = prevClip ? prevClip.endTime : 0;
        const gapDuration = clip.startTime - gapStart;

        if (gapDuration > 0.01) {
          const padStream = `apad_${track.index}_${i}`;
          filterComplex.push(
            `aevalsrc=0:d=${gapDuration}:s=44100[${padStream}]`
          );
          paddedClips.push(padStream);
        }

        paddedClips.push(clipAStream);
      }

      if (paddedClips.length > 1) {
        const concatInputs = paddedClips.map(c => `[${c}]`).join('');
        const trackStream = `track_a_${track.index}`;
        filterComplex.push(
          `${concatInputs}concat=n=${paddedClips.length}:v=0:a=1[${trackStream}]`
        );
        audioInputs.push(trackStream);
      } else if (paddedClips.length === 1) {
        audioInputs.push(paddedClips[0]);
      }
    }

    if (audioInputs.length > 0) {
      if (audioInputs.length > 1) {
        const mixInputs = audioInputs.map(s => `[${s}]`).join('');
        filterComplex.push(`${mixInputs}amix=inputs=${audioInputs.length}:duration=longest[outa]`);
      } else {
        filterComplex.push(`[${audioInputs[0]}]anull[outa]`);
      }
    }

    if (filterComplex.length > 0) {
      args.push('-filter_complex', filterComplex.join(';'));
    }

    if (trackOutputs.length > 0) {
      args.push('-map', '[outv]');
    }
    if (audioInputs.length > 0) {
      args.push('-map', '[outa]');
    }

    const videoCodecMap: Record<string, string> = {
      h264: 'libx264',
      h265: 'libx265',
      av1: 'libaom-av1',
      vp9: 'libvpx-vp9',
    };

    const audioCodecMap: Record<string, string> = {
      aac: 'aac',
      mp3: 'libmp3lame',
      opus: 'libopus',
      copy: 'copy',
    };

    args.push('-c:v', videoCodecMap[exportOptions.videoCodec || 'h264'] || 'libx264');
    args.push('-c:a', audioCodecMap[exportOptions.audioCodec || 'aac'] || 'aac');
    args.push('-b:v', String(exportJob.bitrate));
    args.push('-r', String(exportJob.fps));
    args.push('-s', `${exportJob.width}x${exportJob.height}`);

    if (exportOptions.videoCodec === 'h264') {
      args.push('-preset', 'medium');
      args.push('-crf', '23');
      args.push('-pix_fmt', 'yuv420p');
    }

    args.push('-y');
    args.push(exportJob.outputPath);

    const command = `${config.ffmpeg.ffmpegPath} ${args.join(' ')}`;
    console.log('[Export] FFmpeg command:', command);

    return new Promise((resolve, reject) => {
      const proc = spawn(config.ffmpeg.ffmpegPath, args, {
        stdio: 'pipe',
        shell: false,
      });

      let stderrBuffer = '';
      let totalDuration = timeline.duration;

      if (proc.stderr) {
        proc.stderr.on('data', (data: Buffer) => {
          const output = data.toString();
          stderrBuffer += output;
          
          const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
          if (timeMatch && onProgress && totalDuration > 0) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
            const currentSeconds = hours * 3600 + minutes * 60 + seconds;
            const progress = Math.min(Math.round((currentSeconds / totalDuration) * 100), 99);
            
            prisma.exportJob.update({
              where: { id: exportJob.id },
              data: { progress },
            }).catch(() => {});
            
            onProgress(progress);
          }
        });
      }

      proc.on('error', (err: Error) => {
        console.error('[Export] FFmpeg process error:', err);
        reject(err);
      });

      proc.on('exit', (code: number) => {
        if (code !== 0) {
          console.error('[Export] FFmpeg exited with code', code);
          console.error('[Export] FFmpeg stderr tail:', stderrBuffer.slice(-2000));
          reject(new Error(`FFmpeg exited with code ${code}: ${stderrBuffer.slice(-500)}`));
        } else {
          console.log('[Export] FFmpeg completed successfully');
          resolve(exportJob.outputPath);
        }
      });
    });
  }

  async cancelExport(exportJobId: string): Promise<void> {
    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });
  }

  async getExportStatus(exportJobId: string) {
    return prisma.exportJob.findUnique({
      where: { id: exportJobId },
    });
  }

  async getProjectExports(projectId: string) {
    return prisma.exportJob.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  getOutputUrl(outputPath: string): string {
    const baseUrl = '/uploads/edits';
    const fileName = path.basename(outputPath);
    return `${baseUrl}/${fileName}`;
  }
}

export const exportService = new ExportService();
