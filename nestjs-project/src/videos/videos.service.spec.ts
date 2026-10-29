import {
  NotVideoOwnerException,
  UploadNotDraftException,
  UploadTooLargeException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { ChannelsService } from '../channels/channels.service';
import { MAX_UPLOAD_BYTES } from './videos.constants';
import { Video } from './entities/video.entity';
import { VideoStatus } from './entities/video-status';
import { StorageService } from './storage/storage.service';
import { VideosService } from './videos.service';

describe('VideosService (unit)', () => {
  const channel = { id: 'channel-1', user_id: 'user-1' };
  let videoRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    findOneBy: jest.Mock;
  };
  let channelsService: { findByUserId: jest.Mock };
  let storageService: {
    createMultipartUpload: jest.Mock;
    abortMultipartUpload: jest.Mock;
    presignUploadPart: jest.Mock;
    completeMultipartUpload: jest.Mock;
    presignGetObject: jest.Mock;
    videoBucket: string;
    thumbnailBucket: string;
  };
  let videoQueue: { add: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    videoRepository = {
      create: jest.fn((value: Partial<Video>) => value),
      save: jest.fn((value: Partial<Video>) =>
        Promise.resolve({
          ...value,
          id: value.id ?? 'video-uuid',
          multipart_upload_id: value.multipart_upload_id,
          status: value.status ?? VideoStatus.DRAFT,
        }),
      ),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
    };
    channelsService = {
      findByUserId: jest.fn().mockResolvedValue(channel),
    };
    storageService = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      presignUploadPart: jest
        .fn()
        .mockImplementation(
          (_key: string, _uploadId: string, partNumber: number) =>
            Promise.resolve(`https://storage/part-${partNumber}`),
        ),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      presignGetObject: jest
        .fn()
        .mockResolvedValue('https://storage/object?X-Amz-Signature=1'),
      videoBucket: 'videos',
      thumbnailBucket: 'thumbs',
    };
    videoQueue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new VideosService(
      videoRepository as any,
      channelsService as unknown as ChannelsService,
      storageService as unknown as StorageService,
      videoQueue as any,
    );
  });

  it('rejects size_bytes above 10GB with UPLOAD_TOO_LARGE and does not touch storage or DB', async () => {
    await expect(
      service.initiate('user-1', {
        title: 'Clip',
        original_filename: 'big.mp4',
        content_type: 'video/mp4',
        size_bytes: MAX_UPLOAD_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(UploadTooLargeException);

    expect(channelsService.findByUserId).not.toHaveBeenCalled();
    expect(storageService.createMultipartUpload).not.toHaveBeenCalled();
    expect(videoRepository.save).not.toHaveBeenCalled();
  });

  it('creates draft video after opening multipart upload', async () => {
    const result = await service.initiate('user-1', {
      title: 'Clip',
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: 1024,
    });

    expect(storageService.createMultipartUpload).toHaveBeenCalled();
    expect(videoRepository.save).toHaveBeenCalled();
    expect(result.status).toBe(VideoStatus.DRAFT);
    expect(result.multipart_upload_id).toBe('upload-1');
    expect(result.public_token).toHaveLength(64);
  });

  it('aborts multipart when persisting the draft fails', async () => {
    videoRepository.save.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.initiate('user-1', {
        title: 'Clip',
        original_filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: 1024,
      }),
    ).rejects.toThrow('db down');

    expect(storageService.abortMultipartUpload).toHaveBeenCalledWith(
      expect.any(String),
      'upload-1',
    );
  });

  describe('signParts', () => {
    const draftVideo = {
      public_token: 'tok',
      object_key: 'tok/source',
      multipart_upload_id: 'upload-1',
      status: VideoStatus.DRAFT,
      channel: { user_id: 'user-1' },
    };

    it('returns a presigned url per part for the owner of a draft', async () => {
      videoRepository.findOne.mockResolvedValue(draftVideo);

      const result = await service.signParts('tok', 'user-1', [1, 2]);

      expect(result.parts).toEqual([
        { part_number: 1, url: 'https://storage/part-1' },
        { part_number: 2, url: 'https://storage/part-2' },
      ]);
    });

    it('rejects non-owners', async () => {
      videoRepository.findOne.mockResolvedValue(draftVideo);

      await expect(
        service.signParts('tok', 'other', [1]),
      ).rejects.toBeInstanceOf(NotVideoOwnerException);
    });

    it('rejects when status is not draft', async () => {
      videoRepository.findOne.mockResolvedValue({
        ...draftVideo,
        status: VideoStatus.PROCESSING,
      });

      await expect(
        service.signParts('tok', 'user-1', [1]),
      ).rejects.toBeInstanceOf(UploadNotDraftException);
    });

    it('rejects unknown public tokens', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(
        service.signParts('missing', 'user-1', [1]),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });
  });

  describe('complete', () => {
    const draftVideo = {
      id: 'video-uuid',
      public_token: 'tok',
      object_key: 'tok/source',
      multipart_upload_id: 'upload-1',
      status: VideoStatus.DRAFT,
      channel: { user_id: 'user-1' },
    };

    it('completes multipart, marks processing, and enqueues video.processing with internal uuid', async () => {
      videoRepository.findOne.mockResolvedValue({ ...draftVideo });

      const result = await service.complete('tok', 'user-1', [
        { part_number: 1, etag: '"etag-1"' },
      ]);

      expect(storageService.completeMultipartUpload).toHaveBeenCalled();
      expect(videoQueue.add).toHaveBeenCalledWith(
        'video.processing',
        { videoId: 'video-uuid' },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(result.public_token).toBe('tok');
    });

    it('does not enqueue when not draft', async () => {
      videoRepository.findOne.mockResolvedValue({
        ...draftVideo,
        status: VideoStatus.READY,
      });

      await expect(
        service.complete('tok', 'user-1', [{ part_number: 1, etag: 'e' }]),
      ).rejects.toBeInstanceOf(UploadNotDraftException);
      expect(videoQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('findOne / playback / download', () => {
    it('hides non-ready videos from anonymous callers', async () => {
      videoRepository.findOne.mockResolvedValue({
        public_token: 'tok',
        status: VideoStatus.DRAFT,
        duration_seconds: null,
        thumbnail_object_key: null,
        channel: { user_id: 'owner' },
      });

      await expect(service.findOne('tok')).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
    });

    it('returns failure_reason only for the owner of a failed video', async () => {
      videoRepository.findOne.mockResolvedValue({
        public_token: 'tok',
        status: VideoStatus.FAILED,
        duration_seconds: null,
        thumbnail_object_key: null,
        failure_reason: 'boom',
        channel: { user_id: 'owner' },
      });

      const result = await service.findOne('tok', 'owner');
      expect(result.failure_reason).toBe('boom');
      expect(result).not.toHaveProperty('id');
    });

    it('rejects playback when not ready', async () => {
      videoRepository.findOneBy.mockResolvedValue({
        status: VideoStatus.PROCESSING,
      });

      await expect(service.playback('tok')).rejects.toBeInstanceOf(
        VideoNotReadyException,
      );
    });

    it('returns a download url with content disposition for ready videos', async () => {
      videoRepository.findOneBy.mockResolvedValue({
        status: VideoStatus.READY,
        object_key: 'tok/source',
        title: 'Clip',
        original_filename: 'clip.mp4',
      });

      const result = await service.download('tok');
      expect(result.url).toContain('https://storage/object');
      expect(storageService.presignGetObject).toHaveBeenCalledWith(
        'videos',
        'tok/source',
        'attachment; filename="clip.mp4"',
      );
    });
  });
});
