---
libs:
  "@nestjs/bullmq":
    version: "^11.0.5"
    context7_id: "/nestjs/docs.nestjs.com"
    fetched_at: "2026-10-29T12:51:42-03:00"
  bullmq:
    version: "^6.5.1"
    context7_id: "/taskforcesh/bullmq/v6.3.11"
    fetched_at: "2026-10-29T12:51:42-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1159.0"
    context7_id: "/aws/aws-sdk-js-v3/v3.1153.0"
    fetched_at: "2026-10-29T12:51:42-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1159.0"
    context7_id: "/aws/aws-sdk-js-v3/v3.1153.0"
    fetched_at: "2026-10-29T12:51:42-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-29T18:03:51-03:00"
---

# phase-03-videos — Library References

Distilled docs for libraries decided in this slice. Pulled via Context7. Re-fetch when the underlying TD changes (resolve refreshes this file when the lib set in `## Decisions Index` drifts from the cached set here).

**Version note:** Context7 has no snapshot for the exact installed versions. `bullmq` docs are from `v6.3.11` (installed `6.5.1`, same major) and the AWS SDK docs are from `v3.1153.0` (installed `3.1159.0`, same minor line). The APIs below were checked against the installed type definitions in `node_modules`.

FFmpeg / ffprobe (TD-04) is a system binary installed in `Dockerfile.worker`, not an npm library, so it has no entry here.

## @nestjs/bullmq

**Source:** `/nestjs/docs.nestjs.com` (Context7), "Queues" technique page. Maps to `phase-03-videos/TD-01` Decision A.

### Root connection

`BullModule.forRootAsync` registers the Redis connection once. The factory reads typed config, so the host is the Compose service name (`redis`), never `localhost`.

```typescript
BullModule.forRootAsync({
  inject: [queueConfig.KEY],
  useFactory: (queue: ConfigType<typeof queueConfig>) => ({
    connection: { host: queue.host, port: queue.port },
  }),
});
```

The API (`AppModule`) and the worker (`VideosWorkerModule`) each call `forRootAsync` because they are separate processes.

### Registering and injecting a queue

```typescript
BullModule.registerQueue({ name: VIDEO_QUEUE });

constructor(@InjectQueue(VIDEO_QUEUE) private readonly videoQueue: Queue) {}
```

### Consumer

A consumer is a class decorated with `@Processor(queueName)` that extends `WorkerHost` and implements `process(job)`. The returned promise resolves on success. A rejection (thrown error) marks the attempt failed and lets BullMQ retry it when `attempts` remains.

```typescript
@Processor(VIDEO_QUEUE)
export class VideoProcessor extends WorkerHost {
  async process(job: Job<VideoProcessingJobData>): Promise<void> { /* ... */ }
}
```

Only `VideosWorkerModule` lists `VideoProcessor` as a provider, so the API process never consumes jobs.

## bullmq

**Source:** `/taskforcesh/bullmq/v6.3.11` (Context7). Maps to `phase-03-videos/TD-01` Decision A and `phase-03-videos/TD-05` Decision A (retry before `failed`).

### Redis client

BullMQ 6 declares `ioredis` as an optional peer dependency. With a `connection: { host, port }` options object it loads `ioredis` at runtime and throws "BullMQ could not load the optional 'ioredis' package" if it is missing, so `ioredis` is declared in `package.json`.

### Retries

Retries are configured per job at `add` time:

```typescript
await queue.add(VIDEO_PROCESSING_JOB, { videoId }, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
});
```

Exponential backoff waits `2^(attemptsMade - 1) * delay` ms between attempts.

### Attempt counters

- `job.attemptsMade` increases when the processor throws any error other than the rate-limit/delayed/waiting-children control errors. During the N-th run it equals `N - 1`.
- `job.attemptsStarted` increases every time the job moves to active, including stalled re-runs.
- `job.opts.attempts` is the configured total (default `1`).

The worker uses `job.attemptsMade + 1 >= (job.opts.attempts ?? 1)` to detect the last attempt. Earlier attempts rethrow and leave the row in `processing`. Only the last one writes `failed` and `failure_reason`.

## @aws-sdk/client-s3

**Source:** `/aws/aws-sdk-js-v3/v3.1153.0` (Context7). Maps to `phase-03-videos/TD-02` Decision A and `phase-03-videos/TD-03` Decision A.

### Client for MinIO

MinIO needs path-style addressing (`http://storage:9000/<bucket>/<key>`); virtual-hosted style would resolve `<bucket>.storage`, which does not exist on the Compose network.

```typescript
new S3Client({
  endpoint: storage.endpoint,
  region: storage.region,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});
```

### Multipart upload commands

| Command | Use in `StorageService` |
|---------|-------------------------|
| `CreateMultipartUploadCommand` | Starts the upload at initiate; the returned `UploadId` is stored on the draft row |
| `UploadPartCommand` | Never sent by the API; only presigned so the client sends the bytes |
| `CompleteMultipartUploadCommand` | Called at `/complete` with the client's `{ PartNumber, ETag }[]`, in the order the client sent |
| `AbortMultipartUploadCommand` | Aborts the multipart upload when the draft row fails to save at initiate |
| `GetObjectCommand` | Worker download to a temp file; also presigned for playback/download |
| `PutObjectCommand` | Worker writes `${public_token}/thumbnail.jpg` to the thumbnails bucket |
| `HeadBucketCommand` / `CreateBucketCommand` | `ensureBucket` on module init |

S3 limits: parts of 5 MiB–5 GiB (the last part may be smaller), at most 10,000 parts, and storage rejects `CompleteMultipartUpload` when the part list is not in ascending order. The client chooses the part size and order. For a 10 GB file, any part size from 5 MiB up stays under 10,000 parts.

## @aws-sdk/s3-request-presigner

**Source:** `/aws/aws-sdk-js-v3/v3.1153.0` (Context7). Maps to `phase-03-videos/TD-02` Decision A and `phase-03-videos/TD-07` Decision A.

`getSignedUrl(client, command, { expiresIn })` signs any command without sending it. `expiresIn` is in seconds and defaults to `900`. The service uses `3600`.

```typescript
// Upload part (TD-02)
getSignedUrl(presignClient, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), { expiresIn: 3600 });

// Playback (TD-07): storage answers HTTP Range requests itself
getSignedUrl(presignClient, new GetObjectCommand({ Bucket, Key }), { expiresIn: 3600 });

// Download (TD-07): same GET with a Content-Disposition override
getSignedUrl(presignClient, new GetObjectCommand({
  Bucket, Key,
  ResponseContentDisposition: `attachment; filename="${originalFilename}"`,
}), { expiresIn: 3600 });
```

The host is part of the SigV4 signature, so a URL cannot be rewritten to another host after signing. `StorageService` therefore keeps two clients with the same credentials: `client` on `STORAGE_ENDPOINT` (`http://storage:9000`) for the API and worker's own calls, and `presignClient` on `STORAGE_PUBLIC_ENDPOINT` (`http://localhost:9000`) for every URL handed to a caller. Signing does no network I/O, so the presign client never needs to reach that host from inside the container.

From the host, a `Range: bytes=0-99` GET on a playback URL returns `206 Partial Content` from MinIO.
