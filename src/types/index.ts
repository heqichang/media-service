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

export interface LiveStreamAuthResult {
  allowed: boolean;
  liveRoomId?: string;
  streamKey?: string;
  reason?: string;
}

export interface LiveTranscodeConfig {
  name: string;
  width: number;
  height: number;
  videoBitrate: number;
  audioBitrate?: number;
  videoCodec?: 'h264' | 'h265' | 'av1';
  audioCodec?: 'aac' | 'mp3' | 'opus';
  framerate?: number;
  isBackup?: boolean;
}

export interface LiveRecordConfig {
  format: 'flv' | 'hls' | 'mp4';
  sliceDuration?: number;
  autoConvertVod?: boolean;
}

export interface DanmakuMessage {
  id: string;
  liveRoomId: string;
  userId: string;
  userName: string;
  content: string;
  color: string;
  fontSize: number;
  mode: number;
  timestamp: Date;
}

export interface GiftMessage {
  id: string;
  liveRoomId: string;
  giftId: string;
  giftName: string;
  userId: string;
  userName: string;
  quantity: number;
  totalValue: number;
  iconUrl?: string;
  timestamp: Date;
}

export interface LikeMessage {
  liveRoomId: string;
  userId: string;
  count: number;
  timestamp: Date;
}

export interface OnlineUsersMessage {
  liveRoomId: string;
  count: number;
  users: Array<{ userId: string; userName: string }>;
}

export interface LiveViewerInfo {
  liveRoomId: string;
  userId: string;
  userName: string;
  protocol: 'hls' | 'flv' | 'webrtc';
}

export interface WebRtcSignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave';
  liveRoomId: string;
  userId: string;
  targetUserId?: string;
  data: any;
}

export interface LiveStreamMetrics {
  liveRoomId: string;
  bitrate: number;
  width: number;
  height: number;
  codec: string;
  fps: number;
  latencyMs: number;
  connectedAt?: Date;
}

export interface LiveRoomStats {
  liveRoomId: string;
  viewCount: number;
  peakViewers: number;
  likeCount: number;
  danmakuCount: number;
  giftCount: number;
  duration: number;
  startTime?: Date;
  endTime?: Date;
}

export interface PlayAuthResult {
  allowed: boolean;
  token?: string;
  expiresAt?: Date;
  reason?: string;
}
