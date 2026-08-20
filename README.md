# Social Promotion Automation

This repository starts with a Node.js + TypeScript + NestJS backend boundary for scheduled social publishing.

One `post` owns its editorial content and schedule. Each selected social account receives its own `social_publish_jobs` row. A worker claims and changes only its own job row; a failure on X therefore cannot mark LinkedIn, Instagram, Facebook, or Threads as failed.

## Layout

- `backend/migrations/001_social_publishing_core.sql`: PostgreSQL schema and integrity constraints.
- `backend/src/posts`: post entities, service, controller boundary, and repository contract.
- `backend/src/publishing`: formatter, queue boundary, adapter registry, and platform adapters.
- `backend/src/publishing/publish-worker.bootstrap.ts`: separate Redis/BullMQ worker that dispatches the PostgreSQL outbox and executes one SNS job at a time.
- `backend/src/publishing/x-api-usage.service.ts`: X pay-per-use request reservation/settlement ledger using integer micro-USD estimates.
- `backend/src/kakao-channel`: Kakao Channel inbound-link and consultation-conversion funnel, separate from social publishing jobs.
- `backend/src/analytics`: per-job analytics collection leases, normalized metric snapshots, and campaign dashboard aggregation.
- `backend/src/publishing/formatters`: deterministic LinkedIn/Instagram/Facebook/Threads/X presentation rules and an AI-ready platform-content contract.
- `backend/src/auth`, `campaigns`, `analytics`, `scheduler`, `media`: NestJS modules matching the backend responsibilities.
- `backend/src/auth`: Authorization Code + PKCE, one-time CSRF state, LinkedIn/Facebook/Threads/X provider registry, AES-256-GCM token encryption, and PostgreSQL credential repository.
- `backend/test`: contract tests for independent job failure and retry behavior.
- `frontend`: Next.js 관리자 화면. Backend API만 호출해 캠페인 작성, SNS 선택, 예약, 결과 상태를 표시합니다.
- `docs/data-model.md`: data flow and operational status semantics.
- `docs/database.md`: PostgreSQL ERD, canonical table responsibilities, and migration 011 rollout notes.
- `docs/api-contract.md`: frontend-to-backend-only campaign, post, result, analytics, and integration contract.
- `docs/publishing-queue.md`: Redis/BullMQ delayed scheduling, outbox, retry, and worker deployment procedure.

## Local verification

Run with Node.js 20.9 or later:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

`build` compiles TypeScript and validates that the SQL migration contains the required table and isolation constraints. It does not apply a database migration. OAuth uses PostgreSQL when `DATABASE_URL` is configured. Frontend calls only `/api/campaigns`, `/api/posts`, and `/api/integrations`; callback routes are provider-facing. The current process-local post repository and unconfigured publishing adapters are deliberate fail-closed development boundaries until the upstream application authentication and PostgreSQL post repository are connected.

Scheduled publishing uses a separate worker after migration `009_bullmq_publish_outbox.sql` has been applied. Set server-only `REDIS_URL` and `PUBLISH_WORKER_ENABLED=true`, then run `npm.cmd run start:worker`; see [docs/publishing-queue.md](docs/publishing-queue.md). Do not put Redis, OAuth, or SNS tokens in frontend variables or browser storage.

## 관리자 화면

```powershell
Copy-Item frontend\.env.example frontend\.env.local
npm.cmd run admin:dev
```

`NEXT_PUBLIC_API_BASE_URL`에는 공개 가능한 Backend API origin만 설정합니다. SNS access token, OAuth client secret, Redis URL, database URL은 절대로 `NEXT_PUBLIC_*` 변수에 넣지 않습니다. 연결된 SNS 계정이 있는 사용자 세션으로 로그인하면 대상 선택이 활성화되고, 발행 후에는 `/api/posts/:id/results`를 15초마다 조회해 플랫폼별 성공·재시도·실패 상태를 표시합니다.
