import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from '../config/database.config';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { envValidationSchema } from '../config/env.validation';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { VIDEO_QUEUE } from './videos.constants';
import { Video } from './entities/video.entity';
import { StorageService } from './storage/storage.service';
import { VideoMediaService } from './video-media.service';
import { VideoProcessor } from './video.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, storageConfig, queueConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres' as const,
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        /** Video's relations must resolve even though the worker only queries videos */
        entities: [Video, Channel, User],
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([Video]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [queueConfig.KEY],
      useFactory: (queue: ConfigType<typeof queueConfig>) => ({
        connection: {
          host: queue.host,
          port: queue.port,
        },
      }),
    }),
    BullModule.registerQueue({ name: VIDEO_QUEUE }),
  ],
  providers: [StorageService, VideoMediaService, VideoProcessor],
})
export class VideosWorkerModule {}
