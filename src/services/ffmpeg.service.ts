import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config';
import { VideoMetadata, TranscodeOptions, ThumbnailOptions } from '../types';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

ffmpeg.setFfmpegPath(config.ffmpeg.ffmpegPath);
ffmpeg.setFfprobePath(config.ffmpeg.ffprobePath);

export class FFmpegService {
  static async getMetadata(inputPath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        const framerateStr = videoStream.r_frame_rate || videoStream.avg_frame_rate || '0/1';
        const [num, den] = framerateStr.split('/').map(Number);
        const framerate = den !== 0 ? num / den : 0;

        resolve({
          duration: metadata.format.duration || 0,
          width: videoStream.width || 0,
          height: videoStream.height || 0,
          bitrate: parseInt(String(metadata.format.bit_rate || '0'), 10) || 0,
          format: metadata.format.format_name || '',
          videoCodec: videoStream.codec_name || '',
          audioCodec: audioStream?.codec_name || '',
          framerate,
        });
      });
    });
  }

  static async transcode(
    inputPath: string,
    outputDir: string,
    options: TranscodeOptions,
    onProgress?: (progress: number) => void
  ): Promise<{ outputPath: string; playlistPath?: string }> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const outputId = uuidv4();
      let outputPath: string;
      let playlistPath: string | undefined;

      const command = ffmpeg(inputPath);

      if (options.isHls) {
        playlistPath = path.join(outputDir, `${outputId}.m3u8`);
        outputPath = path.join(outputDir, `${outputId}_%03d.ts`);

        command
          .addOption('-hls_time', '10')
          .addOption('-hls_list_size', '0')
          .addOption('-hls_segment_filename', outputPath)
          .output(playlistPath);
      } else if (options.isDash) {
        playlistPath = path.join(outputDir, `${outputId}.mpd`);
        outputPath = path.join(outputDir, `${outputId}_$RepresentationID$.$ext%03d$`);

        command
          .addOption('-f', 'dash')
          .addOption('-adaptation_sets', 'id=0,streams=v id=1,streams=a')
          .output(playlistPath);
      } else {
        outputPath = path.join(outputDir, `${outputId}.${options.outputFormat}`);
        command.output(outputPath);
      }

      if (options.videoCodec) {
        command.videoCodec(options.videoCodec === 'h264' ? 'libx264' : options.videoCodec === 'h265' ? 'libx265' : 'libaom-av1');
      }

      if (options.audioCodec) {
        command.audioCodec(options.audioCodec === 'aac' ? 'aac' : options.audioCodec === 'mp3' ? 'libmp3lame' : 'libopus');
      }

      if (options.width && options.height) {
        command.size(`${options.width}x${options.height}`);
      } else if (options.width) {
        command.size(`${options.width}x?`);
      } else if (options.height) {
        command.size(`?x${options.height}`);
      }

      if (options.videoBitrate) {
        command.videoBitrate(options.videoBitrate);
      }

      if (options.audioBitrate) {
        command.audioBitrate(options.audioBitrate);
      }

      if (options.framerate) {
        command.fps(options.framerate);
      }

      if (options.crf !== undefined) {
        command.addOption('-crf', options.crf.toString());
      }

      if (options.preset) {
        command.addOption('-preset', options.preset);
      }

      command
        .on('progress', (progress) => {
          if (onProgress && progress.percent !== undefined) {
            onProgress(Math.min(progress.percent, 100));
          }
        })
        .on('end', () => {
          resolve({ outputPath, playlistPath });
        })
        .on('error', (err) => {
          reject(err);
        })
        .run();
    });
  }

  static async generateThumbnail(
    inputPath: string,
    outputDir: string,
    options: ThumbnailOptions
  ): Promise<{ filePath: string; width: number; height: number; timePoint: number }[]> {
    return new Promise(async (resolve, reject) => {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const metadata = await this.getMetadata(inputPath);
      const results: { filePath: string; width: number; height: number; timePoint: number }[] = [];

      const timePoints: number[] = [];

      if (options.count && options.interval) {
        for (let i = 0; i < options.count; i++) {
          timePoints.push(Math.min(i * options.interval, metadata.duration - 1));
        }
      } else if (options.timePoint !== undefined) {
        timePoints.push(options.timePoint);
      } else {
        timePoints.push(metadata.duration * 0.1);
      }

      const thumbnailWidth = options.width || Math.min(metadata.width, 320);
      const thumbnailHeight = options.height || Math.round(thumbnailWidth * metadata.height / metadata.width);

      let processed = 0;

      for (const timePoint of timePoints) {
        const outputId = uuidv4();
        const ext = options.format === 'webp' ? 'webp' : options.format === 'png' ? 'png' : 'jpg';
        const outputPath = path.join(outputDir, `${outputId}.${ext}`);

        ffmpeg(inputPath)
          .seekInput(timePoint)
          .frames(1)
          .size(`${thumbnailWidth}x${thumbnailHeight}`)
          .output(outputPath)
          .on('end', () => {
            results.push({
              filePath: outputPath,
              width: thumbnailWidth,
              height: thumbnailHeight,
              timePoint,
            });

            processed++;
            if (processed === timePoints.length) {
              resolve(results);
            }
          })
          .on('error', (err) => {
            reject(err);
          })
          .run();
      }
    });
  }

  static async generateSprite(
    inputPath: string,
    outputDir: string,
    options: ThumbnailOptions
  ): Promise<{ filePath: string; vttPath: string; data: any }> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const metadata = await this.getMetadata(inputPath);
    const interval = options.interval || 10;
    const count = Math.min(options.count || Math.floor(metadata.duration / interval), 100);
    const columns = options.spriteColumns || 10;
    const thumbnailWidth = options.width || 160;
    const thumbnailHeight = options.height || Math.round(thumbnailWidth * metadata.height / metadata.width);

    const outputId = uuidv4();
    const ext = options.format === 'webp' ? 'webp' : options.format === 'png' ? 'png' : 'jpg';
    const spritePath = path.join(outputDir, `${outputId}_sprite.${ext}`);
    const vttPath = path.join(outputDir, `${outputId}_sprite.vtt`);

    const tempDir = path.join(outputDir, `temp_${outputId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    for (let i = 0; i < count; i++) {
      const timePoint = Math.min(i * interval, metadata.duration - 1);
      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .seekInput(timePoint)
          .frames(1)
          .size(`${thumbnailWidth}x${thumbnailHeight}`)
          .output(path.join(tempDir, `thumb_${i.toString().padStart(5, '0')}.${ext}`))
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });
    }

    const rows = Math.ceil(count / columns);
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(path.join(tempDir, `thumb_%05d.${ext}`))
        .addOption('-frames', '1')
        .addOption('-tile', `${columns}x${rows}`)
        .addOption('-layout', `${columns}x${rows}`)
        .output(spritePath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    let vttContent = 'WEBVTT\n\n';
    for (let i = 0; i < count; i++) {
      const startTime = i * interval;
      const endTime = Math.min((i + 1) * interval, metadata.duration);
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = col * thumbnailWidth;
      const y = row * thumbnailHeight;

      vttContent += `${this.formatVttTime(startTime)} --> ${this.formatVttTime(endTime)}\n`;
      vttContent += `${outputId}_sprite.${ext}#xywh=${x},${y},${thumbnailWidth},${thumbnailHeight}\n\n`;
    }

    fs.writeFileSync(vttPath, vttContent);

    fs.rmSync(tempDir, { recursive: true, force: true });

    return {
      filePath: spritePath,
      vttPath,
      data: {
        count,
        columns,
        rows,
        interval,
        thumbnailWidth,
        thumbnailHeight,
        spriteWidth: columns * thumbnailWidth,
        spriteHeight: rows * thumbnailHeight,
      },
    };
  }

  private static formatVttTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const ms = Math.floor((s % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${Math.floor(s).toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }

  static async generateABR(
    inputPath: string,
    outputDir: string,
    renditions: TranscodeOptions[],
    onProgress?: (progress: number) => void
  ): Promise<{ masterPlaylist: string; playlists: string[] }> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const playlists: string[] = [];
    const outputId = uuidv4();

    for (let i = 0; i < renditions.length; i++) {
      const rendition = renditions[i];
      const renditionDir = path.join(outputDir, `rendition_${i}`);
      fs.mkdirSync(renditionDir, { recursive: true });

      const result = await this.transcode(
        inputPath,
        renditionDir,
        { ...rendition, isHls: true },
        (p) => onProgress?.((i + p / 100) / renditions.length * 100)
      );

      if (result.playlistPath) {
        playlists.push(result.playlistPath);
      }
    }

    const masterPlaylistPath = path.join(outputDir, `${outputId}_master.m3u8`);
    let masterContent = '#EXTM3U\n#EXT-X-VERSION:3\n';

    for (let i = 0; i < renditions.length; i++) {
      const rendition = renditions[i];
      const bandwidth = (rendition.videoBitrate || 1000000) + (rendition.audioBitrate || 128000);
      const resolution = rendition.width && rendition.height ? `${rendition.width}x${rendition.height}` : '';

      masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}`;
      if (resolution) masterContent += `,RESOLUTION=${resolution}`;
      masterContent += '\n';
      masterContent += `rendition_${i}/${path.basename(playlists[i])}\n`;
    }

    fs.writeFileSync(masterPlaylistPath, masterContent);

    return {
      masterPlaylist: masterPlaylistPath,
      playlists,
    };
  }
}
