import { randomBytes } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  NotVideoOwnerException,
  UploadNotDraftException,
  UploadTooLargeException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import {
  MAX_UPLOAD_BYTES,
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_JOB_OPTIONS,
  VIDEO_QUEUE,
} from './videos.constants';
import { Video } from './entities/video.entity';
import type { VideoMetadata } from './entities/video-metadata';
import { VideoStatus } from './entities/video-status';
import { StorageService } from './storage/storage.service';

export type InitiateUploadInput = {
  title: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
};

export type InitiateUploadResult = {
  public_token: string;
  status: VideoStatus;
  multipart_upload_id: string;
};

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    @InjectQueue(VIDEO_QUEUE) private readonly videoQueue: Queue,
  ) {}

  async initiate(
    userId: string,
    input: InitiateUploadInput,
  ): Promise<InitiateUploadResult> {
    if (input.size_bytes > MAX_UPLOAD_BYTES) {
      throw new UploadTooLargeException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new VideoNotFoundException();
    }

    const publicToken = randomBytes(32).toString('hex');
    const objectKey = `${publicToken}/source`;

    const multipartUploadId = await this.storageService.createMultipartUpload(
      objectKey,
      input.content_type,
    );

    try {
      const video = await this.videoRepository.save(
        this.videoRepository.create({
          public_token: publicToken,
          channel_id: channel.id,
          status: VideoStatus.DRAFT,
          title: input.title,
          original_filename: input.original_filename,
          content_type: input.content_type,
          size_bytes: String(input.size_bytes),
          object_key: objectKey,
          multipart_upload_id: multipartUploadId,
        }),
      );

      return {
        public_token: video.public_token,
        status: video.status,
        multipart_upload_id: video.multipart_upload_id!,
      };
    } catch (err) {
      await this.storageService.abortMultipartUpload(
        objectKey,
        multipartUploadId,
      );
      throw err;
    }
  }

  async signParts(
    publicToken: string,
    userId: string,
    partNumbers: number[],
  ): Promise<{ parts: { part_number: number; url: string }[] }> {
    const video = await this.findOwnedDraftOrThrow(publicToken, userId);
    if (!video.multipart_upload_id) {
      throw new UploadNotDraftException();
    }

    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        part_number: partNumber,
        url: await this.storageService.presignUploadPart(
          video.object_key,
          video.multipart_upload_id!,
          partNumber,
        ),
      })),
    );

    return { parts };
  }

  async complete(
    publicToken: string,
    userId: string,
    parts: { part_number: number; etag: string }[],
  ): Promise<{ public_token: string; status: VideoStatus }> {
    const video = await this.findOwnedDraftOrThrow(publicToken, userId);
    if (!video.multipart_upload_id) {
      throw new UploadNotDraftException();
    }

    await this.storageService.completeMultipartUpload(
      video.object_key,
      video.multipart_upload_id,
      parts.map((part) => ({
        partNumber: part.part_number,
        etag: part.etag,
      })),
    );

    video.status = VideoStatus.PROCESSING;
    video.multipart_upload_id = null;
    await this.videoRepository.save(video);

    await this.videoQueue.add(
      VIDEO_PROCESSING_JOB,
      { videoId: video.id },
      VIDEO_PROCESSING_JOB_OPTIONS,
    );

    return {
      public_token: video.public_token,
      status: video.status,
    };
  }

  async findOwnedDraftOrThrow(
    publicToken: string,
    userId: string,
  ): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { public_token: publicToken },
      relations: ['channel'],
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.channel.user_id !== userId) {
      throw new NotVideoOwnerException();
    }
    if (video.status !== VideoStatus.DRAFT) {
      throw new UploadNotDraftException();
    }
    return video;
  }

  async findOne(
    publicToken: string,
    viewerUserId?: string,
  ): Promise<{
    public_token: string;
    title: string;
    status: VideoStatus;
    duration_seconds: number | null;
    metadata: VideoMetadata | null;
    thumbnail_url: string | null;
    failure_reason?: string | null;
  }> {
    const video = await this.videoRepository.findOne({
      where: { public_token: publicToken },
      relations: ['channel'],
    });
    if (!video) {
      throw new VideoNotFoundException();
    }

    const isOwner =
      viewerUserId !== undefined && video.channel.user_id === viewerUserId;

    if (!isOwner && video.status !== VideoStatus.READY) {
      throw new VideoNotFoundException();
    }

    let thumbnailUrl: string | null = null;
    if (video.thumbnail_object_key) {
      thumbnailUrl = await this.storageService.presignGetObject(
        this.storageService.thumbnailBucket,
        video.thumbnail_object_key,
      );
    }

    return {
      public_token: video.public_token,
      title: video.title,
      status: video.status,
      duration_seconds: video.duration_seconds,
      metadata: video.metadata,
      thumbnail_url: thumbnailUrl,
      ...(isOwner && video.status === VideoStatus.FAILED
        ? { failure_reason: video.failure_reason }
        : {}),
    };
  }

  async playback(publicToken: string): Promise<{ url: string }> {
    const video = await this.requireReadyByPublicToken(publicToken);
    const url = await this.storageService.presignGetObject(
      this.storageService.videoBucket,
      video.object_key,
    );
    return { url };
  }

  async download(publicToken: string): Promise<{ url: string }> {
    const video = await this.requireReadyByPublicToken(publicToken);
    const url = await this.storageService.presignGetObject(
      this.storageService.videoBucket,
      video.object_key,
      `attachment; filename="${video.original_filename.replace(/"/g, '')}"`,
    );
    return { url };
  }

  async requireReadyByPublicToken(publicToken: string): Promise<Video> {
    const video = await this.videoRepository.findOneBy({
      public_token: publicToken,
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }
    return video;
  }
}
