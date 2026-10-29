---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.4
target_file: test/videos-parts.e2e-spec.ts
---

# POST /videos/:publicToken/parts Test Plan

## Application Overview

`POST /videos/:publicToken/parts` devolve URLs pré-assinadas para o dono gravar as partes direto no storage. Só vale com o vídeo em `draft`. A API não recebe os bytes.

## Test Scenarios

### 1. POST /videos/:publicToken/parts (SI-03.4)

**Setup:** `beforeEach` trunca o banco de teste e sobe o módulo com `Test.createTestingModule(...).compile()`.

#### 1.1. owner-receives-presigned-urls

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/:publicToken/parts como dono, vídeo em `draft`, body `{ part_numbers: [1, 2] }`
    - expect: HTTP 200
    - expect: `parts` tem dois itens, cada um com `part_number` e `url`
    - expect: `status` da linha continua `draft`

#### 1.2. reject-other-authenticated-user

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/:publicToken/parts com access token de outro usuário autenticado
    - expect: HTTP 403
    - expect: body tem `error` `"NOT_VIDEO_OWNER"`

#### 1.3. reject-when-not-draft

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/:publicToken/parts como dono, com `status` diferente de `draft`
    - expect: HTTP 409
    - expect: body tem `error` `"UPLOAD_NOT_DRAFT"`

#### 1.4. reject-unknown-id

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/:publicToken/parts como usuário autenticado, com `publicToken` que não existe
    - expect: HTTP 404
    - expect: body tem `error` `"VIDEO_NOT_FOUND"`

#### 1.5. reject-missing-token

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-29T05:30:00Z

**Steps:**
  1. POST /videos/:publicToken/parts sem header Authorization
    - expect: HTTP 401
