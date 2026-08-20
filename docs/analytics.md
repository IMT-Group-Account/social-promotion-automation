# Social post analytics collection

```text
Successful social_publish_job
  -> remote_post_id
  -> claim one job for collection
  -> platform adapter GET analytics
  -> social_metrics (through the associated social_posts row)
  -> GET /api/analytics/campaigns/:campaignId/dashboard
```

`social_publish_jobs` remains isolated: analytics collection claims and releases one published job at a time. A failed X or Threads GET releases only that job's analytics lease. It never modifies a sibling platform's publication state or existing snapshot.

## Common metrics

Every snapshot stores non-negative integer fields:

```json
{
  "platform": "linkedin",
  "postId": "remote-post-id",
  "metrics": {
    "views": 10321,
    "likes": 241,
    "comments": 31,
    "shares": 18,
    "clicks": 413
  }
}
```

Platform adapters normalize their configured GET response into these fields. Values the provider does not expose are stored as `0`; a missing view/impression value is a collection error, so a misleading partial snapshot is never inserted.

## Scheduling and dashboard

Set `ANALYTICS_COLLECTION_INTERVAL_MS` to enable the backend scheduler; it is disabled by default. The collector uses a database lease, stale-snapshot interval, and batch limit from `.env.example`. Each campaign dashboard aggregates the newest snapshot for every published job and returns five platform rows, with zero values when no snapshot exists yet.

The analytics endpoint requires upstream application authentication to set `request.user.id`, and the PostgreSQL repository verifies campaign ownership. Apply migration `008` before enabling the scheduler. Each provider's analytics URL, grant, approval, and live response shape must be configured and verified separately; no external GET is sent while its URL is unconfigured.
