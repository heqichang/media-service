import { Server as SocketIOServer } from 'socket.io';
import type { Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { liveInteractService } from './live-interact.service';
import { liveStreamService } from './live-stream.service';
import { liveTranscodeService } from './live-transcode.service';
import { liveRecordService } from './live-record.service';
import { liveRoomService } from './live-room.service';

export function setupWebSocket(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  const liveNamespace = io.of('/live');

  liveNamespace.on('connection', (socket: Socket) => {
    console.log('Client connected to live namespace:', socket.id);

    socket.on('join-room', async (data: { liveRoomId: string; userId: string; userName: string; protocol?: string }) => {
      const { liveRoomId, userId, userName, protocol = 'hls' } = data;

      socket.join(`room:${liveRoomId}`);
      socket.data.liveRoomId = liveRoomId;
      socket.data.userId = userId;
      socket.data.userName = userName;

      liveInteractService.userJoin(liveRoomId, userId, userName, protocol);

      const onlineCount = liveInteractService.getOnlineCount(liveRoomId);
      liveRoomService.updatePeakViewers(liveRoomId, onlineCount);

      liveNamespace.to(`room:${liveRoomId}`).emit('user-joined', {
        userId,
        userName,
        onlineCount,
      });

      const cachedDanmakus = liveInteractService.getCachedDanmakus(liveRoomId);
      socket.emit('danmaku-history', cachedDanmakus);

      socket.emit('online-count', { count: onlineCount });
    });

    socket.on('leave-room', async (data: { liveRoomId: string; userId: string }) => {
      const { liveRoomId, userId } = data;

      socket.leave(`room:${liveRoomId}`);

      liveInteractService.userLeave(liveRoomId, userId);

      const onlineCount = liveInteractService.getOnlineCount(liveRoomId);

      liveNamespace.to(`room:${liveRoomId}`).emit('user-left', {
        userId,
        onlineCount,
      });
    });

    socket.on('send-danmaku', async (data: {
      liveRoomId: string;
      userId: string;
      userName: string;
      content: string;
      color?: string;
      fontSize?: number;
      mode?: number;
    }) => {
      const result = await liveInteractService.sendDanmaku(
        data.liveRoomId,
        data.userId,
        data.userName,
        data.content,
        data.color,
        data.fontSize,
        data.mode
      );

      if (result) {
        liveNamespace.to(`room:${data.liveRoomId}`).emit('danmaku', result);
      }
    });

    socket.on('send-gift', async (data: {
      liveRoomId: string;
      giftId: string;
      userId: string;
      userName: string;
      quantity?: number;
    }) => {
      const result = await liveInteractService.sendGift(
        data.liveRoomId,
        data.giftId,
        data.userId,
        data.userName,
        data.quantity || 1
      );

      if (result) {
        liveNamespace.to(`room:${data.liveRoomId}`).emit('gift', result);
      }
    });

    socket.on('send-like', async (data: {
      liveRoomId: string;
      userId: string;
      count?: number;
    }) => {
      const result = await liveInteractService.sendLike(
        data.liveRoomId,
        data.userId,
        data.count || 1
      );

      liveNamespace.to(`room:${data.liveRoomId}`).emit('like', result);
    });

    socket.on('webrtc-signal', async (data: {
      type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave';
      liveRoomId: string;
      userId: string;
      targetUserId?: string;
      data: any;
    }) => {
      if (data.targetUserId) {
        const targetSockets = await liveNamespace
          .in(`room:${data.liveRoomId}`)
          .fetchSockets();

        const targetSocket = targetSockets.find(
          (s) => s.data.userId === data.targetUserId
        );

        if (targetSocket) {
          targetSocket.emit('webrtc-signal', data);
        }
      } else {
        liveNamespace.to(`room:${data.liveRoomId}`).emit('webrtc-signal', data);
      }
    });

    socket.on('disconnect', () => {
      const { liveRoomId, userId } = socket.data;

      if (liveRoomId && userId) {
        liveInteractService.userLeave(liveRoomId, userId);

        const onlineCount = liveInteractService.getOnlineCount(liveRoomId);

        liveNamespace.to(`room:${liveRoomId}`).emit('user-left', {
          userId,
          onlineCount,
        });
      }

      console.log('Client disconnected from live namespace:', socket.id);
    });
  });

  const adminNamespace = io.of('/admin');

  adminNamespace.on('connection', (socket: Socket) => {
    console.log('Admin connected:', socket.id);

    socket.on('subscribe-stream', (data: { liveRoomId: string }) => {
      socket.join(`admin:stream:${data.liveRoomId}`);
    });

    socket.on('unsubscribe-stream', (data: { liveRoomId: string }) => {
      socket.leave(`admin:stream:${data.liveRoomId}`);
    });
  });

  liveStreamService.on('stream:start', (session) => {
    adminNamespace.emit('stream:start', session);
    adminNamespace.to(`admin:stream:${session.liveRoomId}`).emit('stream:status', {
      liveRoomId: session.liveRoomId,
      status: 'pushing',
      session,
    });
  });

  liveStreamService.on('stream:end', (session) => {
    adminNamespace.emit('stream:end', session);
    adminNamespace.to(`admin:stream:${session.liveRoomId}`).emit('stream:status', {
      liveRoomId: session.liveRoomId,
      status: 'stopped',
      session,
    });
  });

  liveStreamService.on('stream:interrupt', (data) => {
    adminNamespace.to(`admin:stream:${data.liveRoomId}`).emit('stream:interrupt', data);
  });

  liveTranscodeService.on('transcode:start', (session) => {
    adminNamespace.to(`admin:stream:${session.liveRoomId}`).emit('transcode:start', session);
  });

  liveTranscodeService.on('transcode:stop', (data) => {
    adminNamespace.to(`admin:stream:${data.liveRoomId}`).emit('transcode:stop', data);
  });

  liveTranscodeService.on('transcode:high-latency', (data) => {
    adminNamespace.to(`admin:stream:${data.liveRoomId}`).emit('transcode:high-latency', data);
  });

  liveTranscodeService.on('transcode:backup-switch', (data) => {
    adminNamespace.to(`admin:stream:${data.liveRoomId}`).emit('transcode:backup-switch', data);
  });

  liveRecordService.on('record:start', (session) => {
    adminNamespace.to(`admin:stream:${session.liveRoomId}`).emit('record:start', session);
  });

  liveRecordService.on('record:stop', (data) => {
    adminNamespace.to(`admin:stream:${data.liveRoomId}`).emit('record:stop', data);
  });

  liveInteractService.on('danmaku:new', (message) => {
    adminNamespace.to(`admin:stream:${message.liveRoomId}`).emit('danmaku:new', message);
  });

  liveInteractService.on('gift:new', (message) => {
    adminNamespace.to(`admin:stream:${message.liveRoomId}`).emit('gift:new', message);
  });

  liveInteractService.on('like:new', (message) => {
    adminNamespace.to(`admin:stream:${message.liveRoomId}`).emit('like:new', message);
  });

  liveInteractService.on('online:update', (message) => {
    liveNamespace.to(`room:${message.liveRoomId}`).emit('online-update', message);
    adminNamespace.to(`admin:stream:${message.liveRoomId}`).emit('online-update', message);
  });

  return io;
}
