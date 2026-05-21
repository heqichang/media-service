import { transcodeQueue, thumbnailQueue } from './index';
import { FFmpegService } from '../services/ffmpeg.service';
import prisma from '../config/prisma';
import { TranscodeStatus, VideoStatus } from '@prisma/client';
import { storageService } from '../services/storage.service';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

transcodeQueue.process(config.transcode.concurrency, async (job) => {
  const { videoId, inputPath, templateId, options, outputDir } = job.data;

  const task = await prisma.transcodeTask.create({
    data: {
      videoId,
      templateId,
      templateName: options.isHls ? 'HLS' : options.isDash ? 'DASH' : `${options.width || '?'}x${options.height || '?'}`,
      status: TranscodeStatus.PROCESSING,
      startedAt: new Date(),
    },
  });

  try {
    await prisma.video.update({
      where: { id: videoId },
      data: { status: VideoStatus.TRANSCODING },
    });

    job.progress(0);

    const result = await FFmpegService.transcode(inputPath, outputDir, options, (progress) => {
      job.progress(progress);
      prisma.transcodeTask.update({
        where: { id: task.id },
        data: { progress: Math.round(progress) },
      }).catch(() => {});
    });

    let outputObjectName: string | undefined;
    let playlistObjectName: string | undefined;

    if (result.playlistPath) {
      const playlistFileName = path.basename(result.playlistPath);
      playlistObjectName = `${videoId}/${playlistFileName}`;
      await storageService.uploadVideo(playlistObjectName, result.playlistPath);

      const segmentFiles = fs.readdirSync(path.dirname(result.playlistPath))
        .filter(f => f.endsWith('.ts'));

      for (const segmentFile of segmentFiles) {
        const segmentPath = path.join(path.dirname(result.playlistPath), segmentFile);
        const segmentObjectName = `${videoId}/${segmentFile}`;
        await storageService.uploadVideo(segmentObjectName, segmentPath);
      }

      await prisma.playlist.create({
        data: {
          videoId,
          type: options.isHls ? 'hls' : 'dash',
          url: playlistObjectName,
          filePath: result.playlistPath,
          bandwidths: [options.videoBitrate || 2000000],
        },
      });
    }

    if (result.outputPath && fs.existsSync(result.outputPath)) {
      const stats = fs.statSync(result.outputPath);
      const outputFileName = path.basename(result.outputPath);
      outputObjectName = `${videoId}/${outputFileName}`;
      await storageService.uploadVideo(outputObjectName, result.outputPath);

      const outputMetadata = await FFmpegService.getMetadata(result.outputPath);

      await prisma.transcodeTask.update({
        where: { id: task.id },
        data: {
          status: TranscodeStatus.COMPLETED,
          progress: 100,
          outputPath: outputObjectName,
          outputSize: BigInt(stats.size),
          width: outputMetadata.width,
          height: outputMetadata.height,
          bitrate: outputMetadata.bitrate,
          duration: outputMetadata.duration,
          completedAt: new Date(),
        },
      });
    } else {
      await prisma.transcodeTask.update({
        where: { id: task.id },
        data: {
          status: TranscodeStatus.COMPLETED,
          progress: 100,
          outputPath: playlistObjectName,
          completedAt: new Date(),
        },
      });
    }

    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: { transcodeTasks: true },
    });

    if (video && video.transcodeTasks.every(t => t.status === TranscodeStatus.COMPLETED)) {
      await prisma.video.update({
        where: { id: videoId },
        data: { status: VideoStatus.TRANSCODED },
      });
    }

    return { success: true, taskId: task.id };
  } catch (error: any) {
    await prisma.transcodeTask.update({
      where: { id: task.id },
      data: {
        status: TranscodeStatus.FAILED,
        errorMessage: error.message,
      },
    });

    throw error;
  }
});

thumbnailQueue.process(5, async (job) => {
  const { videoId, inputPath, options, outputDir } = job.data;

  try {
    job.progress(0);

    if (options.sprite) {
      const result = await FFmpegService.generateSprite(inputPath, outputDir, options);

      const spriteObjectName = `${videoId}/thumbnails/${path.basename(result.filePath)}`;
      const vttObjectName = `${videoId}/thumbnails/${path.basename(result.vttPath)}`;

      await storageService.uploadThumbnail(spriteObjectName, result.filePath);
      await storageService.uploadThumbnail(vttObjectName, result.vttPath);

      const stats = fs.statSync(result.filePath);

      await prisma.thumbnail.create({
        data: {
          videoId,
          filePath: spriteObjectName,
          url: spriteObjectName,
          timePoint: 0,
          width: result.data.spriteWidth,
          height: result.data.spriteHeight,
          format: options.format.toUpperCase() as any,
          fileSize: BigInt(stats.size),
          isSprite: true,
          spriteData: result.data,
        },
      });

      job.progress(100);
      return { success: true, sprite: spriteObjectName };
    } else {
      const results = await FFmpegService.generateThumbnail(inputPath, outputDir, options);

      for (let i = 0; i < results.length; i++) {
        const thumb = results[i];
        const objectName = `${videoId}/thumbnails/${path.basename(thumb.filePath)}`;
        await storageService.uploadThumbnail(objectName, thumb.filePath);

        const stats = fs.statSync(thumb.filePath);

        const thumbnail = await prisma.thumbnail.create({
          data: {
            videoId,
            filePath: objectName,
            url: objectName,
            timePoint: thumb.timePoint,
            width: thumb.width,
            height: thumb.height,
            format: options.format.toUpperCase() as any,
            fileSize: BigInt(stats.size),
            isSprite: false,
          },
        });

        if (i === 0) {
          await prisma.video.update({
            where: { id: videoId },
            data: { thumbnailUrl: objectName },
          });
        }

        job.progress(((i + 1) / results.length) * 100);
      }

      return { success: true, count: results.length };
    }
  } catch (error: any) {
    console.error('Thumbnail generation failed:', error);
    throw error;
  }
});

console.log('Worker started, waiting for jobs...');
