/**
 * 결정 요약 응답 검증·정규화 (S25 / Spec 부가 7).
 *
 * 판정표 — 이 표대로만 통과시킨다:
 * | 조건 | 결과 |
 * |---|---|
 * | `decisions`가 배열 아님 | `result: null` (폴백 대상) |
 * | `decisions: []` | **정상 응답**. "결정 없음"은 오류가 아니다 |
 * | 항목의 `decision`이 빈 문자열 | 그 항목만 버린다 (지어낸 행을 통과시키지 않는다) |
 * | `owner`/`dueDate`가 문자열 아님 | `null` (c7 AC-020 — 임의 생성 금지) |
 * | `authorityStatus`가 네 값 밖 | `불명` (c7 AC-050 — 임의 판정 금지) |
 * | `authorityStatus === '불명'` | `authorityEvidence`를 **강제로** null |
 * | 그 외 상태인데 `authorityEvidence` 없음 | 상태를 `불명`으로 **강등** |
 *
 * 🔴 마지막 두 행이 이 파일의 핵심이다 — 프롬프트는 모델에게 규칙을 알려줄 뿐이고,
 *    **불변식을 강제하는 것은 코드다**(c7.ts 헤더 주석의 `resolveAuthority()`와 같은 역할).
 *    "근거 없이 확정이라고 말하는 행"이 화면에 뜨는 것은 이 기능의 최악 실패다.
 *
 * 🔴 Zero Retention (Spec 필수 5): 이 파일은 본문을 로그·저장소로 내보내지 않는다.
 *    `issues`에는 필드명·이유 코드만 담는다.
 */

import { AUTHORITY_STATUSES, AUTHORITY_UNKNOWN } from './prompt.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** 근거가 없으면 문자열을 만들지 않고 `null`을 돌려준다 — 빈 문자열과 "없음"을 구분한다. */
function asTextOrNull(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

/**
 * 한 건의 결정을 정규화한다. 살릴 수 없으면 `null`(호출자가 버린다).
 */
function normalizeDecision(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!isNonEmptyString(raw.decision)) return null;

  const owner = asTextOrNull(raw.owner);
  const dueDate = asTextOrNull(raw.dueDate);

  let authorityStatus = AUTHORITY_STATUSES.includes(raw.authorityStatus)
    ? raw.authorityStatus
    : AUTHORITY_UNKNOWN;
  let authorityEvidence = asTextOrNull(raw.authorityEvidence);

  if (authorityStatus === AUTHORITY_UNKNOWN) {
    // 불명인데 근거가 붙어 있으면 그 근거는 무엇에 대한 것인지 알 수 없다 — 버린다.
    authorityEvidence = null;
  } else if (authorityEvidence === null) {
    // 🔴 근거 없이 상태를 단정한 경우. 상태 쪽을 낮춘다 — 근거를 지어내지 않는다.
    authorityStatus = AUTHORITY_UNKNOWN;
  }

  return {
    decision: raw.decision.trim(),
    owner,
    dueDate,
    authorityStatus,
    authorityEvidence,
  };
}

/**
 * LLM 원시 응답을 계약 형태로 정규화한다. **던지지 않는다**.
 *
 * @param {object} raw 파싱된 LLM JSON.
 * @returns {{result: object|null, issues: string[]}} `result`가 null이면 폴백 대상.
 */
export function normalizeDecisionsResponse(raw) {
  const issues = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { result: null, issues: ['response:not-an-object'] };
  }
  if (!Array.isArray(raw.decisions)) {
    return { result: null, issues: ['decisions:not-an-array'] };
  }

  const decisions = [];
  let dropped = 0;
  for (const item of raw.decisions) {
    const normalized = normalizeDecision(item);
    if (normalized === null) {
      dropped += 1;
      continue;
    }
    decisions.push(normalized);
  }
  if (dropped > 0) issues.push('decisions:dropped-invalid-items');

  return { result: { decisions, ...deriveCounts(decisions) }, issues };
}

/**
 * 🔴 **미확정 항목은 모델에게 묻지 않고 여기서 결정적으로 고른다**(c7 AC-038의 설계 판단).
 *    따로 물으면 `decisions[]`와 `unresolved[]`가 서로 어긋나는 상태가 만들어진다.
 *
 * `unresolvedIndexes`는 **인덱스만** 담는다 — 본문을 복제하지 않는다.
 */
export function deriveCounts(decisions) {
  const unresolvedIndexes = [];
  for (let i = 0; i < decisions.length; i += 1) {
    const entry = decisions[i];
    if (entry.owner === null || entry.dueDate === null) unresolvedIndexes.push(i);
  }
  return {
    decisionCount: decisions.length,
    unresolvedIndexes,
    unresolvedCount: unresolvedIndexes.length,
    /** 🔴 로그로 나가는 값은 이 수치들뿐이다 (Spec 필수 5). */
    unknownAuthorityCount: decisions.filter(
      (entry) => entry.authorityStatus === AUTHORITY_UNKNOWN,
    ).length,
  };
}
