import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Channel } from '../src/channels/entities/channel.entity';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/entities/video-status';
import { StorageService } from '../src/videos/storage/storage.service';

type ErrorBody = { statusCode: number; error: string; message: string };
type UrlBody = { url: string };

describe('videos-playback', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let storageService: StorageService;
  let counter = 0;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    storageService = moduleFixture.get(StorageService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function seedVideo(status: VideoStatus): Promise<Video> {
    const user = await userRepository.save(
      userRepository.create({
        email: `play_${++counter}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Chan',
        nickname: `play_${counter}`,
        user_id: user.id,
      }),
    );
    const publicToken = `play_${counter}`.padEnd(64, 'd');
    const objectKey = `${publicToken}/source`;
    await storageService.putObject(
      storageService.videoBucket,
      objectKey,
      Buffer.alloc(32, 3),
      'video/mp4',
    );
    return videoRepository.save(
      videoRepository.create({
        public_token: publicToken,
        channel_id: channel.id,
        status,
        title: 'Clip',
        original_filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: '32',
        object_key: objectKey,
      }),
    );
  }

  it('ready-video-returns-presigned-url', async () => {
    const video = await seedVideo(VideoStatus.READY);

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_token}/playback`)
      .expect(200);

    const body = res.body as UrlBody;
    expect(typeof body.url).toBe('string');
    expect(new URL(body.url).origin).toBe(
      new URL(
        process.env.STORAGE_PUBLIC_ENDPOINT ?? process.env.STORAGE_ENDPOINT!,
      ).origin,
    );
    expect(Buffer.isBuffer(body)).toBe(false);
    expect(JSON.stringify(body).includes('\u0003')).toBe(false);
  });

  it('reject-when-not-ready', async () => {
    const video = await seedVideo(VideoStatus.PROCESSING);

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_token}/playback`)
      .expect(409);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_READY');
  });

  it('reject-unknown-id', async () => {
    const res = await request(app.getHttpServer())
      .get('/videos/unknown-token/playback')
      .expect(404);
    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });

  it('anonymous-ready-video', async () => {
    const video = await seedVideo(VideoStatus.READY);

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_token}/playback`)
      .expect(200);

    expect((res.body as UrlBody).url).toBeDefined();
  });
});
