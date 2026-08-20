# PostgreSQL 데이터 모델

모든 시간은 PostgreSQL `timestamptz` UTC로 저장한다. 토큰·authorization code·SNS provider 원문 응답은 이 모델의 일반 컬럼이나 audit metadata에 저장하지 않는다.

```text
users
 ├─< social_accounts
 ├─< campaigns ─< posts ─< post_media
 │                       └─< social_publish_jobs ─1 social_posts ─< social_metrics
 ├─< oauth_states
 └─< audit_logs
```

`social_publish_jobs`는 Post와 선택된 SocialAccount의 교차점이다. 그래서 동일 Post의 LinkedIn 실패는 Facebook·Instagram·Threads·X job을 변경하지 않는다. `social_posts`는 성공한 job의 원격 post ID/URL을 분리해 보관하며, `social_metrics`는 해당 원격 post의 시간별 metric snapshot이다.

| 테이블 | 역할 | 핵심 관계 |
| --- | --- | --- |
| `users` | 애플리케이션 사용자 | SocialAccount, Campaign의 소유자 |
| `social_accounts` | 암호화 토큰을 가진 SNS 계정 | `user_id → users.id` |
| `campaigns` | 사용자 캠페인 | `owner_id → users.id` |
| `posts` | 원본 콘텐츠와 예약 시각 | `campaign_id → campaigns.id`, `owner_id → users.id` |
| `post_media` | Post의 이미지/영상 URL | `post_id → posts.id` |
| `social_publish_jobs` | 계정별 독립 게시 상태/재시도 | `post_id → posts.id`, `account_id → social_accounts.id` |
| `social_posts` | 성공한 원격 SNS 게시물 | `social_publish_job_id → social_publish_jobs.id` (1:1) |
| `social_metrics` | 원격 게시물의 시계열 metric | `social_post_id → social_posts.id` (1:N) |
| `oauth_states` | hash된 OAuth state와 PKCE verifier ciphertext | `user_id → users.id` |
| `audit_logs` | 민감값 없는 보안/운영 감사 기록 | `user_id → users.id` |

현재 runtime은 SNS 계정 연결/해제, 성공 게시, 최종 게시 실패를 `audit_logs`에 기록한다. audit metadata에는 platform, 오류 코드, retry count 등 운영 진단값만 넣으며 OAuth token, refresh token, authorization code, 원격 API 원문은 저장하지 않는다.

## Migration 011 적용 순서

`011_postgresql_canonical_social_model.sql`은 먼저 기존 user ID를 `users`에 backfill하고, FK를 추가한 뒤 `oauth_authorization_states`를 `oauth_states`로 rename한다. 기존 analytics snapshot은 `social_posts`와 `social_metrics`로 복사한 후 이전 snapshot table을 제거한다. 따라서 migration runner는 이 파일을 transaction으로 적용해야 하며, 실행 전 PostgreSQL backup과 staging 검증이 필요하다.

`social_posts`와 `social_metrics`에 맞춰 runtime repository SQL도 함께 전환됐다. 이전 앱 버전이 `oauth_authorization_states` 또는 `social_post_analytics_snapshots`를 직접 조회한 채로 실행되면 migration 이후 실패하므로, API/Worker 배포와 migration을 같은 release로 진행한다.
