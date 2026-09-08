# 1차 필수 SNS 홍보 운영 흐름

## 구현 범위

- 캠페인·게시물·미디어·SNS별 작업을 PostgreSQL에 저장한다. 런타임 메모리 저장소는 제거하고 테스트에서만 사용한다.
- 생성 API는 항상 `draft`를 만든다. 초안에는 큐 작업이 생기지 않는다.
- 초안 수정은 `revision`을 비교한다. 저장된 버전의 SNS별 미리보기와 `approvedRevision`을 확인한 후에만 발행·예약한다.
- 예약 변경·승인·취소·재시도는 게시물과 작업을 잠그고 하나의 트랜잭션으로 처리한다. 기존 Worker는 변경 전 큐 식별자로 작업을 실행할 수 없다.
- 최종 결과가 확실한 실패만 수동 재시도한다. `remote_request_key`가 남은 불명확한 실패는 재시도·취소를 차단한다.
- 원격 게시 성공을 이미 DB에 기록한 경우 재실행은 로컬 저장만 마무리한다. 원격 요청 중 프로세스가 종료되면 만료된 lease를 통해 재확인한다.
- 관리자 화면: 계정 연결·해제·재연결, 권한·만료 안내, 업로드, 정사각형 JPEG 변환, 초안 저장, SNS별 문구, 최종 검수·승인, 예약 캘린더, 복제, 실패 안내·재시도.
- 업로드 파일은 영구 볼륨에 저장하며 공개 HTTPS URL로 SNS가 읽는다. 초안 파일도 URL을 알면 접근할 수 있으므로 게시용 자료만 업로드한다.
- 로그인은 앱 인증 제공자의 Authorization Code + PKCE를 사용한다. 서비스 JWT는 HttpOnly 쿠키에 두고 Next.js 서버가 Backend의 Bearer 헤더로 전달한다. SNS 토큰은 Backend 밖으로 보내지 않는다.

## 최초 운영 설정

1. Backend DB를 백업하고 기존 API의 쓰기를 중지한 뒤 Worker·Scheduler를 정지한다. `001`~`013`이 적용된 DB에 `014_editorial_workflow.sql`을 기존 마이그레이션 절차로 적용한다. 이 저장소 변경은 운영 DB에 자동 적용되지 않는다.
2. 새 API·Worker·Scheduler를 함께 배포한다. 이전 API는 승인 절차와 새 큐 식별자를 모르므로 새 DB와 혼용하지 않는다.
3. Backend `.env.example`의 기존 DB·Redis·서비스 JWT·SNS OAuth 설정에 `ADMIN_CONSOLE_ORIGIN`, `MEDIA_STORAGE_DIR`, `MEDIA_PUBLIC_BASE_URL`을 추가한다. Oracle Compose의 API에는 영구 `media-uploads` 볼륨이 연결된다. 해당 볼륨을 별도로 백업한다.
4. Frontend는 `frontend/.env.example`을 기준으로 `BACKEND_API_URL`, `APP_ORIGIN`, 앱 로그인 제공자의 `AUTH_*`, `NEXT_PUBLIC_OAUTH_CALLBACK_ORIGIN`을 설정한다. 기존 `NEXT_PUBLIC_API_BASE_URL`은 사용하지 않는다.
5. 앱 로그인 제공자에 `${APP_ORIGIN}/api/auth/callback`을 등록한다. 발급하는 access token은 Backend가 검증하는 issuer/audience/알고리즘을 사용하고 **sub가 UUID 사용자 ID**여야 한다. 다른 형식의 인증 서비스는 별도 사용자 매핑이 필요하다. 세션 만료 시 다시 로그인한다.
6. SNS별 callback은 기존 Backend `/api/oauth/*/callback`을 사용한다. Meta는 팝업 결과를 받은 다음 관리할 페이지를 선택한다. Instagram을 선택하면 그 페이지에 연결된 프로페셔널 계정을 조회하여 Instagram 계정으로 저장한다.
7. Backend 환경에서 `npm.cmd run check:editorial`을 실행한다. 이 명령은 DB를 읽기만 하며 환경변수의 값을 출력하지 않는다.

## API 변경

| API | 동작 |
| --- | --- |
| `POST /api/posts` | 항상 초안 생성. 캠페인·대상 계정 ID는 UUID |
| `GET /api/posts?offset=0` | 소유한 게시물 50개씩 조회 |
| `PATCH /api/posts/:id` | `{revision, content}`로 초안 수정. 저장된 대상 계정은 고정 |
| `GET /api/posts/:id/preview` | `{revision, items, issues}`. 게시 제한을 미리 표시 |
| `POST /api/posts/:id/publish` | `{approvedRevision}`로 즉시 게시 요청 |
| `POST /api/posts/:id/schedule` | `{approvedRevision, scheduledAt}`로 승인·예약 변경 |
| `POST /api/posts/:id/cancel` | `{approvedRevision}`로 남은 작업 취소. 실제 SNS 글은 삭제하지 않음 |
| `POST /api/posts/:id/jobs/:jobId/retry` | `{approvedRevision}`. 확실한 실패 작업 하나만 재시도 |
| `POST /api/posts/:id/duplicate` | 새 초안 생성 |
| `POST /api/media` | 인증된 multipart `file` 업로드 |
| `GET /api/media/files/:name` | 공개된 게시용 파일 조회 |

## 현재 지원 제한

- 관리자 업로드는 Vercel 요청 크기를 고려해 **4MB 미만** JPEG·PNG·MP4로 제한한다. Backend 자체 한도는 이미지 8MB·동영상 32MB다. 대용량 동영상·분할 업로드는 이번 범위에 포함하지 않는다.
- 정사각형 변환은 중앙을 기준으로 1080×1080 JPEG로 만든다. 원본을 보존하려면 일반 업로드를 사용한다.
- 현재 LinkedIn 어댑터는 업로드된 LinkedIn URN을 요구한다. 관리자에서는 텍스트·링크 게시를 지원하고 일반 파일 첨부는 승인 전에 차단한다. LinkedIn 바이너리 업로드 연동은 별도 작업이다.
- Instagram·Facebook·Threads는 현재 단일 미디어 게시만 지원한다. Instagram PNG는 JPEG 변환을 안내한다. X 길이 검사는 비ASCII 문자를 보수적으로 계산한다. 실제 플랫폼의 모든 특수문자·미디어 상세 규칙을 대체하지 않는다.
- 캘린더와 실패 안내는 현재 불러온 50개 게시물 기준임을 화면에 표시한다. 앞뒤 페이지로 다른 이력을 조회할 수 있다. 실패 알림은 앱 내 표시이며 이메일·메신저 발송은 하지 않는다.
- 소유 계정, 만료, 현재 어댑터에 필요한 게시 권한을 검증하지만 SNS 앱 심사·API 권한·계정 유형의 실환경 상태는 별도 검증해야 한다.
- LinkedIn 로그인에서 받은 개인 계정 식별자는 게시 시 Person URN으로 변환한다. [LinkedIn 공식 게시 가이드](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)의 author 형식을 따른다.

## 반복 검증

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
```

실제 PostgreSQL 통합 검사는 **별도 로컬 테스트 DB만** 허용한다. 운영 DB URL로 실행할 수 없다. 테스트별 격리 스키마를 만들고 종료 시 해당 스키마만 정리한다. SNS 호출은 테스트 어댑터로 대체한다.

```powershell
$env:TEST_DATABASE_URL='postgresql://<test-user>:<test-password>@127.0.0.1:<port>/promotion_test_editorial'
npm.cmd run test:editorial:db
```

로컬 PostgreSQL이 없는 Windows에서는 별도 도구 디렉터리에 `embedded-postgres@18.4.0-beta.17`을 설치하고 실행할 수 있다. 이 도구는 제품 의존성에 추가하지 않는다.

```powershell
npm.cmd install --prefix <test-tools-directory> --no-save --no-package-lock embedded-postgres@18.4.0-beta.17
$env:EDITORIAL_TEST_TOOLS='<test-tools-directory>'
npm.cmd run test:editorial:local
```

이 명령은 localhost 전용 임시 PostgreSQL을 시작하고 14개 마이그레이션, 영구 저장·읽기, 소유권·롤백, 동시 승인·버전 충돌, 오래된 큐 무시, 중복 실행 방지, 실패 격리·복구, 취소·복제를 검사한다. 임시 DB 프로세스는 종료하며 테스트 데이터 디렉터리는 OS 임시 폴더에 남긴다.

브라우저 재검증은 `npm.cmd run test:editorial:fixture`로 로컬 fixture를 시작하고 Frontend를 `APP_ORIGIN=http://localhost:3100`, `BACKEND_API_URL=http://127.0.0.1:3199/api`, `NEXT_PUBLIC_OAUTH_CALLBACK_ORIGIN=http://localhost:3199` 환경으로 포트 3100에서 실행한다. `http://localhost:3199/start`에서 전용 테스트 세션으로 진입한다. 이 서버는 개발 스크립트이고 제품에서 가져오지 않으며 실제 SNS에 접근하지 않는다.

두 로컬 서버가 실행 중이면 `node scripts/test-editorial-proxy.mjs`로 세션·프록시 허용 경로·교차 출처 요청 차단·업로드 크기·로그아웃·로그인 callback 상태 검사를 반복할 수 있다.

## 확인된 범위와 남은 운영 검증

2026-09-08 로컬 확인 결과:

| 검증 | 결과 |
| --- | --- |
| Backend 단위·HTTP 테스트 | 64개 통과. 실제 파일 저장·HTTP 다운로드 포함 |
| 로컬 PostgreSQL 18 통합 검사 | 10개 통과. 001~014 실제 적용, provider 호출은 테스트 어댑터 |
| 로컬 Next.js BFF 검사 | 7개 통과 |
| Backend·Frontend lint, TypeScript, build | 통과 |
| Chrome fixture 화면 | 초안 저장, SNS별 문구 검수, 승인 잠금, 예약 승인·변경·취소, 캘린더, 실패 SNS만 재시도, 연결 팝업 결과 전달 확인 |
| 운영 준비 상태 검사 | 현재 셸의 Backend 필수 환경 변수 9개 미설정으로 미충족 |

CI에 PostgreSQL 통합 검사와 Frontend 검사를 추가했으며, 원격 CI 실행은 이번 작업에서 수행하지 않았다.

로컬 단위·HTTP·PostgreSQL 통합 검사와 fixture 기반 브라우저 검증을 운영 SNS 게시 성공으로 간주하지 않는다. 운영 마이그레이션·배포, 실제 앱 로그인, 실제 SNS OAuth·앱 심사, Redis/BullMQ 연결, 공개 HTTPS 미디어 접근, 예약 게시의 실제 URL·플랫폼 읽기 확인은 운영 환경에서 별도로 완료해야 한다.
