/**
 * LLM 실패·크레딧 소진 폴백 (Lessons #5 — 구 프로젝트 AC-029/AC-041, 프로덕션 실동작 확인).
 *
 * 🔴 핵심 규칙: 폴백 응답을 **실제 AI 결과로 오인시키지 않는다.** `fallback: true`와 화면 문구
 *    (`fallbackNotice`)를 항상 함께 실어 보내고, 클라이언트는 이를 반드시 노출한다.
 *    시연 중 키 장애 대비의 생명줄이며, Tasks.md 컷 규칙 "LLM 키 장애 → 폴백 데모 응답 경로"의 구현부다.
 */

import { DEFAULT_URGENCY } from './schema.js';

export const FALLBACK_REASONS = {
  /** 429 · insufficient_quota — 크레딧 소진. */
  QUOTA: 'quota',
  /** 5xx · 네트워크 · 타임아웃 — 일시 장애. */
  ERROR: 'error',
  /** 응답이 왔지만 계약(JSON 6필드)을 만족하지 못함. */
  INVALID: 'invalid',
};

const NOTICES = {
  [FALLBACK_REASONS.QUOTA]:
    'AI 사용량이 소진되어 준비된 예시 응답을 보여 드리고 있습니다. 실제 교정 결과가 아닙니다.',
  [FALLBACK_REASONS.ERROR]:
    'AI 서버에 연결하지 못해 준비된 예시 응답을 보여 드리고 있습니다. 실제 교정 결과가 아닙니다.',
  [FALLBACK_REASONS.INVALID]:
    'AI 응답을 해석하지 못해 준비된 예시 응답을 보여 드리고 있습니다. 실제 교정 결과가 아닙니다.',
};

/**
 * 사전 준비된 데모 응답. 전부 **합성 데이터**이며 실제 인물·기업이 아니다.
 * 원문(`text`)은 `docs/reference/TestCases-legacy.md`의 케이스 문장을 그대로 쓴다.
 */
const SEED_ENTRIES = [
  {
    // 레거시 P-02 / T-U01 — 시연 대표 문장.
    text: '결제 API 죽었습니다. 지금 주문 전부 실패 중이에요. 당장 확인 부탁드립니다.',
    sourceLanguage: 'ko',
    targetLanguage: 'en',
    urgency: 'CRITICAL',
    urgencyReason: '결제 API 전면 장애로 주문이 전량 실패 중이라 즉시 대응이 필요합니다.',
    refined:
      'The payment API is down and all orders are currently failing. Please investigate immediately and let me know what you find.',
    backTranslation:
      '결제 API가 다운되어 현재 모든 주문이 실패하고 있습니다. 즉시 확인하시고 결과를 알려 주시기 바랍니다.',
  },
  {
    // 레거시 T-U03.
    text: '내일 오전까지 리뷰 부탁드립니다',
    sourceLanguage: 'ko',
    targetLanguage: 'en',
    urgency: 'NORMAL',
    urgencyReason: '통상적인 업무 요청이며 마감이 내일 오전으로 명시되어 있습니다.',
    refined: 'Could you review this by tomorrow morning? Thanks in advance.',
    backTranslation: '내일 오전까지 이 건을 검토해 주실 수 있을까요? 미리 감사드립니다.',
  },
];

/**
 * 시드 조회 키. 공백을 정규화하고 **문장 끝 구두점을 떼어** 비교한다 — 시연자가 마침표를
 * 붙였는지 여부로 폴백이 갈리면 키 장애 상황에서 그대로 사고가 된다.
 */
function seedKey(text, sourceLanguage, targetLanguage) {
  const normalized = text.trim().replace(/\s+/g, ' ').replace(/[.。!?！？]+$/u, '');
  return `${sourceLanguage}>${targetLanguage}|${normalized}`;
}

/** 🔴 저장 키와 조회 키가 같은 함수를 거치게 한다 — 어긋나면 폴백이 조용히 빗나간다. */
const SEEDED = new Map(
  SEED_ENTRIES.map((entry) => [
    seedKey(entry.text, entry.sourceLanguage, entry.targetLanguage),
    entry,
  ]),
);

/**
 * 폴백 응답을 만든다. 시드에 없는 입력이면 **번역을 지어내지 않고** 원문을 그대로 돌려주며,
 * 그 사실을 문구로 알린다 — 지어낸 교정문을 실제 결과처럼 보여주는 것이 가장 나쁜 실패다.
 *
 * @param {object} input
 * @param {string} input.text 원문.
 * @param {string} input.sourceLanguage
 * @param {string} input.targetLanguage
 * @param {string|null} [input.userUrgency] 사용자 사전 선택 긴급도(Spec 필수 1 — 폴백에서도 존중).
 * @param {string} reason FALLBACK_REASONS 중 하나.
 */
export function buildFallbackResponse(
  { text, sourceLanguage, targetLanguage, userUrgency = null },
  reason,
) {
  const seed = SEEDED.get(seedKey(text, sourceLanguage, targetLanguage));
  const notice = NOTICES[reason] ?? NOTICES[FALLBACK_REASONS.ERROR];

  return {
    // Spec 필수 1 — AI 판정이 불가능한 상황이므로 기본값 NORMAL. 사용자 선택은 그대로 존중한다.
    urgency: userUrgency ?? seed?.urgency ?? DEFAULT_URGENCY,
    urgencySource: userUrgency ? 'user' : 'fallback',
    urgencyReason: userUrgency ? '' : (seed?.urgencyReason ?? ''),
    aiUrgency: null,
    urgencyFallback: !userUrgency,
    urgencyNotice: null, // 폴백 상황에서는 아래 fallbackNotice가 상위 안내다.

    refined: seed?.refined ?? text,
    refinedReason: '',
    preserved: [],
    misreadRisks: [],

    backTranslation: seed?.backTranslation ?? '',

    detectedIntent: 'normal',
    intentEvidence: null,
    ticket: null,

    appliedGlossary: [],
    unregisteredHonorifics: [],

    fallback: true,
    fallbackReason: reason,
    fallbackNotice: seed
      ? notice
      : `${notice} 이 입력에는 준비된 예시가 없어 원문을 그대로 표시합니다.`,
    cached: false,
  };
}
