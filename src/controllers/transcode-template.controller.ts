import { Request, Response } from 'express';
import { successResponse, errorResponse } from '../utils/response';
import { TranscodeTemplateService } from '../services/transcode-template.service';
import { z } from 'zod';

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  videoBitrate: z.number().int().positive().optional(),
  videoCodec: z.enum(['H264', 'H265', 'AV1']).default('H264'),
  audioBitrate: z.number().int().positive().optional(),
  audioCodec: z.enum(['AAC', 'MP3', 'OPUS']).default('AAC'),
  framerate: z.number().int().min(1).max(120).optional(),
  crf: z.number().int().min(0).max(51).optional(),
  preset: z.string().optional(),
  outputFormat: z.string().default('mp4'),
  isHls: z.boolean().default(false),
  isDash: z.boolean().default(false),
});

const updateTemplateSchema = createTemplateSchema.partial();

export class TranscodeTemplateController {
  static async getTemplates(req: Request, res: Response) {
    try {
      const includePresets = req.query.includePresets !== 'false';
      const templates = await TranscodeTemplateService.getAllTemplates(includePresets);
      successResponse(res, templates);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getTemplate(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const template = await TranscodeTemplateService.getTemplateById(id);

      if (!template) {
        return errorResponse(res, 'Template not found', 404);
      }

      successResponse(res, template);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async createTemplate(req: Request, res: Response) {
    try {
      const validated = createTemplateSchema.parse(req.body);
      const template = await TranscodeTemplateService.createTemplate(validated);
      successResponse(res, template, 'Template created successfully', 201);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return errorResponse(res, error.errors.map(e => e.message).join(', '), 400);
      }
      errorResponse(res, error.message, 500);
    }
  }

  static async updateTemplate(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const validated = updateTemplateSchema.parse(req.body);

      const existing = await TranscodeTemplateService.getTemplateById(id);
      if (!existing) {
        return errorResponse(res, 'Template not found', 404);
      }

      if (existing.isPreset) {
        return errorResponse(res, 'Cannot modify preset templates', 403);
      }

      const template = await TranscodeTemplateService.updateTemplate(id, validated);
      successResponse(res, template, 'Template updated successfully');
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return errorResponse(res, error.errors.map(e => e.message).join(', '), 400);
      }
      errorResponse(res, error.message, 500);
    }
  }

  static async deleteTemplate(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const existing = await TranscodeTemplateService.getTemplateById(id);
      if (!existing) {
        return errorResponse(res, 'Template not found', 404);
      }

      await TranscodeTemplateService.deleteTemplate(id);
      successResponse(res, null, 'Template deleted successfully');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }
}
