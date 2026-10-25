/**
 * 마찰 문서 batchGet을 운영에서 검증된 크기(30)로 나눈다 (2026-10-25).
 * 🔴 0.1.21 — 사이드패널의 120일 고정 읽기(`DASHBOARD_DAYS`)는 없앴다. 확장 대시보드가 필요한 날만 읽는다
 *    (`src/dashboard/range.js`). 120일은 「60일 + 비교」의 최대치로 여기서도 그대로 잠근다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as teamClient from '../src/lib/teamClient.js';

const { frictionDocBatches, frictionDocNameBatches, FRICTION_BATCH_SIZE } = teamClient;

test('120일은 30개씩 4묶음, 날짜가 겹치거나 빠지지 않는다', () => {
  const batches = frictionDocBatches({ base: 'b', teamId: 't', days: 120, today: new Date(2026, 9, 25) });
  assert.equal(FRICTION_BATCH_SIZE, 30);
  assert.deepEqual(batches.map((b) => b.length), [30, 30, 30, 30]);
  const all = batches.flat();
  assert.equal(new Set(all).size, 120);
  assert.equal(all[0], 'b/t_2026-10-25', '오늘부터 거꾸로');
  assert.equal(all[119], 'b/t_2026-06-28');
});

test('30일은 예전과 같은 요청 1회다', () => {
  const batches = frictionDocBatches({ base: 'b', teamId: 't', days: 30, today: new Date(2026, 0, 15) });
  assert.equal(batches.length, 1);
  assert.equal(batches[0][29], 'b/t_2025-12-17', '월·연도 경계를 넘는다');
});

test('나누어떨어지지 않으면 마지막 묶음이 짧다', () => {
  assert.deepEqual(frictionDocBatches({ base: 'b', teamId: 't', days: 31 }).map((b) => b.length), [30, 1]);
});

test('🔴 120일 고정 읽기 상수(DASHBOARD_DAYS)가 없다 — 사이드패널이 미리 120일을 읽지 않는다', () => {
  assert.equal(teamClient.DASHBOARD_DAYS, undefined);
});

test('고른 날짜 키만 문서 이름으로 — 빠진 날만 읽을 때 쓴다', () => {
  const batches = frictionDocNameBatches({ base: 'b', teamId: 't', dateKeys: ['2026-08-01', '2026-08-02'] });
  assert.deepEqual(batches, [['b/t_2026-08-01', 'b/t_2026-08-02']]);
  assert.deepEqual(frictionDocNameBatches({ base: 'b', teamId: 't', dateKeys: [] }), []);
  const many = Array.from({ length: 61 }, (_, i) => `k${i}`);
  assert.deepEqual(frictionDocNameBatches({ base: 'b', teamId: 't', dateKeys: many }).map((x) => x.length), [30, 30, 1]);
});
