/**
 * 핵심 업무 정보 누락 경고 단위 테스트 (2026-08-14 사용자 제안 ② / A안).
 *
 * 🔴 이 테스트가 지키려는 핵심은 **오탐 차단**이다. 감사 인사에 "기한이 없습니다"가 한 번 뜨면
 *    사용자는 그 뒤로 배너를 통째로 무시하고, 진짜 기한 누락도 같이 묻힌다. 그래서 세 관문
 *    (인용 대조 · 자기모순 · 독립 재검)이 각각 실제로 걸러내는지를 개별로 확인한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  verifyMissingElements,
  hasDeadlineMarker,
  MISSING_LABELS,
} from '../src/core/refine/missing.js';
import { normalizeRefineResponse } from '../src/core/refine/schema.js';

const ASK = '리뷰 부탁드립니다';
const SOURCE = `초안 정리했습니다. ${ASK}.`;

function build(missingElements, extra = {}) {
  return { preserved: [], ...extra, missingElements };
}

/* ── 통과해야 하는 경우 ──────────────────────────────────────────────── */

test('요청 인용이 원문에 실재하면 경고가 뜬다', () => {
  const out = verifyMissingElements(
    build([{ element: 'deadline', requestQuote: ASK, suggestion: '언제까지인지 적어 주세요' }]),
    SOURCE,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].label, MISSING_LABELS.deadline);
  assert.equal(out[0].suggestion, '언제까지인지 적어 주세요');
});

test('기한·영향 둘 다 뜰 수 있다', () => {
  const out = verifyMissingElements(
    build([
      { element: 'deadline', requestQuote: ASK, suggestion: 'a' },
      { element: 'impact', requestQuote: ASK, suggestion: 'b' },
    ]),
    SOURCE,
  );
  assert.deepEqual(
    out.map((item) => item.element),
    ['deadline', 'impact'],
  );
});

/* ── ① 인용 대조 ────────────────────────────────────────────────────── */

test('🔴 원문에 없는 요청 인용은 버린다 — 요청이 있었다는 증거가 못 된다', () => {
  const out = verifyMissingElements(
    build([{ element: 'deadline', requestQuote: '승인 부탁드립니다', suggestion: 'x' }]),
    SOURCE,
  );
  assert.deepEqual(out, []);
});

test('🔴 감사 인사에는 따올 요청 문구가 없어 아무것도 안 뜬다', () => {
  const thanks = '어제 도와주셔서 정말 감사합니다. 덕분에 잘 마무리했어요.';
  const out = verifyMissingElements(
    build([{ element: 'deadline', requestQuote: '부탁드립니다', suggestion: 'x' }]),
    thanks,
  );
  assert.deepEqual(out, [], '감사 인사에 기한 누락 경고가 떴다 — 기능이 죽는 경로다');
});

/* ── ② 자기모순 ─────────────────────────────────────────────────────── */

test('🔴 같은 응답이 기한을 "지켜냈다"고 하면 기한 누락 주장은 버린다', () => {
  const out = verifyMissingElements(
    build([{ element: 'deadline', requestQuote: ASK, suggestion: 'x' }], {
      preserved: [{ kind: 'deadline', sourceText: '금요일까지', refinedText: 'by Friday' }],
    }),
    SOURCE,
  );
  assert.deepEqual(out, []);
});

test('자기모순은 기한에만 적용된다 — 영향 경고까지 같이 죽이지 않는다', () => {
  const out = verifyMissingElements(
    build(
      [
        { element: 'deadline', requestQuote: ASK, suggestion: 'a' },
        { element: 'impact', requestQuote: ASK, suggestion: 'b' },
      ],
      { preserved: [{ kind: 'deadline', sourceText: '금요일까지', refinedText: 'by Friday' }] },
    ),
    SOURCE,
  );
  assert.deepEqual(
    out.map((item) => item.element),
    ['impact'],
  );
});

/* ── ③ 독립 재검 ────────────────────────────────────────────────────── */

test('🔴 원문에 기한 표지가 있으면 모델이 뭐라 하든 기한 경고를 버린다', () => {
  for (const source of [
    '금요일까지 리뷰 부탁드립니다',
    '오늘 중 리뷰 부탁드립니다',
    '내일 오전까지 리뷰 부탁드립니다',
    '8/4까지 리뷰 부탁드립니다',
    '14:00 전에 리뷰 부탁드립니다',
    'Please review ASAP',
    'Please review by Friday',
  ]) {
    const out = verifyMissingElements(
      build([{ element: 'deadline', requestQuote: source.slice(0, 6), suggestion: 'x' }]),
      source,
    );
    assert.deepEqual(out, [], `기한 표지를 놓쳤다: ${source}`);
  }
});

test('기한 표지가 없는 문장은 재검을 통과한다 — 재검이 전부를 막으면 기능이 없는 것과 같다', () => {
  assert.equal(hasDeadlineMarker('초안 정리했습니다. 리뷰 부탁드립니다.'), false);
  assert.equal(hasDeadlineMarker(''), false);
  assert.equal(hasDeadlineMarker(null), false);
});

/* ── 화이트리스트·중복 ───────────────────────────────────────────────── */

test('🔴 스키마가 A안 밖의 요소를 버린다 — 담당자·목적·긴급도는 통과 못 한다', () => {
  const { result } = normalizeRefineResponse({
    refined: 'ok',
    urgency: 'NORMAL',
    backTranslation: '확인',
    missingElements: [
      { element: 'assignee', requestQuote: ASK, suggestion: 'x' },
      { element: 'purpose', requestQuote: ASK, suggestion: 'x' },
      { element: 'urgency', requestQuote: ASK, suggestion: 'x' },
      { element: 'deadline', requestQuote: ASK, suggestion: 'ok' },
    ],
  });
  assert.deepEqual(
    result.missingElements.map((item) => item.element),
    ['deadline'],
  );
});

test('🔴 인용 없는 항목은 스키마에서 버린다 — 인용 없는 누락 경고는 아무 데나 붙는다', () => {
  const { result } = normalizeRefineResponse({
    refined: 'ok',
    urgency: 'NORMAL',
    backTranslation: '확인',
    missingElements: [{ element: 'deadline', suggestion: 'x' }],
  });
  assert.deepEqual(result.missingElements, []);
});

test('같은 요소를 두 번 경고하지 않는다', () => {
  const out = verifyMissingElements(
    build([
      { element: 'impact', requestQuote: ASK, suggestion: 'a' },
      { element: 'impact', requestQuote: ASK, suggestion: 'b' },
    ]),
    SOURCE,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].suggestion, 'a');
});

/* ── 죽지 않는다 ────────────────────────────────────────────────────── */

test('필드가 없거나 이상해도 죽지 않는다', () => {
  for (const bad of [null, undefined, {}, { missingElements: null }, { missingElements: 'x' }]) {
    assert.deepEqual(verifyMissingElements(bad, SOURCE), []);
  }
});

test('구버전 응답(missingElements 키 자체가 없음)도 통과한다', () => {
  const { result } = normalizeRefineResponse({
    refined: 'ok',
    urgency: 'NORMAL',
    backTranslation: '확인',
  });
  assert.deepEqual(result.missingElements, []);
});
