/**
 * GitHub 수집 클라이언트 (S22 / Spec audit 3).
 *
 * 🔴 **여기만 네트워크를 안다.** 분석은 `src/core/github/`가 순수 함수로 하고, 이 파일은 가져와서
 *    넘겨주기만 한다. 섞으면 분석을 테스트할 수 없다.
 *
 * 🔴 **Device Flow를 쓴다 — 시크릿이 없다.** 일반 OAuth 웹 플로우는 토큰 교환에 client_secret이
 *    필요해 서버 엔드포인트를 따로 둬야 하고, 그러면 **토큰이 우리 서버를 지나간다.** Device
 *    Flow는 확장이 직접 받아 로컬에 둔다 — 서버가 남의 토큰을 만질 일이 아예 없다.
 *
 * 🔴 **스코프를 요청하지 않는다.** 읽는 것이 전부 공개 데이터라 권한이 필요 없다. 토큰의 유일한
 *    용도는 시간당 한도(60 → 5,000). `public_repo`는 공개 레포 **쓰기**까지 열리므로 쓰지 않는다.
 *
 * 🔴 **비공개 레포는 보지 않는다.** 스코프가 없으니 토큰이 있어도 볼 수 없다 — 설계로 막았다.
 *
 * 🔴 `fetch`를 주입받는다 — 네트워크 없이 응답 처리 분기를 전부 테스트하기 위해서다.
 */

import {
  GITHUB_CLIENT_ID,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_DEVICE_TOKEN_URL,
  GITHUB_EVENT_PAGES,
} from '../config.js';
import { getLocal, setLocal, removeLocal, STORAGE_KEYS } from './storage.js';

const API_ROOT = 'https://api.github.com';
const JSON_HEADERS = { Accept: 'application/json' };
const API_HEADERS = { Accept: 'application/vnd.github+json' };

/**
 * 실패 사유 코드. 🔴 화면 문구를 코드에 흩뿌리지 않는다 — 사유를 코드로 넘기고 문구는
 * `errorMessage()` 한 곳에서 만든다.
 */
export const GITHUB_ERRORS = {
  /**
   * 🔴 **저장된 토큰이 더 이상 안 먹는다** (2026-08-16 사용자 질문 ③에서 드러난 빈칸).
   *    실존하는 사용자에게 「예상치 못한 응답이 왔어요」가 떴다. 그 문구는 `errorMessage()`의
   *    **default 가지**, 즉 우리가 분류하지 못한 상태를 뜻한다. 404·403·429는 이미 각각
   *    다루고 있으니 남는 유력 후보가 **401**이다 — 토큰이 만료·회수되면 GitHub는 401을 준다.
   *    분류하지 않으면 사용자는 「무슨 일이 났는지」도, 「무엇을 하면 되는지」도 알 수 없다.
   */
  AUTH_EXPIRED: 'auth-expired',
  NO_USER: 'no-such-user',
  RATE_LIMIT: 'rate-limited',
  NETWORK: 'network-failed',
  DEVICE_FLOW_OFF: 'device-flow-disabled',
  DENIED: 'authorization-denied',
  EXPIRED: 'code-expired',
  UNKNOWN: 'unknown',
};

export class GitHubError extends Error {
  constructor(reason, detail = '') {
    super(`github:${reason}${detail ? ` (${detail})` : ''}`);
    this.reason = reason;
  }
}

/** 사용자에게 보여줄 문구. 🔴 "실패했어요"로 뭉뚱그리지 않는다 — 할 수 있는 일이 다르다. */
export function errorMessage(reason, detail = '') {
  switch (reason) {
    case GITHUB_ERRORS.AUTH_EXPIRED:
      return 'GitHub 연결이 만료됐어요 — 설정 → 연결된 서비스에서 다시 연결해 주세요';
    case GITHUB_ERRORS.NO_USER:
      return '그 사용자명을 GitHub에서 찾지 못했어요 — 주소창의 github.com/뒤에 오는 값인지 확인해 주세요';
    case GITHUB_ERRORS.RATE_LIMIT:
      return 'GitHub 요청 한도에 걸렸어요 — GitHub를 연결하면 한도가 크게 늘어나요';
    case GITHUB_ERRORS.NETWORK:
      return 'GitHub에 연결하지 못했어요 — 네트워크를 확인해 주세요';
    case GITHUB_ERRORS.DEVICE_FLOW_OFF:
      return 'GitHub 앱 설정에서 Device Flow가 꺼져 있어요';
    case GITHUB_ERRORS.DENIED:
      return '연결이 취소됐어요';
    case GITHUB_ERRORS.EXPIRED:
      return '입력 시간이 지났어요 — 다시 시작해 주세요';
    default:
      /**
       * 🔴 **상태 코드를 같이 보여준다.** 「예상치 못한 응답」만 쓰면 사용자도 우리도 무엇이
       *    일어났는지 알 수 없다 — 실제로 이 문구 때문에 원인을 못 찾은 적이 있다(2026-08-16).
       *    분류하지 못한 것은 사실이므로 문구는 유지하되, **다음에 분류할 수 있도록** 근거를 남긴다.
       */
      return `GitHub에서 예상치 못한 응답이 왔어요${detail ? ` (${detail})` : ''}`;
  }
}

/* ── 토큰 보관 ──────────────────────────────────────────────────────── */

/** @returns {Promise<string|null>} 저장된 액세스 토큰. 없으면 null(= 비인증으로 진행). */
export async function getStoredToken() {
  const stored = await getLocal(STORAGE_KEYS.GITHUB_TOKEN, null);
  return stored?.accessToken ?? null;
}

/**
 * 🔴 `linkedAt` 외에 아무것도 함께 저장하지 않는다 — 사용자명·이메일·아바타를 여기 담기 시작하면
 *    "토큰 보관"이 "프로필 보관"이 된다.
 */
export async function storeToken(accessToken) {
  await setLocal(STORAGE_KEYS.GITHUB_TOKEN, {
    accessToken,
    linkedAt: new Date().toISOString(),
  });
}

/** 연결 해제. 🔴 지우는 경로가 없으면 연결할 수도 없어야 한다. */
export async function clearToken() {
  await removeLocal(STORAGE_KEYS.GITHUB_TOKEN);
}

/* ── Device Flow ────────────────────────────────────────────────────── */

/**
 * 1단계 — 디바이스 코드 발급.
 *
 * 🔴 **`scope`를 보내지 않는다.** 파라미터를 아예 빼면 스코프 없는 토큰이 나온다.
 *
 * @returns {Promise<{userCode, verificationUri, deviceCode, interval, expiresIn}>}
 *   `userCode`를 사용자가 `verificationUri`에 입력한다.
 */
export async function startDeviceFlow(fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(GITHUB_DEVICE_CODE_URL, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID }),
    });
  } catch {
    throw new GitHubError(GITHUB_ERRORS.NETWORK);
  }

  const body = await response.json().catch(() => ({}));
  if (body.error || !body.device_code) {
    // 🔴 Device Flow가 꺼져 있으면 GitHub은 `Not Found`를 준다 — "그런 앱 없음"처럼 보이지만
    //    실제로는 **체크박스 하나**다. 2026-08-14에 실제로 이걸로 한 번 헤맸다.
    throw new GitHubError(GITHUB_ERRORS.DEVICE_FLOW_OFF, body.error ?? 'no device_code');
  }

  return {
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    deviceCode: body.device_code,
    interval: Number(body.interval) || 5,
    expiresIn: Number(body.expires_in) || 900,
  };
}

/**
 * 2단계 — 토큰 폴링 응답 한 번을 해석한다.
 * 🔴 순수 함수로 분리한 이유: 폴링 루프를 돌리지 않고도 모든 분기를 테스트할 수 있다.
 *
 * @returns {{status: 'ok'|'pending'|'slow-down'|'failed', accessToken?, reason?, interval?}}
 */
export function interpretTokenResponse(body) {
  if (body?.access_token) return { status: 'ok', accessToken: body.access_token };
  switch (body?.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      // 🔴 GitHub이 "느리게"라고 하면 반드시 따른다 — 무시하면 차단된다.
      return { status: 'slow-down', interval: Number(body.interval) || 10 };
    case 'expired_token':
      return { status: 'failed', reason: GITHUB_ERRORS.EXPIRED };
    case 'access_denied':
      return { status: 'failed', reason: GITHUB_ERRORS.DENIED };
    default:
      return { status: 'failed', reason: GITHUB_ERRORS.UNKNOWN };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 2단계 — 사용자가 코드를 입력할 때까지 폴링한다.
 *
 * @param {object} flow `startDeviceFlow()` 결과.
 * @param {object} [options]
 * @param {() => boolean} [options.isCancelled] true를 주면 폴링을 멈춘다(사용자가 창을 닫은 경우).
 * @returns {Promise<string>} 액세스 토큰. 🔴 **저장은 호출부가 한다** — 이 함수가 저장까지 하면
 *   "받아만 보고 버리는" 경로를 만들 수 없다.
 */
export async function pollForToken(
  flow,
  { fetchImpl = globalThis.fetch, isCancelled = () => false, sleepImpl = sleep } = {},
) {
  let interval = flow.interval;
  const deadline = Date.now() + flow.expiresIn * 1000;

  while (Date.now() < deadline) {
    if (isCancelled()) throw new GitHubError(GITHUB_ERRORS.DENIED, 'cancelled by user');
    await sleepImpl(interval * 1000);

    let body;
    try {
      const response = await fetchImpl(GITHUB_DEVICE_TOKEN_URL, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: flow.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      body = await response.json();
    } catch {
      throw new GitHubError(GITHUB_ERRORS.NETWORK);
    }

    const verdict = interpretTokenResponse(body);
    if (verdict.status === 'ok') return verdict.accessToken;
    if (verdict.status === 'slow-down') {
      interval = verdict.interval;
      continue;
    }
    if (verdict.status === 'failed') throw new GitHubError(verdict.reason);
  }

  throw new GitHubError(GITHUB_ERRORS.EXPIRED);
}

/* ── 공개 활동 수집 ─────────────────────────────────────────────────── */

/**
 * 공개 프로필을 읽는다 — 수신자 등록 시 **이름을 자동으로 채우기 위해서**다 (2026-08-14).
 *
 * 🔴 **타임존·국가를 여기서 알아낼 수 없다.** GitHub의 `location`은 자유 텍스트라
 *    `"Berlin, Germany"`·`"서울"`·`"Earth"`·빈 값이 뒤섞인다. 이걸 IANA 타임존으로 바꾸는
 *    신뢰할 만한 규칙은 없고, 억지로 매핑하면 **회의 시간 추천이 통째로 틀린다**(그 기능은
 *    타임존이 정확하다는 전제 위에 있다). 그래서 `location`은 **화면에 힌트로만** 보여주고
 *    저장하지도, 자동 적용하지도 않는다 — 지역은 사용자가 목록에서 고른다.
 * 🔴 저장하는 것은 사용자가 확인한 **이름**뿐이다. 아바타·회사·소개는 받지도 않는다.
 *
 * @returns {Promise<{login: string, name: string, locationHint: string}>}
 */
export async function fetchUserProfile(
  username,
  { fetchImpl = globalThis.fetch, token = undefined } = {},
) {
  const clean = String(username ?? '').trim().replace(/^@/, '');
  if (!clean) throw new GitHubError(GITHUB_ERRORS.NO_USER, 'empty');

  const accessToken = token === undefined ? await getStoredToken() : token;
  const headers = accessToken
    ? { ...API_HEADERS, Authorization: `Bearer ${accessToken}` }
    : { ...API_HEADERS };

  let response;
  try {
    response = await fetchImpl(`${API_ROOT}/users/${encodeURIComponent(clean)}`, { headers });
  } catch {
    throw new GitHubError(GITHUB_ERRORS.NETWORK);
  }

  if (response.status === 404) throw new GitHubError(GITHUB_ERRORS.NO_USER, clean);
  if (response.status === 403 || response.status === 429) {
    throw new GitHubError(GITHUB_ERRORS.RATE_LIMIT);
  }
  if (!response.ok) throw new GitHubError(GITHUB_ERRORS.UNKNOWN, String(response.status));

  const body = await response.json().catch(() => null);
  return {
    login: body?.login ?? clean,
    // 🔴 이름이 비어 있으면 login으로 떨어진다 — 빈 칸을 채워 주지 않으면 자동 채우기가 무의미하다.
    name: body?.name || body?.login || clean,
    locationHint: typeof body?.location === 'string' ? body.location : '',
  };
}

/**
 * 공개 이벤트를 모은다.
 *
 * 🔴 **`GITHUB_EVENT_PAGES`(3)장을 받는다.** 1장만 받으면 대부분이 PushEvent라 분석 가능한 글이
 *    12~13건에 그쳐 활발한 계정도 최소치(15)를 못 넘는다 — 2026-08-14 실측. GitHub이 최대 300건만
 *    주므로 4장 이상은 의미가 없다.
 * 🔴 **토큰이 없어도 동작한다.** 공개 데이터라 인증이 권한 문제가 아니라 한도 문제이기 때문이다.
 *
 * @param {string} username `github.com/` 뒤에 오는 값.
 * @returns {Promise<object[]>} 이벤트 배열. 🔴 이 배열은 호출부에서 분석 후 **버려진다.**
 */
export async function fetchPublicEvents(
  username,
  { fetchImpl = globalThis.fetch, token = undefined } = {},
) {
  const clean = String(username ?? '').trim().replace(/^@/, '');
  if (!clean) throw new GitHubError(GITHUB_ERRORS.NO_USER, 'empty');

  const accessToken = token === undefined ? await getStoredToken() : token;
  const headers = accessToken
    ? { ...API_HEADERS, Authorization: `Bearer ${accessToken}` }
    : { ...API_HEADERS };

  const events = [];
  for (let page = 1; page <= GITHUB_EVENT_PAGES; page += 1) {
    const url = `${API_ROOT}/users/${encodeURIComponent(clean)}/events/public?per_page=100&page=${page}`;

    let response;
    try {
      response = await fetchImpl(url, { headers });
    } catch {
      throw new GitHubError(GITHUB_ERRORS.NETWORK);
    }

    if (response.status === 404) throw new GitHubError(GITHUB_ERRORS.NO_USER, clean);
    if (response.status === 403 || response.status === 429) {
      throw new GitHubError(GITHUB_ERRORS.RATE_LIMIT);
    }
    // 🔴 토큰이 만료·회수된 경우. 토큰 없이 부르면 401이 아니라 200이므로, 이건 곧 **우리 토큰 문제**다.
    if (response.status === 401) throw new GitHubError(GITHUB_ERRORS.AUTH_EXPIRED, String(accessToken ? 'token' : 'anon'));
    if (!response.ok) throw new GitHubError(GITHUB_ERRORS.UNKNOWN, String(response.status));

    const page_ = await response.json().catch(() => null);
    if (!Array.isArray(page_)) break;
    events.push(...page_);
    // 🔴 100건 미만이면 마지막 장이다 — 더 부르면 빈 응답으로 한도만 쓴다.
    if (page_.length < 100) break;
  }

  return events;
}
