-- CreateEnum
CREATE TYPE "TrackType" AS ENUM ('VIDEO', 'AUDIO', 'SUBTITLE');

-- CreateEnum
CREATE TYPE "EffectType" AS ENUM ('TRANSITION', 'FILTER', 'TEXT', 'PIP', 'SPEED', 'AUDIO');

-- CreateEnum
CREATE TYPE "TransitionType" AS ENUM ('FADE', 'DISSOLVE', 'SLIDE_LEFT', 'SLIDE_RIGHT', 'SLIDE_UP', 'SLIDE_DOWN', 'WIPE', 'CROSSFADE');

-- CreateEnum
CREATE TYPE "FilterType" AS ENUM ('BRIGHTNESS', 'CONTRAST', 'SATURATION', 'GRAYSCALE', 'SEPIA', 'BLUR', 'SHARPEN', 'VINTAGE', 'CINEMATIC', 'WARM', 'COOL', 'NEGATE', 'HUE_ROTATE');

-- CreateEnum
CREATE TYPE "TextOverlayType" AS ENUM ('TITLE', 'WATERMARK', 'SUBTITLE', 'CAPTION');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "VideoEditProject" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "videoId" TEXT,
    "userId" TEXT,
    "thumbnailUrl" TEXT,
    "duration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 1920,
    "height" INTEGER NOT NULL DEFAULT 1080,
    "fps" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoEditProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timeline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "timelineId" TEXT NOT NULL,
    "type" "TrackType" NOT NULL,
    "name" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'video',
    "startTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "endTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceIn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceOut" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "name" TEXT,
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scale" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Effect" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "type" "EffectType" NOT NULL,
    "subtype" TEXT,
    "name" TEXT,
    "startTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "endTime" DOUBLE PRECISION,
    "duration" DOUBLE PRECISION,
    "parameters" JSONB NOT NULL,
    "transitionType" "TransitionType",
    "filterType" "FilterType",
    "textType" "TextOverlayType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Effect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "outputPath" TEXT,
    "outputUrl" TEXT,
    "fileSize" BIGINT,
    "format" TEXT NOT NULL DEFAULT 'mp4',
    "videoCodec" TEXT NOT NULL DEFAULT 'h264',
    "audioCodec" TEXT NOT NULL DEFAULT 'aac',
    "width" INTEGER NOT NULL DEFAULT 1920,
    "height" INTEGER NOT NULL DEFAULT 1080,
    "bitrate" INTEGER,
    "fps" INTEGER NOT NULL DEFAULT 30,
    "quality" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoEditProject_userId_idx" ON "VideoEditProject"("userId");

-- CreateIndex
CREATE INDEX "VideoEditProject_videoId_idx" ON "VideoEditProject"("videoId");

-- CreateIndex
CREATE INDEX "VideoEditProject_createdAt_idx" ON "VideoEditProject"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Timeline_projectId_key" ON "Timeline"("projectId");

-- CreateIndex
CREATE INDEX "Track_timelineId_type_idx" ON "Track"("timelineId", "type");

-- CreateIndex
CREATE INDEX "Clip_trackId_idx" ON "Clip"("trackId");

-- CreateIndex
CREATE INDEX "Effect_clipId_type_idx" ON "Effect"("clipId", "type");

-- CreateIndex
CREATE INDEX "ExportJob_projectId_idx" ON "ExportJob"("projectId");

-- CreateIndex
CREATE INDEX "ExportJob_status_idx" ON "ExportJob"("status");

-- CreateIndex
CREATE INDEX "ExportJob_createdAt_idx" ON "ExportJob"("createdAt");

-- CreateIndex
CREATE INDEX "EditHistory_projectId_timestamp_idx" ON "EditHistory"("projectId", "timestamp");

-- AddForeignKey
ALTER TABLE "VideoEditProject" ADD CONSTRAINT "VideoEditProject_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timeline" ADD CONSTRAINT "Timeline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoEditProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "Timeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Effect" ADD CONSTRAINT "Effect_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoEditProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditHistory" ADD CONSTRAINT "EditHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoEditProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
