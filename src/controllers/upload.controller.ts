import { Request, Response } from 'express';
import { successResponse, errorResponse } from '../utils/response';
import prisma from '../config/prisma';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { VideoStatus } from '@prisma/client';

export class UploadController {
  static async initiateUpload(req: Request, res: Response) {
    try {
      const { fileName, fileSize, title, description, categoryId, tags } = req.body;

      const allowedTypes = config.upload.allowedVideoTypes;
      const ext = path.extname(fileName).toLowerCase().slice(1);

      if (fileSize > config.upload.maxFileSize) {
        return errorResponse(res, `File size exceeds maximum limit of ${config.upload.maxFileSize} bytes`, 413);
      }

      const uploadId = uuidv4();
      const uploadDir = path.join(config.upload.tempDir, uploadId);

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await prisma.uploadSession.create({
        data: {
          id: uploadId,
          fileName,
          fileSize: BigInt(fileSize),
          offset: BigInt(0),
          expiresAt,
          metadata: { title, description, categoryId, tags },
        },
      });

      const video = await prisma.video.create({
        data: {
          title: title || fileName,
          description,
          fileName,
          originalPath: `${uploadId}/${fileName}`,
          fileSize: BigInt(fileSize),
          status: VideoStatus.UPLOADING,
          uploadId,
          categoryId,
          ...(tags && tags.length > 0
            ? {
                tags: {
                  create: tags.map((tagName: string) => ({
                    tag: {
                      connectOrCreate: {
                        where: { name: tagName },
                        create: { name: tagName },
                      },
                    },
                  })),
                },
              }
            : {}),
        },
      });

      successResponse(
        res,
        {
          uploadId,
          videoId: video.id,
          chunkSize: 5 * 1024 * 1024,
          expiresAt,
        },
        'Upload initiated successfully'
      );
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async uploadChunk(req: Request, res: Response) {
    try {
      const { uploadId } = req.params;
      const { chunkIndex, totalChunks } = req.body;

      const session = await prisma.uploadSession.findUnique({
        where: { id: uploadId },
      });

      if (!session) {
        return errorResponse(res, 'Upload session not found', 404);
      }

      if (session.status !== 'active') {
        return errorResponse(res, 'Upload session is not active', 400);
      }

      if (!req.file) {
        return errorResponse(res, 'No file uploaded', 400);
      }

      const chunkDir = path.join(config.upload.tempDir, uploadId, 'chunks');
      if (!fs.existsSync(chunkDir)) {
        fs.mkdirSync(chunkDir, { recursive: true });
      }

      const chunkPath = path.join(chunkDir, `${chunkIndex}`);
      fs.renameSync(req.file.path, chunkPath);

      const chunkSize = fs.statSync(chunkPath).size;
      const newOffset = session.offset + BigInt(chunkSize);

      await prisma.uploadSession.update({
        where: { id: uploadId },
        data: { offset: newOffset },
      });

      const progress = Math.round((Number(newOffset) / Number(session.fileSize)) * 100);

      await prisma.video.updateMany({
        where: { uploadId },
        data: { uploadProgress: progress },
      });

      successResponse(
        res,
        {
          offset: newOffset.toString(),
          progress,
          isComplete: newOffset >= session.fileSize,
        },
        'Chunk uploaded successfully'
      );
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async completeUpload(req: Request, res: Response) {
    try {
      const { uploadId } = req.params;

      const session = await prisma.uploadSession.findUnique({
        where: { id: uploadId },
      });

      if (!session) {
        return errorResponse(res, 'Upload session not found', 404);
      }

      const chunkDir = path.join(config.upload.tempDir, uploadId, 'chunks');
      const outputPath = path.join(config.upload.tempDir, uploadId, session.fileName);

      const chunkFiles = fs
        .readdirSync(chunkDir)
        .map((f) => parseInt(f, 10))
        .sort((a, b) => a - b);

      const writeStream = fs.createWriteStream(outputPath);

      for (const chunkIndex of chunkFiles) {
        const chunkPath = path.join(chunkDir, chunkIndex.toString());
        const chunkData = fs.readFileSync(chunkPath);
        writeStream.write(chunkData);
        fs.unlinkSync(chunkPath);
      }

      writeStream.end();

      await new Promise<void>((resolve) => {
        writeStream.on('finish', () => resolve());
      });

      fs.rmSync(chunkDir, { recursive: true, force: true });

      const finalSize = fs.statSync(outputPath).size;

      await prisma.uploadSession.update({
        where: { id: uploadId },
        data: {
          status: 'completed',
          offset: BigInt(finalSize),
        },
      });

      const video = await prisma.video.findFirst({
        where: { uploadId },
      });

      if (video) {
        await prisma.video.update({
          where: { id: video.id },
          data: {
            status: VideoStatus.UPLOADED,
            uploadProgress: 100,
            fileSize: BigInt(finalSize),
          },
        });
      }

      successResponse(
        res,
        {
          videoId: video?.id,
          filePath: outputPath,
          fileSize: finalSize,
        },
        'Upload completed successfully'
      );
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getUploadStatus(req: Request, res: Response) {
    try {
      const { uploadId } = req.params;

      const session = await prisma.uploadSession.findUnique({
        where: { id: uploadId },
      });

      if (!session) {
        return errorResponse(res, 'Upload session not found', 404);
      }

      const progress = Math.round((Number(session.offset) / Number(session.fileSize)) * 100);

      successResponse(res, {
        uploadId: session.id,
        status: session.status,
        fileName: session.fileName,
        fileSize: session.fileSize.toString(),
        uploaded: session.offset.toString(),
        progress,
        expiresAt: session.expiresAt,
      });
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async cancelUpload(req: Request, res: Response) {
    try {
      const { uploadId } = req.params;

      const session = await prisma.uploadSession.findUnique({
        where: { id: uploadId },
      });

      if (!session) {
        return errorResponse(res, 'Upload session not found', 404);
      }

      await prisma.uploadSession.update({
        where: { id: uploadId },
        data: { status: 'cancelled' },
      });

      await prisma.video.updateMany({
        where: { uploadId },
        data: { status: VideoStatus.FAILED },
      });

      const uploadDir = path.join(config.upload.tempDir, uploadId);
      if (fs.existsSync(uploadDir)) {
        fs.rmSync(uploadDir, { recursive: true, force: true });
      }

      successResponse(res, null, 'Upload cancelled successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async simpleUpload(req: Request, res: Response) {
    try {
      if (!req.file) {
        return errorResponse(res, 'No file uploaded', 400);
      }

      const uploadId = uuidv4();
      const uploadDir = path.join(config.upload.tempDir, uploadId);
      
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const originalName = req.file.originalname;
      const ext = path.extname(originalName);
      const safeName = uuidv4() + ext;
      const finalPath = path.join(uploadDir, safeName);
      
      fs.renameSync(req.file.path, finalPath);

      const fileSize = fs.statSync(finalPath).size;

      const video = await prisma.video.create({
        data: {
          title: originalName,
          fileName: safeName,
          originalPath: `${uploadId}/${safeName}`,
          fileSize: BigInt(fileSize),
          status: VideoStatus.UPLOADED,
          uploadId,
          uploadProgress: 100,
        },
      });

      successResponse(
        res,
        {
          id: video.id,
          uploadId,
          videoId: video.id,
          filePath: finalPath,
          fileName: safeName,
          fileSize,
          originalName,
          thumbnailUrl: null,
          name: originalName,
          type: 'video',
        },
        'File uploaded successfully'
      );
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }
}
