import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { VIDEO_QUEUE } from './videos.constants';
import { Video } from './entities/video.entity';
import { StorageService } from './storage/storage.service';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ChannelsModule,
    BullModule.registerQueue({ name: VIDEO_QUEUE }),
  ],
  controllers: [VideosController],
  providers: [VideosService, StorageService],
  exports: [TypeOrmModule, VideosService, StorageService],
})
export class VideosModule {}
