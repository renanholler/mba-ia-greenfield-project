import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT!,
  accessKey: process.env.STORAGE_ACCESS_KEY!,
  secretKey: process.env.STORAGE_SECRET_KEY!,
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  videoBucket: process.env.STORAGE_VIDEO_BUCKET!,
  thumbnailBucket: process.env.STORAGE_THUMBNAIL_BUCKET!,
}));
