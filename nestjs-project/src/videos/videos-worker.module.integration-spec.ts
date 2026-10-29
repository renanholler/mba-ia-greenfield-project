import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Video } from './entities/video.entity';
import { VideoProcessor } from './video.processor';
import { VideosWorkerModule } from './videos-worker.module';

describe('VideosWorkerModule (integration)', () => {
  let moduleRef: TestingModule;

  afterAll(async () => {
    await moduleRef?.close();
  });

  // compile() opens the real DataSource without init(), so the BullMQ worker
  // never starts consuming the shared queue during the test run.
  it('connects to the real database with every entity Video relates to', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [VideosWorkerModule],
    }).compile();

    const videoRepository = moduleRef.get<Repository<Video>>(
      getRepositoryToken(Video),
    );
    await expect(
      videoRepository.find({ relations: ['channel'], take: 1 }),
    ).resolves.toBeInstanceOf(Array);
    expect(moduleRef.get(VideoProcessor)).toBeInstanceOf(VideoProcessor);
  });
});
