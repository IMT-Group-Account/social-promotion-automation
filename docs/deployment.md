# Production deployment and migration runbook

This document is the required production release order for the API, publish
worker, analytics scheduler, PostgreSQL, and Redis/BullMQ. The API, worker,
and scheduler use the same image but are independent processes. Do not treat a
successful API container restart as proof that the worker or scheduler is safe.

GitHub Actions runs `npm ci`, lint, typecheck, test, and build on each push and
pull request. It validates migration file structure only. It never backs up,
migrates, or changes a production database.

## Non-negotiable rules

- Use one approved production migration runner and one release operator. It
  must show the exact target database and pending migration list before apply,
  record the applied versions afterwards, and run each migration only once.
- Migration files already applied to any environment are immutable. Never use
  `db reset`, schema recreation, or an ad-hoc manual SQL edit in production.
- `docker compose up` must not be the mechanism that applies migrations. A
  migration is a separately approved, single-run database operation.
- Record the release commit/image digest, backup or snapshot ID, migration
  versions, start/end times, and the final health evidence in the release log.
- A failed database migration stops the release. Do not update API, worker, or
  scheduler containers against an unknown schema state.

## Migration compatibility classification

Classify every migration before approval. The classification determines whether
the old worker may remain alive while the schema changes.

| Class | Examples | Compatibility rule |
| --- | --- | --- |
| Expand | New nullable column, new table, additive index | Old code must tolerate the added schema. New code must tolerate absent/backfilled values until deployment is complete. |
| Contract or state-machine | Status constraint replacement, status remap, required column, renamed column, changed outbox semantics | Quiesce old worker and scheduler before migration. Do not run old worker against the new schema. |
| Destructive | Drop column/table/constraint or make a formerly optional value required | Use an expand-migrate-contract release: deploy compatible readers/writers, backfill and verify, then remove the legacy shape in a later release after all old images are gone. |

For any uncertainty, classify the migration as **Contract or state-machine**.

## Required precondition for state-machine migrations

This precondition occurs before the numbered deployment sequence below. It is
mandatory for a migration such as `013_publish_remote_reconciliation.sql`.

1. Pause the scheduler first so it cannot create new collection work:

   ```bash
   docker compose stop --timeout 120 scheduler
   ```

2. Drain the old publish worker. Allow its current provider calls to finish,
   then stop it gracefully; never use a zero timeout or force-kill it.

   ```bash
   docker compose stop --timeout 120 worker
   ```

3. Confirm the old worker container is stopped and that no legacy
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
write it until the new worker image is running.

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

3. **API container update**

   ```bash
   docker compose up -d --no-deps --build api
   ```

   Confirm the new image is running and its required configuration is present.
   Do not yet resume any old worker or scheduler.

4. **Worker update**

   ```bash
   docker compose up -d --no-deps --build worker
   ```

   Confirm the worker image matches the release image and that it can connect
   to PostgreSQL and Redis. For a state-machine migration, this must be the
   first worker process started after the migration.

5. **Scheduler update**

   ```bash
   docker compose up -d --no-deps --build scheduler
   ```

   Confirm the scheduler image matches the release image. It must not start
   before the new API and worker are available.

6. **Health check**

   ```bash
   docker compose ps
   curl --fail --silent --show-error https://<api-origin>/api/health
   docker compose logs --tail=100 api worker scheduler
   ```

   Verify the API health response, container health, no repeated worker/scheduler
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

## Rollback and recovery

- Before migration apply, stop the release and keep the known-good containers
  running only if they remain compatible with the current database.
- After an additive migration, code rollback is allowed only after verifying
  the prior image ignores the new schema safely.
- After a state-machine or destructive migration, do not restart an old worker
  against the new database. Prefer a forward recovery migration and a fixed
  new image.
- Restoring a production backup/snapshot is a destructive incident action. It
  requires explicit incident authorization, a confirmed restore target, and
  reconciliation of any provider writes that occurred after the snapshot.

## Deployment environment

- `DATABASE_URL` and `REDIS_URL` are server-only connection values.
- OAuth provider secrets, token-encryption keys, and service JWT settings stay
  in `infrastructure/oracle/backend.env`, never in Vercel or browser variables.
- `PUBLISH_WORKER_ENABLED=true` belongs only to the worker container and
  `SCHEDULER_ENABLED=true` only to the scheduler container.
- Expose only the HTTPS reverse proxy or load balancer publicly. Keep the
  Compose API port restricted to that proxy/load balancer.
