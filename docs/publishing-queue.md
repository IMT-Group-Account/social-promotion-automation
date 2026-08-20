# Redis + BullMQ 예약 발행

예약 발행에는 `setTimeout()`을 사용하지 않는다. 하나의 `social_publish_jobs` 행은 하나의 BullMQ delayed job이며, LinkedIn·Facebook·Instagram·Threads·X는 각각 별도로 처리된다.

```text
PostgreSQL social_publish_jobs INSERT
  -> trigger가 social_publish_queue_outbox 행 생성 (같은 DB 트랜잭션)
  -> 별도 publish worker가 outbox를 claim
  -> Redis/BullMQ delayed job (jobId: publish-<publish-job-uuid>)
  -> 예정 시각에 worker가 해당 job 하나만 lease
  -> Adapter 호출
  -> 그 job 행만 published / retrying / failed로 저장
```

outbox의 deterministic BullMQ job ID는 등록 재시도 중에도 중복 delayed job 생성을 막는다. `scheduled_at`은 UTC `timestamptz`로 저장하며, BullMQ delay는 enqueue 시점에 계산한다. Worker 부하나 Redis 장애 때문에 정확히 그 밀리초에 실행된다는 보장은 없으므로 운영 대시보드에서는 예정 시각과 실제 `published_at`을 모두 보여야 한다.

## 실행

PostgreSQL migration `009_bullmq_publish_outbox.sql`을 일반 migration 절차로 먼저 적용한 후, HTTP API와 별도 프로세스로 worker를 실행한다.

```powershell
$env:PUBLISH_WORKER_ENABLED = 'true'
$env:REDIS_URL = 'rediss://:password@redis.example.com:6380'
npm.cmd run build
npm.cmd run start:worker
```

`PUBLISH_WORKER_ENABLED`의 기본값은 `false`다. API 프로세스가 시작됐다는 사실만으로 외부 SNS 발행이 시작되지는 않는다. Redis, DB, OAuth provider 권한이 있는 staging에서 먼저 확인하고, 실제 계정 발행은 운영 승인 범위에서만 수행한다.

## 실패 및 재시도

- 상태는 `waiting` → `processing` → `published`이며, 재시도 대기 중에는 `retrying`이다. 사용자가 취소하면 `cancelled`, 최종 실패하면 `failed`가 된다.
- 429, 공급자 5xx, 네트워크 오류는 첫 실패 후 30초, 두 번째 후 2분, 세 번째 후 10분 뒤 재시도한다. 네 번째 실패는 최종 실패다.
- 401 토큰 만료와 403 권한 오류, 기타 4xx 요청 오류는 재시도하지 않고 즉시 `failed`로 전환한다.
- 최종 실패는 `social_publish_failure_alerts` outbox에 같은 DB 트랜잭션으로 기록되어 관리자 알림 전달 대상이 된다.
- 실패한 X 작업은 그 X 행만 `retrying` 또는 `failed`로 바꾼다. 다른 플랫폼 job은 업데이트하지 않는다.
- DB lease는 중복 BullMQ delivery를 무해하게 만들고, 만료된 lease는 다음 delivery가 다시 claim할 수 있다. 외부 API 호출 성공 직후 프로세스가 죽는 경계에서는 공급자별 멱등성 키/조회 기반 조정이 추가로 필요하다.

환경 변수는 [`.env.example`](../.env.example)에 정리되어 있다.
