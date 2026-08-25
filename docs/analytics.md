# Social post analytics collection

```text
Successful social_publish_job
  -> remote_post_id
  -> claim one job for collection
  -> platform adapter GET analytics
  -> social_metrics (through the associated social_posts row)
  -> GET /api/analytics/campaigns/:campaignId/dashboard (normalized metrics)
  -> GET /api/analytics/campaigns/:campaignId/raw (stored raw snapshots)
```

`social_publish_jobs` remains isolated: analytics collection claims and releases one published job at a time. A failed X or Threads GET releases only that job's analytics lease. It never modifies a sibling platform's publication state or existing snapshot.

## Common metrics

Every snapshot stores only the non-negative metrics the platform actually defines:

```json
{
  "platform": "x",
  "remotePostId": "remote-post-id",
  "metrics": {
    "impressions": 10321,
    "likes": 241,
    "reposts": 18,
    "rawMetrics": {
      "impression_count": 10321,
      "repost_count": 18
    }
  }
}
```

`impressions`, `reach`, `views`, `likes`, `comments`, `shares`, `reposts`, and `clicks` are all optional. Platform adapters do not reinterpret impressions, reach, and views as each other or invent `0` for an unavailable metric. Provider-native non-negative numeric fields are retained in `rawMetrics`; a response with no numeric metric at all is rejected.

The adapter boundary accepts only `remotePostId` and `socialAccountId` for post lookup, deletion, replies, and scheduler collection. A local `posts.id` never crosses into a provider adapter, and the account is mandatory so the credential resolver always selects one specific platform account before making an external request. `social_metrics` stores optional standard metrics and provider-native `raw_metrics` JSONB. Raw data is kept per DB snapshot and is never aggregated into a dashboard row.

## Scheduling and dashboard

Set `ANALYTICS_COLLECTION_INTERVAL_MS` to enable the backend scheduler; it is disabled by default. The collector uses a database lease, stale-snapshot interval, and batch limit from `.env.example`. Each campaign dashboard aggregates only normalized metrics from the newest snapshot for every published job and returns five platform rows, with zero values when no snapshot exists yet. It never includes `rawMetrics`.

Use `GET /api/analytics/campaigns/:campaignId/raw?platform=x&limit=50&cursor=<opaque>` for stored provider-native snapshot metrics. The endpoint verifies campaign ownership, returns at most 100 snapshots in descending capture order, and provides `nextCursor` when another page exists. It reads persisted `social_metrics.raw_metrics`; it does not make a provider API call. A raw snapshot contains `platform`, `remotePostId`, `capturedAt`, and its unaggregated `rawMetrics` object.

The analytics endpoint requires `Authorization: Bearer <our-service-jwt>`; `ServiceJwtAuthGuard` verifies it and sets `request.user.id` from the JWT `sub` claim, and the PostgreSQL repository verifies campaign ownership. Apply migration `008` before enabling the scheduler. Each provider's analytics URL, grant, approval, and live response shape must be configured and verified separately; no external GET is sent while its URL is unconfigured.
