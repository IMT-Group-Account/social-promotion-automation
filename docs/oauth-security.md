# SNS OAuth connection flow

```text
Frontend
  -> Authorization: Bearer <our-service-jwt>
  -> NestJS ServiceJwtAuthGuard
  -> req.user.id
  -> POST /api/integrations/{linkedin|facebook|threads|x}/connect
  -> provider authorization and consent
  -> GET /api/oauth/{linkedin|meta|threads|x}/callback?code&state
  -> server-only token exchange and identity lookup
  -> AES-256-GCM encryption
  -> social_accounts
```

## Security controls

- The server creates a cryptographically random `state` and PKCE verifier for every connect request.
- Only the SHA-256 hash of `state` is retained. `oauth_states` atomically consumes it, so it expires after ten minutes and cannot be replayed.
- The PKCE verifier, access token, and optional refresh token are AES-256-GCM encrypted using the server-only versioned key ring before persistence. `OAUTH_TOKEN_ENCRYPTION_KEYS` is a JSON map of version to base64 32-byte AES key, and `OAUTH_TOKEN_ENCRYPTION_KEY_VERSION` chooses the one current write key. A ciphertext such as `v1.<iv>.<tag>.<ciphertext>` is always decrypted with the retained `v1` key; new ciphertexts are written with the current version only.
- Rotation is deploy-first: add the new key alongside the old key, change `OAUTH_TOKEN_ENCRYPTION_KEY_VERSION` to the new version, then retain the old key until all corresponding OAuth states and credentials are expired, revoked, or re-encrypted. Removing a referenced key makes that ciphertext fail closed. `OAUTH_TOKEN_ENCRYPTION_KEY` remains a deprecated single-key compatibility fallback and is ignored when the key ring is configured.
- Callback responses expose account metadata only. They never contain a provider access token, refresh token, encryption key, or credential reference.
- `ServiceJwtAuthGuard` verifies only our service's HS256 JWT: signature, `iss`, `aud`, mandatory unexpired `exp`, optional `nbf`, and nonempty `sub`. It maps `sub` to `request.user.id`. Query parameters, request bodies, browser storage, and OAuth-provider tokens are never accepted as the user identity.
- `SERVICE_JWT_SECRET`, `SERVICE_JWT_ISSUER`, and `SERVICE_JWT_AUDIENCE` are required at API startup. The secret must be at least 32 bytes and stays server-side; the upstream authentication service and this API must use the same issuer/audience contract.
- The global guard protects all NestJS routes unless `@PublicRoute()` is explicitly applied. OAuth callbacks, the health check, and Kakao's inbound public-link/webhook routes are public because they are not browser user API calls; the Kakao event route retains its separate integration-key check.

## Callback registration

Register these exact backend URLs in provider consoles, replacing the example origin with the `PUBLIC_API_ORIGIN` value:

- `https://api.example.com/api/oauth/linkedin/callback`
- `https://api.example.com/api/oauth/meta/callback`
- `https://api.example.com/api/oauth/threads/callback`
- `https://api.example.com/api/oauth/x/callback`

Use backend-only environment variables from `.env.example`. Do not put access tokens, refresh tokens, OAuth client secrets, database URLs, or the encryption key in frontend environment variables, `localStorage`, or `sessionStorage`.

## Provider boundary

The generic provider uses configured authorization, token, and profile endpoints. LinkedIn, Facebook/Meta, and X have separate profile parsers and a common Authorization Code + PKCE contract. The exact scopes and products must be approved in each provider console before a live connection is enabled.

## LinkedIn publishing authorization

The LinkedIn adapter determines the required scope from the stored author URN:

- `urn:li:organization:*` requires `w_organization_social` to publish and `r_organization_social` to retrieve statistics or posts.
- `urn:li:person:*` requires `w_member_social` to publish and `r_member_social` to retrieve statistics or posts.

An OAuth identity record alone is not sufficient to publish to a company page. Its `platform_account_id` must be a verified person or organization author URN. The application must obtain/verify that organization selection and page role before storing it. Raw HTTPS media is also not passed to LinkedIn Posts API: images and videos must first have a LinkedIn asset URN.

## Facebook Page selection

Facebook Login initially receives a user token only to retrieve managed Pages. The callback returns an opaque `selectionId` and Page IDs/names, never a Page token. The authenticated user then calls `POST /api/integrations/facebook/pages/select` with the selected Page ID. The server consumes the one-time selection and writes that Page's encrypted access token to `social_accounts` as `platform=facebook`, `platform_account_id=pageId`.

Facebook publishing uses only that saved Page token. It requires `pages_manage_posts`; reading posts or statistics requires `pages_read_engagement`. The adapter routes text/link content to `/{page-id}/feed`, images to `/{page-id}/photos`, and video URLs to `/{page-id}/videos`.

## Instagram publishing prerequisites

Instagram is a separate `social_accounts` platform and a separate adapter even though it uses Meta Graph API. It requires a Professional Instagram account linked to a managed Facebook Page, an approved Meta app, and at least `instagram_basic` plus `instagram_content_publish`. The access token remains server-side and encrypted. The adapter creates a media container, polls its processing status, and only then calls `media_publish`; it does not treat container creation as publication success.

## Threads OAuth and publishing prerequisites

Threads is a separate OAuth provider and a separate `social_accounts` platform. The authenticated `POST /api/integrations/threads/connect` route starts a distinct Authorization Code + PKCE flow and its callback saves only the encrypted Threads user access token and Threads User ID. It does not reuse a Facebook Page or Instagram account token.

The Threads adapter requires `threads_content_publish` to create `/{threads-user-id}/threads` content and publish it through `/{threads-user-id}/threads_publish`. Reads, including `getPost()` and `getReplies()`, require `threads_basic`. The Meta app must have the Threads product, current permissions, approved use case, and registered callback URL before a live account can connect. The implementation supports text plus one HTTPS image or video; carousel and provider-specific video readiness handling remain explicit future work.

## X publishing and cost boundary

The X adapter uses the separately encrypted `platform=x` OAuth user credential. Posting and deletion require `tweet.read`, `tweet.write`, and `users.read`; lookup requires `tweet.read` and `users.read`. It sends text or `media.media_ids` only to `POST /2/tweets`, and deletes only with `DELETE /2/tweets/{postId}`.

For media, the backend downloads from a configured allowlist in `X_MEDIA_ALLOWED_HOSTS`, enforces `X_MEDIA_MAX_BYTES`, base64-encodes the verified response, uploads to `POST /2/media/upload`, and then attaches the returned media ID. It never permits arbitrary user-supplied URLs to become server-side fetch destinations.

Each X request reserves an estimate in `x_api_usage_ledger` before its external request, then settles it as succeeded or failed without retrying a completed publication because accounting settlement failed. Prices are integer micro-USD values supplied only through `X_API_COST_*` settings and labeled by `X_API_PRICING_VERSION`; reconcile this estimate against the X Developer Console because provider rates and actual billing can change.
