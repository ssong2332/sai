/**
 * 예약 발송 기록 (S14 후속 / Spec 필수 6).
 *
 * 🔴 **이 확장은 남의 서비스 대신 메시지를 보낼 수 없다 — 조사 결론(2026-08-13)**:
 *    - **Slack**: `chat.scheduleMessage` API가 존재하지만 Slack 앱 등록 + OAuth + (대개) 워크스페이스
 *      관리자 승인이 필요하다. 확장 하나가 임의로 남의 워크스페이스에 글을 예약할 수는 없다.
 *    - **Microsoft Teams**: Graph API에 채팅 예약 전송 엔드포인트가 없다.
 *    - **Gmail**: Gmail API에 예약 전송이 없다(화면의 "예약 전송"은 UI 전용 기능이다).
 *    - **호스트 페이지 DOM 조작으로 각 사이트의 예약 버튼을 누르기**: 사이트마다 마크업이 달라
 *      범용 규칙이 성립하지 않는다 — 이 프로젝트가 이미 배운 함정이다(Lessons #3·#4).
 *    → 그래서 **"우리가 대신 보낸다"고 말하지 않는다.** 우리가 정직하게 할 수 있는 것은
 *      ① 지금 넣지 않기 ② 언제 보내면 좋은지 기록해 두기 ③ 사이드패널에서 다시 보여주기다.
 *
 * 🔴 Zero Retention과의 관계: 스니펫과 **같은 근거**로 허용된다(`docs/ZeroRetention.md`의 "단서").
 *    사용자가 버튼을 눌러 명시적으로 남기는 것이고, `chrome.storage.local`에만 저장되며,
 *    개별 삭제가 가능하다. 서버로는 나가지 않는다.
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

/** 너무 쌓이면 관리가 안 된다 — 지난 것은 사용자가 지우게 한다. */
export const MAX_RESERVATIONS = 30;

function makeId() {
  return `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function listReservations() {
  const stored = await getLocal(STORAGE_KEYS.RESERVATIONS, null);
  return Array.isArray(stored) ? stored : [];
}

/**
 * @param {{text: string, recipientName: string, sendAtLabel: string, sendAtISO: string|null}} input
 * @returns {Promise<{ok: boolean, reason?: string, entry?: object}>}
 */
/**
 * 🔴 **`Date`를 그대로 저장하면 안 된다** (2026-08-14 실측으로 잡은 결함): `chrome.storage.local`은
 *    JSON 직렬화 가능한 값만 보관하므로 `Date`가 **`{}`로 뭉개진다.** 그러면 background의
 *    `Date.parse(item.sendAtISO)`가 `NaN`이 되어 **알람이 아예 걸리지 않았다** — 예약의 존재
 *    이유("시간이 되면 알려준다")가 통째로 죽어 있었다.
 *    저장 직전에 여기서 **문자열로 못박는다** — 호출자가 Date를 넘겨도 안전하게 만든다.
 * @returns {string|null} 유효한 ISO 문자열, 아니면 null(지어내지 않는다).
 */
function toISOStringOrNull(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function addReservation({ text, recipientName, sendAtLabel, sendAtISO = null }) {
  const body = String(text ?? '').trim();
  if (!body) return { ok: false, reason: 'empty' };

  const list = await listReservations();
  if (list.length >= MAX_RESERVATIONS) return { ok: false, reason: 'full' };

  const entry = {
    id: makeId(),
    text: body,
    recipientName: recipientName ?? '상대',
    sendAtLabel: sendAtLabel ?? '',
    sendAtISO: toISOStringOrNull(sendAtISO),
    createdAt: new Date().toISOString(),
  };
  await setLocal(STORAGE_KEYS.RESERVATIONS, [entry, ...list]);
  return { ok: true, entry };
}

/** 🔴 개별 삭제 — Zero Retention 단서 ③의 조건이다. */
export async function removeReservation(id) {
  const list = await listReservations();
  const next = list.filter((entry) => entry.id !== id);
  if (next.length === list.length) return false;
  await setLocal(STORAGE_KEYS.RESERVATIONS, next);
  return true;
}

export async function clearReservations() {
  await setLocal(STORAGE_KEYS.RESERVATIONS, []);
}
