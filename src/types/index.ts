export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  bitrate: number;
  format: string;
  videoCodec: string;
  audioCodec: string;
  framerate: number;
}

export interface TranscodeOptions {
  width?: number;
  height?: number;
  videoBitrate?: number;
  videoCodec?: 'h264' | 'h265' | 'av1';
  audioBitrate?: number;
  audioCodec?: 'aac' | 'mp3' | 'opus';
  framerate?: number;
  crf?: number;
  preset?: string;
  outputFormat: string;
  isHls?: boolean;
  isDash?: boolean;
}

export interface ThumbnailOptions {
  timePoint?: number;
  width?: number;
  height?: number;
  format: 'jpg' | 'png' | 'webp';
  quality?: number;
  count?: number;
  interval?: number;
  sprite?: boolean;
  spriteColumns?: number;
}

export interface TranscodeJobData {
  videoId: string;
  inputPath: string;
  templateId?: string;
  options: TranscodeOptions;
  outputDir: string;
}

export interface ThumbnailJobData {
  videoId: string;
  inputPath: string;
  options: ThumbnailOptions;
  outputDir: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginationResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
