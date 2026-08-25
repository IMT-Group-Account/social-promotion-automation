# Frontend Backend API contract

Frontend never calls LinkedIn, Meta, Threads, X, Redis, or storage-provider APIs directly. It calls only this NestJS API with `Authorization: Bearer <our-service-jwt>`; the global `ServiceJwtAuthGuard` verifies the service JWT and derives `req.user.id` from its `sub` claim before the server verifies ownership and keeps every provider token server-side.

All user API routes return `{ "data": ..., "error": null, "meta": {} }` on success. Missing, malformed, expired, incorrectly issued/audienced, or invalidly signed Bearer tokens return `401`; resources owned by a different user are returned as `404`. OAuth callbacks, `/api/health`, and documented Kakao inbound routes are provider/public exceptions and do not use a browser JWT.

## Request validation

Nest applies a global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, and `transform` enabled. Every JSON request body uses a decorated DTO class; missing or invalid fields and unexpected properties are rejected with `400` before controller or service logic runs. Provider callback query parameters remain provider-specific and are validated by the OAuth flow rather than being silently transformed into an application DTO.

## Campaigns

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/campaigns` | Create `{ "name": "Campaign 2026" }` |
| GET | `/api/campaigns` | List the caller's campaigns |
| GET | `/api/campaigns/:id` | Read one owned campaign |

## Posts

`POST /api/posts` creates one editorial post and one independent publishing job per requested platform account.

```json
{
  "campaignId": "campaign_001",
  "content": {
    "title": "Support our campaign",
    "body": "Help us reach our goal...",
    "url": "https://example.com/campaign/123",
    "media": [{ "type": "image", "url": "https://cdn.example.com/image.jpg" }]
  },
  "targets": [
    { "platform": "linkedin", "accountId": "account_linkedin_001" },
    { "platform": "x", "accountId": "account_x_001" }
  ],
  "scheduledAt": "2026-08-21T09:00:00+09:00"
}
```

The authenticated server derives `ownerId`; clients must not submit it. The server must verify that the authenticated owner controls the campaign and every requested social account before creating the rows in one database transaction.

```json
{
  "data": {
    "post": { "id": "post_001", "status": "scheduled" },
    "jobs": [
      { "id": "job_001", "platform": "linkedin", "status": "waiting" },
      { "id": "job_002", "platform": "x", "status": "waiting" }
    ]
  },
  "error": null,
  "meta": {}
}
```

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/posts/:id` | Read owned source content and per-platform jobs |
| POST | `/api/posts/:id/publish` | Request immediate queue eligibility |
| POST | `/api/posts/:id/schedule` | Set `{ "scheduledAt": "ISO-8601" }` |
| GET | `/api/posts/:id/results` | Per-platform status, remote IDs/URLs, and errors |
| GET | `/api/posts/:id/analytics` | Latest normalized server-collected metrics by platform; never includes raw metrics |

Individual adapter outcomes live on their corresponding job fields: `publishedAt`, `remotePostId`, `remotePostUrl`, `errorCode`, `errorMessage`, `retryCount`, and `nextRetryAt`. `publish` and `schedule` only request backend queue work; they never expose or call an SNS API from the browser.

Provider-adapter operations use only a persisted `remotePostId` together with its `socialAccountId`; the local post ID is never a provider API identifier. Provider analytics collection is scheduler-only; no browser API directly invokes a provider analytics lookup.

## Analytics

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/analytics/campaigns/:campaignId/dashboard` | Owned campaign's normalized aggregate metrics only |
| GET | `/api/analytics/campaigns/:campaignId/raw?platform=x&limit=50&cursor=<opaque>` | Owned campaign's paginated persisted raw metric snapshots |

The dashboard response never contains `rawMetrics`. The raw endpoint is authenticated, verifies campaign ownership, returns up to 100 records per page in capture-time descending order, and exposes no provider access token or provider request capability.

## Integrations

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/integrations` | List the caller's connected accounts without token fields |
| POST | `/api/integrations/linkedin/connect` | Start server-side LinkedIn OAuth/PKCE |
| POST | `/api/integrations/facebook/connect` | Start server-side Meta Page OAuth |
| POST | `/api/integrations/facebook/pages/select` | Save the Page selected after Meta callback |
| POST | `/api/integrations/instagram/connect` | Start the Meta authorization flow for an Instagram professional account |
| POST | `/api/integrations/threads/connect` | Start server-side Threads OAuth |
| POST | `/api/integrations/x/connect` | Start server-side X OAuth |
| DELETE | `/api/integrations/:id` | Revoke the connection and erase encrypted tokens |

Connect responses contain only an `authorizationUrl`. The browser may navigate to that URL, but OAuth callback code/token exchange and encrypted token persistence remain on the backend. Provider callback routes (`/api/oauth/*/callback`) are inbound provider-only routes, not frontend SNS API calls. The legacy browser-facing `/api/oauth/*/connect` routes are not exposed.
