import { Job } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoStatus } from './entities/video-status';
import { StorageService } from './storage/storage.service';
import { VideoMediaService } from './video-media.service';
import { VideoProcessor } from './video.processor';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

function buildJob(videoId: string, attemptsMade = 0): Job {
  return {
    name: 'video.processing',
    data: { videoId },
    attemptsMade,
    opts: { attempts: 3 },
  } as Job;
}

describe('VideoProcessor (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let storageService: StorageService;
  let processor: VideoProcessor;
  let media: {
    extractDurationSeconds: jest.Mock;
    extractThumbnailJpeg: jest.Mock;
  };

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);

    storageService = new StorageService({
      endpoint: process.env.STORAGE_ENDPOINT!,
      accessKey: process.env.STORAGE_ACCESS_KEY!,
      secretKey: process.env.STORAGE_SECRET_KEY!,
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      videoBucket: process.env.STORAGE_VIDEO_BUCKET!,
      thumbnailBucket: process.env.STORAGE_THUMBNAIL_BUCKET!,
    });
    await storageService.onModuleInit();

    media = {
      extractDurationSeconds: jest.fn().mockResolvedValue(15),
      extractThumbnailJpeg: jest.fn().mockResolvedValue(Buffer.from('jpeg')),
    };

    processor = new VideoProcessor(
      videoRepository,
      storageService,
      media as unknown as VideoMediaService,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    jest.clearAllMocks();
    media.extractDurationSeconds.mockResolvedValue(15);
    media.extractThumbnailJpeg.mockResolvedValue(Buffer.from('jpeg'));
  });

  let counter = 0;

  async function seedProcessingVideo(): Promise<Video> {
    const user = await userRepository.save(
      userRepository.create({
        email: `proc_${++counter}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Chan',
        nickname: `proc_${counter}`,
        user_id: user.id,
      }),
    );
    const publicToken = `token_${counter}`.padEnd(64, 'a');
    const objectKey = `${publicToken}/source`;
    await storageService.putObject(
      storageService.videoBucket,
      objectKey,
      Buffer.alloc(128, 2),
      'video/mp4',
    );
    return videoRepository.save(
      videoRepository.create({
        public_token: publicToken,
        channel_id: channel.id,
        status: VideoStatus.PROCESSING,
        original_filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: '128',
        object_key: objectKey,
      }),
    );
  }

  it('processes a video into ready with duration and thumbnail key', async () => {
    const video = await seedProcessingVideo();

    await processor.process(buildJob(video.id));

    const updated = await videoRepository.findOneByOrFail({ id: video.id });
    expect(updated.status).toBe(VideoStatus.READY);
    expect(updated.duration_seconds).toBe(15);
    expect(updated.thumbnail_object_key).toBe(
      `${video.public_token}/thumbnail.jpg`,
    );
    expect(
      await storageService.objectExists(
        storageService.thumbnailBucket,
        updated.thumbnail_object_key!,
      ),
    ).toBe(true);
  });

  it('marks failed and keeps the video object when the last attempt fails', async () => {
    const video = await seedProcessingVideo();
    media.extractDurationSeconds.mockRejectedValue(new Error('boom'));

    await processor.process(buildJob(video.id, 2));

    const updated = await videoRepository.findOneByOrFail({ id: video.id });
    expect(updated.status).toBe(VideoStatus.FAILED);
    expect(updated.failure_reason).toBe('boom');
    expect(
      await storageService.objectExists(
        storageService.videoBucket,
        video.object_key,
      ),
    ).toBe(true);
  });

  it('does not change ready videos on redelivery', async () => {
    const video = await seedProcessingVideo();
    await processor.process(buildJob(video.id));
    const ready = await videoRepository.findOneByOrFail({ id: video.id });

    media.extractDurationSeconds.mockResolvedValue(99);
    await processor.process(buildJob(video.id));

    const again = await videoRepository.findOneByOrFail({ id: video.id });
    expect(again.duration_seconds).toBe(ready.duration_seconds);
    expect(again.thumbnail_object_key).toBe(ready.thumbnail_object_key);
  });
});
