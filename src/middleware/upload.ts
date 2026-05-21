import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { config } from '../config';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

if (!fs.existsSync(config.upload.tempDir)) {
  fs.mkdirSync(config.upload.tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadId = req.params.uploadId || uuidv4();
    const chunkDir = path.join(config.upload.tempDir, uploadId, 'chunks');
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }
    cb(null, chunkDir);
  },
  filename: (req, file, cb) => {
    const chunkIndex = req.body.chunkIndex || uuidv4();
    cb(null, chunkIndex);
  },
});

export const upload = multer({
  storage,
  limits: {
  fileSize: 10 * 1024 * 1024,
},
  fileFilter: (req, file, cb) => {
    const allowedTypes = config.upload.allowedVideoTypes;
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, true);
    }
  },
});

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err);

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: 'File too large',
    });
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: `Multer error: ${err.message}`,
    });
  }

  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
}
