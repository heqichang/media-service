import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  database: {
    url: process.env.DATABASE_URL || '',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  minio: {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    videoBucket: process.env.MINIO_VIDEO_BUCKET || 'videos',
    thumbnailBucket: process.env.MINIO_THUMBNAIL_BUCKET || 'thumbnails',
  },
  ffmpeg: {
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  },
  upload: {
    tempDir: path.resolve(process.env.UPLOAD_TEMP_DIR || './uploads'),
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10737418240', 10),
    allowedVideoTypes: (process.env.ALLOWED_VIDEO_TYPES || 'video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,video/ogg').split(','),
  },
  transcode: {
    concurrency: parseInt(process.env.TRANSCODE_CONCURRENCY || '2', 10),
    maxRetries: parseInt(process.env.TRANSCODE_MAX_RETRIES || '3', 10),
  },
};
