import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import { UploadTooLargeException } from '../common/exceptions/domain.exception';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { MAX_UPLOAD_BYTES, VIDEO_QUEUE } from './videos.constants';
import { Video } from './entities/video.entity';
import { VideoStatus } from './entities/video-status';
import { StorageService } from './storage/storage.service';
import type { VideoProcessingJobData } from './video.processor';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let service: VideosService;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoQueue: Queue<VideoProcessingJobData>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);

    const storageService = new StorageService({
      endpoint: process.env.STORAGE_ENDPOINT!,
      accessKey: process.env.STORAGE_ACCESS_KEY!,
      secretKey: process.env.STORAGE_SECRET_KEY!,
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      videoBucket: process.env.STORAGE_VIDEO_BUCKET!,
      thumbnailBucket: process.env.STORAGE_THUMBNAIL_BUCKET!,
    });
    await storageService.onModuleInit();

    videoQueue = new Queue<VideoProcessingJobData>(VIDEO_QUEUE, {
      connection: {
        host: process.env.QUEUE_HOST ?? 'redis',
        port: Number(process.env.QUEUE_PORT ?? 6379),
      },
    });

    service = new VideosService(
      videoRepository,
      new ChannelsService(dataSource),
      storageService,
      videoQueue,
    );
  });

  afterAll(async () => {
    await videoQueue.close();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;

  async function createUserWithChannel(): Promise<{
    user: User;
    channel: Channel;
  }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `vid_svc_${++counter}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Chan',
        nickname: `vidchan_${counter}`,
        user_id: user.id,
      }),
    );
    return { user, channel };
  }

  it('persists a draft row linked to the caller channel with multipart id', async () => {
    const { user, channel } = await createUserWithChannel();

    const result = await service.initiate(user.id, {
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: 2048,
    });

    expect(result.status).toBe(VideoStatus.DRAFT);
    expect(result.public_token).toHaveLength(64);
    expect(result.multipart_upload_id).toBeTruthy();

    const row = await videoRepository.findOneByOrFail({
      public_token: result.public_token,
    });
    expect(row.channel_id).toBe(channel.id);
    expect(row.id).not.toBe(row.public_token);
    expect(row.thumbnail_object_key).toBeNull();
    expect(row.duration_seconds).toBeNull();
    expect(row.multipart_upload_id).toBe(result.multipart_upload_id);
  });

  it('rejects oversize uploads without inserting a row', async () => {
    const { user } = await createUserWithChannel();

    await expect(
      service.initiate(user.id, {
        original_filename: 'huge.mp4',
        content_type: 'video/mp4',
        size_bytes: MAX_UPLOAD_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(UploadTooLargeException);

    expect(await videoRepository.count()).toBe(0);
  });

  it('signs parts for a draft without changing status', async () => {
    const { user } = await createUserWithChannel();
    const initiated = await service.initiate(user.id, {
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: 2048,
    });

    const signed = await service.signParts(
      initiated.public_token,
      user.id,
      [1, 2],
    );

    expect(signed.parts).toHaveLength(2);
    expect(signed.parts[0].url).toContain('http');
    expect(signed.parts[1].part_number).toBe(2);

    const row = await videoRepository.findOneByOrFail({
      public_token: initiated.public_token,
    });
    expect(row.status).toBe(VideoStatus.DRAFT);
  });

  it('completes multipart upload, clears multipart id, and enqueues processing job', async () => {
    const { user } = await createUserWithChannel();
    const initiated = await service.initiate(user.id, {
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: 64,
    });

    const signed = await service.signParts(
      initiated.public_token,
      user.id,
      [1],
    );
    const body = Buffer.alloc(64, 1);
    const putRes = await fetch(signed.parts[0].url, {
      method: 'PUT',
      body,
    });
    expect(putRes.ok).toBe(true);
    const etag = putRes.headers.get('etag');
    expect(etag).toBeTruthy();

    const completed = await service.complete(initiated.public_token, user.id, [
      { part_number: 1, etag: etag! },
    ]);

    expect(completed.status).toBe(VideoStatus.PROCESSING);

    const row = await videoRepository.findOneByOrFail({
      public_token: initiated.public_token,
    });
    expect(row.status).toBe(VideoStatus.PROCESSING);
    expect(row.multipart_upload_id).toBeNull();

    const jobs = await videoQueue.getJobs(['waiting', 'delayed', 'active']);
    const match = jobs.find(
      (job) => job.name === 'video.processing' && job.data?.videoId === row.id,
    );
    expect(match).toBeDefined();
    expect(match!.data.videoId).not.toBe(row.public_token);
  });
});
