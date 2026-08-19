/**
 * 결정 요약 실패 폴백 (S25 — decode/refine의 fallback.js와 같은 원칙, Lessons #5).
 *
 * 🔴 **결정을 하나도 지어내지 않는다.** 이 기능에서 가장 위험한 실패는 "그럴듯한 결정 행"이
 *    화면에 뜨는 것이다 — 그 자리에 없던 사람이 읽는 표라, 지어낸 한 줄이 실제 합의로 둔갑한다.
 *    그래서 폴백은 **빈 표 + 실패 사실**이다. refine 폴백처럼 시드 응답을 준비해 두지 않는다.
 * 🔴 빈 결과(`decisions: []`)와 폴백을 화면이 구분할 수 있어야 한다 — 전자는 "결정이 없었다",
 *    후자는 "읽지 못했다"로 뜻이 정반대다. `fallback` 플래그가 그 구분을 진다.
 */

export const DECISIONS_FALLBACK_REASONS = {
  QUOTA: 'quota',
  ERROR: 'error',
  INVALID: 'invalid',
};

const NOTICES = {
  [DECISIONS_FALLBACK_REASONS.QUOTA]: 'AI 사용량이 소진되어 결정 요약을 만들지 못했습니다.',
  [DECISIONS_FALLBACK_REASONS.ERROR]: 'AI 서버에 연결하지 못해 결정 요약을 만들지 못했습니다.',
  [DECISIONS_FALLBACK_REASONS.INVALID]: 'AI 응답을 해석하지 못했습니다.',
};

export function buildDecisionsFallbackResponse(_input, reason) {
  const notice = NOTICES[reason] ?? NOTICES[DECISIONS_FALLBACK_REASONS.ERROR];
  return {
    decisions: [],
    decisionCount: 0,
    unresolvedIndexes: [],
    unresolvedCount: 0,
    unknownAuthorityCount: 0,
    fallback: true,
    fallbackReason: reason,
    fallbackNotice: `${notice} 잠시 후 다시 시도해 주세요.`,
    cached: false,
  };
}
