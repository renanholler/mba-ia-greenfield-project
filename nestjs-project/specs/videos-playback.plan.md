---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: test/videos-playback.e2e-spec.ts
---

# GET /videos/:publicToken/playback Test Plan

## Application Overview

`GET /videos/:publicToken/playback` devolve uma URL pré-assinada do objeto de vídeo para o cliente transmitir direto do storage. A API não envia os bytes. Só um vídeo `ready` tem playback, e o endpoint não exige access token.

## Test Scenarios

### 1. GET /videos/:publicToken/playback (SI-03.8)

**Setup:** `beforeEach` trunca o banco de teste e sobe o módulo com `Test.createTestingModule(...).compile()`.

#### 1.1. ready-video-returns-presigned-url

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken/playback de um vídeo `ready`
    - expect: HTTP 200
    - expect: body traz `url` string não vazia apontando para o bucket de vídeo
    - expect: o corpo da resposta não contém os bytes do arquivo

#### 1.2. reject-when-not-ready

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken/playback de um vídeo cujo `status` não é `ready`
    - expect: HTTP 409
    - expect: body tem `error` `"VIDEO_NOT_READY"`

#### 1.3. reject-unknown-id

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken/playback com um `publicToken` que não existe
    - expect: HTTP 404
    - expect: body tem `error` `"VIDEO_NOT_FOUND"`

#### 1.4. anonymous-ready-video

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken/playback sem access token, com o vídeo `ready`
    - expect: HTTP 200
    - expect: body traz `url`
