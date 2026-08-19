/**
 * Google 캘린더 조회 (S23 / Spec 권장 12).
 *
 * 🔴 **FreeBusy만 부른다. `events.list`를 쓰지 않는다.** FreeBusy는 바쁜 구간의 **시각만** 주고
 *    일정 제목·참석자·설명을 주지 않는다. `events.list`를 쓰면 남의 회의 제목까지 받아 오게 되고,
 *    그 순간 우리가 그 데이터의 유통 경로가 된다. **받지 않는 것이 안 새게 하는 가장 확실한 방법**
 *    이다 (Spec 필수 5).
 *
 * 🔴 **읽기 전용 스코프만 쓴다** (`calendar.readonly`, `src/manifest.js`의 `oauth2`). 일정을
 *    만들지 않는다 — 우리가 하는 일은 빈 시간을 읽는 것뿐이다.
 *
 * 🔴 **토큰을 우리가 저장하지 않는다.** `chrome.identity`가 크롬 안에서 관리하고 갱신한다.
 *    GitHub(Device Flow)과 다른 점이며, 그래서 `STORAGE_KEYS`에 캘린더 토큰 키가 없다.
 *
 * 🔴 `fetch`와 `identity`를 주입받는다 — 네트워크 없이 분기를 전부 테스트하기 위해서다.
 */

const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';

export const CALENDAR_ERRORS = {
  NOT_SIGNED_IN: 'not-signed-in',
  DENIED: 'access-denied',
  /** OAuth 클라이언트 ID가 이 확장과 안 맞음 — **설정 문제**이지 사용자 선택이 아니다. */
  BAD_CLIENT: 'bad-client-id',
  /** 동의 화면이 안 열림 — 범위 미등록 등 **설정 문제**. */
  CONSENT_BROKEN: 'consent-screen-broken',
  NETWORK: 'network-failed',
  UNKNOWN: 'unknown',
};

export class CalendarError extends Error {
  constructor(reason, detail = '') {
    super(`calendar:${reason}${detail ? ` (${detail})` : ''}`);
    this.reason = reason;
    /**
     * 🔴 크롬이 준 원문을 **버리지 않는다** (2026-08-14 추가). 처음엔 사유 코드만 남겼는데,
     *    동의 창이 아예 안 뜨는 경우와 사용자가 거부한 경우가 **같은 문구**로 보여서 원인을
     *    좁힐 수 없었다. 설정 문제와 사용자 선택은 할 일이 완전히 다르다.
     */
    this.detail = detail;
  }
}

/**
 * `chrome.identity`가 준 원문에서 **실제 원인**을 읽어낸다.
 * 🔴 "거부"로 뭉뚱그리면 안 되는 이유: 아래 대부분은 사용자가 아니라 **설정** 문제다.
 */
function classifyIdentityFailure(rawMessage = '') {
  const text = String(rawMessage).toLowerCase();
  if (text.includes('bad client id') || text.includes('invalid client')) {
    return CALENDAR_ERRORS.BAD_CLIENT;
  }
  if (text.includes('not signed in') || text.includes('no account')) {
    return CALENDAR_ERRORS.NOT_SIGNED_IN;
  }
  if (text.includes('authorization page could not be loaded')) {
    return CALENDAR_ERRORS.CONSENT_BROKEN;
  }
  if (text.includes('not granted') || text.includes('revoked') || text.includes('canceled')) {
    return CALENDAR_ERRORS.DENIED;
  }
  return CALENDAR_ERRORS.UNKNOWN;
}

/** 🔴 사유마다 사용자가 할 수 있는 일이 다르므로 문구도 다르다. */
export function calendarErrorMessage(reason, detail = '') {
  const suffix = detail ? ` (${detail})` : '';
  switch (reason) {
    case CALENDAR_ERRORS.NOT_SIGNED_IN:
      return '크롬에 구글 계정으로 로그인되어 있어야 캘린더를 볼 수 있어요 — 우상단 프로필에서 로그인해 주세요';
    case CALENDAR_ERRORS.BAD_CLIENT:
      return `OAuth 클라이언트 ID가 이 확장과 맞지 않아요 — 구글 클라우드에서 유형이 "Chrome 확장 프로그램"이고 항목 ID가 정확한지 확인해 주세요${suffix}`;
    case CALENDAR_ERRORS.CONSENT_BROKEN:
      return `동의 화면을 열지 못했어요 — 구글 클라우드 「데이터 액세스」에 calendar.readonly 범위가 추가돼 있는지 확인해 주세요${suffix}`;
    case CALENDAR_ERRORS.DENIED:
      return '캘린더 접근을 허용하지 않으셨어요 — 업무시간이 겹치는 시간만 보여드릴게요';
    case CALENDAR_ERRORS.NETWORK:
      return '캘린더에 연결하지 못했어요 — 네트워크를 확인해 주세요';
    default:
      return `캘린더 연결에 실패했어요${suffix}`;
  }
}

/** `chrome.identity.getAuthToken`을 Promise로. 🔴 콜백 API라 감싸지 않으면 예외 처리가 안 된다. */
function getAuthToken({ interactive, identityImpl }) {
  const identity = identityImpl ?? globalThis.chrome?.identity;
  if (!identity?.getAuthToken) {
    return Promise.reject(new CalendarError(CALENDAR_ERRORS.NOT_SIGNED_IN, 'no chrome.identity'));
  }
  return new Promise((resolve, reject) => {
    identity.getAuthToken({ interactive }, (token) => {
      // 🔴 `chrome.runtime.lastError`를 읽지 않으면 크롬이 콘솔에 미처리 오류를 뱉는다.
      const failure = globalThis.chrome?.runtime?.lastError;
      if (failure || !token) {
        const raw = failure?.message ?? 'no token';
        // 🔴 원문을 콘솔에도 남긴다 — 화면 문구만으로 못 좁히는 경우가 있다. 일정 내용이 아니라
        //    크롬이 준 오류 문자열이므로 Zero Retention과 무관하다.
        console.warn('[사이] 캘린더 인증 실패:', raw);
        reject(
          new CalendarError(
            interactive ? classifyIdentityFailure(raw) : CALENDAR_ERRORS.NOT_SIGNED_IN,
            raw,
          ),
        );
        return;
      }
      resolve(token);
    });
  });
}

/**
 * 캘린더 연결 상태를 **조용히** 확인한다.
 * 🔴 `interactive: false`라 동의 창을 띄우지 않는다 — 사이드패널을 열자마자 구글 로그인 창이
 *    튀어나오면 사용자는 무슨 일인지 모른다. 연결은 사용자가 버튼을 눌러야 시작된다.
 */
export async function isCalendarLinked({ identityImpl } = {}) {
  try {
    await getAuthToken({ interactive: false, identityImpl });
    return true;
  } catch {
    return false;
  }
}

/**
 * 연결 해제. 🔴 캐시된 토큰을 지우지 않으면 "해제했다"고 해 놓고 다음 조회가 그대로 성공한다.
 */
export async function unlinkCalendar({ identityImpl } = {}) {
  const identity = identityImpl ?? globalThis.chrome?.identity;
  if (!identity?.getAuthToken) return;
  try {
    const token = await getAuthToken({ interactive: false, identityImpl });
    await new Promise((resolve) => identity.removeCachedAuthToken({ token }, resolve));
  } catch {
    // 애초에 토큰이 없으면 해제할 것도 없다.
  }
}

/**
 * 내가 바쁜 구간을 가져온다.
 *
 * @param {object} input
 * @param {Date} input.timeMin 조회 시작.
 * @param {Date} input.timeMax 조회 끝.
 * @param {boolean} [input.interactive] true면 필요 시 동의 창을 띄운다(사용자가 버튼을 누른 경우).
 * @returns {Promise<{start: string, end: string}[]>} 🔴 **시각뿐이다** — 제목·참석자가 없다.
 */
export async function fetchBusyIntervals({
  timeMin,
  timeMax,
  interactive = false,
  fetchImpl = globalThis.fetch,
  identityImpl = undefined,
}) {
  const token = await getAuthToken({ interactive, identityImpl });

  let response;
  try {
    response = await fetchImpl(FREEBUSY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        // 🔴 `primary`만 묻는다 — 상대 캘린더는 조회 권한이 없고, 있다고 가정하지도 않는다.
        items: [{ id: 'primary' }],
      }),
    });
  } catch {
    throw new CalendarError(CALENDAR_ERRORS.NETWORK);
  }

  if (response.status === 401 || response.status === 403) {
    throw new CalendarError(CALENDAR_ERRORS.DENIED, String(response.status));
  }
  if (!response.ok) throw new CalendarError(CALENDAR_ERRORS.UNKNOWN, String(response.status));

  const body = await response.json().catch(() => null);
  const busy = body?.calendars?.primary?.busy;
  // 🔴 응답이 예상과 다르면 **빈 배열이 아니라 오류**다. 빈 배열을 주면 "확인했는데 안 바쁘다"가
  //    되어, 확인하지 못한 것을 확인했다고 말하게 된다.
  if (!Array.isArray(busy)) throw new CalendarError(CALENDAR_ERRORS.UNKNOWN, 'no busy array');

  // 🔴 시각 두 개만 남기고 나머지 필드는 버린다 — 구글이 뭘 더 얹어 보내도 통과시키지 않는다.
  return busy.map((item) => ({ start: item.start, end: item.end }));
}
