import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { SignPartsDto } from './dto/sign-parts.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @ApiBearerAuth()
  @Post('uploads')
  @HttpCode(201)
  initiate(@CurrentUser() user: JwtPayload, @Body() dto: InitiateUploadDto) {
    return this.videosService.initiate(user.sub, dto);
  }

  @ApiBearerAuth()
  @Post(':publicToken/parts')
  @HttpCode(200)
  signParts(
    @CurrentUser() user: JwtPayload,
    @Param('publicToken') publicToken: string,
    @Body() dto: SignPartsDto,
  ) {
    return this.videosService.signParts(
      publicToken,
      user.sub,
      dto.part_numbers,
    );
  }

  @ApiBearerAuth()
  @Post(':publicToken/complete')
  @HttpCode(202)
  complete(
    @CurrentUser() user: JwtPayload,
    @Param('publicToken') publicToken: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.videosService.complete(publicToken, user.sub, dto.parts);
  }

  @Public()
  @Get(':publicToken')
  findOne(
    @Param('publicToken') publicToken: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.videosService.findOne(publicToken, user?.sub);
  }

  @Public()
  @Get(':publicToken/playback')
  playback(@Param('publicToken') publicToken: string) {
    return this.videosService.playback(publicToken);
  }

  @Public()
  @Get(':publicToken/download')
  download(@Param('publicToken') publicToken: string) {
    return this.videosService.download(publicToken);
  }
}
