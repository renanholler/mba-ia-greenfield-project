import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Repository } from 'typeorm';
import { VIDEO_PROCESSING_JOB, VIDEO_QUEUE } from './videos.constants';
import { Video } from './entities/video.entity';
import { VideoStatus } from './entities/video-status';
import { StorageService } from './storage/storage.service';
import { VideoMediaService } from './video-media.service';

export type VideoProcessingJobData = {
  videoId: string;
};

@Injectable()
@Processor(VIDEO_QUEUE)
export class VideoProcessor extends WorkerHost {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly videoMediaService: VideoMediaService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    if (job.name !== VIDEO_PROCESSING_JOB) {
      return;
    }

    const video = await this.videoRepository.findOneBy({
      id: job.data.videoId,
    });
    if (!video) {
      return;
    }
    if (
      video.status === VideoStatus.READY ||
      video.status === VideoStatus.FAILED
    ) {
      return;
    }

    const workDir = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
    const sourcePath = join(workDir, 'source');

    try {
      await this.storageService.downloadObjectToFile(
        this.storageService.videoBucket,
        video.object_key,
        sourcePath,
      );

      const { durationSeconds, metadata } =
        await this.videoMediaService.probe(sourcePath);
      const thumbnailBytes =
        await this.videoMediaService.extractThumbnailJpeg(sourcePath);

      const thumbnailObjectKey = `${video.public_token}/thumbnail.jpg`;
      await this.storageService.putObject(
        this.storageService.thumbnailBucket,
        thumbnailObjectKey,
        thumbnailBytes,
        'image/jpeg',
      );

      video.duration_seconds = durationSeconds;
      video.metadata = metadata;
      video.thumbnail_object_key = thumbnailObjectKey;
      video.status = VideoStatus.READY;
      video.failure_reason = null;
      await this.videoRepository.save(video);
    } catch (err) {
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (!isLastAttempt) {
        throw err;
      }
      video.status = VideoStatus.FAILED;
      video.failure_reason =
        err instanceof Error ? err.message : 'Video processing failed';
      await this.videoRepository.save(video);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
