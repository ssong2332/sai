/**
 * 수신 해독기 응답 검증·정규화 (S10 / Spec 필수 10).
 *
 * 🔴 Zero Retention (Spec 필수 5): 본문 문자열을 로그·저장소로 내보내지 않는다.
 */

import { REPLY_INTENTS } from '../reply/prompt.js';
import { occursIn } from '../refine/reasoning.js';

const URGENCY_LEVELS = ['CRITICAL', 'NORMAL', 'LOW'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function asString(value, fallback = '') {
  return isNonEmptyString(value) ? value : fallback;
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => isNonEmptyString(item));
}

/**
 * LLM 원시 응답을 계약 형태로 정규화한다. **던지지 않는다** — 필수 필드가 없으면
 * `result: null`로 돌려줘 호출자가 폴백을 결정하게 한다.
 *
 * @param {object} raw 파싱된 LLM JSON.
 * @param {string} [sourceText] 🔴 상대가 보낸 **원문**(맥락 아님). 긴급도 격차 관문이 인용을
 *   대조하는 데 쓴다. 넘기지 않으면 관문이 꺼진다(v2 동작 그대로).
 * @returns {{result: object|null, issues: string[]}}
 */
export function normalizeDecodeResponse(raw, sourceText = '') {
  const issues = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { result: null, issues: ['response:not-an-object'] };
  }

  // literalTranslation — 이것이 없으면 해독 결과 자체가 없다. 폴백 대상.
  if (!isNonEmptyString(raw.literalTranslation)) {
    return { result: null, issues: ['literalTranslation:missing'] };
  }

  const surfaceUrgency = URGENCY_LEVELS.includes(raw.surfaceUrgency) ? raw.surfaceUrgency : null;
  let actualUrgency = URGENCY_LEVELS.includes(raw.actualUrgency) ? raw.actualUrgency : null;
  if (surfaceUrgency === null || actualUrgency === null) issues.push('urgency:invalid');

  /**
   * 🔴 긴급도 격차 관문 (v3, 2026-08-15 운영 실측이 잡은 누출).
   *
   * 맥락(`threadContext`)이 4축으로 새어 `actualUrgency`를 올린 사례를 실측했다 — 원문은
   * "Could you get that over to us by the end of the week?" 한 줄인데 CRITICAL이 나왔고 근거는
   * 「이전 대화 맥락상 이사회 패킷…」이었다. 지시문에 금지 문구가 **이미 있었는데도** 샜으므로
   * 코드로 한 겹 더 본다(S36 누락 경고에서 통한 방식 — 인용을 요구하고 인용을 대조한다).
   *
   * 판정표 (이 표대로만 동작한다)
   * | 조건                                   | 처리                                  |
   * |---|---|
   * | 표면 == 실제 (격차 없음)                 | 통과 — 검사할 주장이 없다               |
   * | `sourceText` 미제공                     | 통과 — 대조할 원문이 없으면 판정하지 않는다 |
   * | 격차 있음 + 인용이 원문에 있음            | 통과 — 원문에서 읽히는 격차다            |
   * | 격차 있음 + 인용이 비었거나 원문에 없음    | 🔴 실제 = 표면으로 되돌림                |
   *
   * 🔴 **격차를 없애는 방향으로만 작동한다.** 코드가 긴급도를 **올리는** 경로는 없다 —
   *    근거 없는 경보를 지울 뿐이다(`missing.js`의 세 관문과 같은 규칙). 반대 방향을 허용하면
   *    화면의 긴급도가 모델의 판정인지 우리 코드의 판정인지 구분되지 않는다.
   * 🔴 F-11("a few minor comments" → 실제 CRITICAL)은 그대로 통과한다. 그 근거 구절이 **원문
   *    안에** 있기 때문이다 — 이 관문이 막는 것은 원문 밖에서 온 긴급도뿐이다.
   */
  const urgencyEvidence = asString(raw.urgencyEvidence, '');
  let urgencyEvidenceVerified = true;
  if (
    surfaceUrgency !== null &&
    actualUrgency !== null &&
    surfaceUrgency !== actualUrgency &&
    isNonEmptyString(sourceText)
  ) {
    urgencyEvidenceVerified = occursIn(urgencyEvidence, sourceText);
    if (!urgencyEvidenceVerified) {
      actualUrgency = surfaceUrgency;
      issues.push('urgency:gap-unsupported');
    }
  }

  const result = {
    literalTranslation: raw.literalTranslation,
    actualIntent: asString(raw.actualIntent, ''),
    intentEvidence: asString(raw.intentEvidence, ''),

    // 판정 실패 시 표면/실제 모두 NORMAL로 — 긴급도를 지어내지 않는다(Spec 필수 1과 같은 원칙).
    surfaceUrgency: surfaceUrgency ?? 'NORMAL',
    actualUrgency: actualUrgency ?? 'NORMAL',
    /**
     * 🔴 격차가 관문에 걸리면 이유도 함께 버린다. 그 문장은 **없어진 격차를 설명하는 문장**이라
     *    (실측 사례: "이전 대화 맥락상 …이므로 실제 긴급도는 매우 높습니다") 그대로 두면 화면의
     *    긴급도와 정면으로 어긋난다. 근거가 무효면 결론과 설명을 함께 거둔다.
     */
    urgencyReason: urgencyEvidenceVerified ? asString(raw.urgencyReason, '') : '',
    // 🔴 표면과 실제가 갈리는 것 자체가 이 기능의 핵심 신호다(F-11 예시: "minor comments" →
    //    전면 재작업). 화면이 매번 재계산하지 않도록 여기서 한 번만 판단해 싣는다.
    urgencyGap: surfaceUrgency !== null && actualUrgency !== null && surfaceUrgency !== actualUrgency,

    requiredActions: asStringList(raw.requiredActions),

    /**
     * 🔴 화이트리스트 (v2). 목록 밖 값은 **조용히 null**로 만든다 — 화면이 모르는 키를 받으면
     *    존재하지 않는 버튼을 추천하게 되고, 사용자에게는 "추천이 사라진" 것으로 보인다.
     * 🔴 요구 행동이 없으면 추천도 없다. 회신 버튼 자체가 안 뜨는 화면 조건과 같은 규칙이라,
     *    여기서 맞춰 두지 않으면 "추천은 있는데 고를 버튼이 없는" 상태가 만들어진다.
     */
    recommendedReply:
      REPLY_INTENTS.includes(raw.recommendedReply) && asStringList(raw.requiredActions).length > 0
        ? raw.recommendedReply
        : null,

    fallback: false,
    fallbackReason: null,
    cached: false,
  };

  return { result, issues };
}
