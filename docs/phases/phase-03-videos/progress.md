# phase-03-videos — Progress

**Status:** completed
**SIs:** 9/9 completed

### SI-03.1 — Preparar storage, fila e worker
- **Status:** completed
- **Tests:** 3 passing (2 storage presign unit + 1 worker module integration)
- **Observations:**
  - Installed `@nestjs/bullmq` at `^11.0.5`. The plan names the package and does not pin a version.
  - The official `minio/minio` image and `dl.min.io` are unavailable. The Compose storage service is `bitnamilegacy/minio:2025.7.23-debian-12-r5` (S3 API on port 9000). The broker host is the Compose service `redis`.
  - The existing `env.validation.integration-spec.ts` fixture now includes the new required storage and queue variables so the SWAGGER_ENABLED suite still validates.
  - A host-side smoke run (upload from the host, real FFmpeg in the worker) found two gaps the suites did not cover. Presigned URLs carried `storage:9000`, which does not resolve outside Docker, so they are now signed against `STORAGE_PUBLIC_ENDPOINT` (`http://localhost:9000` in Compose). The worker's DataSource also failed to start because `autoLoadEntities` only knew `Video`; it now lists `Video`, `Channel` and `User` explicitly, and `videos-worker.module.integration-spec.ts` boots it against the real database.
  - `video-worker` has `restart: unless-stopped`, so it recovers on a fresh clone where it starts before `npm install` has populated `node_modules`.
  - e2e suites that PUT to a signed URL run inside the Compose network, so `videos-complete.e2e-spec.ts` points `STORAGE_PUBLIC_ENDPOINT` back to the internal endpoint.

### SI-03.2 — Criar a entidade Video
- **Status:** completed
- **Tests:** 6 passing
- **Observations:**
  - `public_token` is 32 random bytes encoded as hex, generated on insert. It is not the uuid primary key.
  - `size_bytes` is typed as `string` because TypeORM reads a PostgreSQL `bigint` as a string.
  - `migration:generate` against an empty migrations history produced a full-schema file; the migration was rewritten to only create `videos` (PK, unique `public_token`, FK `channel_id`, nullable processing fields).
  - `title` (required at initiate) and `metadata` (jsonb, filled by the worker) were added to `CreateVideos` itself rather than a follow-up migration, since the migration had not reached `dev` yet.
  - The migration integration test drops tables in foreign-key order and drops the verification enum. A parallel drop deadlocked once `videos` referenced `channels`.

### SI-03.3 — Iniciar o upload
- **Status:** completed
- **Tests:** 11 passing (5 unit/integration + 6 e2e)
- **Observations:**
  - Installed `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. StorageService ensures both buckets exist on module init.
  - `MAX_UPLOAD_BYTES` lives in `videos.constants.ts` so unit tests do not import class-validator DTOs.

### SI-03.4 — Assinar as partes do upload
- **Status:** completed
- **Tests:** 15 related passing (service suites + 5 e2e)
- **Observations:** none

### SI-03.5 — Concluir o upload e enfileirar o processamento
- **Status:** completed
- **Tests:** 18 related passing (13 service + 5 e2e)
- **Observations:**
  - `bullmq` (`^6.5.1`) is a direct dependency because the code imports `Job` and `Queue` from it. `ioredis` (`^5.11.1`) is declared too: BullMQ 6 lists it as an optional peer and fails at connect time without it.
  - `complete` maps API `part_number` to storage `partNumber` before CompleteMultipartUpload.
  - The job is enqueued with `VIDEO_PROCESSING_JOB_OPTIONS` (3 attempts, exponential backoff starting at 5s), so the queue does the retrying described in TD-05.

### SI-03.6 — Processar duração e thumbnail no worker
- **Status:** completed
- **Tests:** 10 passing (4 processor unit + 3 probe-parsing unit + 3 integration)
- **Observations:**
  - `VideoMediaService.probe` runs `ffprobe -show_format -show_streams -of json` once; `parseProbeOutput` turns it into `duration_seconds` plus `metadata` (format, bitrate, width, height, frame rate, video/audio codec). The API image has no FFmpeg, so the parser is unit-tested and the binary was exercised by the host-side smoke run (640x360 h264/aac sample → `ready`, 4s, thumbnail written).
  - Worker entrypoint is `src/worker.ts` via Compose `video-worker` (not the API process). `VideoProcessor` lives only in `VideosWorkerModule`.
  - On a failed attempt with attempts left, the processor rethrows and the row stays `processing`. Only the last attempt writes `failed` and `failure_reason`.

### SI-03.7 — Consultar o vídeo pela URL única
- **Status:** completed
- **Tests:** e2e videos-id 5 passing (+ service unit coverage)
- **Observations:**
  - The response now carries `title` and `metadata`.
  - JwtAuthGuard optionally attaches `request.user` on `@Public()` routes so owners can see non-ready videos.

### SI-03.8 — Entregar a URL de streaming
- **Status:** completed
- **Tests:** e2e videos-playback 4 passing
- **Observations:**
  - Smoke run from the host: a `Range: bytes=0-99` GET on the playback URL returned `206` with `Content-Range: bytes 0-99/<size>`.

### SI-03.9 — Entregar a URL de download
- **Status:** completed
- **Tests:** e2e videos-download 4 passing
- **Observations:**
  - Smoke run from the host: the download URL returned the full object with `Content-Disposition: attachment; filename="<original_filename>"`.
