import { Router } from 'express';
import { LiveRoomController } from '../controllers/live-room.controller';

const router = Router();

router.post('/', LiveRoomController.createRoom);
router.get('/', LiveRoomController.getRooms);
router.get('/active', LiveRoomController.getAllActiveRooms);
router.get('/:id', LiveRoomController.getRoom);
router.put('/:id', LiveRoomController.updateRoom);
router.delete('/:id', LiveRoomController.deleteRoom);
router.post('/:id/ban', LiveRoomController.banRoom);
router.post('/:id/unban', LiveRoomController.unbanRoom);
router.post('/:id/reset-key', LiveRoomController.resetStreamKey);
router.get('/:id/stats', LiveRoomController.getRoomStats);
router.get('/:id/stream-config', LiveRoomController.getStreamConfig);
router.get('/:id/streams', LiveRoomController.getActiveStreams);
router.get('/:id/streams/history', LiveRoomController.getStreamHistory);
router.get('/:id/streams/stats', LiveRoomController.getStreamStats);
router.get('/:id/transcodes', LiveRoomController.getTranscodeStatus);
router.get('/:id/transcodes/stats', LiveRoomController.getTranscodeStats);
router.post('/:id/transcodes/start', LiveRoomController.startTranscode);
router.post('/:id/transcodes/:transcodeId/stop', LiveRoomController.stopTranscode);
router.get('/:id/recordings', LiveRoomController.getRecordings);
router.get('/:id/recordings/stats', LiveRoomController.getRecordingStats);
router.post('/:id/recordings/start', LiveRoomController.startRecording);
router.post('/:id/recordings/:recordingId/stop', LiveRoomController.stopRecording);
router.post('/:id/recordings/:recordingId/convert-vod', LiveRoomController.convertRecordingToVod);
router.delete('/:id/recordings/:recordingId', LiveRoomController.deleteRecording);
router.get('/:id/play-urls', LiveRoomController.getPlayUrls);
router.get('/:id/play-stats', LiveRoomController.getPlayStats);
router.post('/plans', LiveRoomController.createPlan);
router.get('/:liveRoomId/plans', LiveRoomController.getPlans);
router.delete('/plans/:id', LiveRoomController.deletePlan);

router.post('/:id/verify-password', LiveRoomController.verifyViewPassword);

export default router;
