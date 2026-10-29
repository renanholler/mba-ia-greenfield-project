import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../../config/storage.config';

const PRESIGN_EXPIRES_SECONDS = 3600;

export type StorageConfig = ConfigType<typeof storageConfig>;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly client: S3Client;
  /** Signs URLs with the host the caller can reach; signing does no network I/O */
  private readonly presignClient: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly storage: StorageConfig,
  ) {
    this.client = this.createClient(storage.endpoint);
    this.presignClient = this.createClient(
      storage.publicEndpoint ?? storage.endpoint,
    );
  }

  private createClient(endpoint: string): S3Client {
    return new S3Client({
      endpoint,
      region: this.storage.region,
      credentials: {
        accessKeyId: this.storage.accessKey,
        secretAccessKey: this.storage.secretKey,
      },
      forcePathStyle: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket(this.storage.videoBucket);
    await this.ensureBucket(this.storage.thumbnailBucket);
  }

  get videoBucket(): string {
    return this.storage.videoBucket;
  }

  get thumbnailBucket(): string {
    return this.storage.thumbnailBucket;
  }

  async createMultipartUpload(
    objectKey: string,
    contentType: string,
  ): Promise<string> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.storage.videoBucket,
        Key: objectKey,
        ContentType: contentType,
      }),
    );
    if (!result.UploadId) {
      throw new Error('CreateMultipartUpload did not return UploadId');
    }
    return result.UploadId;
  }

  async abortMultipartUpload(
    objectKey: string,
    uploadId: string,
  ): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.storage.videoBucket,
        Key: objectKey,
        UploadId: uploadId,
      }),
    );
  }

  async presignUploadPart(
    objectKey: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new UploadPartCommand({
        Bucket: this.storage.videoBucket,
        Key: objectKey,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: PRESIGN_EXPIRES_SECONDS },
    );
  }

  async completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.storage.videoBucket,
        Key: objectKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            ETag: part.etag,
            PartNumber: part.partNumber,
          })),
        },
      }),
    );
  }

  async presignGetObject(
    bucket: string,
    objectKey: string,
    contentDisposition?: string,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ...(contentDisposition
          ? { ResponseContentDisposition: contentDisposition }
          : {}),
      }),
      { expiresIn: PRESIGN_EXPIRES_SECONDS },
    );
  }

  async putObject(
    bucket: string,
    objectKey: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async downloadObjectToFile(
    bucket: string,
    objectKey: string,
    destinationPath: string,
  ): Promise<void> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      }),
    );
    if (!result.Body) {
      throw new Error(`Object ${objectKey} has no body`);
    }
    await pipeline(result.Body as Readable, createWriteStream(destinationPath));
  }

  async objectExists(bucket: string, objectKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Range: 'bytes=0-0',
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch {
        // Concurrent create or bucket already owned — HeadBucket next call will confirm.
      }
    }
  }
}
