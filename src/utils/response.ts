import { Response } from 'express';
import { ApiResponse } from '../types';

export function successResponse<T>(res: Response, data?: T, message?: string, statusCode = 200): Response<ApiResponse<T>> {
  return res.status(statusCode).json({
    success: true,
    data,
    message,
  });
}

export function errorResponse(res: Response, error: string, statusCode = 400): Response<ApiResponse> {
  return res.status(statusCode).json({
    success: false,
    error,
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}
