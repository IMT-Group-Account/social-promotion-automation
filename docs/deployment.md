# Production deployment and migration runbook

This document is the required production release order for the API, publish
worker, analytics scheduler, PostgreSQL, and Redis/BullMQ. The preferred Oracle
VM deployment runs one built release with three independent `systemd` services;
Docker is optional. Do not treat a successful API restart as proof that the
worker or scheduler is safe.

GitHub Actions runs `npm ci`, lint, typecheck, test, and build on each push and
pull request. It validates migration file structure only. It never backs up,
migrates, or changes a production database.

## Non-negotiable rules

- Use one approved production migration runner and one release operator. It
  must show the exact target database and pending migration list before apply,
  record the applied versions afterwards, and run each migration only once.
- Migration files already applied to any environment are immutable. Never use
  `db reset`, schema recreation, or an ad-hoc manual SQL edit in production.
- Application startup must not be the mechanism that applies migrations. A
  migration is a separately approved, single-run database operation.
- Record the release commit (and image digest only when Docker is used), backup or snapshot ID, migration
  versions, start/end times, and the final health evidence in the release log.
- A failed database migration stops the release. Do not update API, worker, or
  scheduler processes against an unknown schema state.

## Migration compatibility classification

Classify every migration before approval. The classification determines whether
the old worker may remain alive while the schema changes.

| Class | Examples | Compatibility rule |
| --- | --- | --- |
| Expand | New nullable column, new table, additive index | Old code must tolerate the added schema. New code must tolerate absent/backfilled values until deployment is complete. |
| Contract or state-machine | Status constraint replacement, status remap, required column, renamed column, changed outbox semantics | Quiesce old worker and scheduler before migration. Do not run old worker against the new schema. |
| Destructive | Drop column/table/constraint or make a formerly optional value required | Use an expand-migrate-contract release: deploy compatible readers/writers, backfill and verify, then remove the legacy shape in a later release after all old processes are gone. |

For any uncertainty, classify the migration as **Contract or state-machine**.

## Required precondition for state-machine migrations

This precondition occurs before the numbered deployment sequence below. It is
mandatory for a migration such as `013_publish_remote_reconciliation.sql`.

1. Pause the scheduler first so it cannot create new collection work:

   ```bash
   sudo systemctl stop social-promotion-scheduler
   ```

2. Drain the old publish worker. Allow its current provider calls to finish,
   then stop it gracefully; never use a zero timeout or force-kill it.

   ```bash
   sudo systemctl stop social-promotion-worker
   ```

3. Confirm the old worker service is stopped and that no legacy
   `processing` job remains. If a provider request was interrupted or its
   outcome is unknown, investigate it before migration; do not convert it to a
   retry candidate that could publish the same post again.

   ```sql
   SELECT status, count(*)
   FROM social_publish_jobs
   GROUP BY status
   ORDER BY status;
   ```

The API may remain available while worker and scheduler are paused. New work
can accumulate in the transactional outbox, but no old worker may claim or
write it until the new worker release is running.

## Mandatory production sequence

After any required quiesce step, execute this exact order.

1. **DB backup / snapshot**
   - Create a provider backup or snapshot and record its immutable ID.
   - Verify that the backup is restorable using the provider's documented
     method; a snapshot-created message alone is not recovery evidence.
   - Confirm the target database, release commit, and approved migration list.

2. **Migration execution**
   - Run the approved production migration runner once, in timestamp order.
   - Capture its dry-run/plan, apply result, and post-apply migration history.
   - For data migrations, verify the defined row counts and constraints before
     continuing. Do not continue on a partial or unverified apply.

3. **Release activation and API update**

   ```bash
   sudo ln -sfn /opt/social-promotion/releases/<release-id> /opt/social-promotion/current
   sudo systemctl restart social-promotion-api
   ```

   Build and verify the release directory before this symlink change. Confirm
   the new release is running and its required configuration is present.
   Do not yet resume any old worker or scheduler.

4. **Worker update**

   ```bash
   sudo systemctl restart social-promotion-worker
   ```

   Confirm the worker release ID matches the API and that it can connect
   to PostgreSQL and Redis. For a state-machine migration, this must be the
   first worker process started after the migration.

5. **Scheduler update**

   ```bash
   sudo systemctl restart social-promotion-scheduler
   ```

   Confirm the scheduler release ID matches the API. It must not start
   before the new API and worker are available.

6. **Health check**

   ```bash
   systemctl --no-pager --full status social-promotion-api social-promotion-worker social-promotion-scheduler
   curl --fail --silent --show-error https://<api-origin>/api/health
   curl --fail --silent --show-error https://<api-origin>/api/health/ready
   journalctl --no-pager -n 100 -u social-promotion-api -u social-promotion-worker -u social-promotion-scheduler
   ```

   Verify the API health response, service health, no repeated worker/scheduler
   startup errors, the expected BullMQ queue depth, and normal outbox dispatch.
   When a release changes publication state semantics, also verify one
   non-mutating status read before allowing new operational publishing.

## State-machine compatibility: processing to claimed

Migration `013_publish_remote_reconciliation.sql` is a Contract or
state-machine migration because it:

- replaces the status constraint and maps legacy `processing` rows to
  `claimed`;
- adds `remote_request_key` and `remote_request_started_at`;
- requires `remote_request_key` for `remote_requesting`, `remote_confirmed`,
  and `published` states; and
- makes `remote_requesting` a durable reconciliation boundary before an
  irreversible provider write.

An old worker can still try to write `processing`, cannot populate the new
request key, and does not follow the new reconciliation contract. Therefore it
must never coexist with the migrated database. The required sequence is:

```text
old scheduler stopped
  -> old worker drained and stopped
  -> no unresolved legacy processing work
  -> backup / snapshot
  -> migration 013
  -> new API
  -> new worker
  -> new scheduler
  -> health and queue verification
```

For future state changes, prefer a two-release expand-migrate-contract plan
when it is possible to make new workers accept both states. If it is not
possible, use the same quiesced cutover procedure; never rely on a status
constraint error as a safe handoff mechanism.

Migration `015_failure_alert_delivery.sql` is an expand-compatible migration:
it adds nullable/defaulted delivery columns and expands the failure-alert status
constraint. An old worker continues inserting `pending` alerts, while only the
new worker claims them for webhook delivery. Apply migration 015 before starting
the new worker; rolling back to an old worker leaves undelivered rows durable.

Migration `016_runtime_heartbeats.sql` is additive. The new worker and scheduler
update separate singleton heartbeat rows after successful loops. `/api/health`
remains a liveness check; `/api/health/ready` verifies PostgreSQL and every
runtime required by `READINESS_REQUIRE_WORKER` and
`READINESS_REQUIRE_SCHEDULER`. Configure the stale threshold longer than the
largest normal polling interval but short enough to stop releases when a
runtime has silently stopped.

## Rollback and recovery

- Before migration apply, stop the release and keep the known-good processes
  running only if they remain compatible with the current database.
- After an additive migration, code rollback is allowed only after verifying
  the prior release ignores the new schema safely.
- After a state-machine or destructive migration, do not restart an old worker
  against the new database. Prefer a forward recovery migration and a fixed
  new release.
- Restoring a production backup/snapshot is a destructive incident action. It
  requires explicit incident authorization, a confirmed restore target, and
  reconciliation of any provider writes that occurred after the snapshot.

## Deployment environment

- `DATABASE_URL` and `REDIS_URL` are server-only connection values.
- OAuth provider secrets, token-encryption keys, and service JWT settings stay
  in `infrastructure/oracle/backend.env`, never in Vercel or browser variables.
- `PUBLISH_WORKER_ENABLED=true` belongs only to the worker service and
  `SCHEDULER_ENABLED=true` only to the scheduler service. The supplied unit
  files set these process-specific flags without duplicating the shared secret
  environment file.
- Expose only the HTTPS reverse proxy or load balancer publicly. Keep the
  Node.js API port restricted to that proxy/load balancer.

## Preferred non-Docker host layout

- Application releases: `/opt/social-promotion/releases/<release-id>`
- Active symlink: `/opt/social-promotion/current`
- Secret environment file: `/etc/social-promotion/backend.env`, mode `0640`
- Persistent media: `/var/lib/social-promotion/uploads`
- Process manager: the three units in
  `infrastructure/oracle/systemd`
- Database and queue: preferably managed PostgreSQL and managed Redis reached
  through private networking or TLS; native OS services are also acceptable.

Install dependencies and build inside a new release directory. Never run
`npm install` in the active release while a process is serving traffic. The
release directory must pass lint, typecheck, tests, build, dependency audit,
and the approved migration plan before the active symlink changes.

Docker Compose remains available only as an optional packaging alternative in
`infrastructure/oracle/docker-compose.yml`; it is not required by application
runtime behavior or the production release procedure.
