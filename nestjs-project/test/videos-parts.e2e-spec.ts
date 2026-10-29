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
import { Video } from '../src/videos/entities/video.entity';
import { VideoStatus } from '../src/videos/entities/video-status';

type ErrorBody = { statusCode: number; error: string; message: string };
type LoginBody = { access_token: string; refresh_token: string };
type UploadBody = { public_token: string };
type PartsBody = { parts: { part_number: number; url: string }[] };

describe('videos-parts', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;

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

  async function initiateDraft(accessToken: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Clip',
        original_filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: 1024,
      })
      .expect(201);
    return (res.body as UploadBody).public_token;
  }

  it('owner-receives-presigned-urls', async () => {
    const accessToken = await registerConfirmAndLogin(
      'parts-owner@example.com',
    );
    const publicToken = await initiateDraft(accessToken);

    const res = await request(app.getHttpServer())
      .post(`/videos/${publicToken}/parts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ part_numbers: [1, 2] })
      .expect(200);

    const body = res.body as PartsBody;
    expect(body.parts).toHaveLength(2);
    expect(body.parts[0].part_number).toBe(1);
    expect(typeof body.parts[0].url).toBe('string');
    expect(body.parts[1].part_number).toBe(2);

    const row = await videoRepository.findOneByOrFail({
      public_token: publicToken,
    });
    expect(row.status).toBe(VideoStatus.DRAFT);
  });

  it('reject-other-authenticated-user', async () => {
    const ownerToken = await registerConfirmAndLogin('parts-a@example.com');
    const otherToken = await registerConfirmAndLogin('parts-b@example.com');
    const publicToken = await initiateDraft(ownerToken);

    const res = await request(app.getHttpServer())
      .post(`/videos/${publicToken}/parts`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ part_numbers: [1] })
      .expect(403);

    expect((res.body as ErrorBody).error).toBe('NOT_VIDEO_OWNER');
  });

  it('reject-when-not-draft', async () => {
    const accessToken = await registerConfirmAndLogin('parts-proc@example.com');
    const publicToken = await initiateDraft(accessToken);
    await videoRepository.update(
      { public_token: publicToken },
      { status: VideoStatus.PROCESSING },
    );

    const res = await request(app.getHttpServer())
      .post(`/videos/${publicToken}/parts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ part_numbers: [1] })
      .expect(409);

    expect((res.body as ErrorBody).error).toBe('UPLOAD_NOT_DRAFT');
  });

  it('reject-unknown-id', async () => {
    const accessToken = await registerConfirmAndLogin('parts-miss@example.com');

    const res = await request(app.getHttpServer())
      .post('/videos/does-not-exist/parts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ part_numbers: [1] })
      .expect(404);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });

  it('reject-missing-token', async () => {
    await request(app.getHttpServer())
      .post('/videos/any/parts')
      .send({ part_numbers: [1] })
      .expect(401);
  });
});
