/**
 * 사이트별 켜고 끄기 — 「통합」 토글 + 「사이 버튼을 표시하지 않을 사이트」 목록 (2026-10-25).
 *
 * 🔴 금지
 *   - 여기에 **방문 기록을 남기지 않는다.** 저장되는 것은 사용자가 직접 넣은 호스트 이름과 꺼 둔 통합 id뿐이다.
 *     콘텐츠 스크립트는 지금 페이지의 호스트를 **읽어서 비교만** 한다 — 어디에도 쓰지 않는다(Zero Retention).
 *   - 경로·쿼리·해시를 저장하지 않는다 — `normalizeHost`가 호스트만 남긴다(경로에 문서 id·검색어가 섞인다).
 *
 * 저장 (`STORAGE_KEYS`):
 * | 키 | 값 | 기본 |
 * |---|---|---|
 * | `SITE_BLOCKLIST` (`sai.sites.blocked`) | `string[]` — 정규화한 호스트, 중복 없음, 최대 `MAX_BLOCKED_HOSTS` | `[]` |
 * | `SITE_INTEGRATIONS_OFF` (`sai.sites.integrationsOff`) | `string[]` — **꺼 둔** 통합 id만 | `[]` = 전부 켜짐 |
 *
 * 판정표 — 지금 페이지에서 사이를 띄우는가 (`evaluateSiteGate`). **위에서부터 처음 맞는 줄**:
 * | # | 조건 | 결과 | reason |
 * |---|---|---|---|
 * | 1 | 호스트가 비었음(`about:blank`·`file:` 등) | 켜짐 | `null` — 기존 동작 유지 |
 * | 2 | 차단 목록의 항목과 맞음(같은 호스트 또는 그 하위 도메인) | **꺼짐** | `blocked` |
 * | 3 | 꺼 둔 통합의 호스트와 맞음 | **꺼짐** | `integration-off` |
 * | 4 | 그 밖 | 켜짐 | `null` |
 * 🔴 **「끔」이 언제나 이긴다** — 통합이 켜져 있어도 차단 목록에 있으면 꺼진다. 「켬」은 아무것도 덮지 않는다
 *    (기본이 켜짐이라 켬은 「따로 끄지 않음」일 뿐이다). 그래서 두 설정이 서로를 뒤집는 경우가 없다.
 *    둘 다 해당하면 reason은 `blocked`다 — 화면은 「차단 목록에서 빼야 다시 켜져요」라고 말할 수 있다.
 *
 * 호스트 맞춤 규칙 (`hostMatches`): 항목 `example.com`은 `example.com`과 `*.example.com`에 맞는다.
 *   `badexample.com`에는 맞지 않는다(점 경계). 별표(`*.`)는 넣어도 떼고 저장한다 — 원래 하위 도메인까지 맞는다.
 *   앞의 `www.`도 뗀다 — `www.notion.so`를 넣은 사람이 `notion.so`에서 꺼지지 않으면 고장으로 읽힌다.
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

export const MAX_BLOCKED_HOSTS = 200;
/** 호스트 이름 상한(DNS 253). */
const MAX_HOST_LENGTH = 253;

/**
 * 자주 쓰는 업무 사이트 (「통합」 패널). 🔴 사이에는 **사이트별 전용 어댑터가 없다**(2026-10-25 `src/content` grep —
 * 호스트로 분기하는 코드 0건). 그래서 설명은 「무엇을 할 수 있는지」만 말하고, 사이트 전용 기능을 지어내지 않는다.
 * `hosts`는 `hostMatches` 규칙(하위 도메인 포함)으로 비교한다. `openUrl`은 「…에서 열기」 링크다.
 */
export const INTEGRATIONS = [
  {
    id: 'slack',
    name: 'Slack',
    hosts: ['slack.com'],
    openUrl: 'https://app.slack.com/',
    description: '채널·DM에 쓴 문장을 보내기 전에 다듬고, 받은 메시지의 뜻을 풀어요.',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    hosts: ['mail.google.com'],
    openUrl: 'https://mail.google.com/',
    description: '메일 본문을 다듬고, 받은 메일에서 상대가 실제로 원하는 것을 짚어요.',
  },
  {
    id: 'outlook',
    name: 'Outlook',
    hosts: ['outlook.office.com', 'outlook.office365.com', 'outlook.live.com'],
    openUrl: 'https://outlook.office.com/mail/',
    description: '웹 Outlook에서 메일을 쓰거나 읽을 때 같은 방식으로 도와요.',
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    hosts: ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft'],
    openUrl: 'https://teams.microsoft.com/',
    description: '채팅에 쓴 문장을 다듬고, 상대 시간대를 보고 보낼 때를 알려 줘요.',
  },
  {
    id: 'google-chat',
    name: 'Google Chat',
    hosts: ['chat.google.com'],
    openUrl: 'https://chat.google.com/',
    description: '스페이스·DM 메시지를 보내기 전에 다듬어요.',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    hosts: ['linkedin.com'],
    openUrl: 'https://www.linkedin.com/messaging/',
    description: '메시지·댓글을 상대에게 맞는 말투로 다듬어요.',
  },
  {
    id: 'discord',
    name: 'Discord',
    hosts: ['discord.com'],
    openUrl: 'https://discord.com/app',
    description: '커뮤니티·팀 채널 메시지를 다듬고 뜻을 풀어요.',
  },
  {
    id: 'notion',
    name: 'Notion',
    hosts: ['notion.so', 'notion.site'],
    openUrl: 'https://www.notion.so/',
    description: '문서·댓글에 쓴 문장을 다듬고, 용어집대로 옮겼는지 확인해요.',
  },
  {
    id: 'atlassian',
    name: 'Jira · Confluence',
    hosts: ['atlassian.net'],
    openUrl: 'https://start.atlassian.com/',
    description: '이슈·댓글·문서에서 기한과 숫자를 지키며 다듬어요.',
  },
  {
    id: 'github',
    name: 'GitHub',
    hosts: ['github.com'],
    openUrl: 'https://github.com/',
    description: '이슈·PR 댓글을 다듬고, 리뷰 코멘트의 뜻을 풀어요.',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Web',
    hosts: ['web.whatsapp.com'],
    openUrl: 'https://web.whatsapp.com/',
    description: '채팅 메시지를 보내기 전에 다듬어요.',
  },
];

const INTEGRATION_IDS = INTEGRATIONS.map((item) => item.id);

/** 정규화 실패 사유 — 화면 문구는 `hostErrorMessage`. */
export const HOST_ERRORS = {
  EMPTY: 'empty',
  INVALID: 'invalid',
};

export function hostErrorMessage(reason) {
  if (reason === HOST_ERRORS.EMPTY) return '사이트 주소를 넣어 주세요.';
  return '사이트 주소 형식이 아니에요. 예: example.com';
}

/** 호스트 한 칸(label) — 영문 소문자·숫자·하이픈, 앞뒤 하이픈 금지, 1~63자. */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * 사용자가 넣은 문자열 → 호스트. 맞지 않으면 `{ok:false, reason}`.
 * - 앞뒤 공백·스킴(`https://`)·경로·쿼리·해시·포트·사용자 정보를 뗀다.
 * - 소문자로. 국제화 도메인은 `URL`이 퓨니코드로 바꾼다(`예시.kr` → `xn--...`).
 * - 앞의 `*.`·`www.`·끝의 점을 뗀다.
 * - 점이 하나 이상 있어야 한다(`localhost`는 예외). IP 주소(IPv4)는 받는다.
 *
 * @param {unknown} input
 * @returns {{ok: true, host: string} | {ok: false, reason: string}}
 */
export function normalizeHost(input) {
  if (typeof input !== 'string') return { ok: false, reason: HOST_ERRORS.EMPTY };
  let text = input.trim().toLowerCase();
  if (text === '') return { ok: false, reason: HOST_ERRORS.EMPTY };
  // 별표는 맨 앞 `*.` 하나만 허용하고 뗀다 — 원래 하위 도메인까지 맞는다.
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  if (text.startsWith('*.')) text = text.slice(2);
  if (text.includes('*') || /\s/.test(text)) return { ok: false, reason: HOST_ERRORS.INVALID };

  let host;
  try {
    host = new URL(`http://${text}`).hostname;
  } catch {
    return { ok: false, reason: HOST_ERRORS.INVALID };
  }
  host = host.replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (host === '' || host.length > MAX_HOST_LENGTH) return { ok: false, reason: HOST_ERRORS.INVALID };
  // IPv6(`[::1]`)는 받지 않는다 — 대괄호가 남으면 형식 밖이다.
  if (host.startsWith('[')) return { ok: false, reason: HOST_ERRORS.INVALID };
  const labels = host.split('.');
  if (labels.length < 2 && host !== 'localhost') return { ok: false, reason: HOST_ERRORS.INVALID };
  if (!labels.every((label) => LABEL.test(label))) return { ok: false, reason: HOST_ERRORS.INVALID };
  return { ok: true, host };
}

/**
 * 페이지 호스트가 규칙 호스트와 맞는가 — 같거나, 점 경계의 하위 도메인.
 * 🔴 `www.`는 페이지 쪽에서도 떼고 비교한다(규칙 쪽은 저장 때 이미 뗐다).
 */
export function hostMatches(pageHost, ruleHost) {
  if (typeof pageHost !== 'string' || typeof ruleHost !== 'string' || ruleHost === '') return false;
  let host = pageHost.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  return host === ruleHost || host.endsWith(`.${ruleHost}`);
}

/** 저장값을 믿지 않는다 — 문자열 배열만, 다시 정규화해서 남긴다. */
export function cleanBlocklist(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const result = normalizeHost(item);
    if (result.ok && !out.includes(result.host)) out.push(result.host);
    if (out.length >= MAX_BLOCKED_HOSTS) break;
  }
  return out;
}

/** 꺼 둔 통합 id — 아는 id만 남긴다. */
export function cleanIntegrationsOff(value) {
  if (!Array.isArray(value)) return [];
  return INTEGRATION_IDS.filter((id) => value.includes(id));
}

/** 페이지 호스트에 해당하는 통합(첫 번째) — 없으면 null. */
export function findIntegration(pageHost) {
  return INTEGRATIONS.find((item) => item.hosts.some((rule) => hostMatches(pageHost, rule))) ?? null;
}

/**
 * 판정 — 헤더의 표 그대로.
 * @param {string} pageHost `location.hostname`
 * @param {{blocked?: unknown, integrationsOff?: unknown}} settings 저장값(정리 전이어도 된다)
 * @returns {{enabled: boolean, reason: null | 'blocked' | 'integration-off', rule: string | null, integrationId: string | null}}
 */
export function evaluateSiteGate(pageHost, settings = {}) {
  const shown = { enabled: true, reason: null, rule: null, integrationId: null };
  if (typeof pageHost !== 'string' || pageHost === '') return shown;
  const blocked = cleanBlocklist(settings.blocked);
  const rule = blocked.find((item) => hostMatches(pageHost, item));
  const integration = findIntegration(pageHost);
  if (rule) return { enabled: false, reason: 'blocked', rule, integrationId: integration?.id ?? null };
  const offIds = cleanIntegrationsOff(settings.integrationsOff);
  if (integration && offIds.includes(integration.id)) {
    return { enabled: false, reason: 'integration-off', rule: null, integrationId: integration.id };
  }
  return { ...shown, integrationId: integration?.id ?? null };
}

/**
 * 통합 하나가 화면에서 어떻게 보이는가 — 토글 값과 「차단 목록 때문에 꺼짐」을 함께 돌려준다.
 * 🔴 토글은 켜져 있는데 그 사이트 호스트가 차단 목록에 있으면 `blockedBy`에 그 항목이 온다 —
 *    화면이 「켜져 있는데 왜 안 뜨지」를 미리 말하게 한다.
 */
export function integrationState(integration, settings = {}) {
  const on = !cleanIntegrationsOff(settings.integrationsOff).includes(integration.id);
  const blocked = cleanBlocklist(settings.blocked);
  const blockedBy =
    blocked.find((rule) => integration.hosts.some((host) => hostMatches(host, rule))) ?? null;
  return { on, blockedBy };
}

/** 목록에 추가 — 이미 있으면 `duplicate: true`(목록은 그대로). */
export function addToBlocklist(list, input) {
  const current = cleanBlocklist(list);
  const result = normalizeHost(input);
  if (!result.ok) return { ok: false, reason: result.reason, list: current };
  if (current.includes(result.host)) return { ok: true, duplicate: true, host: result.host, list: current };
  if (current.length >= MAX_BLOCKED_HOSTS) return { ok: false, reason: 'full', list: current };
  return { ok: true, duplicate: false, host: result.host, list: [...current, result.host] };
}

/* ── 저장소 ─────────────────────────────────────────── */

export async function getSiteGateSettings() {
  const [blocked, integrationsOff] = await Promise.all([
    getLocal(STORAGE_KEYS.SITE_BLOCKLIST, []),
    getLocal(STORAGE_KEYS.SITE_INTEGRATIONS_OFF, []),
  ]);
  return { blocked: cleanBlocklist(blocked), integrationsOff: cleanIntegrationsOff(integrationsOff) };
}

/** @returns {Promise<ReturnType<typeof addToBlocklist>>} */
export async function addBlockedHost(input) {
  const { blocked } = await getSiteGateSettings();
  const result = addToBlocklist(blocked, input);
  if (result.ok && !result.duplicate) await setLocal(STORAGE_KEYS.SITE_BLOCKLIST, result.list);
  return result;
}

export async function removeBlockedHost(host) {
  const { blocked } = await getSiteGateSettings();
  const next = blocked.filter((item) => item !== host);
  await setLocal(STORAGE_KEYS.SITE_BLOCKLIST, next);
  return next;
}

export async function setIntegrationEnabled(id, enabled) {
  if (!INTEGRATION_IDS.includes(id)) throw new Error('unknown integration');
  const { integrationsOff } = await getSiteGateSettings();
  const next = enabled ? integrationsOff.filter((item) => item !== id) : [...new Set([...integrationsOff, id])];
  await setLocal(STORAGE_KEYS.SITE_INTEGRATIONS_OFF, cleanIntegrationsOff(next));
  return cleanIntegrationsOff(next);
}

/** 이 두 키가 바뀌면 콘텐츠 스크립트가 다시 판정한다. */
export const SITE_GATE_KEYS = [STORAGE_KEYS.SITE_BLOCKLIST, STORAGE_KEYS.SITE_INTEGRATIONS_OFF];
