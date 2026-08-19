/**
 * 「왜 이렇게 바꿨나」 근거 조립 단위 테스트 (2026-08-14 사용자 제안 ③).
 *
 * 🔴 이 테스트가 지키려는 핵심:
 *    ① **지어낸 근거가 화면에 오르지 않는다** — 모델이 "이걸 지켰다"고 말해도 그 문자열이
 *       실제 원문·교정문에 없으면 버린다. 이 기능의 존재 이유가 신뢰이므로 여기가 제일 중요하다.
 *    ② **볼 게 없으면 0을 준다** — 빈 섹션을 그리면 세로 공간만 먹는다.
 *    ③ 잘못된 입력에도 죽지 않는다 — 팝업 전체가 같이 죽는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReasoning, occursIn, PRESERVED_LABELS } from '../src/core/refine/reasoning.js';

const SOURCE = '금요일까지 초안 3건 보내주시면 좋겠습니다. 확인 부탁드려요 팀장님.';
const REFINED =
  'Could you send the three drafts by Friday? I would appreciate your review.';

function base(overrides = {}) {
  return {
    refined: REFINED,
    refinedReason: '요청을 분명히 하면서 정중한 어조를 유지했습니다.',
    preserved: [],
    misreadRisks: [],
    unregisteredHonorifics: [],
    ...overrides,
  };
}

/* ── ① 검증: 실제로 있는 것만 ────────────────────────────────────────── */

test('🔴 원문·교정문에 실제로 있는 preserved만 통과한다', () => {
  const out = buildReasoning(
    base({
      preserved: [
        { kind: 'deadline', sourceText: '금요일까지', refinedText: 'by Friday' },
        { kind: 'number', sourceText: '3건', refinedText: 'three drafts' },
      ],
    }),
    SOURCE,
  );
  assert.equal(out.preserved.length, 2);
  assert.equal(out.preserved[0].label, PRESERVED_LABELS.deadline);
  assert.equal(out.preserved[1].label, PRESERVED_LABELS.number);
});

test('🔴 지어낸 preserved는 버린다 — 이게 이 기능의 존재 이유다', () => {
  const out = buildReasoning(
    base({
      preserved: [
        // 원문엔 없는 기한을 지켰다고 주장
        { kind: 'deadline', sourceText: '다음 주 화요일', refinedText: 'by Friday' },
        // 교정문엔 없는 문구가 들어갔다고 주장
        { kind: 'action', sourceText: '확인 부탁드려요', refinedText: 'please sign the contract' },
      ],
    }),
    SOURCE,
  );
  assert.deepEqual(out.preserved, [], '대조 안 되는 항목이 화면에 올라간다');
});

test('🔴 인용이 어디에도 없는 misreadRisk는 버린다', () => {
  const out = buildReasoning(
    base({
      misreadRisks: [
        { quote: 'by Friday', misreading: '마감을 통보로 읽힐 수 있어요', evidence: '조건절이 없어요' },
        { quote: 'ASAP', misreading: '재촉으로 읽혀요', evidence: '없는 문장' },
      ],
    }),
    SOURCE,
  );
  assert.equal(out.risks.length, 1);
  assert.equal(out.risks[0].quote, 'by Friday');
});

test('원문 쪽 인용도 통과시킨다 — 위험은 교정문에만 있는 게 아니다', () => {
  const out = buildReasoning(
    base({
      misreadRisks: [
        { quote: '팀장님', misreading: '직함 호칭이 영어에선 어색해요', evidence: '원문 호칭' },
      ],
    }),
    SOURCE,
  );
  assert.equal(out.risks.length, 1);
});

test('공백·대소문자 차이로 진짜 인용을 놓치지 않는다', () => {
  assert.equal(occursIn('BY   friday', REFINED), true);
  assert.equal(occursIn('금요일까지', SOURCE), true);
});

test('🔴 빈 문자열은 "모든 문장에 들어 있다"가 되면 안 된다', () => {
  assert.equal(occursIn('', REFINED), false);
  assert.equal(occursIn('   ', REFINED), false);
  assert.equal(occursIn(null, REFINED), false);
});

test('미등록 경어는 실제로 있는 것만, 중복 없이', () => {
  const out = buildReasoning(
    base({ unregisteredHonorifics: ['팀장님', '팀장님', '사장님'] }),
    SOURCE,
  );
  assert.deepEqual(out.honorifics, ['팀장님']);
});

/* ── ② 볼 게 없으면 0 ────────────────────────────────────────────────── */

test('🔴 근거가 하나도 없으면 total 0 — 빈 섹션을 그리지 않게', () => {
  const out = buildReasoning(base({ refinedReason: '' }), SOURCE);
  assert.equal(out.total, 0);
});

test('total은 실제로 보여줄 항목 수와 같다', () => {
  const out = buildReasoning(
    base({
      preserved: [{ kind: 'deadline', sourceText: '금요일까지', refinedText: 'by Friday' }],
      misreadRisks: [
        { quote: 'by Friday', misreading: '통보로 읽혀요', evidence: '조건절 없음' },
      ],
      unregisteredHonorifics: ['팀장님'],
    }),
    SOURCE,
  );
  // 이유 1 + 보존 1 + 위험 1 + 경어 1
  assert.equal(out.total, 4);
  assert.equal(out.total, 1 + out.preserved.length + out.risks.length + out.honorifics.length);
});

test('🔴 total은 걸러낸 뒤를 센다 — 버린 항목이 숫자에 남으면 "3곳"인데 아무것도 안 보인다', () => {
  const out = buildReasoning(
    base({
      refinedReason: '',
      preserved: [{ kind: 'deadline', sourceText: '없는 기한', refinedText: '없는 문구' }],
      misreadRisks: [{ quote: '없음', misreading: 'x', evidence: 'y' }],
    }),
    SOURCE,
  );
  assert.equal(out.total, 0);
});

/* ── ③ 죽지 않는다 ──────────────────────────────────────────────────── */

test('result가 없거나 이상해도 죽지 않는다', () => {
  for (const bad of [null, undefined, 'string', 42, []]) {
    const out = buildReasoning(bad, SOURCE);
    assert.equal(out.total, 0);
    assert.deepEqual(out.preserved, []);
  }
});

test('필드가 통째로 없어도 죽지 않는다 (구버전 응답·폴백 경로)', () => {
  const out = buildReasoning({ refined: REFINED }, SOURCE);
  assert.equal(out.total, 0);
});

test('원문을 넘기지 않아도 죽지 않는다 — 대신 preserved는 통과하지 못한다', () => {
  const out = buildReasoning(
    base({ preserved: [{ kind: 'deadline', sourceText: '금요일까지', refinedText: 'by Friday' }] }),
    undefined,
  );
  assert.deepEqual(out.preserved, []);
});

test('알 수 없는 kind는 기본 라벨로 떨어진다 — 라벨 자리가 비면 안 된다', () => {
  const out = buildReasoning(
    base({ preserved: [{ kind: 'weird', sourceText: '확인', refinedText: 'review' }] }),
    SOURCE,
  );
  assert.equal(out.preserved[0].label, PRESERVED_LABELS.action);
});
