-- CreateEnum
CREATE TYPE "LiveRoomStatus" AS ENUM ('NOT_STARTED', 'LIVING', 'ENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "LiveStreamStatus" AS ENUM ('PUSHING', 'INTERRUPTED', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "LiveStreamProtocol" AS ENUM ('RTMP', 'SRT', 'RTSP');

-- CreateEnum
CREATE TYPE "LiveTranscodeStatus" AS ENUM ('RUNNING', 'STOPPED', 'FAILED', 'SWITCHED');

-- CreateEnum
CREATE TYPE "LiveRecordingStatus" AS ENUM ('RECORDING', 'STOPPED', 'CONVERTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LiveRecordingFormat" AS ENUM ('FLV', 'HLS', 'MP4');

-- CreateEnum
CREATE TYPE "DanmakuStatus" AS ENUM ('NORMAL', 'HIDDEN', 'BANNED');

-- CreateEnum
CREATE TYPE "GiftStatus" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "LivePlayProtocol" AS ENUM ('HLS', 'FLV', 'WEBRTC');

-- CreateEnum
CREATE TYPE "PlayAuthStatus" AS ENUM ('ALLOWED', 'DENIED', 'EXPIRED');

-- CreateTable
CREATE TABLE "LiveRoom" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverUrl" TEXT,
    "categoryId" TEXT,
    "streamKey" TEXT NOT NULL,
    "status" "LiveRoomStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "pushUrl" TEXT,
    "playUrlHls" TEXT,
    "playUrlFlv" TEXT,
    "playUrlRtc" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "maxBitrate" INTEGER,
    "isRecorded" BOOLEAN NOT NULL DEFAULT true,
    "recordFormat" "LiveRecordingFormat" NOT NULL DEFAULT 'FLV',
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "duration" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "peakViewers" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "banReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveStream" (
    "id" TEXT NOT NULL,
    "liveRoomId" TEXT NOT NULL,
    "streamIndex" INTEGER NOT NULL DEFAULT 0,
    "streamName" TEXT NOT NULL,
    "protocol" "LiveStreamProtocol" NOT NULL DEFAULT 'RTMP',
    "status" "LiveStreamStatus" NOT NULL DEFAULT 'PUSHING',
    "bitrate" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "codec" TEXT,
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "duration" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "pushIp" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveStream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveTranscode" (
    "id" TEXT NOT NULL,
    "liveRoomId" TEXT NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "videoBitrate" INTEGER NOT NULL,
    "audioBitrate" INTEGER,
    "videoCodec" "VideoCodec" NOT NULL DEFAULT 'H264',
    "audioCodec" "AudioCodec" NOT NULL DEFAULT 'AAC',
    "framerate" INTEGER,
    "status" "LiveTranscodeStatus" NOT NULL DEFAULT 'RUNNING',
    "outputUrl" TEXT,
    "outputPath" TEXT,
    "isBackup" BOOLEAN NOT NULL DEFAULT false,
    "mainTranscodeId" TEXT,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "lastCheckAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveTranscode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveRecording" (
    "id" TEXT NOT NULL,
    "liveRoomId" TEXT NOT NULL,
    "format" "LiveRecordingFormat" NOT NULL DEFAULT 'FLV',
    "status" "LiveRecordingStatus" NOT NULL DEFAULT 'RECORDING',
    "filePath" TEXT,
    "fileSize" BIGINT,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "segmentIndex" INTEGER NOT NULL DEFAULT 0,
    "sliceDuration" INTEGER,
    "videoId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivePlan" (
    "id" TEXT NOT NULL,
    "liveRoomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "description" TEXT,
    "isNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LivePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Danmaku" (
    "id" TEXT NOT NULL,
    "liveRoomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#FFFFFF',
    "fontSize" INTEGER NOT NULL DEFAULT 24,
    "mode" INTEGER NOT NULL DEFAULT 1,
    "status" "DanmakuStatus" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Danmaku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gift" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconUrl" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "value" INTEGER NOT NULL,
    "status" "GiftStatus" NOT NULL DEFAULT 'ENABLED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveGiftLog" (
    "id" TEXT NOT NULL,
    "liveRoomId" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "totalValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveGiftLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveLike" (
    "id" TEXT NOT NULL,
    "liveRoomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveViewer" (
    "id" TEXT NOT NULL,
    "liveRoomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "protocol" "LivePlayProtocol" NOT NULL DEFAULT 'HLS',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LiveViewer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveRoom_streamKey_key" ON "LiveRoom"("streamKey");

-- CreateIndex
CREATE INDEX "LiveRoom_status_idx" ON "LiveRoom"("status");

-- CreateIndex
CREATE INDEX "LiveRoom_categoryId_idx" ON "LiveRoom"("categoryId");

-- CreateIndex
CREATE INDEX "LiveRoom_createdAt_idx" ON "LiveRoom"("createdAt");

-- CreateIndex
CREATE INDEX "LiveStream_liveRoomId_idx" ON "LiveStream"("liveRoomId");

-- CreateIndex
CREATE INDEX "LiveStream_status_idx" ON "LiveStream"("status");

-- CreateIndex
CREATE INDEX "LiveTranscode_liveRoomId_idx" ON "LiveTranscode"("liveRoomId");

-- CreateIndex
CREATE INDEX "LiveTranscode_status_idx" ON "LiveTranscode"("status");

-- CreateIndex
CREATE INDEX "LiveRecording_liveRoomId_idx" ON "LiveRecording"("liveRoomId");

-- CreateIndex
CREATE INDEX "LiveRecording_status_idx" ON "LiveRecording"("status");

-- CreateIndex
CREATE INDEX "LivePlan_liveRoomId_idx" ON "LivePlan"("liveRoomId");

-- CreateIndex
CREATE INDEX "LivePlan_scheduledAt_idx" ON "LivePlan"("scheduledAt");

-- CreateIndex
CREATE INDEX "Danmaku_liveRoomId_idx" ON "Danmaku"("liveRoomId");

-- CreateIndex
CREATE INDEX "Danmaku_userId_idx" ON "Danmaku"("userId");

-- CreateIndex
CREATE INDEX "Danmaku_createdAt_idx" ON "Danmaku"("createdAt");

-- CreateIndex
CREATE INDEX "LiveGiftLog_liveRoomId_idx" ON "LiveGiftLog"("liveRoomId");

-- CreateIndex
CREATE INDEX "LiveGiftLog_userId_idx" ON "LiveGiftLog"("userId");

-- CreateIndex
CREATE INDEX "LiveGiftLog_createdAt_idx" ON "LiveGiftLog"("createdAt");

-- CreateIndex
CREATE INDEX "LiveLike_liveRoomId_idx" ON "LiveLike"("liveRoomId");

-- CreateIndex
CREATE INDEX "LiveLike_userId_idx" ON "LiveLike"("userId");

-- CreateIndex
CREATE INDEX "LiveViewer_liveRoomId_idx" ON "LiveViewer"("liveRoomId");

-- CreateIndex
CREATE INDEX "LiveViewer_userId_idx" ON "LiveViewer"("userId");

-- CreateIndex
CREATE INDEX "LiveViewer_isActive_idx" ON "LiveViewer"("isActive");

-- AddForeignKey
ALTER TABLE "LiveRoom" ADD CONSTRAINT "LiveRoom_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_liveRoomId_fkey" FOREIGN KEY ("liveRoomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveTranscode" ADD CONSTRAINT "LiveTranscode_liveRoomId_fkey" FOREIGN KEY ("liveRoomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveTranscode" ADD CONSTRAINT "LiveTranscode_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TranscodeTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveTranscode" ADD CONSTRAINT "LiveTranscode_mainTranscodeId_fkey" FOREIGN KEY ("mainTranscodeId") REFERENCES "LiveTranscode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveRecording" ADD CONSTRAINT "LiveRecording_liveRoomId_fkey" FOREIGN KEY ("liveRoomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveRecording" ADD CONSTRAINT "LiveRecording_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivePlan" ADD CONSTRAINT "LivePlan_liveRoomId_fkey" FOREIGN KEY ("liveRoomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Danmaku" ADD CONSTRAINT "Danmaku_liveRoomId_fkey" FOREIGN KEY ("liveRoomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveGiftLog" ADD CONSTRAINT "LiveGiftLog_liveRoomId_fkey" FOREIGN KEY ("liveRoomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveGiftLog" ADD CONSTRAINT "LiveGiftLog_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveLike" ADD CONSTRAINT "LiveLike_liveRoomId_fkey" FOREIGN KEY ("liveRoomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveViewer" ADD CONSTRAINT "LiveViewer_liveRoomId_fkey" FOREIGN KEY ("liveRoomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
