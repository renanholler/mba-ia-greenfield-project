import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Channel } from '../src/channels/entities/channel.entity';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/entities/video-status';
import { StorageService } from '../src/videos/storage/storage.service';

type ErrorBody = { statusCode: number; error: string; message: string };
type LoginBody = { access_token: string; refresh_token: string };
type MeBody = { sub: string; email: string };
type VideoBody = {
  id?: string;
  public_token: string;
  title: string;
  status: string;
  duration_seconds: number | null;
  metadata: Record<string, unknown> | null;
  thumbnail_url: string | null;
  failure_reason?: string | null;
};

describe('videos-id', () => {
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

  async function registerConfirmAndLogin(email: string): Promise<string> {
    let capturedToken = '';
    jest
      .spyOn(app.get(MailService), 'sendConfirmationEmail')
      .mockImplementationOnce(
        (_email: string, _name: string, token: string) => {
          capturedToken = token;
          return Promise.resolve();
        },
      );
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'password123' });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' });
    return (res.body as LoginBody).access_token;
  }

  async function seedVideo(
    status: VideoStatus,
    extras: Partial<Video> = {},
  ): Promise<Video> {
    const user = await userRepository.save(
      userRepository.create({
        email: `id_${++counter}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Chan',
        nickname: `idchan_${counter}`,
        user_id: user.id,
      }),
    );
    const publicToken = `pub_${counter}`.padEnd(64, 'b');
    if (extras.thumbnail_object_key) {
      await storageService.putObject(
        storageService.thumbnailBucket,
        extras.thumbnail_object_key,
        Buffer.from('jpg'),
        'image/jpeg',
      );
    }
    return videoRepository.save(
      videoRepository.create({
        public_token: publicToken,
        channel_id: channel.id,
        status,
        title: 'Clip',
        original_filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: '10',
        object_key: `${publicToken}/source`,
        ...extras,
      }),
    );
  }

  it('anonymous-reads-ready-video', async () => {
    const metadata = {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      bit_rate: 1200000,
      width: 1280,
      height: 720,
      frame_rate: 30,
      video_codec: 'h264',
      audio_codec: 'aac',
    };
    const video = await seedVideo(VideoStatus.READY, {
      duration_seconds: 12,
      metadata,
      thumbnail_object_key: `thumb_${counter}.jpg`,
    });

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_token}`)
      .expect(200);

    const body = res.body as VideoBody;
    expect(body.public_token).toBe(video.public_token);
    expect(body.title).toBe('Clip');
    expect(body.status).toBe('ready');
    expect(body.duration_seconds).toBe(12);
    expect(body.metadata).toEqual(metadata);
    expect(typeof body.thumbnail_url).toBe('string');
    expect(body.id).toBeUndefined();
  });

  it('anonymous-cannot-read-unready-video', async () => {
    const video = await seedVideo(VideoStatus.DRAFT);

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.public_token}`)
      .expect(404);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });

  it('owner-reads-failure-reason', async () => {
    const accessToken = await registerConfirmAndLogin('owner-fail@example.com');
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const channel = await channelRepository.findOneByOrFail({
      user_id: (me.body as MeBody).sub,
    });
    const publicToken = `failtok`.padEnd(64, 'c');
    await videoRepository.save(
      videoRepository.create({
        public_token: publicToken,
        channel_id: channel.id,
        status: VideoStatus.FAILED,
        title: 'Clip',
        original_filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: '10',
        object_key: `${publicToken}/source`,
        failure_reason: 'ffmpeg crashed',
      }),
    );

    const res = await request(app.getHttpServer())
      .get(`/videos/${publicToken}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect((res.body as VideoBody).failure_reason).toBe('ffmpeg crashed');
  });

  it('reject-unknown-id', async () => {
    const res = await request(app.getHttpServer())
      .get('/videos/missing-token-value-here')
      .expect(404);
    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });

  it('reject-internal-uuid', async () => {
    const video = await seedVideo(VideoStatus.READY, { duration_seconds: 1 });

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.id}`)
      .expect(404);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });
});
