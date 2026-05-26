import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { UploadController } from '../controllers/upload.controller';
import { upload } from '../middleware/upload';

const router = Router();

const simpleStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(config.upload.tempDir, 'simple');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    let originalName = file.originalname;
    try {
      if (/[^\x00-\x7F]/.test(originalName)) {
        originalName = Buffer.from(originalName, 'latin1').toString('utf8');
      }
    } catch (e) {}
    const ext = path.extname(originalName);
    const safeName = uuidv4() + ext;
    file.originalname = originalName;
    cb(null, safeName);
  },
});

const simpleUpload = multer({
  storage: simpleStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
});

router.post('/initiate', UploadController.initiateUpload);
router.post('/chunk/:uploadId', upload.single('chunk'), UploadController.uploadChunk);
router.post('/complete/:uploadId', UploadController.completeUpload);
router.get('/status/:uploadId', UploadController.getUploadStatus);
router.delete('/cancel/:uploadId', UploadController.cancelUpload);
router.post('/simple', simpleUpload.single('file'), UploadController.simpleUpload);
router.post('/video', simpleUpload.single('file'), UploadController.simpleUpload);

export default router;
