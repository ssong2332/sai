/**
 * S18 — Health Index 공식 (Spec §3: `100 - 정규화된 마찰 카운트`).
 * 🔴 2026-08-13 — 클로드 디자인 시안 반영으로 정규화 기준이 "관측된 신호(긍정+마찰) 대비
 *    마찰 비율"로 바뀌었다(`docs/Tasks.md` S18 기록 참조). 판정표: 정상 비율 계산 · 신호 0건 ·
 *    clamp(0~100) · 음수 방어.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeHealthMetrics } from '../dashboard/src/healthIndex.js';

test('마찰 비율만큼 100에서 뺀다 — 주간 목업 값(긍정 31·마찰 9)', () => {
  const { frictionRatio, healthIndex } = computeHealthMetrics({ totalCount: 40, frictionCount: 9 });
  // 9/40*100 = 22.5%
  assert.equal(frictionRatio, 22.5);
  assert.equal(healthIndex, 77.5);
});

test('마찰이 0건이면 healthIndex는 100이다', () => {
  assert.deepEqual(computeHealthMetrics({ totalCount: 100, frictionCount: 0 }), {
    frictionRatio: 0,
    healthIndex: 100,
  });
});

test('🔴 신호가 하나도 없으면 100이 아니라 null이다 — 안 쓰는 팀이 만점이 되면 안 된다', () => {
  // 2026-08-15 실데이터 연동으로 **동작을 바꿨다**. 목업 시절엔 이 분기에 닿지 않아 100이어도
  // 문제가 없었지만, 이제는 "사이를 안 쓸수록 건강한 팀"이라는 정반대 신호가 된다.
  assert.deepEqual(computeHealthMetrics({ totalCount: 0, frictionCount: 0 }), {
    frictionRatio: 0,
    healthIndex: null,
  });
});

test('음수 값은 지어내지 않고 0으로 취급한다', () => {
  assert.deepEqual(computeHealthMetrics({ totalCount: 10, frictionCount: -3 }), {
    frictionRatio: 0,
    healthIndex: 100,
  });
});

test('🔴 마찰만 있고 긍정이 0이어도 clamp되어 0 밑으로 내려가지 않는다', () => {
  const { healthIndex } = computeHealthMetrics({ totalCount: 10, frictionCount: 10 });
  assert.equal(healthIndex, 0);
});

test('입력이 숫자가 아니어도 죽지 않는다 — 표본 없음과 같이 취급한다', () => {
  assert.deepEqual(computeHealthMetrics({ totalCount: undefined, frictionCount: NaN }), {
    frictionRatio: 0,
    healthIndex: null,
  });
});

test('소수 1자리로 반올림된다', () => {
  // 1/3*100 = 33.333... → 33.3
  const { frictionRatio } = computeHealthMetrics({ totalCount: 3, frictionCount: 1 });
  assert.equal(frictionRatio, 33.3);
});
