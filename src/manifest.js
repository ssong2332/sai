import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  /**
   * 🔴 **확장 ID 고정용 공개키** (2026-08-14, S22·S23 OAuth 준비).
   *
   * 언팩 확장의 ID는 **로드한 폴더의 절대 경로**에서 파생된다. 지금은 워크트리에서 로드하고
   * 있어서, 나중에 `C:\sai`로 옮기거나 다른 PC에서 로드하면 **ID가 바뀐다.** OAuth 클라이언트는
   * ID에 묶여 있으므로 그 순간 구글·GitHub 연동이 통째로 깨진다. 이 `key`를 넣으면 경로와
   * 무관하게 ID가 고정된다.
   *
   * 고정된 ID: **ogbcccaaojphhgobeeidpafokjieckdf**
   *
   * 🔴 이 값은 **공개키다 — 비밀이 아니다.** 커밋해도 되고, 오히려 커밋해야 팀·다른 PC에서
   *    같은 ID가 나온다. 짝이 되는 **개인키는 저장소 밖**(`C:\sai-secrets\sai-extension-key.pem`)에
   *    있다. 개인키는 `.crx`를 직접 서명해 배포할 때만 필요하며, 웹스토어 업로드에는 필요 없다.
   *    잃어버려도 이 `key`가 manifest에 있는 한 ID는 유지된다.
   * 🔴 **이 값을 바꾸면 ID가 바뀐다** — 등록해 둔 OAuth 클라이언트가 전부 무효가 된다.
   */
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzXBg0vYEbD7p/OVzWPrMtmNSESszVdML3yuFDRqAUpPAg18SoKsw9uhnCeo9+AC33rjM42y8aCymeYxUlI35HCYDoDs0yRbtf5XnzRFSyvL1sOCm7bDQmCpPy0bF+5+dMFQQMWoKmeRv6y9OErWk6CTcBI5dAPPMSOAXneL0sAKRatCxRtXLwPF1wFLPIfO4k2/I3dcRtgwI5xnLJiIqpXqM9ZIsXN3/rLIcj+NC7LbdvStx+iuIB3SYV1NEjiSAMrstuuo6tP3UT8VnsSrHy9nQ/QzMjfdTVwl4yx+ob6iECUtO5bdWvJLUrsLuYdkUbKVC0UpbFBALPkUtPpyuPQIDAQAB',
  /**
   * 🔴 **이름은 「무엇을 하는지」까지 말한다** (2026-08-19). 확장 목록·설치 화면에서는 이 한 줄이
   *    판단 근거인데, 「사이 (Sai)」만으로는 무슨 도구인지 알 수 없었다.
   * 🔴 **여기서는 점 없이 `SAI`다** — 화면·발표의 워드마크는 `S·AI`이지만, 가운뎃점은 검색이
   *    안 되고 스토어·경로에서 깨진다. 보여주는 이름과 식별자를 나눈다.
   */
  name: 'SAI — 해외 협업 메시지 다듬기',
  /**
   * 🔴 **릴리스 태그와 같은 값을 유지한다** (2026-08-20). 그전까지 태그만 v0.1.1·v0.1.2로
   *    올라가고 여기는 `0.1.0`에 멈춰 있었다 — 크롬 확장 관리 화면에는 이 값이 뜨므로,
   *    테스터가 «어느 버전을 깔았는지 화면만 보고는 알 수 없는» 상태였다.
   * 🔴 `v`를 붙이지 않는다 — 크롬은 숫자와 점만 받는다.
   */
  version: '0.1.5',
  /**
   * 🔴 **동작을 먼저, 은유는 빼고.** 예전 문구("사람과 사람, 언어와 언어 사이를 매끄럽게 잇는")는
   *    첫 줄이 은유라 무엇을 하는 도구인지 읽는 데 시간이 걸렸다.
   * 🔴 **본문 미저장을 설명에 넣는다** — 남의 메시지를 다루는 도구에서 사람들이 가장 먼저 묻는
   *    것이고, 우리는 실제로 지킨다(Spec 필수 5).
   */
  description:
    '보내기 전에 톤·긴급도·오해 소지를 잡아 주는 해외 협업 메시지 도구. 상대의 시간대와 용어집까지 반영하고, 메시지 본문은 저장하지 않아요.',
  // 2026-08-13 — claude.ai/design "MEDIATE 로고 03 SHIFT 전개" 정사각 락업 좌표를 사이 팔레트로
  // 재배색해 `scripts/generate-icons.mjs`로 생성(브라우저 렌더링 없이 순수 Node, 새 의존성 0개).
  // 원본 SVG 좌표의 단일 출처는 `src/assets/SaiMark.jsx`.
  icons: {
    16: 'src/assets/icons/icon-16.png',
    32: 'src/assets/icons/icon-32.png',
    48: 'src/assets/icons/icon-48.png',
    128: 'src/assets/icons/icon-128.png',
  },
  action: {
    default_title: '사이 — 사이드 패널 열기',
    default_icon: {
      16: 'src/assets/icons/icon-16.png',
      32: 'src/assets/icons/icon-32.png',
      48: 'src/assets/icons/icon-48.png',
      128: 'src/assets/icons/icon-128.png',
    },
  },
  background: {
    service_worker: 'src/background/index.js',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.jsx'],
      run_at: 'document_idle',
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  /**
   * 단축키 (S26 / Spec 부가 9 — 단축키 커스텀 지정).
   *
   * 🔴 **"커스텀 지정" UI를 우리가 만들지 않는다** — 크롬은 확장이 단축키를 직접 재설정하는 API를
   *    주지 않는다(보안상 다른 확장·브라우저 단축키를 가로챌 수 있기 때문). 사용자가 바꾸는
   *    자리는 `chrome://extensions/shortcuts` 한 곳뿐이며, 확장은 그 페이지를 **열어줄 수만**
   *    있다(`chrome.tabs.create`). 사이드패널 설정에서 그리로 보낸다.
   * 🔴 기본값은 크롬 권장대로 `Alt` 조합을 쓴다 — `Ctrl+Shift+*`는 브라우저 기본 단축키와
   *    충돌이 잦다. 충돌 시 크롬이 조용히 미할당 상태로 두므로, 설정 화면 안내가 더 중요하다.
   */
  commands: {
    _execute_action: {
      suggested_key: { default: 'Alt+S' },
      description: '사이드 패널 열기',
    },
    'refine-selection': {
      suggested_key: { default: 'Alt+D' },
      description: '선택한 문장 다듬기 / 뜻 풀기',
    },
    /**
     * 🔴 **Alt+X를 고른 이유** (2026-08-19). 크롬이 이미 쓰는 조합을 피해야 한다 —
     *    `Alt+F`·`Alt+E`는 **크롬 메뉴**, `Alt+D`는 주소창인데 우리가 이미 잡고 있다(확장 단축키가
     *    이긴다). `Alt+X`는 크롬 기본 단축키가 아니다.
     * 🔴 그래도 **다른 확장과 겹치면 크롬이 이 칸을 비워 둔다** — 그건 고장이 아니라 크롬의
     *    정책이고, 설정의 단축키 카드가 「지정 안 됨」으로 보여주며 「바꾸기」로 직접 지정할 수 있다.
     */
    'open-snippets': {
      suggested_key: { default: 'Alt+X' },
      description: '저장 문구 열기',
    },
  },
  // 🔴 'alarms'·'notifications'는 예약 알림용이다(Spec 필수 6). 우리가 대신 보내지는 못하므로
  //    (`src/lib/reservations.js` 조사 결론) **시간이 되면 사용자에게 알려주는 것**까지가 우리 몫이다.
  /**
   * Google OAuth (S23 캘린더 · S31 로그인) — `chrome.identity.getAuthToken`이 이 블록을 읽는다.
   *
   * 🔴 **`client_id`는 비밀이 아니다.** 확장 번들은 누구나 뜯어보므로 애초에 숨길 수 없는 값이고,
   *    Chrome 확장 유형 OAuth 클라이언트는 **시크릿을 발급하지 않는다** — 크롬이 확장 ID로 신원을
   *    증명한다. 그래서 `key`(위)를 고정한 것이 보안의 핵심이다.
   * 🔴 이 클라이언트는 **확장 ID `ogbcccaaojphhgobeeidpafokjieckdf`에 묶여 있다.** 위 `key`를
   *    바꾸면 여기도 함께 다시 만들어야 한다.
   * 🔴 **읽기 전용 범위만 요청한다.** 캘린더에 일정을 쓰지 않는다 — 우리가 하는 일은 빈 시간을
   *    읽는 것뿐이다(Spec 권장 12).
   */
  oauth2: {
    client_id: '995477529646-ac3v8145tbbufalascroh9l6gq5iaid8.apps.googleusercontent.com',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  },
  // 🔴 'identity'는 위 `oauth2` 블록을 쓰기 위한 권한이다 (S23·S31).
  permissions: [
    'sidePanel',
    'storage',
    'activeTab',
    'clipboardWrite',
    'alarms',
    'notifications',
    'identity',
  ],
  // 🔴 MV3 서비스 워커는 권한 없는 오리진으로 fetch할 수 없다. `src/config.js`의
  //    REFINE_ENDPOINT와 반드시 함께 바꾼다. 로컬 프록시로 되돌릴 때는
  //    'http://127.0.0.1:8787/*'를 추가한다.
  host_permissions: [
    'https://asia-northeast3-sai-global-msg-2026.cloudfunctions.net/*',
    // S22 — GitHub 공개 활동 조회. 🔴 확장이 host_permission을 가지면 CORS 제약을 받지 않는다.
    //    GitHub API·OAuth 엔드포인트는 CORS 헤더를 주지 않으므로 이 권한이 없으면 전부 실패한다.
    'https://api.github.com/*',
    // S22 — Device Flow(코드 발급·토큰 교환). 🔴 `github.com`이고 `api.github.com`이 아니다.
    'https://github.com/login/*',
    // S23 — 캘린더 빈 시간 조회.
    'https://www.googleapis.com/*',
    // S31 — 구글 로그인(Identity Toolkit) · 토큰 갱신 · Firestore 동기화.
    // 🔴 세 도메인이 전부 다르다. 하나라도 빠지면 그 단계에서만 조용히 실패한다.
    'https://identitytoolkit.googleapis.com/*',
    'https://securetoken.googleapis.com/*',
    'https://firestore.googleapis.com/*',
    /**
     * 로컬 프록시 (`npm run proxy`) — 2026-08-19 사용자 요청 「함께 고쳐」.
     *
     * 🔴 **왜 미리 넣어 두는가.** `src/config.js`의 `REFINE_ENDPOINT`를 로컬로 바꿔도
     *    이 권한이 없으면 **MV3 서비스 워커가 fetch 자체를 못 해 전부 조용히 실패**한다.
     *    두 파일 중 하나만 고치는 사고가 실제로 나기 쉬운 자리라(주석으로 경고까지 달려
     *    있었다), 권한을 미리 열어 **엔드포인트 한 줄만 바꾸면 되게** 만든다.
     * 🔴 **권한이 있다고 그리로 부르지는 않는다** — 기본값은 배포된 함수다(`config.js`).
     *    이 권한은 `127.0.0.1`(내 기기 안)로만 열려 있어 남의 서버로 나갈 수 없다.
     * 🔴 포트는 `config.js`의 `LOCAL_PROXY_ENDPOINT`와 **같아야 한다**(8787).
     *    다른 포트로 프록시를 띄우면(`SAI_PROXY_PORT`) 여기도 함께 고쳐야 한다.
     */
    'http://127.0.0.1:8787/*',
  ],
});
