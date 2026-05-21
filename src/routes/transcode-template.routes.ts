import { Router } from 'express';
import { TranscodeTemplateController } from '../controllers/transcode-template.controller';

const router = Router();

router.get('/', TranscodeTemplateController.getTemplates);
router.get('/:id', TranscodeTemplateController.getTemplate);
router.post('/', TranscodeTemplateController.createTemplate);
router.put('/:id', TranscodeTemplateController.updateTemplate);
router.delete('/:id', TranscodeTemplateController.deleteTemplate);

export default router;
