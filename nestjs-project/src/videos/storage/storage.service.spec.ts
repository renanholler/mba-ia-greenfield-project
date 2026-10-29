import { StorageConfig, StorageService } from './storage.service';

function buildService(publicEndpoint: string | undefined): StorageService {
  const config: StorageConfig = {
    endpoint: 'http://storage:9000',
    publicEndpoint,
    accessKey: 'key',
    secretKey: 'secret',
    region: 'us-east-1',
    videoBucket: 'videos',
    thumbnailBucket: 'thumbnails',
  };
  return new StorageService(config);
}

describe('StorageService presigning (unit)', () => {
  it('signs GET and upload-part URLs with the public endpoint', async () => {
    const service = buildService('http://localhost:9000');

    const getUrl = new URL(
      await service.presignGetObject('videos', 'tok/source'),
    );
    const partUrl = new URL(
      await service.presignUploadPart('tok/source', 'upload-1', 1),
    );

    expect(getUrl.origin).toBe('http://localhost:9000');
    expect(getUrl.pathname).toBe('/videos/tok/source');
    expect(partUrl.origin).toBe('http://localhost:9000');
    expect(partUrl.searchParams.get('partNumber')).toBe('1');
  });

  it('falls back to the internal endpoint when no public endpoint is set', async () => {
    const service = buildService(undefined);

    const url = new URL(await service.presignGetObject('videos', 'tok/source'));

    expect(url.origin).toBe('http://storage:9000');
  });
});
