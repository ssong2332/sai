/**
 * 마찰 문서 batchGet을 운영에서 검증된 크기(30)로 나눈다 (2026-10-25).
 * 🔴 0.1.21 — 사이드패널의 120일 고정 읽기(`DASHBOARD_DAYS`)는 없앴다. 확장 대시보드가 필요한 날만 읽는다
 *    (`src/dashboard/range.js`). 2026-10-26 — 「최근 N일」 묶음(`frictionDocBatches`)은 부르는 곳이 없어 지웠다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as teamClient from '../src/lib/teamClient.js';

const { frictionDocNameBatches, FRICTION_BATCH_SIZE } = teamClient;

test('🔴 120일 고정 읽기 상수(DASHBOARD_DAYS)가 없다 — 사이드패널이 미리 120일을 읽지 않는다', () => {
  assert.equal(teamClient.DASHBOARD_DAYS, undefined);
});

test('고른 날짜 키만 문서 이름으로, 30개씩 — 빠진 날만 읽을 때 쓴다', () => {
  assert.equal(FRICTION_BATCH_SIZE, 30);
  const batches = frictionDocNameBatches({ base: 'b', teamId: 't', dateKeys: ['2026-08-01', '2026-08-02'] });
  assert.deepEqual(batches, [['b/t_2026-08-01', 'b/t_2026-08-02']]);
  assert.deepEqual(frictionDocNameBatches({ base: 'b', teamId: 't', dateKeys: [] }), []);
  const many = Array.from({ length: 61 }, (_, i) => `k${i}`);
  assert.deepEqual(frictionDocNameBatches({ base: 'b', teamId: 't', dateKeys: many }).map((x) => x.length), [30, 30, 1]);
});
