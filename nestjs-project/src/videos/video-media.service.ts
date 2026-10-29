import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

@Injectable()
export class VideoMediaService {
  async extractDurationSeconds(videoPath: string): Promise<number> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    const duration = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(`Could not parse duration from ffprobe: ${stdout}`);
    }
    return Math.round(duration);
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
