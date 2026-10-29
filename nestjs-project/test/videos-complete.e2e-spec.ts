import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import type { VideoProcessingJobData } from '../src/videos/video.processor';
import { VIDEO_QUEUE } from '../src/videos/videos.constants';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/entities/video-status';

type ErrorBody = { statusCode: number; error: string; message: string };
type LoginBody = { access_token: string; refresh_token: string };
type UploadBody = { public_token: string; status: string };
type PartsBody = { parts: { part_number: number; url: string }[] };

describe('videos-complete', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let videoQueue: Queue<VideoProcessingJobData>;

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
    videoQueue = moduleFixture.get(getQueueToken(VIDEO_QUEUE));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await videoQueue.obliterate({ force: true });
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

  async function initiateAndUploadPart(
    accessToken: string,
  ): Promise<{ publicToken: string; etag: string }> {
    const initiated = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        original_filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: 64,
      })
      .expect(201);

    const publicToken = (initiated.body as UploadBody).public_token;
    const signed = await request(app.getHttpServer())
      .post(`/videos/${publicToken}/parts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ part_numbers: [1] })
      .expect(200);

    const putRes = await fetch((signed.body as PartsBody).parts[0].url, {
      method: 'PUT',
      body: Buffer.alloc(64, 1),
    });
    expect(putRes.ok).toBe(true);
    const etag = putRes.headers.get('etag');
    expect(etag).toBeTruthy();
    return { publicToken, etag: etag! };
  }

  it('owner-completes-draft', async () => {
    const accessToken = await registerConfirmAndLogin('complete-a@example.com');
    const { publicToken, etag } = await initiateAndUploadPart(accessToken);

    const res = await request(app.getHttpServer())
      .post(`/videos/${publicToken}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ parts: [{ part_number: 1, etag }] })
      .expect(202);

    const body = res.body as UploadBody;
    expect(body.status).toBe('processing');
    expect(body.public_token).toBe(publicToken);

    const row = await videoRepository.findOneByOrFail({
      public_token: publicToken,
    });
    expect(row.multipart_upload_id).toBeNull();
  });

  it('publishes-processing-job', async () => {
    const accessToken = await registerConfirmAndLogin('complete-b@example.com');
    const { publicToken, etag } = await initiateAndUploadPart(accessToken);

    await request(app.getHttpServer())
      .post(`/videos/${publicToken}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ parts: [{ part_number: 1, etag }] })
      .expect(202);

    const row = await videoRepository.findOneByOrFail({
      public_token: publicToken,
    });
    const jobs = await videoQueue.getJobs(['waiting', 'delayed', 'active']);
    const match = jobs.find(
      (job) => job.name === 'video.processing' && job.data?.videoId === row.id,
    );
    expect(match).toBeDefined();
    expect(match!.data.videoId).not.toBe(publicToken);
  });

  it('reject-when-not-draft', async () => {
    const accessToken = await registerConfirmAndLogin('complete-c@example.com');
    const { publicToken } = await initiateAndUploadPart(accessToken);
    await videoRepository.update(
      { public_token: publicToken },
      { status: VideoStatus.PROCESSING },
    );

    const res = await request(app.getHttpServer())
      .post(`/videos/${publicToken}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ parts: [{ part_number: 1, etag: '"x"' }] })
      .expect(409);

    expect((res.body as ErrorBody).error).toBe('UPLOAD_NOT_DRAFT');
    const jobs = await videoQueue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs).toHaveLength(0);
  });

  it('reject-other-authenticated-user', async () => {
    const ownerToken = await registerConfirmAndLogin('complete-d1@example.com');
    const otherToken = await registerConfirmAndLogin('complete-d2@example.com');
    const { publicToken, etag } = await initiateAndUploadPart(ownerToken);

    const res = await request(app.getHttpServer())
      .post(`/videos/${publicToken}/complete`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ parts: [{ part_number: 1, etag }] })
      .expect(403);

    expect((res.body as ErrorBody).error).toBe('NOT_VIDEO_OWNER');
  });

  it('reject-empty-parts', async () => {
    const accessToken = await registerConfirmAndLogin('complete-e@example.com');
    const { publicToken } = await initiateAndUploadPart(accessToken);

    const res = await request(app.getHttpServer())
      .post(`/videos/${publicToken}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ parts: [] })
      .expect(400);

    expect((res.body as ErrorBody).error).toBe('VALIDATION_ERROR');
  });
});
