import { NestFactory } from '@nestjs/core';
import { VideosWorkerModule } from './videos/videos-worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(VideosWorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.enableShutdownHooks();
}

void bootstrap();
