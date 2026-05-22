import { Router } from 'express';
import uploadRoutes from './upload.routes';
import videoRoutes from './video.routes';
import transcodeTemplateRoutes from './transcode-template.routes';
import categoryRoutes from './category.routes';
import storageRoutes from './storage.routes';
import liveRoomRoutes from './live-room.routes';
import liveInteractRoutes from './live-interact.routes';

const router = Router();

router.use('/upload', uploadRoutes);
router.use('/videos', videoRoutes);
router.use('/transcode-templates', transcodeTemplateRoutes);
router.use('/', categoryRoutes);
router.use('/storage', storageRoutes);
router.use('/live-rooms', liveRoomRoutes);
router.use('/live-interact', liveInteractRoutes);

router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

export default router;
