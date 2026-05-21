# Media Service - 音视频处理平台

一个功能完整的音视频处理平台，支持视频上传、转码、存储、播放、截图等功能。

## 功能特性

### 📤 视频上传
- ✅ 大文件分片上传（支持断点续传）
- ✅ 实时上传进度显示
- ✅ 上传前格式校验（文件类型、大小限制）
- ✅ 并发上传控制
- ✅ 上传完成通知

### 🔄 视频转码
- ✅ 转码模板管理（分辨率、码率、帧率、编码格式）
- ✅ 预设模板（360P / 720P / 1080P / 4K）
- ✅ 自定义转码模板
- ✅ 编码格式：H.264 / H.265 / AV1
- ✅ 音频编码：AAC / MP3 / Opus
- ✅ 自适应码率转码（ABR，生成多码率流）
- ✅ 转码队列管理
- ✅ 转码进度查询
- ✅ 转码失败自动重试

### 💾 视频存储
- ✅ 对象存储集成（MinIO / AWS S3 兼容）
- ✅ 视频文件管理（列表、删除、元信息）
- ✅ 存储空间统计
- ✅ 生命周期管理（支持过期视频自动归档/删除）

### 🎬 视频播放
- ✅ Web 播放器（Video.js）
- ✅ HLS / DASH / MP4 播放支持
- ✅ 自适应码率播放（根据网络自动切换清晰度）
- ✅ 播放控制（播放/暂停/快进/音量/倍速）
- ✅ 缩略图预览（进度条悬停预览）
- ✅ 字幕加载（SRT / VTT）支持

### 🖼 缩略图与截图
- ✅ 自动生成视频缩略图
- ✅ 指定时间点截图
- ✅ 批量截图（每隔 N 秒截一张）
- ✅ 截图格式（JPG / PNG / WebP）
- ✅ 雪碧图生成（多截图拼合为一张图）

### 📋 视频管理
- ✅ 视频列表（分页、搜索）
- ✅ 视频元信息（时长、分辨率、码率、格式、大小）
- ✅ 视频分类与标签
- ✅ 视频状态管理（上传中/转码中/已发布/已下架）

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端框架 | Node.js + Express + TypeScript |
| 数据库 | PostgreSQL + Prisma ORM |
| 任务队列 | Bull + Redis |
| 转码引擎 | FFmpeg |
| 对象存储 | MinIO (AWS S3 兼容) |
| 分片上传 | 自研分片上传 |
| 播放器 | Video.js + hls.js + dash.js |
| 容器化 | Docker + Docker Compose |

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f app

# 停止服务
docker-compose down
```

### 方式二：本地开发

#### 前置要求
- Node.js >= 18.x
- PostgreSQL >= 13.x
- Redis >= 6.x
- MinIO
- FFmpeg >= 4.x

#### 安装依赖

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 修改 .env 文件中的配置

# 初始化数据库
npx prisma generate
npx prisma migrate dev

# 启动开发服务器
npm run dev

# 启动转码 worker（另开终端）
npm run worker
```

## API 文档

### 上传接口

#### 1. 初始化上传
```http
POST /api/v1/upload/initiate
Content-Type: application/json

{
  "fileName": "video.mp4",
  "fileSize": 1073741824,
  "title": "我的视频",
  "description": "视频描述",
  "categoryId": "uuid",
  "tags": ["教育", "技术"]
}
```

#### 2. 上传分片
```http
POST /api/v1/upload/chunk/:uploadId
Content-Type: multipart/form-data

chunk: <二进制文件>
chunkIndex: 0
totalChunks: 200
```

#### 3. 完成上传
```http
POST /api/v1/upload/complete/:uploadId
```

#### 4. 查询上传状态
```http
GET /api/v1/upload/status/:uploadId
```

#### 5. 取消上传
```http
DELETE /api/v1/upload/cancel/:uploadId
```

### 视频接口

#### 获取视频列表
```http
GET /api/v1/videos?page=1&pageSize=20&search=关键词&categoryId=xxx&status=PUBLISHED
```

#### 获取视频详情
```http
GET /api/v1/videos/:id
```

#### 更新视频信息
```http
PUT /api/v1/videos/:id
Content-Type: application/json

{
  "title": "新标题",
  "description": "新描述",
  "categoryId": "uuid",
  "tags": ["新标签"],
  "isPublic": true
}
```

#### 删除视频
```http
DELETE /api/v1/videos/:id
```

#### 发布视频
```http
POST /api/v1/videos/:id/publish
```

#### 提取元信息
```http
POST /api/v1/videos/:id/metadata
```

### 转码接口

#### 开始转码
```http
POST /api/v1/videos/:id/transcode
Content-Type: application/json

{
  "templateId": "uuid",
  "templateIds": ["uuid1", "uuid2"],
  "isABR": false
}
```

#### 查询转码状态
```http
GET /api/v1/videos/:id/transcode/status
```

### 截图接口

#### 生成截图
```http
POST /api/v1/videos/:id/thumbnails
Content-Type: application/json

{
  "timePoint": 10.5,
  "count": 10,
  "interval": 5,
  "width": 320,
  "format": "jpg",
  "sprite": false
}
```

#### 获取截图列表
```http
GET /api/v1/videos/:id/thumbnails
```

### 转码模板接口

#### 获取所有模板
```http
GET /api/v1/transcode-templates
```

#### 创建自定义模板
```http
POST /api/v1/transcode-templates
Content-Type: application/json

{
  "name": "自定义模板",
  "description": "我的自定义转码模板",
  "width": 1920,
  "height": 1080,
  "videoBitrate": 5000000,
  "videoCodec": "H264",
  "audioBitrate": 192000,
  "audioCodec": "AAC",
  "framerate": 30,
  "crf": 23,
  "outputFormat": "mp4"
}
```

### 分类与标签接口

```http
GET    /api/v1/categories
POST   /api/v1/categories
PUT    /api/v1/categories/:id
DELETE /api/v1/categories/:id

GET    /api/v1/tags
POST   /api/v1/tags
DELETE /api/v1/tags/:id
```

### 存储接口

```http
GET /api/v1/storage/stats
GET /api/v1/storage/url/:type/:objectName
GET /api/v1/storage/objects
```

## 预设转码模板

| 模板名称 | 分辨率 | 视频码率 | 音频码率 | 编码 |
|---------|--------|---------|---------|------|
| 360P (低画质) | 640x360 | 800 kbps | 96 kbps | H.264 |
| 720P (标准画质) | 1280x720 | 2.5 Mbps | 128 kbps | H.264 |
| 1080P (高清) | 1920x1080 | 5 Mbps | 192 kbps | H.264 |
| 4K (超高清) | 3840x2160 | 20 Mbps | 256 kbps | H.265 |
| HLS 自适应码率 | - | 多码率 | 多码率 | H.264 |

## 视频播放器

访问 `http://localhost:3000/player/:videoId` 查看视频播放器。

## 管理界面

- MinIO 控制台: http://localhost:9001 (minioadmin / minioadmin)
- Prisma Studio: `npm run prisma:studio`

## 项目结构

```
media-service/
├── src/
│   ├── config/              # 配置文件
│   ├── controllers/         # 控制器
│   ├── middleware/          # 中间件
│   ├── queues/              # 任务队列
│   ├── routes/              # 路由定义
│   ├── services/            # 业务服务
│   ├── types/               # TypeScript 类型
│   ├── utils/               # 工具函数
│   └── server.ts            # 服务入口
├── prisma/                  # 数据库模型
│   └── schema.prisma
├── public/                  # 静态文件
│   └── player.html          # 播放器页面
├── uploads/                 # 上传临时目录
├── docker-compose.yml       # Docker 编排
├── Dockerfile               # Docker 镜像
└── package.json
```

## 开发指南

### 添加新的转码模板

```typescript
// 在 src/services/transcode-template.service.ts 中添加预设模板
const PRESET_TEMPLATES = [
  // ... 现有模板
  {
    name: '自定义模板',
    description: '描述',
    width: 1280,
    height: 720,
    videoBitrate: 3000000,
    videoCodec: VideoCodec.H264,
    audioBitrate: 128000,
    audioCodec: AudioCodec.AAC,
    framerate: 30,
    outputFormat: 'mp4',
    isPreset: true,
  },
];
```

### 配置生命周期管理

在数据库中设置视频的 `expiresAt` 字段，系统将自动处理过期视频。

## 性能优化建议

1. **转码并发**: 根据服务器 CPU 核心数调整 `TRANSCODE_CONCURRENCY`
2. **分片大小**: 默认 5MB，可根据网络环境调整
3. **CDN 加速**: 生产环境建议配置 CDN 加速视频分发
4. **缓存策略**: 合理配置 MinIO 缓存和 CDN 缓存

## 常见问题

### Q: FFmpeg 找不到？
A: 确保已安装 FFmpeg 并在系统 PATH 中，或在 .env 中配置 `FFMPEG_PATH` 和 `FFPROBE_PATH`。

### Q: 上传大文件失败？
A: 检查 `MAX_FILE_SIZE` 配置，以及反向代理（如 Nginx）的上传大小限制。

### Q: 转码速度慢？
A: 转码速度取决于 CPU 性能，可以考虑使用 GPU 加速或分布式转码。

## License

MIT
