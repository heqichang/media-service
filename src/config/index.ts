import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    publicHost: process.env.PUBLIC_HOST || '',
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
    liveBucket: process.env.MINIO_LIVE_BUCKET || 'lives',
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
  videoEdit: {
    outputDir: path.resolve(process.env.VIDEO_EDIT_OUTPUT_DIR || './uploads/edits'),
    tempDir: path.resolve(process.env.VIDEO_EDIT_TEMP_DIR || './uploads/edits/temp'),
    exportConcurrency: parseInt(process.env.VIDEO_EDIT_EXPORT_CONCURRENCY || '1', 10),
    maxHistorySize: parseInt(process.env.VIDEO_EDIT_MAX_HISTORY || '50', 10),
    defaultWidth: parseInt(process.env.VIDEO_EDIT_DEFAULT_WIDTH || '1920', 10),
    defaultHeight: parseInt(process.env.VIDEO_EDIT_DEFAULT_HEIGHT || '1080', 10),
    defaultFps: parseInt(process.env.VIDEO_EDIT_DEFAULT_FPS || '30', 10),
    defaultTransitionDuration: parseFloat(process.env.VIDEO_EDIT_DEFAULT_TRANSITION || '0.5'),
  },
  live: {
    rtmp: {
      port: parseInt(process.env.RTMP_PORT || '1935', 10),
      enabled: process.env.RTMP_ENABLED !== 'false',
      chunkSize: parseInt(process.env.RTMP_CHUNK_SIZE || '4096', 10),
      gopCache: process.env.RTMP_GOP_CACHE !== 'false',
      pingInterval: parseInt(process.env.RTMP_PING_INTERVAL || '60000', 10),
      pingTimeout: parseInt(process.env.RTMP_PING_TIMEOUT || '30000', 10),
    },
    srt: {
      port: parseInt(process.env.SRT_PORT || '9000', 10),
      enabled: process.env.SRT_ENABLED !== 'false',
      maxBandwidth: parseInt(process.env.SRT_MAX_BANDWIDTH || '1000000', 10),
      latency: parseInt(process.env.SRT_LATENCY || '120', 10),
    },
    auth: {
      streamKeyLength: parseInt(process.env.STREAM_KEY_LENGTH || '32', 10),
      tokenExpiry: parseInt(process.env.STREAM_TOKEN_EXPIRY || '3600', 10),
      playTokenExpiry: parseInt(process.env.PLAY_TOKEN_EXPIRY || '7200', 10),
    },
    transcode: {
      enabled: process.env.LIVE_TRANSCODE_ENABLED !== 'false',
      maxLatencyMs: parseInt(process.env.LIVE_TRANSCODE_MAX_LATENCY || '3000', 10),
      checkInterval: parseInt(process.env.LIVE_TRANSCODE_CHECK_INTERVAL || '5000', 10),
      autoSwitchBackup: process.env.LIVE_TRANSCODE_AUTO_SWITCH !== 'false',
    },
    record: {
      enabled: process.env.LIVE_RECORD_ENABLED !== 'false',
      defaultFormat: process.env.LIVE_RECORD_DEFAULT_FORMAT || 'flv',
      autoConvertVod: process.env.LIVE_RECORD_AUTO_CONVERT !== 'false',
      sliceDuration: parseInt(process.env.LIVE_RECORD_SLICE_DURATION || '3600', 10),
      outputDir: path.resolve(process.env.LIVE_RECORD_OUTPUT_DIR || './uploads/recordings'),
    },
    hls: {
      enabled: process.env.HLS_ENABLED !== 'false',
      time: parseInt(process.env.HLS_TIME || '2', 10),
      listSize: parseInt(process.env.HLS_LIST_SIZE || '6', 10),
      segmentDir: path.resolve(process.env.HLS_SEGMENT_DIR || './uploads/hls'),
    },
    flv: {
      enabled: process.env.FLV_ENABLED !== 'false',
      port: parseInt(process.env.FLV_PORT || '8000', 10),
    },
    webrtc: {
      enabled: process.env.WEBRTC_ENABLED !== 'false',
      port: parseInt(process.env.WEBRTC_PORT || '8888', 10),
      stunServer: process.env.WEBRTC_STUN_SERVER || 'stun:stun.l.google.com:19302',
      turnServer: process.env.WEBRTC_TURN_SERVER || '',
      turnUsername: process.env.WEBRTC_TURN_USERNAME || '',
      turnCredential: process.env.WEBRTC_TURN_CREDENTIAL || '',
    },
    interact: {
      danmakuRateLimit: parseInt(process.env.DANMAKU_RATE_LIMIT || '1', 10),
      danmakuMaxLength: parseInt(process.env.DANMAKU_MAX_LENGTH || '100', 10),
      onlineUpdateInterval: parseInt(process.env.ONLINE_UPDATE_INTERVAL || '5000', 10),
      maxDanmakuCache: parseInt(process.env.MAX_DANMAKU_CACHE || '100', 10),
    },
    cdn: {
      enabled: process.env.CDN_ENABLED === 'true',
      baseUrl: process.env.CDN_BASE_URL || '',
      hlsPath: process.env.CDN_HLS_PATH || '/hls',
      flvPath: process.env.CDN_FLV_PATH || '/live',
    },
  },
};
