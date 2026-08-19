import { REFINE_MESSAGE, mockRefine, mockDecode } from '../content/refineClient.js';
import { REFINE_ENDPOINT, REFINE_TIMEOUT_MS } from '../config.js';
// 🔴 2026-08-17 — `/v1/refine`이 인증을 요구한다. 토큰이 없으면 서버가 401을 준다.
import { getIdToken } from '../lib/authClient.js';
import { buildFallbackResponse, FALLBACK_REASONS } from '../core/refine/fallback.js';

// 툴바 아이콘 클릭 → 사이드 패널 열기 (Spec §1 UI 삼원화 — Side Panel 진입점)
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[사이] sidePanel 설정 실패:', error));

/**
 * 콘텐츠 스크립트 → `POST /v1/refine` 중계.
 *
 * 🔴 **API 키는 여기에 없다.** 확장 번들은 누구나 뜯어보므로 키는 서버에만 둔다.
 *    지금 서버는 로컬 프록시(`server/refine-proxy.js`), S02 이후엔 Firebase Functions다 —
 *    바뀌는 것은 `src/config.js`의 URL 하나뿐이다.
 * 🔴 Zero Retention (Spec 필수 5): 요청 본문을 로그에 남기지 않는다. 실패도 코드명만 찍는다.
 * 🔴 백엔드가 죽어 있으면 **목업으로 폴백하되 `mock: true`를 실어** 화면이 "실제 결과 아님"을
 *    표시하게 한다 (Lessons #5 — 폴백을 실제 결과로 오인시키지 않는다).
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== REFINE_MESSAGE) return false;

  const mode = message.request?.mode;

  callBackend(message.request)
    .then((result) => sendResponse(result))
    .catch(async (error) => {
      console.warn('[사이] 백엔드 실패:', error?.name ?? 'unknown');

      /**
       * 🔴 **401·429는 목업으로 덮지 않는다** (2026-08-17, 인증 도입과 함께).
       *
       * 「서버가 죽었다」와 「로그인이 안 됐다 / 오늘 한도를 다 썼다」는 **사용자가 할 일이
       * 정반대**다. 앞의 둘을 목업 폴백으로 보내면, 로그인만 하면 될 사람이 **준비된 예시를
       * 실제 교정 결과로 오인**한다 — `fallback.js` 헤더가 "가장 나쁜 실패"라고 못 박은 상태다.
       *
       * 🔴 모드를 가리지 않는다. 교정·해독·회신·결정 어느 쪽이든 사용자가 해야 할 일은 같다.
       */
      const authNotice = AUTH_FAILURE_NOTICES[error?.status];
      if (authNotice) {
        sendResponse(buildAuthFailureResponse(message.request, mode, authNotice));
        return;
      }

      /**
       * 🔴 **결정 요약에는 목업 폴백을 두지 않는다** (S25). 교정 목업은 사용자가 자기 원문과
       *    비교할 수 있지만, 결정 표는 그 자리에 없던 사람이 읽는 것이라 **준비된 예시 표가
       *    실제 합의로 오인되면** 훨씬 위험하다. 빈 표 + 실패 사실을 그대로 올린다.
       */
      /**
       * 🔴 **회신 초안에도 목업 폴백을 두지 않는다** (S37). 교정 목업은 사용자가 자기 원문과
       *    나란히 두고 보지만, 회신 초안은 **그대로 복사해 상대에게 보내는 문장**이다. 준비된
       *    예시 문장이 자기 메시지에 대한 답으로 오인되면 잘못된 내용이 실제로 전송된다.
       */
      if (mode === 'reply') {
        sendResponse({
          draft: null,
          placeholderNote: '',
          fallback: true,
          fallbackReason: 'error',
          fallbackNotice: 'AI 서버에 연결하지 못해 회신 초안을 만들지 못했어요.',
          backendUnreachable: true,
        });
        return;
      }

      if (mode === 'decisions') {
        sendResponse({
          decisions: [],
          decisionCount: 0,
          unresolvedIndexes: [],
          unresolvedCount: 0,
          fallback: true,
          fallbackReason: 'error',
          fallbackNotice: 'AI 서버에 연결하지 못해 결정 요약을 만들지 못했어요.',
          backendUnreachable: true,
        });
        return;
      }
      console.warn('[사이] 목업으로 폴백');
      const fallback =
        mode === 'decode' ? await mockDecode(message.request) : await mockRefine(message.request);
      sendResponse({ ...fallback, backendUnreachable: true });
    });

  return true; // 비동기 응답을 쓰겠다는 신호 — 빼면 sendResponse가 무시된다.
});

/* ── 결정 로그 페이지 (S25 / Spec 부가 7) ─────────────────────────────── */

export const DECISIONS_PAGE = 'src/decisions/index.html';

/**
 * 🔴 **저장이 아니라 손에 들고 있는 것이다.** 방금 만든 요약을 페이지로 넘기려면 어딘가 두어야
 *    하는데, `chrome.storage`에 두면 **사용자가 「저장하기」를 누르기도 전에 디스크에 남는다** —
 *    동의 게이트가 무의미해진다. 그래서 서비스 워커 **메모리 변수**에만 둔다.
 * 🔴 서비스 워커는 언제든 잠들 수 있고, 그러면 이 값은 사라진다. 그건 버그가 아니라 이 설계의
 *    당연한 결과다 — 페이지는 "가져올 게 없음"을 정상 상태로 다룬다(다시 요약하면 된다).
 */
let pendingDecisions = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'decisions:open') {
    // 요약 없이 페이지만 연다 — 동의 화면을 보여줘야 하는 경우.
    chrome.tabs.create({ url: chrome.runtime.getURL(DECISIONS_PAGE) });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'decisions:openWithResult') {
    pendingDecisions = message.pending ?? null;
    chrome.tabs.create({ url: chrome.runtime.getURL(DECISIONS_PAGE) });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'decisions:takePending') {
    // 한 번만 준다 — 페이지를 새로고침하면 사라지는 게 맞다(저장 전 결과가 계속 되살아나면
    // 사용자가 "이미 저장된 것"으로 오해한다).
    const pending = pendingDecisions;
    pendingDecisions = null;
    sendResponse({ pending });
    return false;
  }

  return false;
});

/**
 * 상태 코드 → 사용자에게 할 말. **표에 없는 상태는 기존 폴백 경로로 간다.**
 *
 * | 상태 | 뜻 | 사용자가 할 일 |
 * |---|---|---|
 * | 401 | 토큰이 없거나 만료·위조 | 사이드 패널에서 로그인 |
 * | 429 | 오늘 사용 한도 초과 | 내일 다시 (상한은 `functions/refineQuota.js`) |
 */
const AUTH_FAILURE_NOTICES = {
  401: {
    reason: 'unauthorized',
    notice: '로그인이 필요해요. 사이드 패널을 열고 구글 계정으로 로그인해 주세요.',
  },
  429: {
    reason: 'daily-limit',
    notice: '오늘 사용할 수 있는 교정 횟수를 다 썼어요. 내일 다시 이용해 주세요.',
  },
};

/**
 * 🔴 **응답 «모양»은 `buildFallbackResponse`에서 가져오고, «내용»만 갈아 끼운다.**
 *    여기서 객체를 처음부터 새로 쓰면 나중에 응답 계약이 바뀔 때 이 한 곳만 낡는다.
 * 🔴 **`refined`를 원문으로 되돌린다.** `buildFallbackResponse`는 데모 시드가 있는 입력에
 *    **준비된 교정문**을 넣어 주는데, 로그인이 안 된 상황에서 그럴듯한 번역이 뜨면 사용자는
 *    교정이 된 줄 안다. 시드는 "서버 장애 중에도 시연이 되게" 하려는 장치이지 **인증 실패를
 *    가리는 장치가 아니다.**
 */
function buildAuthFailureResponse(request, mode, { reason, notice }) {
  if (mode === 'reply') {
    return { draft: null, placeholderNote: '', fallback: true, fallbackReason: reason, fallbackNotice: notice };
  }
  if (mode === 'decisions') {
    return {
      decisions: [], decisionCount: 0, unresolvedIndexes: [], unresolvedCount: 0,
      fallback: true, fallbackReason: reason, fallbackNotice: notice,
    };
  }
  const shape = buildFallbackResponse(request ?? {}, FALLBACK_REASONS.ERROR);
  return {
    ...shape,
    refined: request?.text ?? '',
    backTranslation: '',
    fallbackReason: reason,
    fallbackNotice: notice,
  };
}

/**
 * 백엔드가 돌려준 상태 코드를 실어 나르는 오류. 🔴 본문·토큰은 담지 않는다.
 *
 * 🔴 **왜 상태 코드가 필요한가**: 예전에는 모든 실패가 똑같이 목업 폴백으로 갔다. 그런데
 *    「서버가 죽었다」와 「로그인이 안 됐다」는 **사용자가 할 일이 정반대**다. 구분하지 않으면
 *    로그인만 하면 될 사람에게 목업을 보여주고, 그 사람은 그게 진짜 결과인 줄 안다.
 */
export class BackendError extends Error {
  constructor(status) {
    super(`http ${status}`);
    this.name = 'BackendError';
    this.status = status;
  }
}

async function callBackend(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFINE_TIMEOUT_MS);
  /**
   * 🔴 **Firebase ID 토큰을 붙인다** (2026-08-17). 서버가 `requireUid`로 검증하며, 없으면 401이다.
   * 🔴 토큰을 못 얻어도 **여기서 멈추지 않는다** — 요청을 보내고 서버의 401을 받게 둔다.
   *    거절 사유를 판정하는 곳을 서버 한 곳으로 모아 두어야 클라이언트와 어긋나지 않는다.
   * 🔴 토큰을 로그에 찍지 않는다.
   */
  let token = null;
  try {
    token = await getIdToken();
  } catch (error) {
    console.warn('[사이] 토큰 없음:', error?.reason ?? error?.name ?? 'unknown');
  }
  try {
    const response = await fetch(REFINE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) throw new BackendError(response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ── 단축키 (S26 / Spec 부가 9) ────────────────────────────────────────── */

/**
 * 🔴 `_execute_action`(사이드패널 열기)은 크롬이 직접 처리하므로 여기서 받지 않는다 —
 *    `onCommand`에는 우리가 정의한 명령만 온다.
 * 🔴 콘텐츠 스크립트가 실제 동작을 한다(선택 영역을 아는 쪽은 그쪽뿐이다). background는
 *    "지금 보이는 탭"에 신호만 전달한다.
 * 🔴 콘텐츠 스크립트가 없는 탭(chrome:// 등)에서는 `sendMessage`가 실패한다 — 조용히 무시한다.
 *    그런 페이지에서 단축키를 누른 것은 사용자의 실수이지 고장이 아니다.
 */
export const COMMAND_REFINE_SELECTION = 'refine-selection';

/**
 * 🔴 **저장 문구 열기** (2026-08-19 사용자 결정 — 단축키 3번째 칸).
 *    LLM을 부르지 않는 유일한 재사용 경로라 **한도를 쓰지 않는다**. 지금까지는 로고에 커서를
 *    올려 펼쳐지는 버튼으로만 닿을 수 있었다 — hover가 필요한 입구는 키보드로 못 간다.
 */
export const COMMAND_OPEN_SNIPPETS = 'open-snippets';

/** 🔴 여기 없는 명령은 전달하지 않는다 — 표에 없는 것을 임의로 처리하지 않는다. */
const FORWARDED_COMMANDS = new Set([COMMAND_REFINE_SELECTION, COMMAND_OPEN_SNIPPETS]);

chrome.commands?.onCommand.addListener(async (command) => {
  if (!FORWARDED_COMMANDS.has(command)) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, { type: command });
  } catch {
    // 콘텐츠 스크립트가 없는 탭 — 무시한다.
  }
});

/* ── 예약 알림 (S14 후속 / Spec 필수 6) ────────────────────────────────── */

/**
 * 🔴 **우리가 대신 보내지 않는다 — 보낼 수 없다.** Slack은 앱 등록+OAuth+관리자 승인이 필요하고,
 *    Teams Graph API엔 채팅 예약 전송이 없으며, Gmail API에도 예약 전송이 없다(조사 근거는
 *    `src/lib/reservations.js` 헤더). 그래서 우리가 하는 일은 **시간이 되면 알려주는 것**까지다.
 * 🔴 콘텐츠 스크립트는 `chrome.alarms`를 쓸 수 없다 — 그래서 저장소 변경을 background가 보고
 *    알람을 건다.
 * 🔴 Zero Retention: 알림 본문에 메시지를 싣지 않는다. "누구에게 보낼 시간"까지만 알린다.
 */
const RESERVATION_KEY = 'sai.reservations';
const ALARM_PREFIX = 'sai-reservation:';

async function syncReservationAlarms() {
  const stored = await chrome.storage.local.get(RESERVATION_KEY);
  const list = Array.isArray(stored[RESERVATION_KEY]) ? stored[RESERVATION_KEY] : [];

  // 기존 예약 알람을 걷어내고 현재 목록으로 다시 건다 — 삭제된 예약의 알람이 남지 않게.
  const existing = await chrome.alarms.getAll();
  await Promise.all(
    existing.filter((a) => a.name.startsWith(ALARM_PREFIX)).map((a) => chrome.alarms.clear(a.name)),
  );

  /**
   * 🔴 `sendAtISO`가 **문자열이 아니면 건너뛴다** (2026-08-14 실측): 예전 코드가 `Date` 객체를
   *    그대로 저장해 storage에서 `{}`로 뭉개졌고, `Date.parse({})`가 `NaN`이라 알람이 한 번도
   *    걸리지 않았다. 저장 쪽은 `lib/reservations.js`에서 고쳤지만 **이미 저장된 옛 항목은
   *    영영 `{}`**이므로 여기서도 형을 확인한다 — 고장난 데이터로 조용히 실패하지 않게.
   */
  let skippedBroken = 0;
  for (const item of list) {
    const when = typeof item?.sendAtISO === 'string' ? Date.parse(item.sendAtISO) : NaN;
    if (!Number.isFinite(when)) {
      if (item?.sendAtISO != null) skippedBroken += 1;
      continue;
    }
    // 이미 지난 시각은 알람을 걸지 않는다(즉시 발화해 사용자를 놀라게 한다).
    if (when <= Date.now()) continue;
    chrome.alarms.create(`${ALARM_PREFIX}${item.id}`, { when });
  }

  // 🔴 건수만 남긴다 — 본문·수신자명은 로그에 싣지 않는다 (Spec 필수 5).
  if (skippedBroken > 0) {
    console.warn(`[사이] 예약 ${skippedBroken}건은 시각 형식이 올바르지 않아 알림을 걸지 못했어요`);
  }
}

chrome.runtime.onInstalled.addListener(syncReservationAlarms);
chrome.runtime.onStartup.addListener(syncReservationAlarms);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[RESERVATION_KEY]) syncReservationAlarms();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const id = alarm.name.slice(ALARM_PREFIX.length);
  const stored = await chrome.storage.local.get(RESERVATION_KEY);
  const item = (stored[RESERVATION_KEY] ?? []).find((entry) => entry.id === id);
  if (!item) return;

  chrome.notifications.create(alarm.name, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/assets/icons/icon-128.png'),
    title: '사이 — 보내기로 적어 둔 시간이에요',
    // 🔴 본문(메시지)은 싣지 않는다. 누구에게 보낼 때인지까지만.
    message: `${item.recipientName}에게 보낼 시간입니다. 사이드패널에서 문장을 확인하세요.`,
  });
});
