/**
 * 의도 검증 피드백 루프 (S26 / Spec 부가 5 — `👍/👎` & 포인트 지급).
 *
 * 교정 결과가 내 의도대로 나왔는지 한 번의 클릭으로 알려주는 장치다. Spec §1의 "1초 피드백
 * 참여 시 포인트 획득"이 여기에 걸린다.
 *
 * 🔴 **이 집계는 학습에 쓰이지 않는다 — 쓸 수 없다** (2026-08-13 사용자 지적으로 명시).
 *    `{up, down}` 수치만으로는 **어떤 결과에 대한 평가인지**를 알 수 없어 학습 입력이 되지
 *    못한다. 그런데도 "평가하면 반영된다"고 암시하면 거짓말이 된다. 그래서 UI는 학습을 약속하지
 *    않고, 👎는 **즉시 재생성**으로 응답한다(`RefinePopup.sendFeedback`).
 *    → 실제 학습 신호의 단일 출처는 **S13**이다: 사용자가 교정문을 직접 고쳐서 적용하면
 *      그 diff가 분류돼 3회 이상부터 프로필에 반영된다(`src/lib/profile.js`의 `recordEdit`).
 *    → 이 집계는 "내가 얼마나 만족했나"를 **나 자신이 보는 용도**로만 남는다.
 *
 * 🔴 **Zero Retention (Spec 필수 5)**: 저장되는 것은 **집계 수치 두 개(up/down)뿐**이다.
 *    원문·교정문·"무엇이 마음에 안 들었는지" 같은 자유 서술은 받지도, 저장하지도 않는다 —
 *    그런 필드를 애초에 두지 않았다. 자유 서술 피드백을 넣고 싶어지면 그 순간 본문이 저장소로
 *    들어오는 것이므로, 넣지 않는다.
 * 🔴 `chrome.storage.local`에만 남는다. 서버로 나가지 않는다 — v1은 **내가 내 사용 이력을
 *    보는 용도**이며, 모델 학습에 쓰려면 별도 동의 설계가 먼저다(지어내지 않는다).
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

export const FEEDBACK_KINDS = { UP: 'up', DOWN: 'down' };

const EMPTY = { up: 0, down: 0 };

export async function getFeedbackCounts() {
  const stored = await getLocal(STORAGE_KEYS.FEEDBACK, null);
  if (!stored || typeof stored !== 'object') return { ...EMPTY };
  return {
    up: Number.isFinite(stored.up) ? stored.up : 0,
    down: Number.isFinite(stored.down) ? stored.down : 0,
  };
}

/**
 * 피드백 1건을 집계한다.
 * 🔴 고정 집합('up'|'down') 외의 값은 기록하지 않는다 — 통과시키면 종류가 사실상 자유
 *    문자열이 되고, 그 순간 본문이 들어올 경로가 생긴다(`points.js`의 사유 규칙과 같은 이유).
 *
 * @param {'up'|'down'} kind
 * @returns {Promise<{ok: boolean, counts: {up:number, down:number}}>}
 */
export async function recordFeedback(kind) {
  const counts = await getFeedbackCounts();
  if (kind !== FEEDBACK_KINDS.UP && kind !== FEEDBACK_KINDS.DOWN) {
    return { ok: false, counts };
  }
  const next = { ...counts, [kind]: counts[kind] + 1 };
  await setLocal(STORAGE_KEYS.FEEDBACK, next);
  return { ok: true, counts: next };
}

/** 사용자가 자기 이력을 지울 수 있어야 한다(학습내역·스니펫과 같은 원칙). */
export async function clearFeedback() {
  await setLocal(STORAGE_KEYS.FEEDBACK, { ...EMPTY });
}
