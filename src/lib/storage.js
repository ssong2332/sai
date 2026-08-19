/**
 * `chrome.storage.local` 얇은 래퍼.
 *
 * 확장 밖(예: `vite preview`, 단위 테스트)에서는 `chrome`이 없다 — 그때 예외로 죽지 않고
 * 메모리 폴백으로 동작해야 개발 중 화면 확인이 가능하다(Lessons #1의 "확장 전용 전역이 없어
 * 전 페이지가 즉사"와 같은 계열의 함정).
 *
 * 🔴 여기에 메시지 본문을 넣지 않는다 — 저장 대상은 설정값·토글 상태뿐 (Spec 필수 5).
 */

const memoryFallback = new Map();

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && chrome?.storage?.local != null;
}

/**
 * @param {string} key
 * @param {*} fallbackValue 저장된 값이 없을 때 돌려줄 값.
 */
export async function getLocal(key, fallbackValue = null) {
  if (!hasChromeStorage()) {
    return memoryFallback.has(key) ? memoryFallback.get(key) : fallbackValue;
  }
  const stored = await chrome.storage.local.get(key);
  return stored[key] ?? fallbackValue;
}

export async function setLocal(key, value) {
  if (!hasChromeStorage()) {
    memoryFallback.set(key, value);
    return;
  }
  await chrome.storage.local.set({ [key]: value });
}

/** 저장된 키를 완전히 지운다 — `setLocal(key, null)`과 달리 "값이 null로 저장됨"이 아니라
 * "저장된 적 없음" 상태로 되돌린다. 시드 재적용 여부 판단(예: 용어집 최초 로드)에 필요하다. */
export async function removeLocal(key) {
  if (!hasChromeStorage()) {
    memoryFallback.delete(key);
    return;
  }
  await chrome.storage.local.remove(key);
}

/** 저장 키 — 문자열을 여기저기 흩뿌리지 않는다. */
export const STORAGE_KEYS = {
  /** 'dark' | 'light' — 사이드패널 테마 (2026-08-12 사용자 결정으로 v1 포함). */
  THEME: 'sai.theme',
  /** boolean — 역번역 상시 노출 토글 (Spec 필수 3). S06이 쓴다. */
  BACK_TRANSLATION: 'sai.backTranslation',
  /** 개인 용어집 엔트리 배열 (Spec 필수 7). S12가 쓴다. */
  GLOSSARY_PERSONAL: 'sai.glossary.personal',
  /** {situationId, collabStyleId} — 상황 템플릿·협업 성향 (Spec 필수 2 1순위). S13이 쓴다. */
  PROFILE: 'sai.profile',
  /**
   * {카테고리 id: 횟수} — Diff 학습 누적 (Spec 필수 2 2순위 · 권장 11). S13이 쓴다.
   * 🔴 **수치만** 담는다 — 원문·교정문·수정문은 절대 여기 들어가지 않는다 (Spec 필수 5).
   */
  LEARNED_PATTERNS: 'sai.profile.learned',
  /**
   * 수신자 목록 (Spec 필수 9 · S17). 🔴 **숫자 점수는 어떤 형태로도 들어가지 않는다** (G1/G2) —
   * 사람에 대한 정보는 고정 집합의 서술형 태그 id뿐이다.
   */
  RECIPIENTS: 'sai.recipients',
  /** 마지막으로 고른 수신자 id (S17 — 수동 선택이 주 경로, Lessons #4). */
  RECIPIENT_SELECTED: 'sai.recipients.selected',
  /** boolean — 캐주얼 톤 (Spec 필수 8). 기본 false: 밈을 자동으로 끼워 넣지 않는다. S16이 쓴다. */
  /**
   * 🔴 **문체 수위 — 하나의 눈금** (2026-08-18). 예전에는 `CASUAL_TONE`(불리언)과 수신자별
   *    `register`가 **같은 축을 두 개의 버튼**으로 나눠 갖고 있었다. 둘 다 켜지는 상태가
   *    존재했고, 그때 누가 이기는지는 프롬프트 «배치»가 조용히 정했다 — 화면 어디에도
   *    드러나지 않았다. 3단 하나로 합쳐 **모순 상태 자체를 없앴다.**
   *    값: 'casual' | 'formal' | null(기본)
   */
  REGISTER: 'sai.register',
  CASUAL_TONE: 'sai.casualTone',
  /**
   * {language, partnerRegion, tone, completedAt} — 3초 퀵 온보딩 (Spec 권장 9). S11이 쓴다.
   * 🔴 `partnerRegion`은 **소통 언어 기본값**을 정하는 데만 쓴다 — 성향·톤 추론에 쓰지 않는다
   *    (Spec 필수 2 3순위 · 필수 9 국가 단위 단정 금지).
   */
  ONBOARDING: 'sai.onboarding',
  /**
   * 승인 문장 스니펫 (Spec 권장 10 F-16). S20이 쓴다.
   * 🔴 **여기에만 교정문이 영속된다.** 사용자가 버튼을 눌러 직접 저장한 것만 들어가며, 서버·
   *    Firestore·`chrome.storage.sync` 어디로도 나가지 않는다 — 근거와 조건은
   *    `docs/ZeroRetention.md`의 "단서: 스니펫은 왜 위반이 아닌가" 참조.
   */
  SNIPPETS: 'sai.snippets',
  /**
   * boolean — 교정문 하이라이트(용어 초록 · 위험 노란 밑줄) 표시 여부. S19.
   * 기본 true. 🔴 끄면 **표시만** 사라지고 판정 자체는 그대로다 — 이모지 자동 교체(권장 4)는
   *    문장을 실제로 바꾸는 동작이라 이 토글과 무관하게 계속 적용된다.
   */
  HIGHLIGHT_HINTS: 'sai.highlightHints',
  /**
   * boolean — 「왜 이렇게 바꿨나」 근거 패널 펼침 여부 (2026-08-14 사용자 제안 ③).
   * 🔴 기본 **접힘**: 매 교정마다 근거 4종이 펼쳐지면 팝업에서 가장 큰 블록이 된다(대화 참고
   *    목록을 접은 것과 같은 기준). 있다는 사실은 접힌 줄이 보여주고, 펼침 선택은 저장된다.
   */
  REFINE_REASONING: 'sai.refineReasoning',
  /**
   * S37 — 회신 초안 자동 모드. true면 방향을 고르는 즉시 초안을 만든다(사전 질문 건너뜀).
   * 🔴 기본값은 false(질문 모드)다. 질문의 목적이 초안의 빈칸을 줄이는 것인데, 기본이 자동이면
   *    대부분의 사용자는 질문 기능이 있다는 것조차 모른 채 자리표시자만 채우게 된다.
   */
  REPLY_AUTO: 'sai.replyAuto',
  /**
   * `{dateKey, refined, decoded, scheduled}` — 홈 「오늘의 사이」 카운트 (`src/lib/usage.js`).
   * 🔴 **정수 3개와 날짜뿐이다** (Spec 필수 5). 본문·수신자는 어떤 형태로도 들어가지 않는다.
   *    날짜가 바뀌면 읽는 쪽에서 0으로 보므로 어제 값이 화면에 남지 않는다.
   */
  USAGE_TODAY: 'sai.usage.today',
  /**
   * `{byDate: {'YYYY-MM-DD': {misread, venting, ...}}}` — 아직 서버로 올리지 않은 마찰·긍정
   * 카운트 (`src/lib/friction.js`, Spec §3 F-10/F-26).
   * 🔴 **정수뿐이다.** 본문·수신자·개인 식별자는 어떤 형태로도 들어가지 않는다(Spec 필수 5 · 9).
   */
  FRICTION_PENDING: 'sai.friction.pending',
  /**
   * `{teamId, name, role, joinedAt}` — 소속 팀 (Spec §3 팀 용어집·건강도).
   * 🔴 초대 코드는 저장하지 않는다 — 참가에 한 번 쓰고 버린다. 남겨 두면 이 기기를 쓰는 누구나
   *    팀에 다시 들어갈 수 있는 열쇠가 된다.
   */
  TEAM: 'sai.team',
  /**
   * `[{teamId, name, role, canViewDashboard}]` — 소속된 팀 **전체** (2026-08-16).
   * 🔴 예전에는 `TEAM`에 팀 **하나**만 담겼다. 여러 팀에 속할 수 있게 바꾸면서 목록으로 옮겼고,
   *    `TEAM`은 이관용으로만 읽는다(`teamClient.js`의 마이그레이션).
   * 🔴 초대 코드는 여기에도 저장하지 않는다.
   */
  TEAMS: 'sai.teams',
  /** 지금 보고 있는 팀 id. 목록에 없으면 첫 번째 팀으로 되돌린다. */
  ACTIVE_TEAM: 'sai.teams.active',
  /**
   * `{displayName, jobTitle}` — 팀에서 나를 알아보게 하는 이름·직급 (`src/lib/identity.js`).
   * 🔴 **자기 정보뿐이다.** 팀 생성·참가 시 함께 실어 보내며, 그 외 어디로도 나가지 않는다.
   */
  IDENTITY: 'sai.identity',
  /**
   * 예약 발송 기록 (Spec 필수 6). 🔴 스니펫과 같은 근거로 본문이 로컬에만 저장된다 —
   * 조건과 한계는 `src/lib/reservations.js` 헤더 참조.
   */
  RESERVATIONS: 'sai.reservations',
  /**
   * boolean — 결정 로그 저장에 대한 **명시적 동의** (S25 / Spec 부가 7).
   * 🔴 이 값이 true가 아니면 **결정 요약 기능 자체를 쓸 수 없다**(2026-08-14 사용자 결정).
   *    "저장은 안 하고 보기만" 경로를 두지 않았다 — 요약해 놓고 저장을 못 하면 Decision
   *    **Log**가 아니고, 동의 없이 만들어 화면에만 띄우는 것도 결국 남의 메시지를 뽑아내는
   *    일이라 같은 동의가 필요하다.
   */
  DECISIONS_CONSENT: 'sai.decisionsConsent',
  /**
   * 결정 로그 (Spec 부가 7). 🔴 스니펫·예약과 **같은 근거**로 로컬에만 저장된다.
   *    다만 이건 **남이 쓴 메시지**에서 뽑은 내용이라 스니펫(내가 쓴 문장)보다 조건이 엄하다 —
   *    사전 동의 필수 + 동의 철회 시 전량 삭제. 조건은 `src/lib/decisions.js` 헤더 참조.
   */
  DECISION_LOGS: 'sai.decisionLogs',
  /**
   * 'replace' | 'append' — 저장 문구를 넣을 때 기존 내용을 지울지 뒤에 붙일지 (S20 후속).
   * 기본 'replace'. 🔴 사용자가 쓰던 초안을 말없이 지우는 일이 없도록 선택지를 준다.
   */
  SNIPPET_INSERT_MODE: 'sai.snippetInsertMode',
  /**
   * boolean — 스레드 직전 대화 맥락 참고 여부 (Spec 권장 8 · S21). 기본 true.
   * 🔴 **여기에 저장되는 것은 on/off 한 개뿐이다.** 맥락 본문은 저장하지 않는다 — 남이 쓴
   *    메시지라 스니펫·예약(사용자가 직접 남긴 자기 글)의 예외 근거가 성립하지 않는다.
   */
  THREAD_CONTEXT: 'sai.threadContext',
  /**
   * boolean — 팝업에서 참고한 문장 **미리보기**를 보여줄지. 기본 true.
   * 🔴 `THREAD_CONTEXT`(참고 자체를 켜고 끔)와 **다른 축**이다(2026-08-13 사용자 요청) — 참고는
   *    계속 쓰면서 화면에 원문만 안 보이게 하고 싶을 수 있다(옆에서 볼 때 남의 메시지가 그대로
   *    뜨는 게 부담스러운 경우 등). 꺼도 서버로 나가는 것은 그대로다 — **표시만** 가린다.
   */
  THREAD_CONTEXT_PREVIEW: 'sai.threadContextPreview',
  /**
   * {balance, history[]} — 인앱 재화 (Spec §1 Token Economy · S23).
   * 🔴 저장되는 것은 **사유 코드(고정 enum)·수치·시각**뿐이다 — 메시지 본문·상대 이름·회의
   *    제목이 들어갈 필드 자체가 없다 (`src/lib/points.js` 참조).
   */
  POINTS: 'sai.points',
  /**
   * {up, down} — 의도 검증 피드백 집계 (Spec 부가 5 · S26).
   * 🔴 **수치 두 개뿐이다.** 자유 서술 피드백은 받지 않는다 — 받는 순간 본문이 저장된다
   *    (`src/lib/feedback.js` 헤더 참조).
   */
  FEEDBACK: 'sai.feedback',
  /**
   * GitHub Device Flow 액세스 토큰 (S22 / Spec audit 3).
   *
   * 🔴 **로컬에만 있다. 서버·Firestore로 나가지 않는다.** Device Flow를 고른 이유가 이것이다 —
   *    일반 OAuth 웹 플로우는 시크릿 때문에 토큰 교환을 서버에서 해야 해서 토큰이 우리 서버를
   *    지나가지만, Device Flow는 확장이 직접 받아 여기 둔다.
   * 🔴 **스코프가 없는 토큰이다.** 공개 데이터 읽기에는 권한이 필요 없고, 이 토큰의 유일한 용도는
   *    시간당 한도(60 → 5,000)를 올리는 것이다. 유출돼도 남의 저장소를 건드릴 수 없다.
   * 🔴 값 형태: `{accessToken, linkedAt}`. **사용자명·이메일·아바타를 함께 담지 않는다.**
   */
  GITHUB_TOKEN: 'sai.github.token',
  /**
   * 구글 로그인 세션 (S31). `{uid, email, idToken, refreshToken, expiresAt}`.
   *
   * 🔴 **로컬에만 있다.** 토큰을 우리 서버로 보내지 않는다 — 확장이 Firestore REST를 직접 부른다.
   * 🔴 이 세션으로 열리는 것은 **`firestore.rules`가 허용한 필드뿐**이다. 규칙이 소유자를 확인하고
   *    쓸 수 있는 필드를 화이트리스트로 묶으므로, 토큰이 있다고 본문을 올릴 수 있는 게 아니다.
   * 🔴 갱신 실패 시 이 키를 **지운다** — 죽은 토큰으로 "로그인됨"이라 표시하면 동기화가 조용히
   *    실패하면서 화면만 멀쩡해 보인다.
   */
  AUTH: 'sai.auth',
  /**
   * 🔴 `URGENT_TAG: 'sai.urgentTag'`는 **삭제했다** (2026-08-14, S27 저장소 검사에서 발견).
   *    URGENT 태그를 상시 적용으로 바꾸면서 읽기를 없앴고, 이후 스위치를 되살릴 때는 **저장 없이
   *    매 결과마다 켜짐으로 초기화되는** 상태로 만들었다(옛 문장에 대한 선택이 새 문장에 남으면
   *    안 되므로 의도된 설계다). 그래서 이 키는 쓰는 곳이 하나도 없는 잔재였다.
   *    → 이미 값이 저장돼 있던 브라우저에는 `sai.urgentTag`가 남아 있을 수 있으나 **아무도 읽지
   *      않는다.** 지우려면 확장 컨텍스트에서 `chrome.storage.local.remove('sai.urgentTag')`.
   */
};
