---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-29T01:15:25-03:00"
  docs/project-plan.md: "2026-10-29T00:00:07-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-29T01:01:53-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-29T00:00:07-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-29T00:00:07-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-29T00:00:07-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-29T00:00:07-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, and URLs únicas geradas: armazenamento de vídeos e thumbnails, processamento em segundo plano (filas), pré-cadastro automático como rascunho, extração de duração e metadados, thumbnail a partir de um frame, reprodução via streaming sem download completo, and download pelo usuário.

---

## Step Implementations

### SI-03.1 — Preparar storage, fila e worker

**Description:** Instalar o broker da fila, os namespaces de configuração e os serviços Compose de storage, fila e worker FFmpeg, antes de existir um vídeo.

**Technical actions:**

1. Instalar `@nestjs/bullmq` em `nestjs-project` (per `phase-03-videos/TD-01`).
2. Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` com endpoint, credenciais e dois nomes de bucket, um para o objeto de vídeo e outro para o thumbnail (per `phase-03-videos/TD-03`, `phase-01-configuracao-base/TD-03`).
3. Criar `src/config/queue.config.ts` — `registerAs('queue', ...)` com o host do broker, distinto do Postgres de auth (per `phase-03-videos/TD-01`, `phase-01-configuracao-base/TD-01`).
4. Estender `src/config/env.validation.ts` com Joi para as variáveis novas (per `phase-01-configuracao-base/TD-02`) e registrar `BullModule.forRoot` a partir de `queueConfig`.
5. Adicionar ao `compose.yaml` três serviços na rede interna: object storage compatível com S3, broker da fila, e um container dedicado com FFmpeg cujo comando não é o da API (per `phase-03-videos/TD-04`). Entre serviços, o host é o nome do serviço Compose.

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- A API não sobe quando falta variável obrigatória de storage ou de fila — o bootstrap falha na validação Joi antes de escutar HTTP
- `compose.yaml` declara object storage, broker da fila e worker FFmpeg como serviços distintos de `nestjs-api`
- O host do broker na config é o nome do serviço Compose do broker, não `localhost` e não o serviço Postgres
- A config de storage expõe dois nomes de bucket distintos

---

### SI-03.2 — Criar a entidade Video

**Description:** Persistir o vídeo com o ciclo `draft` → `processing` → `ready` | `failed` e o vínculo com o canal da Fase 02.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` — `@Entity('videos')` com os campos de `### Data Model` → `Video`: `id`, `public_token`, `channel_id`, `status`, `original_filename`, `content_type`, `size_bytes`, `object_key`, `thumbnail_object_key`, `duration_seconds`, `multipart_upload_id`, `failure_reason`, `created_at`, `updated_at` (per `phase-03-videos/TD-05`, `phase-03-videos/TD-06`).
2. Declarar `@ManyToOne` de `Video` para `Channel` via `channel_id`.
3. Gerar a migration `CreateVideos` e conferir PK em `id`, unique em `public_token`, FK em `channel_id`, e nulabilidade de `thumbnail_object_key`, `duration_seconds`, `multipart_upload_id` e `failure_reason`.
4. Criar `src/videos/videos.module.ts` com `TypeOrmModule.forFeature([Video])` e exportar o repositório.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: constraints, defaults, `select: false` | `src/videos/entities/video.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Inserir um `Video` com `channel_id` de um canal existente persiste `status` default `draft`, `id` uuid gerado e `public_token` opaco distinto desse `id`
- Inserir um `Video` com `channel_id` inexistente falha na FK
- `thumbnail_object_key`, `duration_seconds`, `multipart_upload_id` e `failure_reason` aceitam null no insert inicial
- Dois vídeos podem existir; cada `public_token` é único e é o segmento público da URL. O `id` não entra na rota (per `phase-03-videos/TD-06`)

---

### SI-03.3 — Iniciar o upload

**Route:** POST /videos/uploads
**Test Specs:** see `nestjs-project/specs/videos-uploads.plan.md`
**Authorization:** Authenticated

**Description:** Criar o rascunho e abrir o multipart no bucket de vídeo no mesmo request, sem receber os bytes do arquivo.

**Technical actions:**

1. Criar `InitiateUploadDto` com `original_filename`, `content_type` e `size_bytes`, validados por class-validator (per `phase-02-auth/TD-06`).
2. No serviço, rejeitar `size_bytes` acima de 10GB com `UPLOAD_TOO_LARGE` e criar a linha `Video` em `status = draft` ligada ao canal do caller (per `phase-03-videos/TD-02`, `phase-03-videos/TD-05`).
3. Abrir o multipart no bucket de vídeo e gravar `multipart_upload_id` e `object_key` na mesma transação do rascunho.
4. Expor `POST /videos/uploads` no controller, atrás do guard de access token da Fase 02, respondendo `201` com `public_token`, `status` e `multipart_upload_id`. O `id` uuid não sai na resposta.
5. Mapear falhas de validação para `VALIDATION_ERROR` pelo filtro já existente (per `phase-02-auth/TD-07`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.initiate` | Unit: branch logic (mock repo) | `src/videos/videos.service.spec.ts` |
| `VideosService.initiate` | Integration: DB contract + local storage adapter | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.1 + SI-03.2

**Acceptance criteria:**

- `POST /videos/uploads` autenticado com `{ original_filename, content_type, size_bytes }` válidos retorna `201` com `public_token` opaco, `status: "draft"` e `multipart_upload_id`. O corpo não traz o `id` uuid
- A linha criada tem `channel_id` do canal do caller e `thumbnail_object_key` e `duration_seconds` nulos
- `POST /videos/uploads` com `size_bytes` acima de 10GB retorna `400` com `error: "UPLOAD_TOO_LARGE"` e não insere linha
- `POST /videos/uploads` sem access token retorna `401`
- `POST /videos/uploads` com `original_filename` vazio retorna `400` com `error: "VALIDATION_ERROR"`

---

### SI-03.4 — Assinar as partes do upload

**Route:** POST /videos/:publicToken/parts
**Test Specs:** see `nestjs-project/specs/videos-parts.plan.md`
**Authorization:** Owner

**Description:** Devolver URLs pré-assinadas para as partes, para o cliente gravar o objeto direto no storage.

**Technical actions:**

1. Criar `SignPartsDto` com `part_numbers` (inteiros ≥ 1, array não vazio).
2. No serviço, exigir `status = draft` e o canal do caller; caso contrário lançar `UPLOAD_NOT_DRAFT`, `NOT_VIDEO_OWNER` ou `VIDEO_NOT_FOUND` (per `phase-03-videos/TD-02`).
3. Gerar uma URL pré-assinada por `part_number` no bucket de vídeo, sem receber bytes na API.
4. Expor `POST /videos/:publicToken/parts` respondendo `200` com `parts: [{ part_number, url }]`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.signParts` | Unit: branch logic (mock repo) | `src/videos/videos.service.spec.ts` |
| `VideosService.signParts` | Integration: DB contract + local storage adapter | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.3

**Acceptance criteria:**

- `POST /videos/:publicToken/parts` do dono, com o vídeo em `draft` e `part_numbers: [1, 2]`, retorna `200` com duas URLs e não altera `status`
- `POST /videos/:publicToken/parts` de outro usuário autenticado retorna `403` com `error: "NOT_VIDEO_OWNER"`
- `POST /videos/:publicToken/parts` com status diferente de `draft` retorna `409` com `error: "UPLOAD_NOT_DRAFT"`
- `POST /videos/:publicToken/parts` com `publicToken` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `POST /videos/:publicToken/parts` sem access token retorna `401`

---

### SI-03.5 — Concluir o upload e enfileirar o processamento

**Route:** POST /videos/:publicToken/complete
**Test Specs:** see `nestjs-project/specs/videos-complete.plan.md`
**Authorization:** Owner

**Description:** Fechar o multipart, passar o vídeo para `processing` e publicar o job `video.processing`.

**Technical actions:**

1. Criar `CompleteUploadDto` com `parts: [{ part_number, etag }]`, array não vazio.
2. No serviço, repetir as guardas de dono e de `status = draft` com `NOT_VIDEO_OWNER`, `VIDEO_NOT_FOUND` e `UPLOAD_NOT_DRAFT`.
3. Completar o multipart no bucket de vídeo com os `etag` recebidos e só então gravar `status = processing`, limpando `multipart_upload_id` (per `phase-03-videos/TD-05`).
4. Publicar o job `video.processing` com payload `{ "videoId": "uuid" }` depois da transição, com `attempts` e `backoff` exponencial (per `phase-03-videos/TD-01`, `phase-03-videos/TD-05`).
5. Expor `POST /videos/:publicToken/complete` respondendo `202` com `public_token` e `status: "processing"`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.complete` | Unit: branch logic (mock repo) | `src/videos/videos.service.spec.ts` |
| `VideosService.complete` | Integration: DB contract + local storage adapter | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.1 + SI-03.4

**Acceptance criteria:**

- `POST /videos/:publicToken/complete` do dono, com o vídeo em `draft` e `parts` válidos, retorna `202` com `status: "processing"` e `multipart_upload_id` nulo na linha
- A conclusão publica uma mensagem `video.processing` cujo payload é `{ "videoId": "<uuid interno>" }`. O segmento da rota não entra no payload
- `POST /videos/:publicToken/complete` com status diferente de `draft` retorna `409` com `error: "UPLOAD_NOT_DRAFT"` e não publica job
- `POST /videos/:publicToken/complete` de outro usuário autenticado retorna `403` com `error: "NOT_VIDEO_OWNER"`
- `POST /videos/:publicToken/complete` com `parts` vazio retorna `400` com `error: "VALIDATION_ERROR"`

---

### SI-03.6 — Processar duração e thumbnail no worker

**Description:** Consumir `video.processing` num container FFmpeg separado, gravar duração e thumbnail, e marcar `ready` ou `failed` sem apagar o objeto.

**Technical actions:**

1. Criar o consumer `video.processing` no processo do worker, lendo `{ "videoId": "uuid" }` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`).
2. No sucesso, gravar `duration_seconds`, escrever um frame no bucket de thumbnail em `thumbnail_object_key` e setar `status = ready`.
3. No fracasso, relançar o erro enquanto houver tentativas para a fila refazer o job. Na última tentativa, setar `status = failed` e `failure_reason`, mantendo `object_key` no bucket de vídeo (per `phase-03-videos/TD-05`).
4. Tratar reentrega at-least-once: se o vídeo já está `ready` ou `failed`, o consumer não reprocessa o objeto.
5. Subir o worker pelo comando do serviço Compose dedicado, não pelo comando da API (per `phase-03-videos/TD-04`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessor` | Unit: branch logic (mock repo) | `src/videos/video.processor.spec.ts` |
| `VideoProcessor` | Integration: DB contract | `src/videos/video.processor.integration-spec.ts` |

**Dependencies:** SI-03.1 + SI-03.2

**Acceptance criteria:**

- Um job `video.processing` de um vídeo em `processing` termina com `status = ready`, `duration_seconds` preenchido e `thumbnail_object_key` apontando para o bucket de thumbnail
- Uma tentativa que falha na extração, com tentativas restantes, relança o erro e mantém `status = processing`
- Um job que falha na extração na última tentativa termina com `status = failed`, `failure_reason` preenchido e o objeto de vídeo ainda no bucket
- Reentregar o job de um vídeo já `ready` não altera `duration_seconds` nem `thumbnail_object_key`
- O processo que consome a fila não é o processo HTTP da API

---

### SI-03.7 — Consultar o vídeo pela URL única

**Route:** GET /videos/:publicToken
**Test Specs:** see `nestjs-project/specs/videos-id.plan.md`
**Authorization:** Anonymous

**Description:** Expor o vídeo pelo `public_token`. O uuid fica interno. Anônimo só vê `ready`; o dono vê qualquer status.

**Technical actions:**

1. No serviço, retornar `404 VIDEO_NOT_FOUND` quando o `public_token` não existe, quando o caminho traz o uuid interno, ou quando o caller não é o dono e `status` não é `ready` (per `phase-03-videos/TD-06`).
2. Montar a resposta `200` com `public_token`, `status`, `duration_seconds`, `thumbnail_url` e, só para o dono em `failed`, `failure_reason`. O `id` uuid não sai na resposta.
3. Gerar `thumbnail_url` como GET pré-assinado do bucket de thumbnail quando `thumbnail_object_key` está preenchido; senão `null` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-07`).
4. Expor `GET /videos/:publicToken` sem exigir access token. Se o token vier, resolver o dono para a regra de visibilidade.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.findOne` | Unit: branch logic (mock repo) | `src/videos/videos.service.spec.ts` |
| `VideosService.findOne` | Integration: DB contract + local storage adapter | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.1 + SI-03.2

**Acceptance criteria:**

- `GET /videos/:publicToken` sem token, com o vídeo `ready`, retorna `200` com `public_token`, `status: "ready"`, `duration_seconds` e `thumbnail_url` quando `thumbnail_object_key` existe. O corpo não traz o `id` uuid
- `GET /videos/:publicToken` sem token, com o vídeo em `draft`, `processing` ou `failed`, retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:publicToken` do dono, com o vídeo `failed`, retorna `200` com `failure_reason` preenchido
- `GET /videos/:publicToken` com `publicToken` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:publicToken` com o uuid interno no lugar do token retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.8 — Entregar a URL de streaming

**Route:** GET /videos/:publicToken/playback
**Test Specs:** see `nestjs-project/specs/videos-playback.plan.md`
**Authorization:** Anonymous

**Description:** Devolver um GET pré-assinado do objeto de vídeo para o cliente transmitir direto do storage, com suporte a Range.

**Technical actions:**

1. No serviço, exigir `status = ready`; senão `VIDEO_NOT_READY`. `publicToken` inexistente responde `VIDEO_NOT_FOUND` (per `phase-03-videos/TD-07`).
2. Gerar uma URL pré-assinada de GET do `object_key` no bucket de vídeo, sem `Content-Disposition` de anexo.
3. Expor `GET /videos/:publicToken/playback` sem access token, respondendo `200` com `{ url }`. A API não faz proxy do objeto.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.playback` | Unit: branch logic (mock repo) | `src/videos/videos.service.spec.ts` |
| `VideosService.playback` | Integration: DB contract + local storage adapter | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.1 + SI-03.2

**Acceptance criteria:**

- `GET /videos/:publicToken/playback` de um vídeo `ready` retorna `200` com `url` pré-assinada do bucket de vídeo e o corpo da API não contém os bytes do arquivo
- `GET /videos/:publicToken/playback` de um vídeo que não está `ready` retorna `409` com `error: "VIDEO_NOT_READY"`
- `GET /videos/:publicToken/playback` com `publicToken` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:publicToken/playback` sem access token, com o vídeo `ready`, retorna `200`

---

### SI-03.9 — Entregar a URL de download

**Route:** GET /videos/:publicToken/download
**Test Specs:** see `nestjs-project/specs/videos-download.plan.md`
**Authorization:** Anonymous

**Description:** Devolver um GET pré-assinado do objeto de vídeo com Content-Disposition a partir de `original_filename`.

**Technical actions:**

1. Reusar a guarda de `SI-03.8`: `ready` ou `VIDEO_NOT_READY`, e `VIDEO_NOT_FOUND` quando o `public_token` não existe (per `phase-03-videos/TD-07`).
2. Gerar a URL pré-assinada de GET do `object_key` com Content-Disposition usando `original_filename`.
3. Expor `GET /videos/:publicToken/download` sem access token, respondendo `200` com `{ url }`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.download` | Unit: branch logic (mock repo) | `src/videos/videos.service.spec.ts` |
| `VideosService.download` | Integration: DB contract + local storage adapter | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.8

**Acceptance criteria:**

- `GET /videos/:publicToken/download` de um vídeo `ready` retorna `200` com `url` cujo Content-Disposition usa `original_filename`
- `GET /videos/:publicToken/download` de um vídeo que não está `ready` retorna `409` com `error: "VIDEO_NOT_READY"`
- `GET /videos/:publicToken/download` com `publicToken` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `GET /videos/:publicToken/download` sem access token, com o vídeo `ready`, retorna `200`

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated. Internal only — not the public URL segment (per phase-03-videos/TD-06, decision B) |
| public_token | varchar(64) | not null, unique. Random opaque token, generated at insert, distinct from `id`. Public URL segment (per phase-03-videos/TD-06, decision B) |
| channel_id | uuid | not null, FK → channels.id. Owning channel from Phase 02 |
| status | varchar | not null. `draft` at initiate; `processing` only after multipart complete; `ready` when the worker finishes; `failed` keeps the object (per phase-03-videos/TD-05) |
| original_filename | varchar(255) | not null. Used as the download Content-Disposition name (per phase-03-videos/TD-07) |
| content_type | varchar(255) | not null |
| size_bytes | bigint | not null. At most 10GB |
| object_key | varchar(1024) | not null. Object in the video bucket |
| thumbnail_object_key | varchar(1024) | nullable until the worker writes a frame |
| duration_seconds | integer | nullable until the worker extracts duration |
| multipart_upload_id | varchar(1024) | nullable. Set at initiate; cleared after complete |
| failure_reason | text | nullable. Set when status becomes `failed` |
| created_at | timestamptz | not null, default now() |
| updated_at | timestamptz | not null, default now() |

**Relations:** `Channel` has many `Video` (one-to-many, via `channel_id`)
**Indexes:** unique on `id` (primary key). Unique on `public_token`. Index on `channel_id`.

**Storage layout:** two private buckets, one per artifact, distinguished by bucket name — the video object and the thumbnail object do not share a bucket (per phase-03-videos/TD-03). The API does not store bytes. The client writes the video object with presigned multipart URLs (per phase-03-videos/TD-02). The worker writes the thumbnail object.

### API Contracts

#### POST /videos/uploads (SI-03.3)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer access token

**Request body:**
- original_filename: string, required — non-empty, max 255 characters
- content_type: string, required — non-empty, max 255 characters
- size_bytes: integer, required — greater than 0 and at most 10GB

**Response 201:**
- public_token: string — opaque token, the public URL segment. Not the primary key (per phase-03-videos/TD-06, decision B)
- status: `draft` — the draft row is created in this same initiate call (per phase-03-videos/TD-02, phase-03-videos/TD-05)
- multipart_upload_id: string — storage multipart id for the video-bucket object

**Error responses:**
- 400 VALIDATION_ERROR: when the body fails schema validation
- 400 UPLOAD_TOO_LARGE: when `size_bytes` is above 10GB
- 401 unauthenticated: when the access token is missing or invalid

---

#### POST /videos/:publicToken/parts (SI-03.4)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer access token

**Request body:**
- part_numbers: integer[], required — each part number ≥ 1. The API returns a presigned URL per number and does not receive file bytes (per phase-03-videos/TD-02)

**Response 200:**
- parts: array of `{ part_number: integer, url: string }` — short-lived presigned URLs for the video bucket

**Error responses:**
- 401 unauthenticated
- 403 NOT_VIDEO_OWNER: when the caller does not own the video
- 404 VIDEO_NOT_FOUND: when `publicToken` does not exist
- 409 UPLOAD_NOT_DRAFT: when status is not `draft`
- 400 VALIDATION_ERROR: when `part_numbers` is missing or empty

---

#### POST /videos/:publicToken/complete (SI-03.5)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer access token

**Request body:**
- parts: array of `{ part_number: integer, etag: string }`, required — the completed multipart parts

**Response 202:**
- public_token: string — the same opaque token used in the route
- status: `processing` — set only after the multipart complete succeeds (per phase-03-videos/TD-05)

**Error responses:**
- 401 unauthenticated
- 403 NOT_VIDEO_OWNER
- 404 VIDEO_NOT_FOUND
- 409 UPLOAD_NOT_DRAFT: when status is not `draft`
- 400 VALIDATION_ERROR: when `parts` is missing or a part has no `etag`

---

#### GET /videos/:publicToken (SI-03.7)

**Request headers:**
- Authorization: Bearer access token — optional. Anonymous callers only receive a `ready` video

**Response 200:**
- public_token: string — the opaque token from the route. The primary key is not returned
- status: `draft` | `processing` | `ready` | `failed`
- duration_seconds: integer | null
- thumbnail_url: string | null — short-lived presigned GET for the thumbnail bucket when `thumbnail_object_key` is set; otherwise null (per phase-03-videos/TD-03, phase-03-videos/TD-07)
- failure_reason: string | null — present for the owner when status is `failed`; omitted for other callers

**Error responses:**
- 404 VIDEO_NOT_FOUND: when `publicToken` does not exist, when the path segment is the internal uuid, or the caller is not the owner and status is not `ready`

---

#### GET /videos/:publicToken/playback (SI-03.8)

**Request headers:** none required

**Response 200:**
- url: string — short-lived presigned GET for the video object. The client streams from storage, including Range requests, and the API does not proxy the object (per phase-03-videos/TD-07)

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 409 VIDEO_NOT_READY: when status is not `ready`

---

#### GET /videos/:publicToken/download (SI-03.9)

**Request headers:** none required

**Response 200:**
- url: string — short-lived presigned GET for the video object with Content-Disposition set from `original_filename` (per phase-03-videos/TD-07)

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 409 VIDEO_NOT_READY: when status is not `ready`

### Authorization Matrix

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos/uploads | ✗ | ✓ | ✓ |
| POST /videos/:publicToken/parts | ✗ | ✗ | ✓ |
| POST /videos/:publicToken/complete | ✗ | ✗ | ✓ |
| GET /videos/:publicToken | ✓ | ✓ | ✓ |
| GET /videos/:publicToken/playback | ✓ | ✓ | ✓ |
| GET /videos/:publicToken/download | ✓ | ✓ | ✓ |

Anonymous `GET /videos/:publicToken` is limited to `ready` videos; any other status is `404 VIDEO_NOT_FOUND`. Playback and download are not authentication-gated. They still require `status = ready`. Upload mutations require the Phase 02 access token. The caller of `POST /videos/uploads` becomes the owner through their channel.

### Error Catalog

**Error response format:** inherited from Phase 02 (per phase-02-auth/TD-07). This phase does not redefine it.

```
{ statusCode: number, error: string, message: string }
```

Validation failures stay `400` with `error` = `VALIDATION_ERROR`. New domain codes:

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| UPLOAD_TOO_LARGE | 400 | `POST /videos/uploads` when `size_bytes` is above 10GB |
| NOT_VIDEO_OWNER | 403 | `POST /videos/:publicToken/parts` or `POST /videos/:publicToken/complete` when the caller is authenticated but does not own the video |
| VIDEO_NOT_FOUND | 404 | Unknown `publicToken`, the internal uuid used as the path segment, or `GET /videos/:publicToken` when the caller is not the owner and status is not `ready` |
| UPLOAD_NOT_DRAFT | 409 | `POST /videos/:publicToken/parts` or `POST /videos/:publicToken/complete` when status is not `draft` |
| VIDEO_NOT_READY | 409 | `GET /videos/:publicToken/playback` or `GET /videos/:publicToken/download` when status is not `ready` |

### Events/Messages

#### video.processing

**Payload:** the internal primary key. The public token is not in the message.

```json
{ "videoId": "uuid" }
```

**Producer:** the API, after `POST /videos/:publicToken/complete` moves the row from `draft` to `processing` (per phase-03-videos/TD-05)
**Consumer:** the dedicated FFmpeg worker container. The API does not transcode (per phase-03-videos/TD-04)
**Trigger:** multipart complete succeeded. The worker reads the video object, extracts duration, writes one thumbnail frame into the thumbnail bucket, then sets status to `ready` or `failed`. On `failed`, the video object stays in the bucket (per phase-03-videos/TD-05)
**Delivery semantics:** at-least-once (per phase-03-videos/TD-01). The broker is not the Postgres that serves auth. FFmpeg runs in the worker, and the job is retried by the queue rather than inside the request

---

## Dependency Map

```
SI-03.1 (root)
SI-03.2 (root)
SI-03.1 + SI-03.2
├── SI-03.3 — depends on SI-03.1 + SI-03.2
│   └── SI-03.4 — depends on SI-03.3
│       └── SI-03.5 — depends on SI-03.1 + SI-03.4
├── SI-03.6 — depends on SI-03.1 + SI-03.2
├── SI-03.7 — depends on SI-03.1 + SI-03.2
└── SI-03.8 — depends on SI-03.1 + SI-03.2
    └── SI-03.9 — depends on SI-03.8
```

---

## Deliverables

- [x] SI-03.1 — Preparar storage, fila e worker
- [x] SI-03.2 — Criar a entidade Video
- [x] SI-03.3 — Iniciar o upload
- [x] SI-03.4 — Assinar as partes do upload
- [x] SI-03.5 — Concluir o upload e enfileirar o processamento
- [x] SI-03.6 — Processar duração e thumbnail no worker
- [x] SI-03.7 — Consultar o vídeo pela URL única
- [x] SI-03.8 — Entregar a URL de streaming
- [x] SI-03.9 — Entregar a URL de download

**Full test suites:**

- [x] Backend tests pass (`cd nestjs-project && npm test`)
- [x] E2E tests pass (`cd nestjs-project && npm run test:e2e`)
- [x] Type/compilation checks pass (`cd nestjs-project && npx tsc --noEmit`)
- [x] Project builds successfully (`cd nestjs-project && npm run build`)
