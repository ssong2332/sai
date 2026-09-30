/**
 * 확장이 부르는 백엔드 주소.
 *
 * 🔴 여기에 API 키를 두지 않는다. 확장 번들은 누구나 뜯어본다 — 키는 서버(Cloud Functions의
 *    Secret Manager)에만 있다.
 * 🔴 2026-08-13 — Cloud Functions(`sai-global-msg-2026`, `asia-northeast3`)로 전환했다.
 *    배포·curl 실측 확인(Lessons #10): `GET /health` → `configured:true`,
 *    `POST /v1/refine` → 200, 캐시 동작(2회차 155ms). 로컬 프록시(`server/refine-proxy.js`)는
 *    오프라인 개발용으로 계속 쓸 수 있다 — 아래 상수만 바꾸면 된다.
 * 🔴 이 주소를 바꾸면 `src/manifest.js`의 `host_permissions`도 함께 바꿔야 한다 —
 *    MV3 서비스 워커는 권한 없는 오리진으로 fetch할 수 없다.
 */
export const DEPLOYED_ENDPOINT =
  'https://asia-northeast3-sai-global-msg-2026.cloudfunctions.net/refineV1';

/**
 * 팀 생성·참가·마찰 카운트 (Spec §3, 2026-08-15).
 * 🔴 `refineV1`과 **다른 함수**다 — 저건 LLM 시크릿이 붙어 있고 이건 Firestore·Auth를 쓴다.
 *    같은 오리진이라 `host_permissions`는 이미 덮고 있다(추가 권한 불필요).
 */
export const TEAM_ENDPOINT =
  'https://asia-northeast3-sai-global-msg-2026.cloudfunctions.net/teamV1';

/** 오프라인 로컬 개발용. `npm run proxy`가 이 주소로 뜬다. */
export const LOCAL_PROXY_ENDPOINT = 'http://127.0.0.1:8787/v1/refine';

/**
 * 🔴 **이 한 줄만 바꾸면 된다** (2026-08-19 도입 · 2026-09-30 L11로 방식 변경). 예전에는 여기와
 *    `src/manifest.js`의 `host_permissions`를 **함께** 고쳐야 했고, 하나만 고치면 MV3 서비스 워커가
 *    권한 없는 오리진으로 fetch하지 못해 **조용히 전부 실패**했다. 2026-08-19에는 manifest에
 *    localhost 권한을 **항상** 넣어 그 함정을 막았지만, 그러면 **공개 빌드에도** 쓰지 않는 로컬 권한이
 *    실린다(스토어 심사에서 사유를 댈 수 없는 권한). 이제는 아래 `LOCAL_PROXY_HOST_PERMISSIONS`가
 *    **이 값에서 권한을 파생**한다 — 로컬을 가리킬 때만 권한이 붙는다.
 *
 * | 쓰려는 것 | 이 값 | 준비 |
 * |---|---|---|
 * | 배포된 함수 (**기본 · 공개 빌드**) | `DEPLOYED_ENDPOINT` | 없음 — localhost 권한 없음 |
 * | 로컬 프록시 | `LOCAL_PROXY_ENDPOINT` | `npm run proxy` 켜 두기 · 빌드 다시 (권한은 자동) |
 *
 * 🔴 로컬로 바꾸면 **인증이 없다**(프록시는 localhost 전용이라 토큰을 안 본다). 시연·개발용이며
 *    그 상태로 남에게 배포하면 그 사람 화면에서는 전부 실패한다(그 기기에 프록시가 없다).
 * 🔴 프록시를 다른 포트로 띄우면(`SAI_PROXY_PORT`) `LOCAL_PROXY_ENDPOINT`만 그 포트로 고친다 —
 *    권한은 그 주소의 오리진에서 파생되므로 manifest는 손대지 않는다.
 */
export const REFINE_ENDPOINT = DEPLOYED_ENDPOINT;

/**
 * 로컬 프록시용 `host_permissions` — `REFINE_ENDPOINT`가 로컬 프록시일 때만 한 줄, 아니면 빈 배열.
 * `src/manifest.js`가 펼쳐 넣는다 (L11 — 공개 빌드에서 localhost 권한 제거).
 * 🔴 manifest는 빌드 시점에 Node에서 이 파일을 읽는다 — 이 파일 최상단에 `chrome`·`window`를
 *    건드리는 코드를 두지 않는다.
 */
export function localProxyHostPermissions(endpoint) {
  return endpoint === LOCAL_PROXY_ENDPOINT ? [`${new URL(LOCAL_PROXY_ENDPOINT).origin}/*`] : [];
}

export const LOCAL_PROXY_HOST_PERMISSIONS = localProxyHostPermissions(REFINE_ENDPOINT);

/** 프록시가 응답하지 않을 때까지 기다리는 시간. 코어 자체 타임아웃(20초)보다 넉넉히 잡는다. */
export const REFINE_TIMEOUT_MS = 30_000;

/**
 * GitHub OAuth App — Device Flow (S22 / Spec audit 3).
 *
 * 🔴 **비밀이 아니다.** Device Flow는 시크릿을 쓰지 않는 공개 클라이언트 방식이고, client_id는
 *    확장 번들에 어차피 들어간다. 시크릿은 **어디에도 넣지 않는다** — 넣을 자리가 없는 것이 설계다.
 * 🔴 **스코프를 요청하지 않는다** (2026-08-14 사용자 결정). 읽는 것은 전부 공개 데이터라 권한이
 *    필요 없다. 토큰의 유일한 용도는 시간당 한도를 60 → 5,000으로 올리는 것이다. `public_repo`는
 *    공개 레포 **쓰기**까지 열리므로 쓰지 않는다.
 * 🔴 **앞 글자는 대문자 O다 — 숫자 0이 아니다** (2026-08-14 실측에서 실제로 헷갈려 `Not Found`가
 *    났다). GitHub의 새 client_id는 `Ov23li`로 시작한다.
 */
export const GITHUB_CLIENT_ID = 'Ov23liJkfZ0GUE0fktkS';

/** Device Flow 엔드포인트. 🔴 `api.github.com`이 아니라 `github.com`이다. */
export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const GITHUB_DEVICE_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/**
 * 공개 활동을 몇 페이지까지 받을지 (S22).
 * 🔴 **3으로 고정한다** (2026-08-14 실측 근거). 1페이지(100건)만 받으면 대부분이 PushEvent라
 *    분석 가능한 글이 12~13건에 그쳐 활발한 계정도 최소치(15)를 못 넘는다. 3페이지면 40 / 34로
 *    올라간다. GitHub은 이 엔드포인트를 **최대 300건**까지만 주므로 4 이상은 의미가 없다.
 */
export const GITHUB_EVENT_PAGES = 3;

/**
 * 구글 로그인 (S31 / `docs/WebSplit.md` B안 선행 조건).
 *
 * 🔴 **둘 다 비밀이 아니다.** 확장 번들은 누구나 뜯어보므로 애초에 숨길 수 없고, 두 값 모두
 *    공개 식별자다. 실제 보호는 **Firestore 보안 규칙**(`firestore.rules`)이 한다 — 규칙이
 *    `request.auth.uid`로 소유자를 확인하고 **쓸 수 있는 필드를 화이트리스트**로 묶는다.
 * 🔴 **`GOOGLE_WEB_CLIENT_ID`는 manifest의 `oauth2.client_id`와 다른 클라이언트다.**
 *    - manifest 쪽: 유형 **Chrome 확장 프로그램** — `getAuthToken`(캘린더, 크롬 전용).
 *      🔴 2026-09-30부터 `FEATURES.calendar=false`라 공개 빌드 manifest에는 이 블록이 없다(L10).
 *    - 여기: 유형 **웹 애플리케이션** — `launchWebAuthFlow`(로그인, 크롬·엣지 둘 다)
 *    같은 값을 넣으면 조용히 실패한다. 리디렉션 URI로
 *    `https://ogbcccaaojphhgobeeidpafokjieckdf.chromiumapp.org/`가 등록돼 있어야 한다.
 * 🔴 값이 비어 있으면 `isAuthConfigured()`가 false를 주고 **버튼 자체가 안내 문구로 바뀐다** —
 *    플레이스홀더로 눌러 놓고 실패하게 두지 않는다.
 */
export const GOOGLE_WEB_CLIENT_ID =
  '995477529646-3j08tkj47l0sksef8pkgfgj65qab989r.apps.googleusercontent.com';

/**
 * Firebase 웹 API 키 (Firebase 콘솔 → 프로젝트 설정 → 웹 앱 `sai`).
 *
 * 🔴 **CLAUDE.md의 "API 키를 소스에 쓰지 않는다"에 대한 의도된 예외다** (2026-08-14 사용자 고지).
 *    이 값은 성격이 다르다:
 *    - **숨길 방법이 원리적으로 없다.** 확장 번들에 들어가야 동작하고 번들은 누구나 뜯어본다.
 *      `.env`에 넣어도 빌드 시 번들에 박히므로 아무것도 달라지지 않는다.
 *    - **권한을 주는 키가 아니다.** 프로젝트를 가리키는 식별자에 가깝다. 실제 보호는
 *      **`firestore.rules`**(소유자 확인 + 필드 화이트리스트)와 Identity Toolkit의 인증이 한다.
 *    - GitHub `client_id`·OAuth `client_id`·manifest `key`와 같은 취급이다.
 *    🔴 그래도 **Google Cloud에서 API 키 제한을 걸어 두는 것이 옳다** — 사용 설정된 API를
 *       Identity Toolkit·Firestore로 좁히면 이 키로 다른 API를 호출할 수 없다.
 * 🔴 **provider API 키(OpenAI/Gemini)와 혼동하지 않는다.** 그쪽은 진짜 비밀이라 서버에만 있다.
 */
export const FIREBASE_API_KEY = 'AIzaSyDFz9uhmzU0_zA2oiCd3s0_pYE7lu-7teE';

/** Firestore REST 경로에 쓰는 프로젝트 id. */
export const FIREBASE_PROJECT_ID = 'sai-global-msg-2026';

/**
 * 기능 스위치.
 *
 * 🔴 **`decisionSummary: false` — 코드는 남기고 기능만 끈다** (2026-08-14 사용자 결정).
 *
 *    끈 이유(실측): 배포 실측에서 결정이 3건 있는 대화에서 **1건만 뽑았다.** 교정은 사용자가
 *    자기 원문과 비교해 이상을 알아챌 수 있지만, 결정 표는 **그 자리에 없던 사람이 읽는 것**이라
 *    비교 대상이 없다 — 표에 3줄이 있으면 그게 전부라고 믿는다. **누락을 알아챌 방법이 구조적으로
 *    없다.** 스키마 가드가 막는 것은 "근거 없이 확정이라 말하는 것"까지이고 누락은 못 막는다.
 *
 *    다시 켤 조건: provider를 Spec §6-3 기준(OpenAI)으로 바꾸고 `npm run test:refine:live` 20건을
 *    통과시킨 뒤, **결정 요약의 누락률을 따로 측정**해서 납득될 때. 그때 이 값만 `true`로 바꾸면
 *    된다 — 코어(`src/core/decisions/`)·서버 모드·저장소·전용 페이지는 전부 그대로 있다.
 *
 *    🔴 끄는 것은 **진입점(선택 툴바 버튼)뿐**이다. 결정 로그 페이지 자체는 살아 있어서, 이미
 *    동의하고 저장해 둔 사람은 `chrome-extension://<id>/src/decisions/index.html`로 자기 기록을
 *    보고 지울 수 있다. 기능을 끈다고 남의 데이터를 가둬 두지 않는다.
 */
export const FEATURES = {
  decisionSummary: false,
  /**
   * 🔴 **포인트 — 공개 빌드에서 끈다** (2026-09-30 L17, 출시 결정 「유료화는 나중」 Spec §0).
   *    적립은 동작하지만 **쓸 곳이 없다.** 홈 카드가 「소통 가이드 상세 열람에 사용할 수 있어요」라고
   *    말하는데 그런 기능은 없다 — 없는 기능을 약속하는 문구다. 끄면 카드·`+P` 표시·적립 토스트가
   *    모두 사라지고 **적립 자체도 하지 않는다**(보이지 않는 잔액을 쌓아 두지 않는다).
   *    다시 켤 조건: 포인트 사용처가 유료화와 함께 생길 때.
   */
  points: false,
  /**
   * 🔴 **GitHub 아이디 불러오기 — 공개 빌드에서 끈다** (2026-09-30 L17).
   *    S22에 **실확장 확인 기록이 없다**(Tasks S22 「진행 중」 — 실 API 종단 확인까지만). 출시 규칙은
   *    「실확장 확인 없는 기능은 공개 빌드에서 켜지 않는다」(Tasks 출시 v1.0). 또 **제3자(수신자)의
   *    공개 활동을 조회**하는 기능이라 개인정보처리방침에 따로 설명해야 한다 — 확인 전에는 열지 않는다.
   *    끄면 수신자 폼의 「GitHub 아이디」 줄이 사라지고, manifest의 GitHub 권한도 빠진다(`src/manifest.js`).
   *    다시 켤 조건: 실확장 확인 + 처리방침에 제3자 공개 정보 조회 항목 추가.
   */
  githubLookup: false,
  /**
   * 🔴 **캘린더 빈 시간(FreeBusy) — 첫 출시에서 뺀다** (2026-09-30 사용자 결정, Spec §0 · Tasks L10).
   *    `calendar.readonly`는 구글의 **민감 범위**라 OAuth 앱 검증을 통과하기 전에는 「확인되지 않은 앱」
   *    경고와 사용자 수 상한이 붙는다. 검증 대기를 출시 경로에서 뺀다.
   *    끄면: 회의 시간 추천의 「내 일정 빼고 보기」가 사라지고(추천 자체는 시차 기준으로 그대로 동작),
   *    manifest의 `oauth2` 블록과 `https://www.googleapis.com/*` 권한도 빠진다(`src/manifest.js`).
   *    「일정 만들기」 링크는 남는다 — 구글/아웃룩의 새 일정 화면을 URL로 열 뿐 API·권한이 없다.
   *    다시 켤 조건: 구글 OAuth 검증 통과 + 처리방침에 캘린더 항목 추가.
   */
  calendar: false,
};

/**
 * S18 — B2B 웹 대시보드 URL. `dashboard/`(별도 Vite 앱)를 Firebase Hosting에 배포한 주소.
 * 🔴 2026-08-13 — 아직 배포 전이다(`firebase deploy --only hosting` 미실행, 사용자 승인 대기).
 *    배포 완료 후 실제 URL을 curl로 확인하고 이 주석을 갱신한다(Lessons #10 — 배포 성공과 URL
 *    동작은 별개).
 */
export const DASHBOARD_URL = 'https://sai-global-msg-2026.web.app';
