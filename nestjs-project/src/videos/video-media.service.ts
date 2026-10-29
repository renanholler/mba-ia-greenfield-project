import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type { VideoMetadata } from './entities/video-metadata';

const execFileAsync = promisify(execFile);

export type VideoProbeResult = {
  durationSeconds: number;
  metadata: VideoMetadata;
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
};

type FfprobeOutput = {
  format?: { duration?: string; format_name?: string; bit_rate?: string };
  streams?: FfprobeStream[];
};

function toNumberOrNull(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** ffprobe reports frame rates as fractions such as "30000/1001" */
function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [numerator, denominator] = value.split('/').map(Number);
  if (!denominator || !Number.isFinite(numerator)) return null;
  return Math.round((numerator / denominator) * 100) / 100;
}

export function parseProbeOutput(stdout: string): VideoProbeResult {
  const probe = JSON.parse(stdout) as FfprobeOutput;
  const duration = toNumberOrNull(probe.format?.duration);
  if (duration === null || duration < 0) {
    throw new Error(`Could not parse duration from ffprobe: ${stdout}`);
  }

  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');

  return {
    durationSeconds: Math.round(duration),
    metadata: {
      format_name: probe.format?.format_name ?? null,
      bit_rate: toNumberOrNull(probe.format?.bit_rate),
      width: video?.width ?? null,
      height: video?.height ?? null,
      frame_rate: parseFrameRate(video?.avg_frame_rate),
      video_codec: video?.codec_name ?? null,
      audio_codec: audio?.codec_name ?? null,
    },
  };
}

@Injectable()
export class VideoMediaService {
  async probe(videoPath: string): Promise<VideoProbeResult> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      videoPath,
    ]);
    return parseProbeOutput(stdout);
  }

  async extractThumbnailJpeg(videoPath: string): Promise<Buffer> {
    const workDir = await mkdtemp(join(tmpdir(), 'streamtube-thumb-'));
    const thumbnailPath = join(workDir, 'thumb.jpg');
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        videoPath,
        '-ss',
        '00:00:01',
        '-vframes',
        '1',
        thumbnailPath,
      ]);
      return await readFile(thumbnailPath);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
