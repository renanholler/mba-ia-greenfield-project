---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-29
scope_description: "Backend video phase: queue, direct-to-storage upload up to 10GB, bucket layout, FFmpeg worker packaging, status lifecycle, unique URL, and streaming/download."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — API, queue, FFmpeg worker, object storage, and the videos table. NestJS `^11.0.1` is installed. BullMQ, pg-boss, Redis, and the AWS S3 SDK are not.
- `next-frontend/` — no open decision. The video UI is out of this phase. The C4 diagram already sends playback from the browser to object storage; this phase only defines the API contract that a later phase will call.

Object storage product is not a decision. The architecture diagram already fixes S3-compatible storage, MinIO locally. What is open is how the bucket is laid out and how bytes move.

Context7, checked against the installed NestJS 11 line: `@nestjs/bullmq` registers a Redis connection and retries a failed job by `attempts` / `backoff` (`WorkerHost.process` rejection). pg-boss stores jobs in PostgreSQL (`SKIP LOCKED`, polling worker, exponential backoff) and does not use Redis. Amazon S3 allows a single PUT up to 5 GB; multipart upload is the API for larger objects (parts 5 MiB–5 GiB, up to 10,000 parts).

---

## TD-01: Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The C4 diagram leaves the message queue as TBD. Processing a video (ffprobe + thumbnail) must not run inside the upload request. Phase 02 avoided Redis only for auth tokens ("PostgreSQL already suffices" for refresh-token rotation). That does not forbid a later Redis used as a job broker. Depends on nothing above. TD-05 uses this choice for retries.

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)

- API enqueues a job after the upload completes. A separate worker process runs a `WorkerHost`. Failed jobs retry from `attempts` and `backoff` on the queue. Requires a Redis service on the Compose network.
- **Pros:** Matches the project's NestJS queue rule (`micro-use-queues`). Context7 shows the worker and the retry settings as first-class. Long FFmpeg jobs stay off the OLTP database.
- **Cons:** New container and new env keys (`REDIS_HOST` must be the Compose service name). One more thing to run in tests.

### Option B: pg-boss on the existing PostgreSQL 17

- Jobs live in Postgres tables. Workers poll with `SKIP LOCKED`. Retries use pg-boss backoff. No Redis.
- **Pros:** No new datastore. A job can be inserted in the same transaction as the video row. Fits the Phase 02 preference to keep state in PostgreSQL.
- **Cons:** Queue traffic shares the auth and video database. Polling (default about 2s, or `LISTEN/NOTIFY`) is a worse fit for a slow FFmpeg worker than a dedicated broker. Not what the NestJS queue rule in this repo documents.

### Option C: Table outbox polled by the worker, no queue library

- A row marks "ready to process". The worker selects it on an interval and updates status itself.
- **Pros:** No new dependency. Easy to read in SQL.
- **Cons:** Retry, locking, and concurrent workers are hand-rolled. The phase asks for a real queue, and this is the weakest form of one.

**Recommendation:** **Option A (BullMQ + Redis)** — FFmpeg runs for a long time; the broker should not be the same Postgres that serves auth. The repo's own NestJS rule already points at `@nestjs/bullmq`, and Phase 02's "no Redis" line was about tokens, not about this phase.

**Decision:** A
**Libraries:** @nestjs/bullmq, bullmq

---

## TD-02: Upload Protocol for Files up to 10GB

**Scope:** Backend

**Capability:** Transversal — covers: Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** Context7 / Amazon S3: a single PUT stops at 5 GB. A 10GB file cannot use one PUT. The challenge rejects holding the file on the API. The draft row has to exist when the upload starts, before any byte is stored. Passing the body through Nest is not an option here.

**Options:**

### Option A: S3 multipart with a presigned URL per part

- The API creates the video as `draft`, calls `CreateMultipartUpload`, and returns a presigned `UploadPart` URL per part. The client sends bytes to MinIO. The API then `CompleteMultipartUpload` and enqueues processing. The API never reads the file.
- **Pros:** Covers 10GB on the S3 API the project already chose. Draft exists at initiate, which is the pre-register capability. Same shape locally (MinIO) and on AWS later.
- **Cons:** The client must speak multipart (part size, ETags, complete). An abandoned upload leaves parts until abort.

### Option B: tus in front of S3

- A resumable tus endpoint accepts the file and writes it to S3. Resume is built into the protocol.
- **Pros:** Pause and resume without the client implementing S3 part ETags.
- **Cons:** Extra server or library in front of storage the phase does not need. Two protocols to test (tus and S3) instead of one.

**Recommendation:** **Option A (presigned multipart)** — 10GB forces multipart on S3, and the draft row is created in the same initiate call. tus adds a protocol this phase does not require.

**Decision:** A
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

---

## TD-03: Object Storage Layout

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The product is fixed (MinIO now, S3 later). The open choice is how originals and thumbnails are separated. Bucket names show up in Compose, env, and the key builder, so this is a cross-file contract, not a private naming detail.

**Options:**

### Option A: Two private buckets, `videos` and `thumbnails`

- Originals and generated images live in different buckets. Both stay private; access is only via presigned URLs (TD-07).
- **Pros:** Lifecycle and policy can differ later (original vs image) without rewriting keys. Matches the two artifacts the capability names.
- **Cons:** Compose must create two buckets. One more name in env.

### Option B: One private bucket, prefixes `original/` and `thumbnails/`

- A single bucket, keys split by prefix.
- **Pros:** One bucket to create. Fewer env vars.
- **Cons:** Original and thumbnail share one policy. A prefix mistake mixes the two.

**Recommendation:** **Option A (two buckets)** — the phase stores two different artifacts, and separating them in the bucket name keeps later lifecycle rules from depending on prefix conventions.

**Decision:** A

---

## TD-04: Worker Packaging

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The diagram already shows a Video Worker container, distinct from the API, that reads storage and updates the database. The challenge fixes the tool: FFmpeg and ffprobe. Which Node wrapper calls the binary is an implement detail. What is open is whether that binary sits in the API image or in its own image.

**Options:**

### Option A: Dedicated worker image with FFmpeg, own Compose service

- A second image installs ffmpeg/ffprobe and runs only the worker command. The API image does not include FFmpeg. The service shares the Compose network (`db`, Redis from TD-01, MinIO).
- **Pros:** The API container stays a HTTP process. The worker can be scaled without shipping FFmpeg on every API replica. Matches the diagram's separate container.
- **Cons:** Two Dockerfiles (or a second target) to maintain.

### Option B: Same image as the API, different command

- One image includes FFmpeg. Compose runs it twice: `start:prod` and a worker command.
- **Pros:** One build. Worker and API always share the same Node dependencies.
- **Cons:** Every API replica carries FFmpeg. A worker-only change rebuilds the API image.

**Recommendation:** **Option A (dedicated worker image)** — the API does not transcode, and the diagram already treats the worker as its own container.

**Decision:** A

---

## TD-05: Status Lifecycle and Failure

**Scope:** Backend

**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The row exists before bytes arrive (TD-02) and only becomes playable after ffprobe and the thumbnail succeed. Retry behavior depends on TD-01: BullMQ `attempts` / `backoff`, or pg-boss retry, or a hand-rolled loop if TD-01 is the outbox. This TD decides the states and what "failed" means, not the retry library.

**Options:**

### Option A: `draft` → `processing` → `ready` | `failed`, object kept

- `draft` means the upload has been initiated and not completed. `processing` starts only after complete, when the job is enqueued. The queue retries. After retries are exhausted the row is `failed` and the original stays in the bucket.
- **Pros:** Matches "draft at start" without a second in-progress state. A failed video can be inspected. Playback stays impossible until `ready`.
- **Cons:** Abandoned drafts and failed objects occupy storage until a later cleanup (out of this phase).

### Option B: Extra `uploading` state, distinct from `draft`

- `uploading` while parts are in flight, `draft` only if the user saved metadata before sending bytes.
- **Pros:** Separates "user intent" from "bytes in flight" if a later phase adds a metadata form before the file.
- **Cons:** This phase has no screen and no pre-file metadata step. The extra state has nothing to mean yet.

### Option C: On failure, delete the object and the row

- Terminal failure removes the stored original and the video row.
- **Pros:** No leftover objects.
- **Cons:** The failure disappears. Debugging a bad file or a worker bug requires reproducing the upload.

**Recommendation:** **Option A (**`draft` **→** `processing` **→** `ready` **|** `failed`**, object kept)** — the draft is the pre-register, processing starts only after the multipart complete, and a failed object is evidence rather than a silent delete.

**Decision:** A

---

## TD-06: Unique Video URL

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** The entity rule already requires a UUID primary key. The public playback path still needs a segment that cannot collide with another video. This phase does not include the watch page; it only chooses what the API treats as the unique URL.

**Options:**

### Option A: The video UUID is the public URL segment

- `GET` playback and download use the primary key. Uniqueness is the primary key constraint.
- **Pros:** No second identifier to generate or index. UUID v4 is not enumerable. Aligns with the entity convention already in force.
- **Cons:** The public URL is the internal id. Rotating the link means changing the primary key, which this phase does not need.

### Option B: Separate opaque token, distinct from the primary key

- A second unique column (random token) is the path segment. The UUID stays internal.
- **Pros:** The public link can be rotated later without rewriting foreign keys.
- **Cons:** Extra unique column and lookup for a rotation feature no capability in this phase asks for.

**Recommendation:** **Option A (UUID as the URL segment)** — uniqueness is already guaranteed by the primary key, and this phase does not ask to rotate links.

**Decision:** B

Choice B overrides the recommendation. The public path segment is a separate opaque token. The UUID primary key stays internal and is not the route segment.

---

## TD-07: Streaming and Download

**Scope:** Backend

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** The C4 diagram draws the browser streaming from object storage, not from the API. The file can be 10GB. S3 and MinIO honor HTTP Range on GET. Download is the same bytes with a different content disposition. Depends on TD-03 (which bucket) and TD-06 (which public segment is in the path). The API still authenticates the caller before it mints the URL; anonymous vs owner rules are an implement detail on top of this transport.

**Options:**

### Option A: Short-lived presigned GET; the client talks to storage

- The API checks auth and status `ready`, then returns a presigned GET. The player sends `Range` to MinIO and receives 206. Download is a second presigned GET with `Content-Disposition: attachment`, or the same URL with that response override.
- **Pros:** Matches the diagram (frontend → storage). The API does not proxy 10GB. Range/206 is the storage server's job, which is what the challenge cites.
- **Cons:** The client must be allowed to reach MinIO's public endpoint. A leaked URL works until it expires.

### Option B: The API proxies the object with 206

- The client only talks to Nest. The API opens the object and forwards ranges.
- **Pros:** Storage stays unreachable from the browser. One origin.
- **Cons:** Up to 10GB flows through the API process. That repeats the failure mode the upload decision is avoiding, on the read path.

**Recommendation:** **Option A (presigned GET)** — playback already points at storage in the diagram, and proxying a 10GB object through Nest fights the same constraint as the upload.

**Decision:** A
**Libraries:** @aws-sdk/s3-request-presigner

---

## Decisions Summary

| ID    | Scope   | Decision                     | Recommendation                                        | Choice |
| ----- | ------- | ---------------------------- | ----------------------------------------------------- | ------ |
| TD-01 | Backend | Queue technology             | A — BullMQ + Redis                                    | _[A]_  |
| TD-02 | Backend | Upload protocol up to 10GB   | A — presigned S3 multipart                            | _[A]_  |
| TD-03 | Backend | Object storage layout        | A — buckets `videos` and `thumbnails`                 | _[A]_  |
| TD-04 | Backend | Worker packaging             | A — dedicated FFmpeg image                            | _[A]_  |
| TD-05 | Backend | Status lifecycle and failure | A — draft → processing → ready \| failed, object kept | _[A]_  |
| TD-06 | Backend | Unique video URL             | A — UUID as the URL segment                           | _[B]_  |
| TD-07 | Backend | Streaming and download       | A — presigned GET, Range on storage                   | _[A]_  |
