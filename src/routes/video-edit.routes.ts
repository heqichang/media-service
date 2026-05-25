import { Router } from 'express';
import { VideoEditController } from '../controllers/video-edit.controller';

const router = Router();

router.post('/', VideoEditController.createProject);
router.get('/', VideoEditController.getProjects);
router.get('/effect-types', VideoEditController.getEffectTypes);
router.post('/analyze-video', VideoEditController.analyzeVideo);

router.get('/:id', VideoEditController.getProject);
router.put('/:id', VideoEditController.updateProject);
router.delete('/:id', VideoEditController.deleteProject);
router.post('/:id/duplicate', VideoEditController.duplicateProject);

router.get('/:projectId/timeline', VideoEditController.getTimeline);
router.get('/:projectId/undo-redo-status', VideoEditController.getUndoRedoStatus);
router.post('/:projectId/undo', VideoEditController.undo);
router.post('/:projectId/redo', VideoEditController.redo);
router.get('/:projectId/preview', VideoEditController.getPreviewFrame);

router.post('/:projectId/tracks', VideoEditController.addTrack);
router.put('/:projectId/tracks/:trackId', VideoEditController.updateTrack);
router.delete('/:projectId/tracks/:trackId', VideoEditController.deleteTrack);

router.post('/:projectId/tracks/:trackId/clips', VideoEditController.addClip);
router.post('/:projectId/tracks/:trackId/clips/add-video', VideoEditController.addVideoAsClip);
router.put('/:projectId/clips/:clipId', VideoEditController.updateClip);
router.delete('/:projectId/clips/:clipId', VideoEditController.deleteClip);
router.post('/:projectId/clips/:clipId/move', VideoEditController.moveClip);
router.post('/:projectId/clips/:clipId/split', VideoEditController.splitClip);
router.post('/:projectId/clips/merge', VideoEditController.mergeClips);
router.post('/:projectId/clips/:clipId/trim', VideoEditController.trimClip);
router.post('/:projectId/clips/:clipId/cut', VideoEditController.cutClip);

router.post('/:projectId/clips/:clipId/effects', VideoEditController.addEffect);
router.put('/:projectId/effects/:effectId', VideoEditController.updateEffect);
router.delete('/:projectId/effects/:effectId', VideoEditController.deleteEffect);

router.post('/:projectId/clips/:clipId/transitions', VideoEditController.addTransition);
router.post('/:projectId/clips/:clipId/filters', VideoEditController.addFilter);
router.post('/:projectId/clips/:clipId/text', VideoEditController.addTextOverlay);
router.post('/:projectId/clips/:clipId/pip', VideoEditController.addPip);
router.post('/:projectId/clips/:clipId/speed', VideoEditController.addSpeedEffect);
router.post('/:projectId/clips/:clipId/audio', VideoEditController.addAudioEffect);

router.post('/:projectId/exports', VideoEditController.startExport);
router.get('/:projectId/exports', VideoEditController.getProjectExports);
router.get('/exports/:exportJobId', VideoEditController.getExportStatus);
router.post('/exports/:exportJobId/cancel', VideoEditController.cancelExport);

export default router;
