/**
 * 결정 로그 로컬 저장소 (S25 / Spec 부가 7 — Decision Log).
 *
 * 🔴 **Zero Retention과의 관계 — 반드시 읽을 것** (`docs/ZeroRetention.md`의 "단서" 절).
 *    스니펫(`lib/snippets.js`)이 세운 세 조건을 그대로 지키되, **조건이 하나 더 엄하다**:
 *      ① 사용자의 명시적 행동으로만 저장 — 자동 저장·히스토리 금지
 *      ② `chrome.storage.local`에만 — 🔴 서버·Firestore·`chrome.storage.sync` 전송 금지
 *         (sync는 구글 계정을 통해 기기 밖으로 나간다)
 *      ③ 언제든 개별 삭제 가능
 *      ④ 🔴 **사전 동의 없이는 기능 자체가 잠긴다** (스니펫에는 없는 조건)
 *
 *    왜 ④가 추가되나: 스니펫은 **내가 쓴 문장**을 내가 저장하는 것이고, 결정 로그는
 *    **남이 쓴 메시지**에서 뽑아낸 내용이다. 대화 상대는 자기 말이 요약돼 내 기기에 남는 데
 *    동의한 적이 없다. 우리가 상대의 동의를 받을 방법은 없으므로, 최소한 **저장하는 쪽이
 *    무엇을 남기는지 알고 시작하게** 만든다.
 *
 * 🔴 **동의 철회는 곧 삭제다.** 철회하면서 이미 저장된 것을 남겨 두면 철회가 아무 의미가 없다.
 *    `setConsent(false)`는 저장분을 함께 지운다.
 *
 * 🔴 `Date` 객체를 저장하지 않는다 — `chrome.storage`를 통과하면 `{}`가 된다(S26 예약 기능에서
 *    실제로 겪었다: `sendAtISO: {}`로 저장돼 알람이 전부 안 걸렸다). 시각은 **ISO 문자열**로만.
 */

import { getLocal, setLocal, removeLocal, STORAGE_KEYS } from './storage.js';

/** 저장 상한 — 무한히 쌓이면 사용자가 관리할 수 없고, 남의 메시지 파생물 보관량만 늘어난다. */
export const MAX_DECISION_LOGS = 30;

/** 저장을 거절한 이유 — 화면 문구를 여기 코드에 맞춰 만든다(자유 문자열 금지). */
export const SAVE_REJECTIONS = {
  NO_CONSENT: 'no-consent',
  EMPTY: 'empty',
  FULL: 'full',
};

/* ── 동의 ─────────────────────────────────────────────────────────────── */

/** 기본값은 **false**다 — 동의는 켜져 있는 상태에서 시작하지 않는다. */
export async function hasConsent() {
  return (await getLocal(STORAGE_KEYS.DECISIONS_CONSENT, false)) === true;
}

/**
 * 동의를 켜거나 끈다.
 * 🔴 끄면 **저장된 로그를 함께 지운다** — 위 헤더의 "동의 철회는 곧 삭제다" 참조.
 *
 * @returns {Promise<{consent: boolean, deletedCount: number}>}
 */
export async function setConsent(granted) {
  const next = granted === true;
  await setLocal(STORAGE_KEYS.DECISIONS_CONSENT, next);
  if (next) return { consent: true, deletedCount: 0 };

  const existing = await listDecisionLogs();
  await removeLocal(STORAGE_KEYS.DECISION_LOGS);
  return { consent: false, deletedCount: existing.length };
}

/* ── 로그 ─────────────────────────────────────────────────────────────── */

function makeId() {
  return `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function listDecisionLogs() {
  const stored = await getLocal(STORAGE_KEYS.DECISION_LOGS, null);
  return Array.isArray(stored) ? stored : [];
}

/**
 * 결정 요약 한 건을 저장한다.
 *
 * 🔴 **동의가 없으면 저장하지 않고 거절 사유를 돌려준다** — 던지지 않는다. 호출부가 화면에
 *    동의 안내를 띄우는 것이 정상 경로라, 예외로 만들면 그 경로가 오류 처리처럼 보인다.
 * 🔴 `sourceLabel`은 **호스트명만** 받는다(예: `mail.google.com`). 전체 URL은 경로·쿼리에
 *    스레드 ID 같은 식별자가 붙어 있어 필요 이상으로 남는다.
 *
 * @param {object} input
 * @param {Array<object>} input.decisions 정규화된 결정 배열(`core/decisions/schema.js` 형태).
 * @param {string|null} [input.sourceLabel] 호스트명.
 * @param {string|null} [input.title] 사용자가 붙인 이름. 없으면 화면이 날짜로 표시한다.
 * @returns {Promise<{ok: boolean, reason?: string, entry?: object}>}
 */
export async function saveDecisionLog({ decisions, sourceLabel = null, title = null }) {
  if (!(await hasConsent())) return { ok: false, reason: SAVE_REJECTIONS.NO_CONSENT };

  const rows = Array.isArray(decisions) ? decisions : [];
  // 🔴 빈 요약은 저장하지 않는다 — "결정 없음"을 로그로 쌓을 이유가 없다.
  if (rows.length === 0) return { ok: false, reason: SAVE_REJECTIONS.EMPTY };

  const list = await listDecisionLogs();
  if (list.length >= MAX_DECISION_LOGS) return { ok: false, reason: SAVE_REJECTIONS.FULL };

  const entry = {
    id: makeId(),
    // 🔴 ISO 문자열 — `Date` 객체는 chrome.storage를 통과하면 `{}`가 된다.
    savedAt: new Date().toISOString(),
    sourceLabel: typeof sourceLabel === 'string' && sourceLabel.trim() ? sourceLabel.trim() : null,
    title: typeof title === 'string' && title.trim() ? title.trim() : null,
    decisions: rows,
    decisionCount: rows.length,
    unresolvedCount: rows.filter((row) => row.owner === null || row.dueDate === null).length,
  };

  await setLocal(STORAGE_KEYS.DECISION_LOGS, [entry, ...list]);
  return { ok: true, entry };
}

/** 개별 삭제 (조건 ③). */
export async function deleteDecisionLog(id) {
  const list = await listDecisionLogs();
  const next = list.filter((entry) => entry.id !== id);
  await setLocal(STORAGE_KEYS.DECISION_LOGS, next);
  return { deleted: next.length !== list.length };
}

/** 전체 삭제 — 동의는 유지한 채 내용만 비운다(철회는 `setConsent(false)`). */
export async function clearDecisionLogs() {
  const list = await listDecisionLogs();
  await removeLocal(STORAGE_KEYS.DECISION_LOGS);
  return { deletedCount: list.length };
}
