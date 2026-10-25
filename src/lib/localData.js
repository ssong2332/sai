/**
 * 「데이터 보기」 — 이 컴퓨터에 무엇이 **몇 개** 저장돼 있는지 (2026-10-25, 설정 페이지).
 *
 * 🔴 금지
 *   - **개수·참/거짓만** 돌려준다. 본문(저장 문구·예약·결정 로그), 용어, 수신자 이름·시간대, 팀 이름,
 *     토큰·이메일·uid는 반환값 어디에도 들어가지 않는다 — `test/localData.unit.test.js`가 잠근다.
 *   - 여기서 아무것도 지우지 않는다. 지우는 길은 각 화면의 기존 동작으로 안내만 한다.
 *
 * | 항목 | 저장 키 | 세는 법 |
 * |---|---|---|
 * | glossary | `GLOSSARY_PERSONAL` | 배열 길이 |
 * | learned | `LEARNED_PATTERNS` | 아는 분류(`DIFF_CATEGORIES`) 중 횟수가 1 이상인 수 — 학습 내역 패널과 같은 기준 |
 * | snippets · reservations · recipients · decisionLogs · teams | 각 키 | 배열 길이 |
 * | blockedSites | `SITE_BLOCKLIST` | 배열 길이 |
 * | integrationsOff | `SITE_INTEGRATIONS_OFF` | 배열 길이 |
 * | signedIn | `AUTH` | 세션에 uid가 있으면 true |
 * | githubLinked | `GITHUB_TOKEN` | 값이 있으면 true |
 * | decisionsConsent | `DECISIONS_CONSENT` | `=== true` |
 * | pendingLearnedDeletions | `LEARNED_DELETIONS` | `all`이면 true, 아니면 `kinds`가 있으면 true |
 * 마지막 동기화 시각: 저장하는 곳이 없다(2026-10-25 `src/lib` grep) — 지어내지 않는다.
 */

import { getLocal, STORAGE_KEYS } from './storage.js';
import { DIFF_CATEGORIES } from '../core/profile/diff.js';

const KNOWN_LEARNED = new Set(DIFF_CATEGORIES.map((c) => c.id));

export const LOCAL_DATA_KEYS = {
  glossary: STORAGE_KEYS.GLOSSARY_PERSONAL,
  learned: STORAGE_KEYS.LEARNED_PATTERNS,
  learnedDeletions: STORAGE_KEYS.LEARNED_DELETIONS,
  snippets: STORAGE_KEYS.SNIPPETS,
  reservations: STORAGE_KEYS.RESERVATIONS,
  recipients: STORAGE_KEYS.RECIPIENTS,
  decisionLogs: STORAGE_KEYS.DECISION_LOGS,
  decisionsConsent: STORAGE_KEYS.DECISIONS_CONSENT,
  teams: STORAGE_KEYS.TEAMS,
  auth: STORAGE_KEYS.AUTH,
  github: STORAGE_KEYS.GITHUB_TOKEN,
  blockedSites: STORAGE_KEYS.SITE_BLOCKLIST,
  integrationsOff: STORAGE_KEYS.SITE_INTEGRATIONS_OFF,
};

const len = (value) => (Array.isArray(value) ? value.length : 0);

/**
 * 저장값 묶음 → 개수표. 🔴 값을 하나도 복사하지 않는다 — 숫자와 불리언을 새로 만든다.
 * @param {Record<string, unknown>} raw `LOCAL_DATA_KEYS`의 이름(glossary 등)을 키로 한 저장값
 */
export function summarizeLocalData(raw = {}) {
  const learned = raw.learned && typeof raw.learned === 'object' && !Array.isArray(raw.learned) ? raw.learned : {};
  const deletions = raw.learnedDeletions && typeof raw.learnedDeletions === 'object' ? raw.learnedDeletions : {};
  return {
    glossary: len(raw.glossary),
    // 「학습 내역」 패널과 같은 기준 — 아는 분류 중 1회 이상인 것만.
    learned: Object.entries(learned).filter(
      ([id, n]) => KNOWN_LEARNED.has(id) && typeof n === 'number' && Number.isFinite(n) && n > 0,
    ).length,
    snippets: len(raw.snippets),
    reservations: len(raw.reservations),
    recipients: len(raw.recipients),
    decisionLogs: len(raw.decisionLogs),
    teams: len(raw.teams),
    blockedSites: len(raw.blockedSites),
    integrationsOff: len(raw.integrationsOff),
    // `getSession`(authClient.js)과 같은 기준 — uid가 있어야 로그인이다. uid 값 자체는 싣지 않는다.
    signedIn: Boolean(raw.auth && typeof raw.auth === 'object' && raw.auth.uid),
    githubLinked: Boolean(raw.github),
    decisionsConsent: raw.decisionsConsent === true,
    pendingLearnedDeletions: deletions.all === true || len(deletions.kinds) > 0,
  };
}

export async function readLocalDataSummary() {
  const entries = await Promise.all(
    Object.entries(LOCAL_DATA_KEYS).map(async ([name, key]) => [name, await getLocal(key, null)]),
  );
  return summarizeLocalData(Object.fromEntries(entries));
}
