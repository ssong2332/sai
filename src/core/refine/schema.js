/**
 * `/v1/refine` 응답 검증·정규화 — 판정표(CLAUDE.md 보고 규칙 / Tasks.md S03)를 코드로 고정한다.
 *
 * | 조건 | urgency | 플래그 |
 * |---|---|---|
 * | 사용자 사전 선택 | 선택값 | urgencySource="user" |
 * | 미선택 + LLM 판정 성공 | LLM 값 | urgencySource="ai" |
 * | 미선택 + urgency 필드 누락·불량 | NORMAL | urgencySource="fallback", urgencyFallback=true (Spec 필수 1) |
 * | 감정 신호 임계 미만 | — | detectedIntent="normal", ticket=null (Lessons 자산 3 오탐 방지) |
 *
 * 🔴 이 파일은 본문 문자열을 로그·저장소로 내보내지 않는다 (Spec 필수 5 Zero Retention).
 *    검증 실패 사유는 필드명·이유 코드만 담는다.
 */

import { URGENCY_LEVELS } from './prompt.js';

/** Spec 필수 1 — AI 판정 실패 시의 기본값. */
export const DEFAULT_URGENCY = 'NORMAL';

/** 사용자에게 그대로 노출되는 실패 알림 문구 (Spec 필수 1 "실패 사실을 명시적으로 알림"). */
export const URGENCY_FALLBACK_NOTICE =
  '긴급도 자동 판정에 실패해 기본값 Normal을 적용했습니다. 직접 선택해 주세요.';

const TICKET_KEYS = ['problem', 'impact', 'request', 'concernLevel'];

/** 근거 없는 섹션의 표준 표기 (c6.ts AC-062 이식) — 빈 문자열·키 누락 대신 이 값. */
const NO_BASIS = '없음';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function asString(value, fallback = '') {
  return isNonEmptyString(value) ? value : fallback;
}

/** 배열이 아니거나 원소가 규격 밖이면 조용히 버린다 — 지어낸 항목을 통과시키지 않는다. */
function asList(value, pick) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const mapped = pick(item);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

function normalizeTicket(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const ticket = {};
  for (const key of TICKET_KEYS) {
    ticket[key] = asString(raw[key], NO_BASIS);
  }
  // 4개 섹션이 전부 "없음"이면 티켓으로서 의미가 없다 — 제안하지 않는다(오탐 방지).
  if (TICKET_KEYS.every((key) => ticket[key] === NO_BASIS)) return null;
  return ticket;
}

/**
 * LLM 원시 응답을 계약 형태로 정규화한다. **던지지 않는다** — 살릴 수 있는 필드는 살리고,
 * 살릴 수 없으면 호출자가 폴백을 결정하도록 `refined: null`로 표시해 돌려준다.
 *
 * @param {object} raw 파싱된 LLM JSON.
 * @param {object} context
 * @param {string|null} context.userUrgency 사용자가 사전 선택한 긴급도. 없으면 null.
 * @returns {{result: object|null, issues: string[]}} `result.refined`가 null이면 폴백 대상.
 */
export function normalizeRefineResponse(raw, { userUrgency = null } = {}) {
  const issues = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { result: null, issues: ['response:not-an-object'] };
  }

  // refined — 이것이 없으면 교정 결과 자체가 없다. 폴백 대상.
  if (!isNonEmptyString(raw.refined)) {
    return { result: null, issues: ['refined:missing'] };
  }

  // urgency — 판정표 3행. 사용자 선택이 있으면 그것이 최종값이고, AI 판정은 참고로 병기한다.
  const aiUrgency = URGENCY_LEVELS.includes(raw.urgency) ? raw.urgency : null;
  if (aiUrgency === null) issues.push('urgency:invalid');

  let urgency;
  let urgencySource;
  if (userUrgency && URGENCY_LEVELS.includes(userUrgency)) {
    urgency = userUrgency;
    urgencySource = 'user';
  } else if (aiUrgency !== null) {
    urgency = aiUrgency;
    urgencySource = 'ai';
  } else {
    urgency = DEFAULT_URGENCY;
    urgencySource = 'fallback';
  }

  // backTranslation — Spec 필수 3은 상시 노출이므로 누락을 조용히 넘기지 않고 표시한다.
  const backTranslation = asString(raw.backTranslation, '');
  if (backTranslation === '') issues.push('backTranslation:missing');

  // detectedIntent — 임계 미만이면 티켓을 제안하지 않는다(Lessons 자산 3).
  const detectedIntent = raw.detectedIntent === 'venting' ? 'venting' : 'normal';
  const ticket = detectedIntent === 'venting' ? normalizeTicket(raw.ticket) : null;
  if (detectedIntent === 'venting' && ticket === null) issues.push('ticket:missing');

  const result = {
    urgency,
    urgencySource,
    urgencyReason: asString(raw.urgencyReason, ''),
    aiUrgency,
    urgencyFallback: urgencySource === 'fallback',
    urgencyNotice: urgencySource === 'fallback' ? URGENCY_FALLBACK_NOTICE : null,

    refined: raw.refined,
    refinedReason: asString(raw.refinedReason, ''),
    preserved: asList(raw.preserved, (item) => {
      if (!item || !isNonEmptyString(item.sourceText)) return null;
      return {
        kind: ['deadline', 'number', 'action'].includes(item.kind) ? item.kind : 'action',
        sourceText: item.sourceText,
        refinedText: asString(item.refinedText, ''),
      };
    }),
    misreadRisks: asList(raw.misreadRisks, (item) => {
      // 3요소(인용·오해·근거)를 다 갖춘 항목만 통과 — 근거 없는 경고를 노출하지 않는다.
      if (!item || !isNonEmptyString(item.quote)) return null;
      if (!isNonEmptyString(item.misreading) || !isNonEmptyString(item.evidence)) return null;
      return { quote: item.quote, misreading: item.misreading, evidence: item.evidence };
    }),

    backTranslation,

    detectedIntent,
    intentEvidence: detectedIntent === 'venting' ? asString(raw.intentEvidence, '') || null : null,
    ticket,

    appliedGlossary: asList(raw.appliedGlossary, (item) => {
      if (!item || !isNonEmptyString(item.sourceText)) return null;
      return {
        id: asString(item.id, ''),
        sourceText: item.sourceText,
        appliedText: asString(item.appliedText, ''),
      };
    }),
    unregisteredHonorifics: asList(raw.unregisteredHonorifics, (item) =>
      isNonEmptyString(item) ? item : null,
    ),

    /**
     * 핵심 업무 정보 누락 (2026-08-14 사용자 제안 ② A안 — 기한·영향 2종).
     * 🔴 **`element`가 화이트리스트 밖이면 버린다.** 모델이 `assignee`·`purpose` 같은 걸 지어내
     *    보내도 통과시키지 않는다 — 사용자가 A안(2종)을 고른 결정이 여기서 강제된다.
     * 🔴 `requestQuote`가 없으면 버린다 — 인용 없는 누락 경고는 아무 메시지에나 붙는다.
     *    인용이 **원문에 실재하는지**는 화면 쪽(`core/refine/missing.js`)이 대조한다.
     */
    missingElements: asList(raw.missingElements, (item) => {
      if (!item || !['deadline', 'impact'].includes(item.element)) return null;
      if (!isNonEmptyString(item.requestQuote)) return null;
      return {
        element: item.element,
        requestQuote: item.requestQuote,
        suggestion: asString(item.suggestion, ''),
      };
    }),

    fallback: false,
    fallbackReason: null,
    cached: false,
  };

  return { result, issues };
}
