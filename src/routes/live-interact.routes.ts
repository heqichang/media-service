import { Router } from 'express';
import { LiveInteractController } from '../controllers/live-interact.controller';

const router = Router();

router.post('/:liveRoomId/danmaku', LiveInteractController.sendDanmaku);
router.get('/:liveRoomId/danmaku', LiveInteractController.getDanmakus);
router.put('/danmaku/:id/hide', LiveInteractController.hideDanmaku);
router.put('/danmaku/:id/ban', LiveInteractController.banDanmaku);
router.get('/:liveRoomId/danmaku/stats', LiveInteractController.getDanmakuStats);

router.get('/gifts', LiveInteractController.getGifts);
router.post('/gifts', LiveInteractController.createGift);
router.put('/gifts/:id', LiveInteractController.updateGift);
router.post('/:liveRoomId/gift', LiveInteractController.sendGift);
router.get('/:liveRoomId/gift/history', LiveInteractController.getGiftHistory);
router.get('/:liveRoomId/gift/stats', LiveInteractController.getGiftStats);

router.post('/:liveRoomId/like', LiveInteractController.sendLike);
router.get('/:liveRoomId/like/count', LiveInteractController.getLikeCount);

router.get('/:liveRoomId/online', LiveInteractController.getOnlineUsers);

export default router;
