# 데스크톱 앱 설치

소스 폴더를 전달받은 Windows 사용자는 저장소 최상단의 `start.cmd`를 실행한다.
운영 담당자가 `app.url.example`을 `app.url`로 복사하고 실제 HTTPS 관리자 주소
한 줄을 입력하면 `start.cmd`가 해당 앱을 바로 연다. `app.url`은 Git에서 제외된다.

운영 주소가 아직 없으면 `start.cmd`에서 실제 SNS를 호출하지 않는 로컬 데모와
`남은 것.md` 열기만 선택할 수 있다.

관리자 화면은 Windows용 설치형 PWA로 제공된다. 별도의 Electron 실행 파일에
서버 비밀값을 넣지 않고, Chrome 또는 Edge가 HTTPS 관리자 사이트를 독립된 앱
창으로 설치한다.

## 운영 전제조건

- 관리자 프런트엔드가 HTTPS로 배포돼 있어야 한다.
- `APP_ORIGIN`, `BACKEND_API_URL`, OAuth callback origin이 운영 주소와 일치해야 한다.
- 브라우저가 `/manifest.webmanifest`, `/pwa-icon/192`, `/pwa-icon/512`, `/sw.js`를
  정상적으로 받을 수 있어야 한다.
- API와 인증 서비스가 준비되지 않은 상태에서도 설치는 가능하지만 로그인과
  SNS 관리 기능은 사용할 수 없다.

## Windows 설치 방법

1. Edge 또는 Chrome에서 운영 관리자 주소를 연다.
2. 화면 오른쪽 아래의 `설치` 버튼을 선택한다.
3. 브라우저 설치 확인 창에서 설치를 승인한다.
4. 시작 메뉴 또는 작업 표시줄의 `SNS 홍보` 앱을 실행한다.

브라우저가 아직 설치 조건을 확인하지 못했으면 화면의 설치 안내가 나타나지
않는다. 이 경우 페이지를 새로 고치고 주소창의 앱 설치 아이콘을 확인한다.

## 보안 동작

- SNS access token, OAuth client secret, DB URL과 Redis URL은 설치 앱에 포함되지 않는다.
- 인증은 기존 `HttpOnly` 세션 쿠키와 같은 출처의 BFF를 사용한다.
- 서비스 워커는 관리자 페이지와 API 응답을 캐시하지 않는다.
- 네트워크가 끊기면 게시·예약 요청을 로컬에 보관하거나 나중에 자동 전송하지
  않고 실패 처리한다. 중복 게시 위험을 막기 위한 의도적인 동작이다.
- 공유 PC에서는 사용 후 로그아웃하고 앱을 제거한다.

## 업데이트와 제거

앱 화면은 서버에 배포된 최신 버전을 사용한다. 새 버전 배포 후 앱을 완전히
종료하고 다시 실행하면 최신 자산을 받는다.

제거는 Edge/Chrome 앱 메뉴 또는 Windows의 설치된 앱 화면에서 수행한다. 앱을
제거해도 서버의 캠페인·게시 기록은 삭제되지 않는다.

## 배포 검증

```text
GET /manifest.webmanifest -> 200, application/manifest+json
GET /pwa-icon/192         -> 200, image/png
GET /pwa-icon/512         -> 200, image/png
GET /sw.js                -> 200, no-cache
```

최종 검증은 실제 운영 HTTPS 주소에서 설치, 시작 메뉴 실행, 로그인, 로그아웃,
OAuth 팝업 복귀, 새 버전 반영을 확인해야 완료된다.
