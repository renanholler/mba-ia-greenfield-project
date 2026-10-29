---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.3
target_file: test/videos-uploads.e2e-spec.ts
---

# POST /videos/uploads Test Plan

## Application Overview

`POST /videos/uploads` abre o upload de um vídeo de até 10GB. O request autenticado cria a linha em `draft`, no canal de quem chama, e devolve o id do multipart. A API não recebe os bytes do arquivo.

## Test Scenarios

### 1. POST /videos/uploads (SI-03.3)

**Setup:** `beforeEach` trunca o banco de teste e sobe o módulo com `Test.createTestingModule(...).compile()`.

#### 1.1. initiate-returns-draft

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/uploads com access token e body `{ original_filename, content_type, size_bytes }` válidos, com `size_bytes` de no máximo 10GB
    - expect: HTTP 201
    - expect: body traz `public_token` opaco, `status` `"draft"` e `multipart_upload_id` string não vazia
    - expect: o corpo não traz o `id` uuid

#### 1.2. draft-row-belongs-to-caller-channel

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/uploads autenticado, com body válido
    - expect: HTTP 201
    - expect: a linha `videos` do `public_token` devolvido tem `channel_id` igual ao canal do caller e `id` uuid diferente de `public_token`
    - expect: `thumbnail_object_key` e `duration_seconds` são null

#### 1.3. reject-over-10gb

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/uploads autenticado com `size_bytes` acima de 10GB
    - expect: HTTP 400
    - expect: body `{ statusCode: 400, error: "UPLOAD_TOO_LARGE", message: string }`
    - expect: nenhuma linha nova em `videos`

#### 1.4. reject-missing-token

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/uploads sem header Authorization, com body válido
    - expect: HTTP 401

#### 1.5. reject-empty-filename

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/uploads autenticado com `original_filename` vazio
    - expect: HTTP 400
    - expect: body tem `error` `"VALIDATION_ERROR"`
