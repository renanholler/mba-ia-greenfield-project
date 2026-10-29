import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video } from './video.entity';
import { VideoStatus } from './video-status';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let userCounter = 0;

  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: 'Channel',
        nickname: `chan_${userCounter}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(
    channelId: string,
    overrides: Partial<Video> = {},
  ): Video {
    return videoRepository.create({
      channel_id: channelId,
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: '1024',
      object_key: `videos/${channelId}/clip.mp4`,
      ...overrides,
    });
  }

  it('should persist draft status, generated uuid id, and opaque public_token distinct from id', async () => {
    const channel = await createChannel();

    const saved = await videoRepository.save(buildVideo(channel.id));

    expect(saved.id).toBeDefined();
    expect(saved.status).toBe(VideoStatus.DRAFT);
    expect(saved.public_token).toHaveLength(64);
    expect(saved.public_token).not.toBe(saved.id);
  });

  it('should fail when channel_id does not exist', async () => {
    await expect(
      videoRepository.save(buildVideo('00000000-0000-4000-8000-000000000099')),
    ).rejects.toThrow();
  });

  it('should allow null thumbnail_object_key, duration_seconds, multipart_upload_id, and failure_reason', async () => {
    const channel = await createChannel();

    const saved = await videoRepository.save(buildVideo(channel.id));

    expect(saved.thumbnail_object_key).toBeNull();
    expect(saved.duration_seconds).toBeNull();
    expect(saved.multipart_upload_id).toBeNull();
    expect(saved.failure_reason).toBeNull();
  });

  it('should enforce unique public_token across videos', async () => {
    const channel = await createChannel();

    const first = await videoRepository.save(buildVideo(channel.id));
    const second = await videoRepository.save(buildVideo(channel.id));

    expect(second.public_token).not.toBe(first.public_token);
    expect(second.id).not.toBe(first.id);

    await expect(
      videoRepository.save(
        buildVideo(channel.id, { public_token: first.public_token }),
      ),
    ).rejects.toThrow();
  });
});
