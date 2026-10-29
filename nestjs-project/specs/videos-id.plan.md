---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: test/videos-id.e2e-spec.ts
---

# GET /videos/:publicToken Test Plan

## Application Overview

`GET /videos/:publicToken` é a URL única do vídeo. Quem não é dono só recebe um vídeo `ready`. O dono vê qualquer status, inclusive `failure_reason` quando o processamento falhou.

## Test Scenarios

### 1. GET /videos/:publicToken (SI-03.7)

**Setup:** `beforeEach` trunca o banco de teste e sobe o módulo com `Test.createTestingModule(...).compile()`.

#### 1.1. anonymous-reads-ready-video

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken sem access token, com o vídeo `ready` e `thumbnail_object_key` preenchido
    - expect: HTTP 200
    - expect: body traz `public_token`, `status` `"ready"`, `duration_seconds` e `thumbnail_url` string não vazia
    - expect: o corpo não traz o `id` uuid

#### 1.2. anonymous-cannot-read-unready-video

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken sem access token, com o vídeo em `draft`, `processing` ou `failed`
    - expect: HTTP 404
    - expect: body tem `error` `"VIDEO_NOT_FOUND"`

#### 1.3. owner-reads-failure-reason

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken com access token do dono, vídeo em `failed` e `failure_reason` preenchido
    - expect: HTTP 200
    - expect: body traz `failure_reason` igual ao valor persistido

#### 1.4. reject-unknown-id

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken com um `publicToken` que não existe
    - expect: HTTP 404
    - expect: body tem `error` `"VIDEO_NOT_FOUND"`

#### 1.5. reject-internal-uuid

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. GET /videos/:publicToken com o uuid interno da linha no lugar do `public_token`
    - expect: HTTP 404
    - expect: body tem `error` `"VIDEO_NOT_FOUND"`
