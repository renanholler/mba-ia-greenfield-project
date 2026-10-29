import { parseProbeOutput } from './video-media.service';

describe('parseProbeOutput (unit)', () => {
  it('extracts rounded duration and video/audio metadata', () => {
    const stdout = JSON.stringify({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30000/1001',
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: {
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        duration: '12.6',
        bit_rate: '2500000',
      },
    });

    expect(parseProbeOutput(stdout)).toEqual({
      durationSeconds: 13,
      metadata: {
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        bit_rate: 2500000,
        width: 1920,
        height: 1080,
        frame_rate: 29.97,
        video_codec: 'h264',
        audio_codec: 'aac',
      },
    });
  });

  it('returns null metadata fields when there is no audio stream', () => {
    const stdout = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'vp9', width: 640 }],
      format: { duration: '3' },
    });

    const { metadata } = parseProbeOutput(stdout);

    expect(metadata.audio_codec).toBeNull();
    expect(metadata.height).toBeNull();
    expect(metadata.frame_rate).toBeNull();
    expect(metadata.bit_rate).toBeNull();
  });

  it('throws when ffprobe reports no duration', () => {
    const stdout = JSON.stringify({ streams: [], format: {} });

    expect(() => parseProbeOutput(stdout)).toThrow(
      'Could not parse duration from ffprobe',
    );
  });
});
