/**
 * 품질 모드 허용량 (2026-10-31, 월 $100 예산) — `qualityAllowance.js` 판정표 + 메모리·Firestore 저장소 + handler 연결.
 * 🔴 네트워크 없음: Claude·Firestore 모두 가짜. 기준표 B1~B6은 `docs/QualityModes.md` 5절.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryCacheStore } from '../../../src/core/refine/index.js';
import { QUALITY_MODES } from '../../../src/core/refine/quality.js';
import { createHandler } from '../src/handler.js';
import { createFirestoreUsageStore, createMemoryUsageStore } from '../src/usageStore.js';
import {
  COST_ESTIMATE_MICROS,
  MONTHLY_BUDGET_GUARD_MICROS,
  PREMIUM_DAILY_LIMITS,
  decideQuality,
  seoulMonthKey,
} from '../src/qualityAllowance.js';
import { RestFirestore } from '../src/google/firestoreRest.js';
import { createFakeFirestore } from './fakeFirestore.js';
import { BASE_BODY, TEST_ENV, captureLogger, fakeAnthropicFetch, makeKeys, refineRequest, signIdToken } from './helpers.js';

const keys = await makeKeys();
const token = await signIdToken(keys);

function setup(usageStore) {
  const fetchImpl = fakeAnthropicFetch();
  const logger = captureLogger();
  const handle = createHandler({ jwks: keys.jwks, fetchImpl, usageStore, cache: new MemoryCacheStore(), logger });
  // 🔴 캐시를 피하려고 매번 다른 문장 — 같은 문장이면 Claude를 다시 부르지 않아 보낸 모델을 볼 수 없다.
  let n = 0;
  const call = async (body) => {
    n += 1;
    const res = await handle(refineRequest(token, { ...BASE_BODY, text: `${BASE_BODY.text} ${n}`, ...body }), TEST_ENV);
    return { status: res.status, body: await res.json(), sentModel: fetchImpl.seen.bodies.at(-1)?.model };
  };
  return { call, logger, fetchImpl };
}

test('판정표 — 예산 초과가 하루 횟수보다 먼저, 빠른·다듬기 아님은 그대로', () => {
  assert.deepEqual(decideQuality({ requested: 'standard' }), { quality: 'standard', downgrade: null });
  assert.deepEqual(decideQuality({ requested: 'deep', premiumUsed: { deep: 3 } }), { quality: 'fast', downgrade: 'daily' });
  assert.deepEqual(decideQuality({ requested: 'deep', premiumUsed: { deep: 3 }, monthMicros: MONTHLY_BUDGET_GUARD_MICROS }), {
    quality: 'fast',
    downgrade: 'budget',
  });
  assert.deepEqual(decideQuality({ requested: 'fast', monthMicros: 10 ** 9 }), { quality: 'fast', downgrade: null });
  assert.deepEqual(decideQuality({ requested: null, monthMicros: 10 ** 9 }), { quality: null, downgrade: null });
  assert.deepEqual({ ...PREMIUM_DAILY_LIMITS }, { standard: 10, deep: 3 });
  assert.equal(MONTHLY_BUDGET_GUARD_MICROS, 90_000_000);
});

test('B1 기본값은 빠른 — quality 없음·모르는 값', async () => {
  const { call } = setup(createMemoryUsageStore());
  for (const quality of [undefined, 'turbo', 'claude-opus-5-5']) {
    const r = await call({ quality });
    assert.equal(r.body.quality, 'fast', String(quality));
    assert.equal(r.sentModel, QUALITY_MODES.fast.model);
    assert.equal('qualityDowngrade' in r.body, false);
  }
});

test('B2 하루 기본 11번째·심층 4번째는 거절 없이 빠른 모드 + qualityDowngrade=daily', async () => {
  const { call } = setup(createMemoryUsageStore());
  for (const [quality, limit] of Object.entries(PREMIUM_DAILY_LIMITS)) {
    for (let i = 0; i < limit; i += 1) {
      const r = await call({ quality });
      assert.equal(r.body.quality, quality, `${quality} ${i + 1}번째`);
      assert.equal(r.sentModel, QUALITY_MODES[quality].model);
    }
    const over = await call({ quality });
    assert.equal(over.status, 200);
    assert.equal(over.body.quality, 'fast');
    assert.equal(over.body.qualityDowngrade, 'daily');
    assert.equal(over.sentModel, QUALITY_MODES.fast.model, '🔴 넘친 요청에 비싼 모델을 보냈다');
  }
  // 빠른 모드는 상위 모드 한도와 무관하다.
  const fast = await call({ quality: 'fast' });
  assert.equal(fast.body.quality, 'fast');
  assert.equal('qualityDowngrade' in fast.body, false);
});

test('B3 이달 추정 비용 ≥ $90 → 기본·심층은 빠른 + budget, 빠른·뜻 풀기는 그대로', async () => {
  const { call } = setup(createMemoryUsageStore({ monthMicros: MONTHLY_BUDGET_GUARD_MICROS }));
  for (const quality of ['standard', 'deep']) {
    const r = await call({ quality });
    assert.equal(r.body.quality, 'fast');
    assert.equal(r.body.qualityDowngrade, 'budget');
    assert.equal(r.sentModel, QUALITY_MODES.fast.model);
  }
  const fast = await call({ quality: 'fast' });
  assert.equal(fast.body.fallback, false);
  assert.equal('qualityDowngrade' in fast.body, false);
  const decode = await call({ mode: 'decode', quality: 'deep' });
  assert.equal(decode.status, 200);
  assert.equal('quality' in decode.body, false);
});

test('B4 비용은 받은 요청마다 그 모드 추정치만큼 쌓이고, 달이 바뀌면 0부터', async () => {
  let month = '2026-10';
  const store = createMemoryUsageStore({ month: () => month });
  const { call } = setup(store);
  await call({ quality: 'deep' });
  await call({ quality: 'standard' });
  await call({ quality: 'fast' });
  await call({ mode: 'decode' });
  const expected = COST_ESTIMATE_MICROS.deep + COST_ESTIMATE_MICROS.standard + COST_ESTIMATE_MICROS.fast + COST_ESTIMATE_MICROS.other;
  assert.equal(store.monthMicros(), expected);
  month = '2026-11';
  assert.equal(store.monthMicros(), 0);
  assert.equal(seoulMonthKey(new Date('2026-10-31T15:30:00Z')), '2026-11', '🔴 달 경계는 서울 기준');
});

test('B4·B5 Firestore — 한 트랜잭션에 하루 문서(premium)와 달 문서(micros)만, 본문·모델명 없음', async () => {
  const fake = createFakeFirestore();
  const db = new RestFirestore({ projectId: 'sai-global-msg-2026', token: async () => 't', fetchImpl: fake.fetch });
  const now = () => new Date('2026-10-31T03:00:00Z');
  const { call, logger } = setup(createFirestoreUsageStore({ db, now }));
  for (let i = 0; i < 4; i += 1) await call({ quality: 'deep' });

  const quota = await db.collection('refineQuota').doc('uid-test-123_2026-10-31').get();
  const budget = await db.collection('budgetMonthly').doc('2026-10').get();
  assert.ok(quota.exists, '하루 문서가 없다 — uid를 helpers와 맞춘다');
  assert.equal(quota.data().count, 4);
  assert.equal(quota.data().premium.deep, PREMIUM_DAILY_LIMITS.deep, '4번째는 빠른으로 갔으니 심층은 3');
  assert.equal(budget.data().micros, 3 * COST_ESTIMATE_MICROS.deep + COST_ESTIMATE_MICROS.fast);

  const stored = JSON.stringify([quota.data(), budget.data()]);
  for (const banned of [BASE_BODY.text, 'claude-']) assert.equal(stored.includes(banned), false, `저장소에 ${banned}`);
  const logs = logger.lines.join('\n');
  assert.equal(logs.includes(BASE_BODY.text), false);
  assert.equal(logs.includes('uid-test-123'), false, '🔴 로그에 uid');
});

test('B3 Firestore — 달 문서가 $90 이상이면 상위 모드를 빠른으로', async () => {
  const fake = createFakeFirestore();
  const db = new RestFirestore({ projectId: 'sai-global-msg-2026', token: async () => 't', fetchImpl: fake.fetch });
  const now = () => new Date('2026-10-31T03:00:00Z');
  await db.collection('budgetMonthly').doc('2026-10').set({ micros: MONTHLY_BUDGET_GUARD_MICROS });
  const { call } = setup(createFirestoreUsageStore({ db, now }));
  const r = await call({ quality: 'standard' });
  assert.deepEqual([r.body.quality, r.body.qualityDowngrade, r.sentModel], ['fast', 'budget', QUALITY_MODES.fast.model]);
});

test('B6 카운터 장애 — 다듬기는 멈추지 않고, 상위 모드는 빠른 + unavailable', async () => {
  const broken = {
    kind: 'broken',
    async admit() {
      throw Object.assign(new Error('down'), { code: 'UNAVAILABLE' });
    },
    async recordDailyUser() {},
    async recordRequest() {},
  };
  const { call } = setup(broken);
  const r = await call({ quality: 'deep' });
  assert.equal(r.status, 200);
  assert.equal(r.body.fallback, false);
  assert.deepEqual([r.body.quality, r.body.qualityDowngrade, r.sentModel], ['fast', 'unavailable', QUALITY_MODES.fast.model]);
});

test('B7 하루 전체 상한은 그대로 429 — 상위 모드 강등보다 먼저', async () => {
  const { call } = setup(createMemoryUsageStore({ limit: 2 }));
  await call({ quality: 'deep' });
  await call({ quality: 'deep' });
  const r = await call({ quality: 'deep' });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'daily-limit');
});
