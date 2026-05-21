import { Router } from 'express';
import { VideoController } from '../controllers/video.controller';

const router = Router();

router.get('/', VideoController.getVideos);
router.get('/:id', VideoController.getVideo);
router.put('/:id', VideoController.updateVideo);
router.delete('/:id', VideoController.deleteVideo);
router.post('/:id/publish', VideoController.publishVideo);
router.post('/:id/metadata', VideoController.extractMetadata);
router.post('/:id/transcode', VideoController.startTranscode);
router.get('/:id/transcode/status', VideoController.getTranscodeStatus);
router.post('/:id/thumbnails', VideoController.generateThumbnails);
router.get('/:id/thumbnails', VideoController.getThumbnailStatus);

export default router;
