# Staging provider verification

Local tests do not prove that a provider accepted a publication. Run this gate separately for each SNS account after its application, callback URL, permissions, database, Redis, worker, scheduler, and public media origin have been configured.

## Before connecting an account

1. Run `npm run check:editorial` in the API environment.
2. Run `npm run check:provider -- <platform>` without printing or copying secrets into a log.
3. Confirm migrations `001` through `014`, the API image, worker image, and scheduler image belong to the same release.
4. Confirm the test account/page is owned by the operator and the test publication is private or otherwise restricted where the provider supports it.
5. Record the release commit, environment, platform, account/page identifier, and operator. Never record access tokens or authorization codes.

## Live test

1. Complete the OAuth popup and confirm the selected account name, expiry, granted scopes, and empty `missingScopes` in the account screen.
2. Upload one small JPEG from the configured public media origin. Preview the exact final text, link, image, target account, and scheduled time.
3. Approve one uniquely titled test post. Keep the worker running; do not manually repeat the request if the result is `remote_requesting` or otherwise ambiguous.
4. Wait until the job is `published`. Open `remotePostUrl` in a separate authenticated browser session and compare title/text/media/visibility.
5. Confirm the stored `publishedAt`, `remotePostId`, `remotePostUrl`, job audit entry, and one analytics snapshot when the provider supports it.

Success requires all of the following evidence:

- local job status is `published`;
- `publishedAt`, `remotePostId`, and an HTTPS `remotePostUrl` are present;
- the URL opens the intended provider post under the intended account;
- the observed text, media, and visibility match the approved preview;
- a duplicate queue delivery does not create a second provider post.

## Failure drills

Run these with a disposable staging draft, one condition at a time:

- revoke or expire the credential and confirm a terminal authorization failure plus operator guidance;
- return a simulated 429/5xx from the provider boundary and confirm only the affected SNS job retries;
- stop Redis briefly and confirm the PostgreSQL outbox remains authoritative and dispatch resumes once;
- stop the worker after the durable remote-request marker and confirm no automatic duplicate publish occurs;
- use a missing/invalid media URL and confirm approval or publication fails closed.

For every drill, capture timestamps, affected job ID, expected and observed state transitions, alert delivery, and recovery decision. Do not include secrets, raw provider responses, or user content beyond the approved test fixture.

## Evidence record

```text
Release commit/image:
Environment:
Platform and account/page:
Operator and UTC time:
Static readiness result:
OAuth scopes verified:
Local post/job ID:
PublishedAt:
RemotePostId:
RemotePostUrl opened and visually checked:
Text/media/visibility matched:
Duplicate-delivery check:
Analytics snapshot (supported / unsupported / pending):
Failure drill result:
Final decision (approved / blocked):
```
