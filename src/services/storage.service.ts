import * as Minio from 'minio';
import { config } from '../config';
import { Readable } from 'stream';

class StorageService {
  private client: Minio.Client;
  private videoBucket: string;
  private thumbnailBucket: string;

  constructor() {
    this.client = new Minio.Client({
      endPoint: config.minio.endPoint,
      port: config.minio.port,
      useSSL: config.minio.useSSL,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
    });

    this.videoBucket = config.minio.videoBucket;
    this.thumbnailBucket = config.minio.thumbnailBucket;

    this.initializeBuckets();
  }

  private async initializeBuckets(): Promise<void> {
    try {
      const videoBucketExists = await this.client.bucketExists(this.videoBucket);
      if (!videoBucketExists) {
        await this.client.makeBucket(this.videoBucket, 'us-east-1');
        console.log(`Bucket ${this.videoBucket} created`);
      }

      const thumbnailBucketExists = await this.client.bucketExists(this.thumbnailBucket);
      if (!thumbnailBucketExists) {
        await this.client.makeBucket(this.thumbnailBucket, 'us-east-1');
        console.log(`Bucket ${this.thumbnailBucket} created`);
      }
    } catch (error) {
      console.error('Error initializing buckets:', error);
    }
  }

  async uploadVideo(objectName: string, filePath: string, metadata?: Record<string, string>): Promise<string> {
    await this.client.fPutObject(this.videoBucket, objectName, filePath, metadata);
    return objectName;
  }

  async uploadVideoStream(objectName: string, stream: Readable, size: number, metadata?: Record<string, string>): Promise<string> {
    await this.client.putObject(this.videoBucket, objectName, stream, size, metadata);
    return objectName;
  }

  async uploadThumbnail(objectName: string, filePath: string, metadata?: Record<string, string>): Promise<string> {
    await this.client.fPutObject(this.thumbnailBucket, objectName, filePath, metadata);
    return objectName;
  }

  async getVideoUrl(objectName: string, expires = 24 * 60 * 60): Promise<string> {
    return this.client.presignedGetObject(this.videoBucket, objectName, expires);
  }

  async getThumbnailUrl(objectName: string, expires = 24 * 60 * 60): Promise<string> {
    return this.client.presignedGetObject(this.thumbnailBucket, objectName, expires);
  }

  async deleteVideo(objectName: string): Promise<void> {
    await this.client.removeObject(this.videoBucket, objectName);
  }

  async deleteThumbnail(objectName: string): Promise<void> {
    await this.client.removeObject(this.thumbnailBucket, objectName);
  }

  async getVideoSize(objectName: string): Promise<number> {
    const stat = await this.client.statObject(this.videoBucket, objectName);
    return stat.size;
  }

  async getBucketStats(bucket: string): Promise<{ count: number; size: number }> {
    const objects = this.client.listObjectsV2(bucket, '', true);
    let count = 0;
    let size = 0;

    for await (const obj of objects) {
      count++;
      size += obj.size || 0;
    }

    return { count, size };
  }

  async getStorageStats(): Promise<{ videos: { count: number; size: number }; thumbnails: { count: number; size: number } }> {
    const [videoStats, thumbnailStats] = await Promise.all([
      this.getBucketStats(this.videoBucket),
      this.getBucketStats(this.thumbnailBucket),
    ]);

    return {
      videos: videoStats,
      thumbnails: thumbnailStats,
    };
  }

  async listVideos(prefix?: string): Promise<Minio.BucketItem[]> {
    const objects: Minio.BucketItem[] = [];
    const stream = this.client.listObjectsV2(this.videoBucket, prefix, true);

    for await (const obj of stream) {
      objects.push(obj);
    }

    return objects;
  }
}

export const storageService = new StorageService();
