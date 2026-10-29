import { Job } from 'bullmq';
import { Video } from './entities/video.entity';
import { VideoStatus } from './entities/video-status';
import { StorageService } from './storage/storage.service';
import { VideoMediaService } from './video-media.service';
import { VideoProcessor } from './video.processor';

const SAMPLE_METADATA = {
  format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
  bit_rate: 1200000,
  width: 1280,
  height: 720,
  frame_rate: 30,
  video_codec: 'h264',
  audio_codec: 'aac',
};

function buildJob(attemptsMade = 0, attempts = 3): Job {
  return {
    name: 'video.processing',
    data: { videoId: 'v1' },
    attemptsMade,
    opts: { attempts },
  } as Job;
}

describe('VideoProcessor (unit)', () => {
  let videoRepository: {
    findOneBy: jest.Mock;
    save: jest.Mock;
  };
  let storageService: {
    videoBucket: string;
    thumbnailBucket: string;
    downloadObjectToFile: jest.Mock;
    putObject: jest.Mock;
  };
  let videoMediaService: {
    probe: jest.Mock;
    extractThumbnailJpeg: jest.Mock;
  };
  let processor: VideoProcessor;

  beforeEach(() => {
    videoRepository = {
      findOneBy: jest.fn(),
      save: jest.fn((value: Video) => Promise.resolve(value)),
    };
    storageService = {
      videoBucket: 'videos',
      thumbnailBucket: 'thumbs',
      downloadObjectToFile: jest.fn().mockResolvedValue(undefined),
      putObject: jest.fn().mockResolvedValue(undefined),
    };
    videoMediaService = {
      probe: jest
        .fn()
        .mockResolvedValue({ durationSeconds: 42, metadata: SAMPLE_METADATA }),
      extractThumbnailJpeg: jest.fn().mockResolvedValue(Buffer.from('jpeg')),
    };
    processor = new VideoProcessor(
      videoRepository as any,
      storageService as unknown as StorageService,
      videoMediaService as unknown as VideoMediaService,
    );
  });

  it('marks ready with duration and thumbnail on success', async () => {
    const video = {
      id: 'v1',
      public_token: 'tok',
      object_key: 'tok/source',
      status: VideoStatus.PROCESSING,
      duration_seconds: null as number | null,
      metadata: null as typeof SAMPLE_METADATA | null,
      thumbnail_object_key: null as string | null,
      failure_reason: null as string | null,
    };
    videoRepository.findOneBy.mockResolvedValue(video);

    await processor.process(buildJob());

    expect(video.status).toBe(VideoStatus.READY);
    expect(video.duration_seconds).toBe(42);
    expect(video.metadata).toEqual(SAMPLE_METADATA);
    expect(video.thumbnail_object_key).toBe('tok/thumbnail.jpg');
    expect(storageService.putObject).toHaveBeenCalled();
    expect(videoRepository.save).toHaveBeenCalledWith(video);
  });

  it('rethrows and keeps processing when a non-final attempt fails', async () => {
    const video = {
      id: 'v1',
      public_token: 'tok',
      object_key: 'tok/source',
      status: VideoStatus.PROCESSING,
      failure_reason: null as string | null,
    };
    videoRepository.findOneBy.mockResolvedValue(video);
    videoMediaService.probe.mockRejectedValue(new Error('ffprobe failed'));

    await expect(processor.process(buildJob(0, 3))).rejects.toThrow(
      'ffprobe failed',
    );

    expect(video.status).toBe(VideoStatus.PROCESSING);
    expect(video.failure_reason).toBeNull();
    expect(videoRepository.save).not.toHaveBeenCalled();
  });

  it('marks failed and keeps object key when the last attempt fails', async () => {
    const video = {
      id: 'v1',
      public_token: 'tok',
      object_key: 'tok/source',
      status: VideoStatus.PROCESSING,
      failure_reason: null as string | null,
    };
    videoRepository.findOneBy.mockResolvedValue(video);
    videoMediaService.probe.mockRejectedValue(new Error('ffprobe failed'));

    await processor.process(buildJob(2, 3));

    expect(video.status).toBe(VideoStatus.FAILED);
    expect(video.failure_reason).toBe('ffprobe failed');
    expect(video.object_key).toBe('tok/source');
  });

  it('skips reprocessing when already ready', async () => {
    videoRepository.findOneBy.mockResolvedValue({
      id: 'v1',
      status: VideoStatus.READY,
      duration_seconds: 10,
      thumbnail_object_key: 'tok/thumbnail.jpg',
    });

    await processor.process(buildJob());

    expect(storageService.downloadObjectToFile).not.toHaveBeenCalled();
    expect(videoRepository.save).not.toHaveBeenCalled();
  });
});
