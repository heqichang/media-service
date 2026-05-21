import { Router } from 'express';
import { UploadController } from '../controllers/upload.controller';
import { upload } from '../middleware/upload';

const router = Router();

router.post('/initiate', UploadController.initiateUpload);
router.post('/chunk/:uploadId', upload.single('chunk'), UploadController.uploadChunk);
router.post('/complete/:uploadId', UploadController.completeUpload);
router.get('/status/:uploadId', UploadController.getUploadStatus);
router.delete('/cancel/:uploadId', UploadController.cancelUpload);

export default router;
