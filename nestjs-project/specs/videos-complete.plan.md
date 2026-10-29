---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5
target_file: test/videos-complete.e2e-spec.ts
---

# POST /videos/:publicToken/complete Test Plan

## Application Overview

`POST /videos/:publicToken/complete` fecha o multipart, passa o vídeo de `draft` para `processing` e publica o job `video.processing`. Só o dono conclui um upload ainda em rascunho.

## Test Scenarios

### 1. POST /videos/:publicToken/complete (SI-03.5)

**Setup:** `beforeEach` trunca o banco de teste e sobe o módulo com `Test.createTestingModule(...).compile()`.

#### 1.1. owner-completes-draft

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/:publicToken/complete como dono, vídeo em `draft`, body `{ parts: [{ part_number, etag }] }` não vazio
    - expect: HTTP 202
    - expect: body tem `status` `"processing"`
    - expect: a linha tem `multipart_upload_id` null

#### 1.2. publishes-processing-job

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/:publicToken/complete como dono, com `parts` válidos
    - expect: HTTP 202
    - expect: a fila recebe `video.processing` com payload `{ "videoId": "<uuid interno>" }`, não o `public_token` da rota

#### 1.3. reject-when-not-draft

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/:publicToken/complete como dono, com `status` diferente de `draft`
    - expect: HTTP 409
    - expect: body tem `error` `"UPLOAD_NOT_DRAFT"`
    - expect: nenhum job `video.processing` é publicado

#### 1.4. reject-other-authenticated-user

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/:publicToken/complete com access token de outro usuário autenticado
    - expect: HTTP 403
    - expect: body tem `error` `"NOT_VIDEO_OWNER"`

#### 1.5. reject-empty-parts

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/:publicToken/complete como dono, com `parts` vazio
    - expect: HTTP 400
    - expect: body tem `error` `"VALIDATION_ERROR"`
