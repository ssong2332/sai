/**
 * 인앱 재화(포인트) — 토큰 이코노미 최소 구현 (S23 / Spec §1 Token Economy).
 *
 * Spec §1: "회의 시간 양보, 퇴근 요정 수락, 1초 피드백 참여 시 포인트 획득 ➔ 소통 가이드 상세
 * 확장 및 유료 열람에 사용 가능". v1은 **획득**까지만 구현한다 — 사용처(유료 열람)는 결제·백엔드가
 * 붙는 v2 영역이라 지어내지 않는다.
 *
 * 🔴 Zero Retention (Spec 필수 5): 여기에 저장되는 것은 **적립 사유 코드(enum)와 수치**뿐이다.
 *    메시지 본문·상대 이름·회의 제목 어느 것도 들어가지 않는다 — 그런 필드를 애초에 두지 않았다.
 * 🔴 `chrome.storage.local`에만 남는다. 서버·Firestore로 나가지 않는다.
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

/** 적립 사유 — 고정 집합. 자유 문자열을 받지 않는다(본문이 사유를 가장해 들어오는 것 차단). */
export const POINT_REASONS = {
  MEETING_YIELD: 'meeting-yield',
  SCHEDULE_ACCEPT: 'schedule-accept',
  FEEDBACK: 'feedback',
};

/** Spec §1에 명시된 적립액. */
export const POINT_AMOUNTS = {
  [POINT_REASONS.MEETING_YIELD]: 50,
  [POINT_REASONS.SCHEDULE_ACCEPT]: 10,
  [POINT_REASONS.FEEDBACK]: 5,
};

export const POINT_LABELS = {
  [POINT_REASONS.MEETING_YIELD]: '회의 시간 양보',
  [POINT_REASONS.SCHEDULE_ACCEPT]: '퇴근 요정 수락',
  [POINT_REASONS.FEEDBACK]: '1초 피드백',
};

/** 내역이 무한히 쌓이지 않게 최근 것만 남긴다. */
export const MAX_HISTORY = 30;

const EMPTY = { balance: 0, history: [] };

export async function getPoints() {
  const stored = await getLocal(STORAGE_KEYS.POINTS, null);
  if (!stored || typeof stored !== 'object') return { ...EMPTY };
  return {
    balance: Number.isFinite(stored.balance) ? stored.balance : 0,
    history: Array.isArray(stored.history) ? stored.history : [],
  };
}

/**
 * 포인트를 적립한다.
 * 🔴 사유가 고정 집합에 없으면 **적립하지 않는다** — 조용히 통과시키면 사유 코드가 사실상
 *    자유 문자열이 되고, 그 순간 본문이 들어올 경로가 생긴다.
 *
 * @param {string} reason POINT_REASONS 중 하나.
 * @returns {Promise<{ok: boolean, amount: number, balance: number}>}
 */
export async function awardPoints(reason) {
  const amount = POINT_AMOUNTS[reason];
  if (!amount) {
    const current = await getPoints();
    return { ok: false, amount: 0, balance: current.balance };
  }

  const current = await getPoints();
  const entry = { reason, amount, at: new Date().toISOString() };
  const next = {
    balance: current.balance + amount,
    history: [entry, ...current.history].slice(0, MAX_HISTORY),
  };
  await setLocal(STORAGE_KEYS.POINTS, next);
  return { ok: true, amount, balance: next.balance };
}

/** 전체 초기화 — 사용자가 내역을 지울 수 있어야 한다(스니펫·학습내역과 같은 원칙). */
export async function clearPoints() {
  await setLocal(STORAGE_KEYS.POINTS, { ...EMPTY });
}
