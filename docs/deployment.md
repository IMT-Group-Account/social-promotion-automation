# Vercel + Oracle Cloud 배포

## 목표 구조

```text
                [ 관리자 ]
                    │
                    ▼
            ┌───────────────┐
            │    Next.js    │
            │    Vercel     │
            └───────┬───────┘
                    │ REST API
                    ▼
          ┌───────────────────┐
          │      NestJS       │
          │   Oracle Cloud    │
          └─────────┬─────────┘
                    │
         ┌──────────┴───────────┐
         │                      │
         ▼                      ▼
    PostgreSQL                Redis
                               │
                               ▼
                             BullMQ
                               │
                       ┌───────┴───────┐
                       │ Publish Worker│
                       └───────┬───────┘
                               │
          ┌────────┬───────────┼──────────┬─────────┐
          ▼        ▼           ▼          ▼         ▼
      LinkedIn  Facebook   Instagram   Threads      X
         API       API        API        API       API
```

GitHub는 `frontend/` 변경을 Vercel 프로젝트로, `backend/` 변경을 Oracle Cloud VM의 Compose 이미지 빌드로 전달한다. Analytics Scheduler는 같은 Oracle VM에서 별도 프로세스로 실행되며 PostgreSQL에 저장된 성공 발행 건을 조회해 각 Adapter의 조회 API를 호출한다.

Vercel 브라우저 앱은 자체 API만 호출한다. OAuth 토큰과 SNS API 비밀값은 Oracle VM의 `backend.env`에만 두며, `NEXT_PUBLIC_*` 변수와 브라우저 저장소에는 넣지 않는다.

## Vercel: frontend만 배포

1. GitHub 저장소를 Vercel 프로젝트에 연결하고 **Root Directory**를 `frontend`로 지정한다.
2. Production 환경 변수 `NEXT_PUBLIC_API_BASE_URL`을 Oracle API의 HTTPS origin(예: `https://api.example.com`)으로 설정한다.
3. Vercel 배포 URL과 커스텀 도메인을 Oracle의 `CORS_ORIGINS`에 정확히 쉼표로 구분해 넣는다.
4. `frontend/vercel.json`은 Next.js framework 및 기본 응답 헤더만 설정한다. OAuth provider callback은 Vercel이 아니라 Oracle API URL을 등록한다.

## Oracle Cloud VM: backend 실행

VM에는 Docker Engine 및 Docker Compose plugin이 설치되어 있어야 한다. PostgreSQL 및 Redis는 VM 내부 서비스 또는 private/TLS managed endpoint 모두 가능하지만, Oracle VM과 네트워크를 분리하고 공인 인터넷에 인증 없이 노출하지 않는다.

```bash
git clone <repository-url>
cd <repository>/infrastructure/oracle
cp backend.env.example backend.env
# backend.env에 DATABASE_URL, REDIS_URL, OAuth provider secrets, CORS_ORIGINS를 채운다.
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 api worker scheduler
```

`api`, `worker`, `scheduler`는 동일한 빌드 이미지를 사용하지만 서로 다른 실행 프로세스다. 따라서 X 작업이 실패해도 다른 플랫폼의 BullMQ job 상태나 analytics 작업을 실패로 전파하지 않는다. API는 `GET /api/health`로 liveness를 제공한다.

Oracle 앞단에는 HTTPS reverse proxy 또는 load balancer를 두고 443만 외부에 노출한다. Compose의 기본 API 포트(3000)는 방화벽 또는 보안 목록에서 reverse proxy만 접근할 수 있게 제한한다.

## 배포 순서와 롤백

1. 먼저 새 이미지가 마이그레이션과 호환되는지 staging에서 확인한다.
2. 데이터베이스 마이그레이션을 별도, 단일 실행 작업으로 적용한다. `docker compose up`가 자동으로 스키마를 변경하지는 않는다.
3. `docker compose up -d --build`로 API, Worker, Scheduler를 함께 교체한다.
4. `/api/health`, worker 로그, BullMQ 대기열 및 CORS preflight를 확인한다.
5. 장애 시 마지막 정상 Git revision으로 checkout한 뒤 같은 Compose 명령으로 이미지를 재생성한다. 이미 적용한 DB migration은 되돌리기보다 호환되는 복구 migration을 추가한다.

## 필수 환경 변수

- `DATABASE_URL`, `REDIS_URL`: backend 전용 연결 정보
- `OAUTH_TOKEN_ENCRYPTION_KEY`: base64 인코딩한 32-byte AES-256 키
- `PUBLIC_API_ORIGIN`: Oracle API의 HTTPS origin; 각 SNS OAuth callback 등록값의 기준
- `CORS_ORIGINS`: Vercel frontend의 정확한 origin 목록
- OAuth, LinkedIn/Meta/Threads/X/Kakao provider 변수: root `.env.example`의 해당 키 전부
- `ANALYTICS_COLLECTION_INTERVAL_MS`: 1분~24시간. 비우면 Scheduler는 시작하지만 수집하지 않는다.

`PUBLISH_WORKER_ENABLED`와 `SCHEDULER_ENABLED`는 Compose가 worker/scheduler 컨테이너에만 강제로 설정한다. API 컨테이너에는 설정하지 않는다.
