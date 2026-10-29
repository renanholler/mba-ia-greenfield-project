---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: test/videos-download.e2e-spec.ts
---

# GET /videos/:publicToken/download Test Plan

## Application Overview

`GET /videos/:publicToken/download` devolve uma URL pré-assinada do objeto de vídeo com Content-Disposition a partir de `original_filename`. A API não envia os bytes. Só um vídeo `ready` pode ser baixado, e o endpoint não exige access token.

## Test Scenarios

### 1. GET /videos/:publicToken/download (SI-03.9)

**Setup:** `beforeEach` trunca o banco de teste e sobe o módulo com `Test.createTestingModule(...).compile()`.

#### 1.1. ready-video-returns-download-url

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken/download de um vídeo `ready` com `original_filename` conhecido
    - expect: HTTP 200
    - expect: body traz `url` cujo Content-Disposition usa `original_filename`

#### 1.2. reject-when-not-ready

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken/download de um vídeo cujo `status` não é `ready`
    - expect: HTTP 409
    - expect: body tem `error` `"VIDEO_NOT_READY"`

#### 1.3. reject-unknown-id

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken/download com um `publicToken` que não existe
    - expect: HTTP 404
    - expect: body tem `error` `"VIDEO_NOT_FOUND"`

#### 1.4. anonymous-ready-video

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken/download sem access token, com o vídeo `ready`
    - expect: HTTP 200
    - expect: body traz `url`
