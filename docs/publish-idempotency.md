# Social publish idempotency and reconciliation

The database outbox prevents duplicate queue delivery. It cannot prove whether a
provider accepted a write when the worker stops between the provider accepting
the request and this service receiving its response. Each `social_publish_jobs`
row therefore uses this durable transition:

```text
waiting/retrying
  -> claimed
  -> remote_requesting (stable remote_request_key persisted before Adapter.publish)
  -> remote_confirmed (remote post ID persisted)
  -> published
```

`remote_request_key` is deterministic for the job (`social-publish:<job-id>`).
The Adapter contract receives it as `PublishRequest.idempotencyKey`. An adapter
may set `supportsIdempotentPublish` only after it actually forwards that key to
a provider-documented idempotency facility and has provider integration tests.

For a network/unknown/5xx outcome after `remote_requesting`, the worker first
calls `reconcilePublish()` when the provider supports a lookup by that stable
key. If a known `remotePostId` exists, it uses `getPost(remotePostId,
socialAccountId)` instead. A confirmed lookup finishes the same job without
another publish call.

No currently configured provider adapter advertises an externally verified
idempotent-write or request-key reconciliation mechanism. For that case the
worker never sends a second publish request: it records
`AMBIGUOUS_REMOTE_OUTCOME`, schedules only reconciliation checks using the
normal retry backoff, and finally fails closed for manual investigation. The
request key is retained for that investigation and prevents a user reschedule
from bypassing reconciliation.

Definite provider rejections (for example authenticated 4xx responses) retain
the normal retry/failure policy and clear the remote-request marker only after
the provider outcome is known not to have published content. Provider tokens,
request bodies, and raw provider responses must never be stored in the request
key, error message, audit logs, or worker logs.
