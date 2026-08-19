/**
 * 핵심 업무 정보 누락 경고 — 표시 전 검증 (2026-08-14 사용자 제안 ② / A안).
 *
 * 🔴 **왜 「기한·영향」 2종뿐인가** (사용자 A안 선택, 근거는 실측):
 *    테스트 케이스 원문 21건에 5대 요소를 대 본 결과 「없음」 빈도가 담당자 20/21 · 긴급도 19/21 ·
 *    기한 15/21 · 영향 15/21 · 목적 3~5/21이었다. 5개를 다 켜면 메시지당 평균 3.6개가 떠서
 *    **사용자가 배너 전체를 무시하게 되고 진짜 누락도 같이 묻힌다.**
 *    빈도보다 결정적인 이유는 셋이 **근거 있는 판정 자체가 불가능**하다는 것이다:
 *    | 요소 | 제외 사유 |
 *    |---|---|
 *    | 긴급도 | 사이가 이미 매 호출 판정하고 근거까지 보여준다(Spec 필수 1) — 우리 기능과 중복 |
 *    | 담당자 | 1:1 메신저에선 수신자가 곧 담당자 — 20/21은 결함이 아니라 체크의 착시 |
 *    | 목적 | "목적이 불분명하다"는 인용할 근거가 없다 — 대조 원칙을 통과 못 한다 |
 *
 * 🔴 **누락 경고는 오탐이 곧 기능의 죽음이다.** 감사 인사에 "기한이 없습니다"가 한 번 뜨면
 *    그다음부터 배너는 통째로 무시된다. 그래서 모델 판정을 **그대로 믿지 않고** 세 겹으로 거른다:
 *
 * | 관문 | 무엇을 보나 | 왜 |
 * |---|---|---|
 * | ① 인용 대조 | `requestQuote`가 **원문에 실재**하는가 | 요청이 아닌 메시지엔 따올 문구가 없다 |
 * | ② 자기모순 | 같은 응답의 `preserved`에 `deadline`이 있는데 기한 누락을 주장하는가 | 모델이 "지켰다"와 "없다"를 동시에 말하면 둘 다 못 믿는다 |
 * | ③ 독립 재검 | 원문에 **기한 표지**가 실제로 있는가 (우리 목록으로 직접 확인) | 모델과 무관한 두 번째 눈 |
 *
 * 🔴 세 관문은 전부 **경고를 줄이는 방향으로만** 작동한다 — 우리가 경고를 새로 만들어내지 않는다.
 * 🔴 이 파일은 본문을 **읽기만** 한다 — 저장·전송하지 않는다 (Spec 필수 5).
 */

import { occursIn } from './reasoning.js';

/** `element` → 화면 라벨. 스키마가 이 둘로 좁혀서 준다. */
export const MISSING_LABELS = {
  deadline: '기한',
  impact: '영향',
};

/**
 * 기한 표지 — ③ 독립 재검용. **경고를 끄는 데만 쓴다**(있으면 기한 누락 주장을 버린다).
 * 🔴 빠짐없는 목록이 아니어도 된다. 놓치면 모델 판정이 그대로 통과할 뿐이고, 잘못 넣으면
 *    진짜 누락을 못 잡는다 — 그래서 **확실한 것만** 담는다.
 */
const DEADLINE_MARKERS = [
  '까지',
  '오늘',
  '금일',
  '내일',
  '익일',
  '모레',
  '이번 주',
  '이번주',
  '다음 주',
  '다음주',
  '금주',
  '차주',
  '오전',
  '오후',
  '당장',
  '즉시',
  '지금',
  '마감',
  '데드라인',
  'asap',
  'today',
  'tomorrow',
  'deadline',
  'due',
  'eod',
  'by ',
];

/** `8/4`·`8월 4일`·`14:00`처럼 **날짜·시각 표기** 자체. 고정 패턴이며 사용자 값으로 만들지 않는다. */
const DATE_PATTERN = /\d{1,2}\s*[/월-]\s*\d{1,2}|\d{1,2}\s*시|\d{1,2}:\d{2}/;

/** 원문에 기한이라 볼 만한 표지가 실제로 있는가. */
export function hasDeadlineMarker(text) {
  const lower = String(text ?? '').toLowerCase();
  if (lower.trim() === '') return false;
  if (DATE_PATTERN.test(lower)) return true;
  return DEADLINE_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * 표시할 누락 경고만 남긴다.
 *
 * @param {object|null} result `normalizeRefineResponse`의 결과.
 * @param {string} sourceText 사용자가 쓴 원문.
 * @returns {Array<{element: string, label: string, requestQuote: string, suggestion: string}>}
 */
export function verifyMissingElements(result, sourceText = '') {
  const raw = result?.missingElements;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // ② 자기모순 — 같은 응답에서 기한을 "지켜냈다"고 해 놓고 "없다"고도 하면 기한 주장은 버린다.
  const claimsDeadlineKept = (result?.preserved ?? []).some((item) => item.kind === 'deadline');
  // ③ 독립 재검 — 모델과 무관하게 우리가 직접 원문을 훑는다.
  const deadlineInSource = hasDeadlineMarker(sourceText);

  const seen = new Set();
  const out = [];
  for (const item of raw) {
    // ① 인용 대조 — 원문에 실재하지 않는 요청 인용은 요청이 있었다는 증거가 못 된다.
    if (!occursIn(item.requestQuote, sourceText)) continue;
    if (item.element === 'deadline' && (claimsDeadlineKept || deadlineInSource)) continue;
    // 같은 요소를 두 번 경고하지 않는다.
    if (seen.has(item.element)) continue;
    seen.add(item.element);
    out.push({ ...item, label: MISSING_LABELS[item.element] });
  }
  return out;
}
