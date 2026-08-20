# 관리자 홍보 콘솔

`frontend`는 Next.js App Router 기반 관리자 화면이다. 브라우저는 다음 Backend API만 호출한다.

- `GET /api/integrations`으로 연결된 계정을 읽고 활성 계정만 선택 가능하게 표시한다.
- `POST /api/campaigns`, `POST /api/posts`로 캠페인과 SNS별 publish job을 만든다.
- `POST /api/posts/:id/publish` 또는 `POST /api/posts/:id/schedule`로 Worker 작업을 요청한다.
- `GET /api/posts/:id/results`로 `waiting`, `processing`, `published`, `retrying`, `failed`, `cancelled`를 표시한다.

결과 패널은 `published`를 성공으로, `retrying`을 재시도 중으로 보여주고 `nextRetryAt`이 있으면 다음 재시도 시각을 표시한다. 프론트엔드는 SNS API·OAuth token·Redis에 직접 접속하지 않는다.

현재 파일 선택은 로컬 미리보기만 제공한다. Backend media storage endpoint가 아직 없으므로 실제 게시에는 업로드 완료된 HTTPS 이미지 URL을 입력해야 한다. browser blob URL이나 임시 파일 경로는 post payload에 보내지 않는다.
