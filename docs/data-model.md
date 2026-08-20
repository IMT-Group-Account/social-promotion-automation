# Core data model

```text
campaigns 1 ─── * posts 1 ─── * post_media
                       │
                       └─── * social_publish_jobs * ─── 1 social_accounts
```

`posts` is the shared editorial record: campaign, title/body, optional destination URL, media, and requested publishing time. The API exposes selected targets as `platform`/`accountId` pairs, but persistence creates a distinct `social_publish_jobs` record for each pair. A successful job creates one `social_posts` row, and periodic metrics are appended to `social_metrics`.

For example, post `post_001` can have five jobs:

```text
post_001
├─ linkedin / account A / waiting
├─ instagram / account B / waiting
├─ facebook / account C / published
├─ threads / account D / retrying
└─ x / account E / failed
```

## Isolation invariant

The worker selects and updates one job using `WHERE id = :jobId`. It must never issue a sibling update based on `post_id` after an adapter error. `posts.status` is an aggregate display value only:

| Job mix | Post status |
| --- | --- |
| all waiting/retrying | `scheduled` |
| any processing and no terminal failure | `publishing` |
| all published | `completed` |
| any failed/cancelled plus any non-failed work | `partially_failed` |
| all failed/cancelled | `failed` |

Retrying a failed job returns only that job to `retrying`, increments its own `retry_count`, and preserves previous remote success information on every other job.

## Credential boundary

`social_accounts.credential_reference` stores only a pointer to a server-side secret store or encrypted credential record. OAuth access/refresh tokens must not be stored in `posts`, `social_publish_jobs`, logs, API responses, or browser code.
