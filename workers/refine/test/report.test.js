/**
 * Worker 주간 점검(M2) 판정표 — `scripts/reportCore.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeDay, judgeDay, judgeHealth } from '../scripts/reportCore.mjs';

const doc = (over = {}) => ({
  requests: { refine: 90, decode: 10 },
  outcome: { ok: 97, error: 2, rejected: 1 },
  latency: { le1000: 10, le2000: 50, le3000: 30, gt10000: 2 },
  users: { active: 4, returning: 3 },
  client: { applied: 40, undone: 2 },
  ...over,
});

test('문서가 없으면 0으로 요약하고 경고하지 않는다(요청 없음)', () => {
  const day = summarizeDay('2026-10-27', null);
  assert.equal(day.requests, 0);
  assert.deepEqual(judgeDay(day), []);
});

test('합계를 모은다 — rejected(400)는 실패에 넣지 않는다', () => {
  const day = summarizeDay('2026-10-27', doc());
  assert.equal(day.requests, 100);
  assert.equal(day.failures, 2);
  assert.equal(day.rejected, 1);
  assert.equal(day.within2s, 60);
  assert.equal(day.over10s, 2);
  assert.deepEqual(judgeDay(day), []);
});

test('실패율 5% 이상이면 경고 — 요청 20건 미만이면 비율 경고는 하지 않는다', () => {
  assert.match(judgeDay(summarizeDay('d', doc({ outcome: { ok: 95, error: 5 } })))[0], /실패율 5\.0%/);
  const small = summarizeDay('d', { requests: { refine: 10 }, outcome: { ok: 5, error: 5 } });
  assert.deepEqual(judgeDay(small), []);
});

test('키 무효·한도는 1건이라도 경고', () => {
  const warnings = judgeDay(summarizeDay('d', doc({ outcome: { ok: 98, auth: 1, quota: 1 } })));
  assert.ok(warnings.includes('키 무효 1건'));
  assert.ok(warnings.includes('한도 1건'));
});

test('10초 초과 10% 이상이면 경고', () => {
  const warnings = judgeDay(summarizeDay('d', doc({ latency: { gt10000: 10 } })));
  assert.ok(warnings.some((w) => w.startsWith('10초 초과')));
});

test('/health — 정상 / 상태 코드 / 설정 누락', () => {
  const ok = { configured: true, usageStore: 'firestore', team: 'ready' };
  assert.deepEqual(judgeHealth(200, ok), []);
  assert.deepEqual(judgeHealth(503, null), ['/health 응답 503']);
  assert.deepEqual(judgeHealth(200, { ...ok, usageStore: 'noop', team: 'off' }), ['usageStore=noop', 'team=off']);
});
