import Queue from 'bull';
import { config } from '../config';
import { TranscodeJobData, ThumbnailJobData } from '../types';

export const transcodeQueue = new Queue<TranscodeJobData>('transcode', {
  redis: config.redis.url,
  defaultJobOptions: {
    attempts: config.transcode.maxRetries,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
  settings: {
    maxStalledCount: 3,
    stalledInterval: 30000,
  },
});

export const thumbnailQueue = new Queue<ThumbnailJobData>('thumbnail', {
  redis: config.redis.url,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

export const notificationQueue = new Queue<any>('notification', {
  redis: config.redis.url,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

transcodeQueue.on('global:completed', (jobId, result) => {
  console.log(`Transcode job ${jobId} completed`);
});

transcodeQueue.on('global:failed', (jobId, err) => {
  console.error(`Transcode job ${jobId} failed:`, err);
});

thumbnailQueue.on('global:completed', (jobId, result) => {
  console.log(`Thumbnail job ${jobId} completed`);
});

thumbnailQueue.on('global:failed', (jobId, err) => {
  console.error(`Thumbnail job ${jobId} failed:`, err);
});
