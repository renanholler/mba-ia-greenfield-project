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
import { MAX_UPLOAD_BYTES } from '../src/videos/videos.constants';

type ErrorBody = { statusCode: number; error: string; message: string };
type LoginBody = { access_token: string; refresh_token: string };
type UploadBody = {
  id?: string;
  public_token: string;
  status: string;
  multipart_upload_id: string;
};

describe('videos-uploads', () => {
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

  async function registerConfirmAndLogin(
    email: string,
    password = 'password123',
  ): Promise<string> {
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
      .send({ email, password });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return (res.body as LoginBody).access_token;
  }

  const validBody = {
    original_filename: 'clip.mp4',
    content_type: 'video/mp4',
    size_bytes: 1024,
  };

  it('initiate-returns-draft', async () => {
    const accessToken = await registerConfirmAndLogin('uploader@example.com');

    const res = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody)
      .expect(201);

    const body = res.body as UploadBody;
    expect(typeof body.public_token).toBe('string');
    expect(body.public_token.length).toBeGreaterThan(0);
    expect(body.status).toBe('draft');
    expect(typeof body.multipart_upload_id).toBe('string');
    expect(body.multipart_upload_id.length).toBeGreaterThan(0);
    expect(body.id).toBeUndefined();
  });

  it('draft-row-belongs-to-caller-channel', async () => {
    const accessToken = await registerConfirmAndLogin('owner@example.com');

    const res = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validBody)
      .expect(201);

    const row = await videoRepository.findOne({
      where: { public_token: (res.body as UploadBody).public_token },
      relations: ['channel'],
    });
    expect(row).not.toBeNull();
    expect(row!.channel_id).toBe(row!.channel.id);
    expect(row!.id).not.toBe(row!.public_token);
    expect(row!.thumbnail_object_key).toBeNull();
    expect(row!.duration_seconds).toBeNull();
  });

  it('reject-over-10gb', async () => {
    const accessToken = await registerConfirmAndLogin('big@example.com');

    const res = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...validBody, size_bytes: MAX_UPLOAD_BYTES + 1 })
      .expect(400);

    const body = res.body as ErrorBody;
    expect(body).toMatchObject({
      statusCode: 400,
      error: 'UPLOAD_TOO_LARGE',
    });
    expect(typeof body.message).toBe('string');
    expect(await videoRepository.count()).toBe(0);
  });

  it('reject-missing-token', async () => {
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .send(validBody)
      .expect(401);
  });

  it('reject-empty-filename', async () => {
    const accessToken = await registerConfirmAndLogin('empty@example.com');

    const res = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...validBody, original_filename: '' })
      .expect(400);

    expect((res.body as ErrorBody).error).toBe('VALIDATION_ERROR');
  });
});
