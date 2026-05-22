import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';

import { config } from './config';
import prisma from './config/prisma';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/upload';
import { TranscodeTemplateService } from './services/transcode-template.service';

const app = express();

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

app.use('/api/v1', routes);

app.get('/', (req, res) => {
  res.json({
    name: 'Media Service API',
    version: '1.0.0',
    description: '音视频处理平台 - 支持上传、转码、存储、播放、截图等功能',
    endpoints: {
      upload: '/api/v1/upload',
      videos: '/api/v1/videos',
      templates: '/api/v1/transcode-templates',
      categories: '/api/v1/categories',
      tags: '/api/v1/tags',
      storage: '/api/v1/storage',
      health: '/api/v1/health',
    },
  });
});

app.use('/player', express.static(path.join(__dirname, '..', 'public', 'player.html')));

app.get('/player/:videoId', (req, res) => {
  const playerPath = path.join(__dirname, '..', 'public', 'player.html');
  if (fs.existsSync(playerPath)) {
    res.sendFile(playerPath);
  } else {
    res.status(404).json({ error: 'Player page not found' });
  }
});

app.use(errorHandler);
app.use(notFoundHandler);

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

    app.listen(config.server.port, () => {
      console.log(`Server running on http://localhost:${config.server.port}`);
      console.log(`Environment: ${config.server.nodeEnv}`);
      console.log(`API docs: http://localhost:${config.server.port}/`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

startServer();
