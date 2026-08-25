# Redis and BullMQ scheduled publishing

Scheduled publishing does not use process-local `setTimeout()`. Each selected
social account has one `social_publish_jobs` row and one deterministic BullMQ
job. A failure for one platform never changes a sibling platform's job.

```text
PostgreSQL social_publish_jobs INSERT
  -> transactional social_publish_queue_outbox row
  -> publish worker claims the outbox row
  -> Redis/BullMQ delayed job (publish-<publish-job-uuid>)
  -> worker leases exactly one publish job
  -> provider adapter call
  -> that job alone is persisted as published, retrying, or failed
```

The deterministic BullMQ job ID prevents duplicate delayed jobs during outbox
retry. `scheduled_at` is UTC `timestamptz`; the queue delay is calculated at
enqueue time. Operator dashboards must show both scheduled and actual publish
time because worker load and Redis availability prevent exact-time guarantees.

## Runtime

Apply migration `009_bullmq_publish_outbox.sql` through the production migration
procedure before starting the worker. The API never starts publishing merely by
being online.

```powershell
$env:PUBLISH_WORKER_ENABLED = 'true'
$env:REDIS_URL = 'rediss://:password@redis.example.com:6380'
npm.cmd run build
npm.cmd run start:worker
```

`PUBLISH_WORKER_ENABLED` defaults to `false`. Exercise the worker first in a
staging environment with PostgreSQL, Redis, and approved provider credentials.
Actual provider publication needs separate operational authorization.

## Durable state machine

```text
waiting/retrying
  -> claimed
  -> remote_requesting (remote_request_key persisted before Adapter.publish)
  -> remote_confirmed (remote post reference persisted)
  -> published
```

`cancelled` is user-initiated and `failed` is terminal. A retryable failure
uses 30 seconds, 2 minutes, then 10 minutes; the fourth failure is terminal.
Authentication/authorization provider errors and other permanent 4xx outcomes
are terminal. A terminal failure creates a `social_publish_failure_alerts`
outbox record in the same transaction.

Before any irreversible provider write, the worker persists a deterministic
`remote_request_key`. For an unknown network/5xx outcome it reconciles before
repeating a write; when reconciliation is unsupported it remains fail-closed
with `AMBIGUOUS_REMOTE_OUTCOME` rather than publishing again.

## Deployment compatibility

Worker status constraints, transition semantics, and request-key fields are
deployment compatibility changes. Before applying such a migration in
production, follow the required scheduler/worker quiesce, backup, migration,
API, worker, scheduler, and health-check order in
[deployment.md](deployment.md). An old worker must never run against a new
state-machine schema.

Environment settings are documented in [`.env.example`](../.env.example).
