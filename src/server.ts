import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import http from 'http';

import { config } from './config';
import prisma from './config/prisma';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/upload';
import { TranscodeTemplateService } from './services/transcode-template.service';
import { setupWebSocket } from './services/websocket.service';
import { liveStreamService } from './services/live-stream.service';
import { liveTranscodeService } from './services/live-transcode.service';
import { liveRecordService } from './services/live-record.service';
import { liveInteractService } from './services/live-interact.service';
import { livePlayService } from './services/live-play.service';
import { liveRoomService } from './services/live-room.service';
import { mediaServerService } from './services/media-server.service';

const app = express();
const server = http.createServer(app);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (body !== null && typeof body === 'object') {
      const serialized = JSON.stringify(body, (key, value) => {
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return value;
      });
      return res.type('application/json').send(serialized);
    }
    return originalJson(body);
  }) as any;
  next();
});

app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(config.upload.tempDir));
app.use('/hls', express.static(config.live.hls.segmentDir));
app.use('/recordings', express.static(config.live.record.outputDir));

app.use('/api/v1', routes);

app.get('/live/*.flv', (req, res) => {
  const streamPath = req.path;
  const nmsPort = config.live.flv.port;

  console.log('[FLV Proxy] Proxying:', streamPath, '-> 127.0.0.1:' + nmsPort + streamPath);

  const options = {
    hostname: '127.0.0.1',
    port: nmsPort,
    path: streamPath,
    method: 'GET',
    headers: {
      'User-Agent': req.headers['user-agent'] || 'Node.js-Proxy',
      'Accept': '*/*',
      'Connection': 'keep-alive',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    console.log('[FLV Proxy] NMS response:', {
      statusCode: proxyRes.statusCode,
      contentType: proxyRes.headers['content-type'],
    });

    res.writeHead(proxyRes.statusCode || 500, {
      'Content-Type': proxyRes.headers['content-type'] || 'video/x-flv',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
    });

    proxyRes.on('error', (err: Error) => {
      console.error('[FLV Proxy] Proxy response error:', err.message);
      if (!res.headersSent) {
        res.status(502).end();
      }
    });

    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err: Error) => {
    console.error('[FLV Proxy] Proxy request error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to connect to media server: ' + err.message });
    }
  });

  req.on('close', () => {
    console.log('[FLV Proxy] Client disconnected, destroying proxy request');
    proxyReq.destroy();
  });

  proxyReq.end();
});

app.get('/', (req, res) => {
  const publicHost = config.server.publicHost || req.hostname || 'localhost';
  res.json({
    name: 'Media Service API',
    version: '1.0.0',
    description: '音视频处理平台 - 支持上传、转码、存储、播放、截图、直播等功能',
    endpoints: {
      upload: '/api/v1/upload',
      videos: '/api/v1/videos',
      templates: '/api/v1/transcode-templates',
      categories: '/api/v1/categories',
      tags: '/api/v1/tags',
      storage: '/api/v1/storage',
      liveRooms: '/api/v1/live-rooms',
      liveInteract: '/api/v1/live-interact',
      health: '/api/v1/health',
      socket: '/socket.io',
    },
    liveProtocols: {
      rtmp: config.live.rtmp.enabled ? 'rtmp://' + publicHost + ':' + config.live.rtmp.port + '/live' : null,
      srt: config.live.srt.enabled ? 'srt://' + publicHost + ':' + config.live.srt.port : null,
      hls: config.live.hls.enabled ? '/hls/{streamKey}/index.m3u8' : null,
      flv: config.live.flv.enabled ? '/live/{streamKey}.flv' : null,
      webrtc: config.live.webrtc.enabled ? '/webrtc/{roomId}' : null,
    },
  });
});

app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin.html')));
app.use('/player', express.static(path.join(__dirname, '..', 'public', 'player.html')));

app.get('/player/:videoId', (req, res) => {
  const playerPath = path.join(__dirname, '..', 'public', 'player.html');
  if (fs.existsSync(playerPath)) {
    res.sendFile(playerPath);
  } else {
    res.status(404).json({ error: 'Player page not found' });
  }
});

app.get('/live/:roomId', (req, res) => {
  const livePath = path.join(__dirname, '..', 'public', 'live.html');
  if (fs.existsSync(livePath)) {
    res.sendFile(livePath);
  } else {
    res.status(404).json({ error: 'Live page not found' });
  }
});

app.get('/live-player/:roomId', async (req, res) => {
  try {
    const urls = await livePlayService.getPlayUrls(req.params.roomId, req.hostname);
    res.json({
      liveRoomId: req.params.roomId,
      hlsUrl: urls.hls,
      flvUrl: urls.flv,
      webrtcUrl: urls.webrtc,
      websocketUrl: '/socket.io/live',
      apiBase: '/api/v1/live-interact',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/live/push/auth', async (req, res) => {
  try {
    const { streamKey, ip, protocol } = req.body;
    const result = await liveStreamService.authenticatePush(
      streamKey,
      ip || req.ip || '127.0.0.1',
      protocol || 'rtmp'
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/v1/live/push/start', async (req, res) => {
  try {
    const { liveRoomId, streamKey, ip, protocol, metrics } = req.body;
    const session = await liveStreamService.registerStream(
      liveRoomId,
      streamKey,
      ip || req.ip || '127.0.0.1',
      protocol || 'rtmp',
      metrics
    );

    if (session.isPrimary) {
      const room = await prisma.liveRoom.findUnique({ where: { id: liveRoomId } });
      if (room && room.isRecorded) {
        await liveRecordService.startRecording(liveRoomId, {
          format: (room.recordFormat || 'FLV').toLowerCase() as any,
        });
      }
    }

    res.json({ success: true, data: session });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/v1/live/push/stop', async (req, res) => {
  try {
    const { liveRoomId, streamId } = req.body;
    await liveStreamService.unregisterStream(liveRoomId, streamId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/v1/live/transcode/start', async (req, res) => {
  try {
    const { liveRoomId, configs, inputUrl } = req.body;
    const sessions = await liveTranscodeService.startTranscodes(
      liveRoomId,
      configs,
      inputUrl
    );
    res.json({ success: true, data: sessions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/v1/live/transcode/stop', async (req, res) => {
  try {
    const { liveRoomId, transcodeId } = req.body;
    if (transcodeId) {
      await liveTranscodeService.stopTranscode(liveRoomId, transcodeId);
    } else {
      await liveTranscodeService.stopAllTranscodes(liveRoomId);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/v1/live/record/start', async (req, res) => {
  try {
    const { liveRoomId, format, sliceDuration, autoConvertVod } = req.body;
    const session = await liveRecordService.startRecording(liveRoomId, {
      format,
      sliceDuration,
      autoConvertVod,
    });
    res.json({ success: true, data: session });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/v1/live/record/stop', async (req, res) => {
  try {
    const { liveRoomId, recordingId } = req.body;
    if (recordingId) {
      await liveRecordService.stopRecordingSegment(liveRoomId, recordingId);
    } else {
      await liveRecordService.stopAllRecordings(liveRoomId);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/v1/live/play/auth', async (req, res) => {
  try {
    const { liveRoomId, userId, protocol, token } = req.body;
    const result = await livePlayService.authorizePlay(
      liveRoomId,
      userId,
      protocol || 'hls',
      token
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/v1/live/play/urls/:liveRoomId', async (req, res) => {
  try {
    const urls = await livePlayService.getPlayUrls(req.params.liveRoomId);
    res.json({ success: true, data: urls });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/v1/live/config', (req, res) => {
  res.json({
    success: true,
    data: {
      rtmp: config.live.rtmp,
      srt: config.live.srt,
      hls: config.live.hls,
      flv: config.live.flv,
      webrtc: config.live.webrtc,
      transcode: config.live.transcode,
      record: config.live.record,
      cdn: config.live.cdn,
      interact: config.live.interact,
    },
  });
});

app.get('/api/v1/live/server-status', (req, res) => {
  res.json({
    success: true,
    data: mediaServerService.getServerStats(),
  });
});

app.get('/api/v1/live/webrtc-config', (req, res) => {
  res.json({
    success: true,
    data: {
      enabled: config.live.webrtc.enabled,
      stunServer: config.live.webrtc.stunServer,
      turnServer: config.live.webrtc.turnServer,
      turnUsername: config.live.webrtc.turnUsername,
      socketUrl: '/socket.io/live',
    },
  });
});

app.get('/api/v1/live/active-streams', (req, res) => {
  res.json({
    success: true,
    data: mediaServerService.getActiveStreams(),
  });
});

app.get('/api/v1/live/health', async (req, res) => {
  const nmsPort = config.live.flv.port;
  let nmsHttpReachable = false;

  try {
    const options = {
      hostname: '127.0.0.1',
      port: nmsPort,
      path: '/api/streams',
      method: 'GET',
      timeout: 3000,
    };

    const nmsReq = http.request(options, (nmsRes) => {
      nmsHttpReachable = nmsRes.statusCode === 200;
      let data = '';
      nmsRes.on('data', (chunk) => { data += chunk; });
      nmsRes.on('end', () => {
        res.json({
          success: true,
          data: {
            status: 'ok',
            nms: {
              running: true,
              httpReachable: nmsHttpReachable,
              httpPort: nmsPort,
              streams: data ? JSON.parse(data) : null,
            },
            activeStreams: mediaServerService.getActiveStreams().length,
            timestamp: new Date().toISOString(),
          },
        });
      });
    });

    nmsReq.on('error', () => {
      res.json({
        success: true,
        data: {
          status: 'degraded',
          nms: {
            running: false,
            httpReachable: false,
            httpPort: nmsPort,
            error: 'Cannot connect to NMS HTTP server',
          },
          activeStreams: mediaServerService.getActiveStreams().length,
          timestamp: new Date().toISOString(),
        },
      });
    });

    nmsReq.on('timeout', () => {
      nmsReq.destroy();
      res.json({
        success: true,
        data: {
          status: 'degraded',
          nms: {
            running: false,
            httpReachable: false,
            httpPort: nmsPort,
            error: 'Connection timeout',
          },
          activeStreams: mediaServerService.getActiveStreams().length,
          timestamp: new Date().toISOString(),
        },
      });
    });

    nmsReq.end();
  } catch (error: any) {
    res.json({
      success: true,
      data: {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

app.use(errorHandler);
app.use(notFoundHandler);

setupWebSocket(server);

async function startServer() {
  try {
    await prisma.$connect();
    console.log('Database connected successfully');

    await TranscodeTemplateService.initializePresets();
    console.log('Transcode templates initialized');

    if (!fs.existsSync(config.upload.tempDir)) {
      fs.mkdirSync(config.upload.tempDir, { recursive: true });
    }
    console.log('Upload directory ready');

    if (!fs.existsSync(config.live.hls.segmentDir)) {
      fs.mkdirSync(config.live.hls.segmentDir, { recursive: true });
    }
    console.log('HLS segment directory ready');

    if (!fs.existsSync(config.live.record.outputDir)) {
      fs.mkdirSync(config.live.record.outputDir, { recursive: true });
    }
    console.log('Recording output directory ready');

    await mediaServerService.start();

    server.listen(config.server.port, () => {
      console.log('Server running on http://localhost:' + config.server.port);
      console.log('Environment: ' + config.server.nodeEnv);
      console.log('API docs: http://localhost:' + config.server.port + '/');
      console.log('WebSocket: http://localhost:' + config.server.port + '/socket.io');
      console.log('Media server status: http://localhost:' + config.server.port + '/api/v1/live/server-status');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  mediaServerService.stop();
  liveTranscodeService.destroy();
  liveInteractService.destroy();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down (SIGTERM)...');
  mediaServerService.stop();
  liveTranscodeService.destroy();
  liveInteractService.destroy();
  await prisma.$disconnect();
  process.exit(0);
});

startServer();
