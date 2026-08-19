/**
 * 회신 초안 실패 폴백 (S37 — decode/fallback.js와 같은 원칙, Lessons #5).
 *
 * 🔴 **여기서 준비된 예시 초안을 돌려주지 않는다.** 교정 목업과 달리, 회신 초안은 사용자가
 *    그대로 복사해 상대에게 보내는 문장이다. 실패했을 때 그럴듯한 예시 문장이 뜨면 그게 자기
 *    메시지에 대한 답인 줄 알고 보낸다. 초안 자리는 비우고 실패 사실만 올린다.
 */

export const REPLY_FALLBACK_REASONS = {
  QUOTA: 'quota',
  ERROR: 'error',
  INVALID: 'invalid',
};

const NOTICES = {
  [REPLY_FALLBACK_REASONS.QUOTA]: 'AI 사용량이 소진되어 회신 초안을 만들지 못했습니다.',
  [REPLY_FALLBACK_REASONS.ERROR]: 'AI 서버에 연결하지 못해 회신 초안을 만들지 못했습니다.',
  [REPLY_FALLBACK_REASONS.INVALID]: 'AI 응답을 해석하지 못했습니다.',
};

export function buildReplyFallbackResponse(_input, reason) {
  const notice = NOTICES[reason] ?? NOTICES[REPLY_FALLBACK_REASONS.ERROR];
  return {
    draft: null,
    placeholderNote: '',
    fallback: true,
    fallbackReason: reason,
    fallbackNotice: `${notice} 잠시 후 다시 시도해 주세요.`,
    cached: false,
  };
}
