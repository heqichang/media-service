import { Router } from 'express';
import { StorageController } from '../controllers/storage.controller';

const router = Router();

router.get('/stats', StorageController.getStats);
router.get('/url/:type/:objectName', StorageController.getSignedUrl);
router.get('/objects', StorageController.listObjects);
router.delete('/objects/:type/:objectName', StorageController.deleteObject);

export default router;
