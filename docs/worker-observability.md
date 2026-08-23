# Social publish worker observability

`BullMqPublishWorker` emits structured Nest logs for BullMQ `completed`, `failed`, `stalled`, and `error` events.

Job-scoped events use the same context fields:

- `campaignId`
- `postId`
- `publishJobId`
- `platform`
- `socialAccountId`
- `remotePostId`
- `attempt`
- `errorCode`

The outbox enriches each queue message with the campaign, post, platform, account, and last known remote-post identifiers. Successful processing returns the final remote-post ID; retryable and terminal failures carry the domain error code. A stalled job loads the queue message by BullMQ job ID before logging.

Redis/worker `error` events can have no associated job. Those logs retain the same fields with `unknown` or `null` values and use `BULLMQ_WORKER_ERROR`; they never invent a business identity. Logs intentionally exclude provider tokens, request bodies, and raw external error messages.

Shipping these events to a log collector, alert thresholds, and actual Redis failure drills remain deployment verification steps.
