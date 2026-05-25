import prisma from '../config/prisma';
import { config } from '../config';
import { EffectData, TransitionParameters, FilterParameters, TextParameters, PipParameters, SpeedParameters, AudioParameters } from '../types';

export class EffectService {
  async addEffect(projectId: string, clipId: string, effectData: EffectData) {
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
    });

    if (!clip) {
      throw new Error('Clip not found');
    }

    const duration = effectData.duration || (clip.endTime - clip.startTime);
    const endTime = effectData.endTime || (effectData.startTime + duration);

    const effect = await prisma.effect.create({
      data: {
        clipId,
        type: effectData.type,
        subtype: effectData.subtype,
        name: effectData.name,
        startTime: effectData.startTime,
        endTime,
        duration,
        parameters: effectData.parameters,
        transitionType: effectData.transitionType as any,
        filterType: effectData.filterType as any,
        textType: effectData.textType as any,
      },
    });

    return effect;
  }

  async updateEffect(projectId: string, effectId: string, updates: Partial<EffectData>) {
    const data: any = {};

    if (updates.type) data.type = updates.type;
    if (updates.subtype !== undefined) data.subtype = updates.subtype;
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.startTime !== undefined) data.startTime = updates.startTime;
    if (updates.endTime !== undefined) data.endTime = updates.endTime;
    if (updates.duration !== undefined) data.duration = updates.duration;
    if (updates.parameters) data.parameters = updates.parameters;
    if (updates.transitionType) data.transitionType = updates.transitionType as any;
    if (updates.filterType) data.filterType = updates.filterType as any;
    if (updates.textType) data.textType = updates.textType as any;

    const effect = await prisma.effect.update({
      where: { id: effectId },
      data,
    });

    return effect;
  }

  async deleteEffect(projectId: string, effectId: string) {
    await prisma.effect.delete({
      where: { id: effectId },
    });

    return true;
  }

  async getEffects(clipId: string) {
    return prisma.effect.findMany({
      where: { clipId },
      orderBy: { startTime: 'asc' },
    });
  }

  async addTransition(projectId: string, clipId: string, transitionType: string, parameters: TransitionParameters) {
    return this.addEffect(projectId, clipId, {
      type: 'TRANSITION',
      subtype: transitionType,
      name: transitionType,
      startTime: 0,
      duration: parameters.duration || config.videoEdit.defaultTransitionDuration,
      parameters,
      transitionType,
    });
  }

  async addFilter(projectId: string, clipId: string, filterType: string, parameters: FilterParameters) {
    const clip = await prisma.clip.findUnique({ where: { id: clipId } });
    if (!clip) throw new Error('Clip not found');

    return this.addEffect(projectId, clipId, {
      type: 'FILTER',
      subtype: filterType,
      name: filterType,
      startTime: 0,
      endTime: clip.duration,
      duration: clip.duration,
      parameters,
      filterType,
    });
  }

  async addTextOverlay(projectId: string, clipId: string, textType: string, parameters: TextParameters) {
    const clip = await prisma.clip.findUnique({ where: { id: clipId } });
    if (!clip) throw new Error('Clip not found');

    return this.addEffect(projectId, clipId, {
      type: 'TEXT',
      subtype: textType,
      name: textType,
      startTime: parameters.positionX ? 0 : 0,
      endTime: clip.duration,
      duration: clip.duration,
      parameters,
      textType,
    });
  }

  async addPip(projectId: string, clipId: string, parameters: PipParameters) {
    const clip = await prisma.clip.findUnique({ where: { id: clipId } });
    if (!clip) throw new Error('Clip not found');

    return this.addEffect(projectId, clipId, {
      type: 'PIP',
      subtype: 'PIP',
      name: 'Picture in Picture',
      startTime: 0,
      endTime: clip.duration,
      duration: clip.duration,
      parameters,
    });
  }

  async addSpeedEffect(projectId: string, clipId: string, parameters: SpeedParameters) {
    const clip = await prisma.clip.findUnique({ where: { id: clipId } });
    if (!clip) throw new Error('Clip not found');

    return this.addEffect(projectId, clipId, {
      type: 'SPEED',
      subtype: 'SPEED',
      name: `Speed ${parameters.speed}x`,
      startTime: 0,
      endTime: clip.duration,
      duration: clip.duration,
      parameters,
    });
  }

  async addAudioEffect(projectId: string, clipId: string, parameters: AudioParameters) {
    const clip = await prisma.clip.findUnique({ where: { id: clipId } });
    if (!clip) throw new Error('Clip not found');

    return this.addEffect(projectId, clipId, {
      type: 'AUDIO',
      subtype: 'AUDIO',
      name: 'Audio Adjustment',
      startTime: 0,
      endTime: clip.duration,
      duration: clip.duration,
      parameters,
    });
  }

  buildFilterExpression(effect: any, clipWidth: number, clipHeight: number): string | null {
    if (effect.type === 'FILTER') {
      return this.buildVideoFilter(effect, clipWidth, clipHeight);
    } else if (effect.type === 'TEXT') {
      return this.buildTextFilter(effect, clipWidth, clipHeight);
    } else if (effect.type === 'PIP') {
      return this.buildPipFilter(effect, clipWidth, clipHeight);
    } else if (effect.type === 'SPEED') {
      return this.buildSpeedFilter(effect);
    }
    return null;
  }

  private buildVideoFilter(effect: any, clipWidth: number, clipHeight: number): string | null {
    const params = effect.parameters;
    const filterType = effect.filterType;

    switch (filterType) {
      case 'BRIGHTNESS':
        return `eq=brightness=${params.brightness || 0.1}`;
      case 'CONTRAST':
        return `eq=contrast=${params.contrast || 1.2}`;
      case 'SATURATION':
        return `eq=saturation=${params.saturation || 1.5}`;
      case 'GRAYSCALE':
        return `colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3`;
      case 'SEPIA':
        return `colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131`;
      case 'BLUR':
        return `boxblur=${params.blur || 10}:1`;
      case 'SHARPEN':
        return `unsharp=5:5:1.5:5:5:0.5`;
      case 'VINTAGE':
        return `curves=vintage`;
      case 'CINEMATIC':
        return `colorgrade=teal=0.2:orange=0.1`;
      case 'WARM':
        return `colorbalance=rs=0.1:gs=-0.05:bs=-0.1`;
      case 'COOL':
        return `colorbalance=rs=-0.1:gs=-0.05:bs=0.1`;
      case 'NEGATE':
        return `negate`;
      case 'HUE_ROTATE':
        return `hue=h=${params.intensity || 45}`;
      default:
        return null;
    }
  }

  private buildTextFilter(effect: any, clipWidth: number, clipHeight: number): string | null {
    const params = effect.parameters as TextParameters;
    const text = params.text || '';
    const fontSize = params.fontSize || 48;
    const fontColor = params.fontColor || 'white';
    const fontFamily = params.fontFamily || 'Arial';
    const posX = params.positionX !== undefined ? params.positionX : 'w/2-text_w/2';
    const posY = params.positionY !== undefined ? params.positionY : 'h/10';
    
    let drawtext = `drawtext=text='${text.replace(/'/g, "\\'")}'`;
    drawtext += `:fontsize=${fontSize}`;
    drawtext += `:fontcolor=${fontColor}`;
    drawtext += `:x=${posX}`;
    drawtext += `:y=${posY}`;

    if (params.backgroundColor) {
      drawtext += `:box=1:boxcolor=${params.backgroundColor}@0.8:boxborderw=5`;
    }

    if (params.borderColor && params.borderWidth) {
      drawtext += `:bordercolor=${params.borderColor}:borderw=${params.borderWidth}`;
    }

    if (params.shadow) {
      drawtext += `:shadowx=${params.shadowX || 2}:shadowy=${params.shadowY || 2}:shadowcolor=${params.shadowColor || 'black@0.5'}`;
    }

    if (params.animation === 'fade_in') {
      drawtext += `:enable='gte(t,${effect.startTime})'`;
    } else if (params.animation === 'typewriter') {
      drawtext += `:text='${text}'`;
      drawtext += `:alpha='if(lt(t,${effect.startTime}),0,if(lt(t,${effect.startTime}+1),(t-${effect.startTime})/1,1))'`;
    }

    return drawtext;
  }

  private buildPipFilter(effect: any, clipWidth: number, clipHeight: number): string | null {
    const params = effect.parameters as PipParameters;
    return `[pip_scaled]overlay=${params.positionX}:${params.positionY}`;
  }

  private buildSpeedFilter(effect: any): string | null {
    const params = effect.parameters as SpeedParameters;
    const speed = params.speed || 1;
    return `setpts=PTS/${speed}`;
  }

  buildAudioFilter(effect: any): string | null {
    if (effect.type !== 'AUDIO') return null;

    const params = effect.parameters as AudioParameters;
    const filters: string[] = [];

    if (params.volume !== undefined) {
      filters.push(`volume=${params.volume}`);
    }

    if (params.fadeIn) {
      filters.push(`afade=t=in:st=0:d=${params.fadeIn}`);
    }

    if (params.fadeOut) {
      const clip = (effect as any).clip;
      const fadeStartTime = clip ? clip.duration - params.fadeOut : 10;
      filters.push(`afade=t=out:st=${fadeStartTime}:d=${params.fadeOut}`);
    }

    if (params.noiseReduction) {
      filters.push(`afftdn=nf=-${params.noiseThreshold || 20}`);
    }

    return filters.length > 0 ? filters.join(',') : null;
  }

  buildTransitionFilter(
    transitionType: string,
    duration: number,
    offset: number,
    firstStream: string,
    secondStream: string
  ): string {
    const transitionMap: Record<string, string> = {
      'FADE': 'fade',
      'DISSOLVE': 'xfade=transition=dissolve',
      'SLIDE_LEFT': 'xfade=transition=slideleft',
      'SLIDE_RIGHT': 'xfade=transition=slideright',
      'SLIDE_UP': 'xfade=transition=slideup',
      'SLIDE_DOWN': 'xfade=transition=slidedown',
      'WIPE': 'xfade=transition=wiperight',
      'CROSSFADE': 'xfade=transition=crossfade',
    };

    const transition = transitionMap[transitionType] || transitionMap['CROSSFADE'];
    return `[${firstStream}][${secondStream}]${transition}:duration=${duration}:offset=${offset}`;
  }

  getTransitionTypes() {
    return [
      { type: 'FADE', name: '淡入淡出', description: '经典淡入淡出效果' },
      { type: 'DISSOLVE', name: '叠化', description: '柔和的叠化过渡' },
      { type: 'SLIDE_LEFT', name: '向左滑动', description: '从右向左滑动' },
      { type: 'SLIDE_RIGHT', name: '向右滑动', description: '从左向右滑动' },
      { type: 'SLIDE_UP', name: '向上滑动', description: '从下向上滑动' },
      { type: 'SLIDE_DOWN', name: '向下滑动', description: '从上向下滑动' },
      { type: 'WIPE', name: '擦除', description: '横向擦除效果' },
      { type: 'CROSSFADE', name: '交叉淡化', description: '音频交叉淡化' },
    ];
  }

  getFilterTypes() {
    return [
      { type: 'BRIGHTNESS', name: '亮度', description: '调整画面亮度' },
      { type: 'CONTRAST', name: '对比度', description: '调整画面对比度' },
      { type: 'SATURATION', name: '饱和度', description: '调整色彩饱和度' },
      { type: 'GRAYSCALE', name: '黑白', description: '转换为黑白画面' },
      { type: 'SEPIA', name: '复古', description: '老照片风格' },
      { type: 'BLUR', name: '模糊', description: '高斯模糊效果' },
      { type: 'SHARPEN', name: '锐化', description: '增强画面清晰度' },
      { type: 'VINTAGE', name: '胶片', description: '电影胶片质感' },
      { type: 'CINEMATIC', name: '电影', description: '电影级调色' },
      { type: 'WARM', name: '暖色调', description: '温暖的色调' },
      { type: 'COOL', name: '冷色调', description: '冷静的色调' },
      { type: 'NEGATE', name: '反色', description: '颜色反转效果' },
      { type: 'HUE_ROTATE', name: '色相', description: '调整色相角度' },
    ];
  }

  getTextTypes() {
    return [
      { type: 'TITLE', name: '标题', description: '视频标题文字' },
      { type: 'WATERMARK', name: '水印', description: 'Logo或水印' },
      { type: 'SUBTITLE', name: '字幕', description: '对话字幕' },
      { type: 'CAPTION', name: '说明文字', description: '画面说明' },
    ];
  }
}

export const effectService = new EffectService();
