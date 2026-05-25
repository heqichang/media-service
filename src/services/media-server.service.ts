import NodeMediaServer from 'node-media-server';
import { spawn as spawnChild } from 'child_process';
import { config } from '../config';
import { liveStreamService } from './live-stream.service';
import { liveRoomService } from './live-room.service';
import { liveRecordService } from './live-record.service';
import { liveInteractService } from './live-interact.service';

export class MediaServerService {
  private nms: any | null = null;
  private srtProcess: any | null = null;
  private srtRestartCount = 0;
  private hlsProcesses: Map<string, any> = new Map();

  private activeStreams: Map<string, {
    liveRoomId: string;
    streamKey: string;
    sessionId: string;
    startedAt: Date;
    isPrimary: boolean;
  }> = new Map();

  async start(): Promise<void> {
    if (!config.live.rtmp.enabled && !config.live.srt.enabled) {
      console.log('[MediaServer] RTMP and SRT are both disabled');
      return;
    }

    if (config.live.rtmp.enabled) {
      this.startRtmpServer();
    }

    if (config.live.srt.enabled) {
      this.startSrtServer();
    }
  }

  private startRtmpServer(): void {
    const nmsConfig = {
      rtmp: {
        port: config.live.rtmp.port,
        chunk_size: config.live.rtmp.chunkSize,
        gop_cache: config.live.rtmp.gopCache,
        ping: Math.floor(config.live.rtmp.pingInterval / 1000),
        ping_timeout: Math.floor(config.live.rtmp.pingTimeout / 1000),
      },
      http: {
        port: config.live.flv.port,
        bind: '0.0.0.0',
        mediaroot: config.live.hls.segmentDir,
        allow_origin: '*',
        api: true,
      },
      auth: {
        api: true,
        api_user: 'admin',
        api_pass: 'admin',
        play: false,
        publish: false,
      },
    };

    this.nms = new NodeMediaServer(nmsConfig);

    this.nms.on('prePublish', (session: any) => {
      console.log('[MediaServer] === prePublish triggered ===');
      console.log('[MediaServer] Session info:', {
        id: session.id,
        streamPath: session.streamPath,
        streamName: session.streamName,
        streamApp: session.streamApp,
        ip: session.ip,
      });

      const streamKey = this.extractStreamKey(session);
      if (!streamKey) {
        console.log('[MediaServer] No stream key found, will close after postPublish');
        return;
      }

      console.log('[MediaServer] Stream key detected, starting async setup:', streamKey);

      this.handleStreamPublish(session, streamKey).catch(err => {
        console.error('[MediaServer] Async stream setup failed:', err.message);
      });
    });

    this.nms.on('postPublish', (session: any) => {
      console.log('[MediaServer] postPublish:', {
        id: session.id,
        streamPath: session.streamPath,
      });
    });

    this.nms.on('donePublish', (session: any) => {
      console.log('[MediaServer] donePublish:', {
        id: session.id,
        streamPath: session.streamPath,
      });

      const streamInfo = this.activeStreams.get(session.id);
      if (streamInfo) {
        liveStreamService.unregisterStream(streamInfo.liveRoomId, streamInfo.sessionId)
          .catch(err => console.error('[MediaServer] Error unregistering stream:', err));

        this.stopHlsProcess(streamInfo.liveRoomId);

        if (streamInfo.isPrimary) {
          liveRecordService.stopAllRecordings(streamInfo.liveRoomId)
            .catch(err => console.error('[MediaServer] Error stopping recordings:', err));

          liveRoomService.updateLiveRoomStatus(streamInfo.liveRoomId, 'ENDED')
            .catch(err => console.error('[MediaServer] Error updating room status:', err));

          liveInteractService.clearRoomUsers(streamInfo.liveRoomId)
            .catch(err => console.error('[MediaServer] Error clearing users:', err));
        }

        this.activeStreams.delete(session.id);
      }
    });

    this.nms.on('prePlay', (session: any) => {
      console.log('[MediaServer] prePlay:', {
        id: session.id,
        streamPath: session.streamPath,
        ip: session.ip,
      });
    });

    this.nms.on('postPlay', (session: any) => {
      console.log('[MediaServer] postPlay:', {
        id: session.id,
        streamPath: session.streamPath,
      });
    });

    this.nms.on('donePlay', (session: any) => {
      console.log('[MediaServer] donePlay:', {
        id: session.id,
        streamPath: session.streamPath,
      });
    });

    try {
      this.nms.run();
      const publicHost = config.server.publicHost || 'localhost';
      console.log('[MediaServer] Node-Media-Server started successfully');
      console.log('[MediaServer] RTMP server on port', config.live.rtmp.port);
      console.log('[MediaServer] HTTP/FLV server on port', config.live.flv.port);
      console.log('[MediaServer] RTMP Server URL: rtmp://' + publicHost + ':' + config.live.rtmp.port + '/live');
      console.log('[MediaServer] RTMP Stream Key: {streamKey}');
      console.log('[MediaServer] FLV Play URL: http://' + publicHost + ':' + config.server.port + '/live/{streamKey}.flv');
      console.log('[MediaServer] HLS Play URL: http://' + publicHost + ':' + config.server.port + '/hls/{streamKey}/index.m3u8');
    } catch (error: any) {
      console.error('[MediaServer] Failed to start Node-Media-Server:', error.message);
    }
  }

  private async handleStreamPublish(session: any, streamKey: string): Promise<void> {
    try {
      const authResult = await liveStreamService.authenticatePush(
        streamKey,
        session.ip || '127.0.0.1',
        'rtmp'
      );

      console.log('[MediaServer] Auth result:', {
        allowed: authResult.allowed,
        reason: authResult.reason,
        liveRoomId: authResult.liveRoomId,
      });

      if (!authResult.allowed) {
        console.log('[MediaServer] Auth failed, stream will not be registered:', authResult.reason);
        return;
      }

      const streamSession = await liveStreamService.registerStream(
        authResult.liveRoomId!,
        streamKey,
        session.ip || '127.0.0.1',
        'rtmp'
      );

      console.log('[MediaServer] Stream registered:', {
        streamId: streamSession.streamId,
        isPrimary: streamSession.isPrimary,
      });

      this.activeStreams.set(session.id, {
        liveRoomId: authResult.liveRoomId!,
        streamKey,
        sessionId: streamSession.streamId,
        startedAt: new Date(),
        isPrimary: streamSession.isPrimary,
      });

      if (streamSession.isPrimary) {
        const room = await liveRoomService.getRoom(authResult.liveRoomId!);
        if (room && room.isRecorded) {
          liveRecordService.startRecording(authResult.liveRoomId!, {
            format: (room.recordFormat || 'FLV').toLowerCase() as any,
          }).catch(err => console.error('[MediaServer] Error starting recording:', err));
        }

        const publicHost = config.server.publicHost || 'localhost';
        const baseHttpUrl = 'http://' + publicHost + ':' + config.server.port;
        liveRoomService.updatePlayUrls(authResult.liveRoomId!, {
          hls: baseHttpUrl + '/hls/' + streamKey + '/index.m3u8',
          flv: baseHttpUrl + '/live/' + streamKey + '.flv',
          rtc: null,
        }).catch(err => console.error('[MediaServer] Error updating play URLs:', err));

        liveRoomService.updateLiveRoomStatus(authResult.liveRoomId!, 'LIVING')
          .catch(err => console.error('[MediaServer] Error updating room status:', err));

        this.startHlsProcess(authResult.liveRoomId!, streamKey);
      }

      console.log('[MediaServer] Stream setup complete:', {
        liveRoomId: authResult.liveRoomId,
        streamId: streamSession.streamId,
        isPrimary: streamSession.isPrimary,
      });
    } catch (error: any) {
      console.error('[MediaServer] Stream setup error:', error.message);
    }
  }

  private startHlsProcess(liveRoomId: string, streamKey: string): void {
    if (this.hlsProcesses.has(liveRoomId)) {
      return;
    }

    const hlsDir = config.live.hls.segmentDir + '/' + streamKey;
    const fs = require('fs');
    fs.mkdirSync(hlsDir, { recursive: true });

    const args = [
      '-i', 'rtmp://127.0.0.1:' + config.live.rtmp.port + '/live/' + streamKey,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-c:a', 'aac',
      '-f', 'hls',
      '-hls_time', String(config.live.hls.time),
      '-hls_list_size', String(config.live.hls.listSize),
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_filename', hlsDir + '/segment_%03d.ts',
      hlsDir + '/index.m3u8',
    ];

    console.log('[MediaServer] Starting HLS process for room', liveRoomId);

    const proc = spawnChild(config.ffmpeg.ffmpegPath, args, {
      stdio: 'pipe',
      shell: false,
    });

    if (proc.stderr) {
      proc.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          if (line.includes('error') || line.includes('Error')) {
            console.error('[MediaServer][HLS stderr]', line);
          }
        }
      });
    }

    proc.on('error', (err: Error) => {
      console.error('[MediaServer] HLS process error:', err.message);
    });

    proc.on('exit', (code: number) => {
      console.log('[MediaServer] HLS process exited with code', code, 'for room', liveRoomId);
      this.hlsProcesses.delete(liveRoomId);
    });

    this.hlsProcesses.set(liveRoomId, proc);
  }

  private stopHlsProcess(liveRoomId: string): void {
    const proc = this.hlsProcesses.get(liveRoomId);
    if (proc) {
      console.log('[MediaServer] Stopping HLS process for room', liveRoomId);
      proc.kill('SIGTERM');
      this.hlsProcesses.delete(liveRoomId);
    }
  }

  private startSrtServer(): void {
    if (this.srtRestartCount >= 5) {
      console.error('[MediaServer] SRT relay has failed', this.srtRestartCount, 'times, giving up. Check if port', config.live.srt.port, 'is in use.');
      return;
    }

    console.log('[MediaServer] SRT server starting on port', config.live.srt.port);

    try {
      const srtCommand = [
        '-i', 'srt://0.0.0.0:' + config.live.srt.port + '?mode=listener&pkt_size=1316&maxbw=' + config.live.srt.maxBandwidth + '&latency=' + config.live.srt.latency,
        '-c', 'copy',
        '-f', 'flv',
        'rtmp://localhost:' + config.live.rtmp.port + '/live',
      ];

      console.log('[MediaServer] SRT relay command: ffmpeg', srtCommand.join(' '));

      this.srtProcess = spawnChild(config.ffmpeg.ffmpegPath, srtCommand, {
        stdio: 'pipe',
        shell: false,
      });

      if (this.srtProcess.stderr) {
        this.srtProcess.stderr.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            if (line.includes('error') || line.includes('Error') || line.includes('-10048')) {
              console.error('[MediaServer][SRT stderr]', line);
            }
          }
        });
      }

      this.srtProcess.on('spawn', () => {
        console.log('[MediaServer] SRT relay process started');
        this.srtRestartCount = 0;
      });

      this.srtProcess.on('error', (err: Error) => {
        console.error('[MediaServer] SRT relay error:', err.message);
      });

      this.srtProcess.on('exit', (code: number) => {
        console.log('[MediaServer] SRT relay exited with code', code);
        if (code !== 0) {
          this.srtRestartCount++;
          console.log('[MediaServer] SRT relay restart attempt', this.srtRestartCount, '/ 5 in 10 seconds...');
          setTimeout(() => {
            if (config.live.srt.enabled && this.srtRestartCount < 5) {
              this.startSrtServer();
            }
          }, 10000);
        }
      });
    } catch (error: any) {
      console.error('[MediaServer] Failed to start SRT relay:', error.message);
    }
  }

  private extractStreamKey(session: any): string | null {
    if (!session) {
      return null;
    }

    console.log('[MediaServer] Session data:', {
      streamPath: session.streamPath,
      streamName: session.streamName,
      streamApp: session.streamApp,
    });

    if (session.streamName) {
      return session.streamName;
    }

    if (session.streamPath) {
      const parts = session.streamPath.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return parts[parts.length - 1];
      }
    }

    return null;
  }

  getActiveStreams(): Array<{
    id: string;
    liveRoomId: string;
    sessionId: string;
    startedAt: Date;
    isPrimary: boolean;
  }> {
    return Array.from(this.activeStreams.entries()).map(([id, info]) => ({
      id,
      liveRoomId: info.liveRoomId,
      sessionId: info.sessionId,
      startedAt: info.startedAt,
      isPrimary: info.isPrimary,
    }));
  }

  getServerStats(): any {
    const publicHost = config.server.publicHost || 'localhost';
    return {
      rtmpPort: config.live.rtmp.port,
      httpPort: config.live.flv.port,
      expressPort: config.server.port,
      srtPort: config.live.srt.port,
      activeStreams: this.activeStreams.size,
      hlsEnabled: config.live.hls.enabled,
      flvEnabled: config.live.flv.enabled,
      webrtcEnabled: config.live.webrtc.enabled,
      hlsSegmentDir: config.live.hls.segmentDir,
      rtmpPushUrl: 'rtmp://' + publicHost + ':' + config.live.rtmp.port + '/live',
      rtmpStreamKey: '{streamKey}',
      srtPushUrl: 'srt://' + publicHost + ':' + config.live.srt.port + '?streamid={streamKey}&pkt_size=1316',
      hlsPlayUrl: 'http://' + publicHost + ':' + config.server.port + '/hls/{streamKey}/index.m3u8',
      flvPlayUrl: 'http://' + publicHost + ':' + config.server.port + '/live/{streamKey}.flv',
      hlsPlayUrlDirect: 'http://' + publicHost + ':' + config.live.flv.port + '/live/{streamKey}/index.m3u8',
      flvPlayUrlDirect: 'http://' + publicHost + ':' + config.live.flv.port + '/live/{streamKey}.flv',
      webrtcPlayUrl: '/webrtc/{roomId} (via WebSocket signaling)',
      nmsRunning: this.nms !== null,
      srtRunning: this.srtProcess !== null,
    };
  }

  stop(): void {
    if (this.nms) {
      try {
        this.nms.stop();
        console.log('[MediaServer] Node-Media-Server stopped');
      } catch (error: any) {
        console.error('[MediaServer] Error stopping NMS:', error.message);
      }
    }

    if (this.srtProcess) {
      try {
        this.srtProcess.kill('SIGTERM');
        console.log('[MediaServer] SRT relay stopped');
      } catch (error: any) {
        console.error('[MediaServer] Error stopping SRT relay:', error.message);
      }
    }

    this.activeStreams.clear();
  }
}

export const mediaServerService = new MediaServerService();
