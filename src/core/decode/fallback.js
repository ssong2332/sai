/**
 * 해독 실패 폴백 (S10 — refine의 fallback.js와 같은 원칙, Lessons #5).
 *
 * 🔴 폴백 응답을 실제 해석으로 오인시키지 않는다. `fallback:true` + 화면 문구를 항상 함께 싣는다.
 * 🔴 시드에 없는 입력은 **의도를 지어내지 않고** 원문을 직역 자리에 그대로 두고 실패를 알린다 —
 *    "그럴듯한 해석"을 지어내는 것이 이 기능에서 가장 위험한 실패다(근거 없는 의도 추정).
 */

export const DECODE_FALLBACK_REASONS = {
  QUOTA: 'quota',
  ERROR: 'error',
  INVALID: 'invalid',
};

const NOTICES = {
  [DECODE_FALLBACK_REASONS.QUOTA]: 'AI 사용량이 소진되어 해석 결과를 만들지 못했습니다.',
  [DECODE_FALLBACK_REASONS.ERROR]: 'AI 서버에 연결하지 못해 해석 결과를 만들지 못했습니다.',
  [DECODE_FALLBACK_REASONS.INVALID]: 'AI 응답을 해석하지 못했습니다.',
};

export function buildDecodeFallbackResponse(_input, reason) {
  const notice = NOTICES[reason] ?? NOTICES[DECODE_FALLBACK_REASONS.ERROR];
  return {
    literalTranslation: null,
    actualIntent: '',
    intentEvidence: '',
    surfaceUrgency: 'NORMAL',
    actualUrgency: 'NORMAL',
    urgencyReason: '',
    urgencyGap: false,
    requiredActions: [],
    recommendedReply: null,
    fallback: true,
    fallbackReason: reason,
    fallbackNotice: `${notice} 잠시 후 다시 시도해 주세요.`,
    cached: false,
  };
}
