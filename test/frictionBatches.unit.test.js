/**
 * 대시보드 120일 읽기 — batchGet을 운영에서 검증된 크기(30)로 나눈다 (2026-10-25).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { frictionDocBatches, DASHBOARD_DAYS, FRICTION_BATCH_SIZE } from '../src/lib/teamClient.js';

test('120일은 30개씩 4묶음, 날짜가 겹치거나 빠지지 않는다', () => {
  const batches = frictionDocBatches({ base: 'b', teamId: 't', days: DASHBOARD_DAYS, today: new Date(2026, 9, 25) });
  assert.equal(DASHBOARD_DAYS, 120);
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
