import NodeMediaServer from 'node-media-server';
import { config } from '../config';
import { liveStreamService } from './live-stream.service';
import { liveRoomService } from './live-room.service';
import { liveRecordService } from './live-record.service';
import { liveInteractService } from './live-interact.service';

export class MediaServerService {
  private nms: any | null = null;
  private srtProcess: any | null = null;

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
      trans: {
        ffmpeg: config.ffmpeg.ffmpegPath,
        tasks: [
          {
            app: 'live',
            ac: 'aac',
            vc: 'libx264',
            hls: true,
            hlsFlags: '[hls_time=' + config.live.hls.time + ':hls_list_size=' + config.live.hls.listSize + ':hls_flags=delete_segments]',
            hlsKeep: false,
          },
        ],
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

    this.nms.on('prePublish', async (session: any) => {
      console.log('[MediaServer] === prePublish triggered ===');
      console.log('[MediaServer] Session info:', {
        id: session.id,
        streamPath: session.streamPath,
        streamName: session.streamName,
        streamApp: session.streamApp,
        ip: session.ip,
        connectTime: session.connectTime,
      });

      const streamKey = this.extractStreamKey(session);
      if (!streamKey) {
        console.log('[MediaServer] No stream key found, rejecting connection');
        session.close();
        return;
      }

      console.log('[MediaServer] Authenticating stream key:', streamKey);

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
          console.log('[MediaServer] Auth failed:', authResult.reason);
          session.close();
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

        console.log('[MediaServer] Stream authenticated:', {
          liveRoomId: authResult.liveRoomId,
          streamId: streamSession.streamId,
          isPrimary: streamSession.isPrimary,
        });

        if (streamSession.isPrimary) {
          const room = await liveRoomService.getRoom(authResult.liveRoomId!);
          if (room && room.isRecorded) {
            await liveRecordService.startRecording(authResult.liveRoomId!, {
              format: (room.recordFormat || 'FLV').toLowerCase() as any,
            }).catch(err => console.error('[MediaServer] Error starting recording:', err));
          }

          const publicHost = config.server.publicHost || 'localhost';
          const baseHttpUrl = 'http://' + publicHost + ':' + config.server.port;
          await liveRoomService.updatePlayUrls(authResult.liveRoomId!, {
            hls: baseHttpUrl + '/hls/' + streamKey + '/index.m3u8',
            flv: baseHttpUrl + '/live/' + streamKey + '.flv',
            rtc: null,
          }).catch(err => console.error('[MediaServer] Error updating play URLs:', err));

          await liveRoomService.updateLiveRoomStatus(authResult.liveRoomId!, 'LIVING')
            .catch(err => console.error('[MediaServer] Error updating room status:', err));
        }
      } catch (error: any) {
        console.error('[MediaServer] Auth error:', error.message);
        session.close();
      }
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
      console.log('[MediaServer] HTTP/FLV/HLS server on port', config.live.flv.port);
      console.log('[MediaServer] RTMP Push URL: rtmp://' + publicHost + ':' + config.live.rtmp.port + '/live/{streamKey}');
      console.log('[MediaServer] HLS Play URL (via Express): http://' + publicHost + ':' + config.server.port + '/hls/{streamKey}/index.m3u8');
      console.log('[MediaServer] FLV Play URL (via Express): http://' + publicHost + ':' + config.server.port + '/live/{streamKey}.flv');
      console.log('[MediaServer] HLS Play URL (direct NMS): http://' + publicHost + ':' + config.live.flv.port + '/live/{streamKey}/index.m3u8');
      console.log('[MediaServer] FLV Play URL (direct NMS): http://' + publicHost + ':' + config.live.flv.port + '/live/{streamKey}.flv');
    } catch (error: any) {
      console.error('[MediaServer] Failed to start Node-Media-Server:', error.message);
    }
  }

  private startSrtServer(): void {
    console.log('[MediaServer] SRT server starting on port', config.live.srt.port);

    try {
      const { spawn } = require('child_process');

      const srtCommand = [
        '-i', 'srt://0.0.0.0:' + config.live.srt.port + '?mode=listener&pkt_size=1316&maxbw=' + config.live.srt.maxBandwidth + '&latency=' + config.live.srt.latency,
        '-c', 'copy',
        '-f', 'flv',
        'rtmp://localhost:' + config.live.rtmp.port + '/live',
      ];

      console.log('[MediaServer] SRT relay command: ffmpeg', srtCommand.join(' '));

      this.srtProcess = spawn(config.ffmpeg.ffmpegPath, srtCommand, {
        stdio: 'pipe',
        shell: false,
      });

      if (this.srtProcess.stdout) {
        this.srtProcess.stdout.on('data', (data: Buffer) => {
          console.log('[MediaServer][SRT stdout]', data.toString());
        });
      }

      if (this.srtProcess.stderr) {
        this.srtProcess.stderr.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            if (line.includes('error') || line.includes('Error')) {
              console.error('[MediaServer][SRT stderr]', line);
            } else {
              console.log('[MediaServer][SRT stderr]', line);
            }
          }
        });
      }

      this.srtProcess.on('spawn', () => {
        console.log('[MediaServer] SRT relay process started, forwarding to RTMP');
      });

      this.srtProcess.on('error', (err: Error) => {
        console.error('[MediaServer] SRT relay error:', err.message);
      });

      this.srtProcess.on('exit', (code: number) => {
        console.log('[MediaServer] SRT relay exited with code', code);
        if (code !== 0) {
          console.log('[MediaServer] SRT relay will restart...');
          setTimeout(() => {
            if (config.live.srt.enabled) {
              this.startSrtServer();
            }
          }, 5000);
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
      rtmpPushUrl: 'rtmp://' + publicHost + ':' + config.live.rtmp.port + '/live/{streamKey}',
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
