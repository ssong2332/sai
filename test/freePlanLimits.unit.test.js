/**
 * 무료 요금제 2단계(2026-11-05 사용자 결정 「B안 — 개인 용어집 5 · 저장 문구 3 · 회신 하루 3, 나머지 추천대로」) — 확장 쪽.
 * 🔴 네트워크 없음: 요금제 조회는 가짜. 저장소는 `storage.js` 메모리 폴백.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { clearAllLocal, getLocal, setLocal, STORAGE_KEYS } from '../src/lib/storage.js';
import { getCachedPlan, getFeatures, PLAN_CACHE_MAX_AGE_MS, PlanLimitError, refreshPlan } from '../src/lib/planCache.js';
import { addSnippet, listSnippets } from '../src/lib/snippets.js';
import { addPersonalGlossaryEntry, listPersonalGlossary } from '../src/lib/glossary.js';
import { getLearnedCounts, recordEdit } from '../src/lib/profile.js';
import { PLAN_FEATURES } from '../src/core/refine/quality.js';

const asPlan = (plan, checkedAt = Date.now()) => setLocal(STORAGE_KEYS.PLAN, { plan, checkedAt });
const term = (i) => ({ sourceText: `용어${i}`, targetText: `term${i}`, keepSource: false, language: null });

beforeEach(async () => {
  await clearAllLocal();
});

test('요금제 저장 판정표 — 없음·오래됨(7일)·모르는 값은 무료 표, 저장값은 그 요금제 표', async () => {
  assert.equal(await getCachedPlan(), null);
  assert.equal(await getFeatures(), PLAN_FEATURES.free);
  await asPlan('pro');
  assert.equal(await getFeatures(), PLAN_FEATURES.pro);
  await asPlan('team', Date.now() - PLAN_CACHE_MAX_AGE_MS - 1);
  assert.equal(await getCachedPlan(), null, '7일 지난 값은 쓰지 않는다');
  assert.equal(await getFeatures(), PLAN_FEATURES.free);
  await setLocal(STORAGE_KEYS.PLAN, { plan: 'gold', checkedAt: Date.now() });
  assert.equal(await getFeatures(), PLAN_FEATURES.free);
});

test('요금제 다시 묻기 — 답하면 저장 · 오류(null)면 마지막 값 유지 · 로그아웃이면 지움 · 저장값은 이름·시각뿐', async () => {
  assert.equal(await refreshPlan({ session: async () => ({ uid: 'u' }), fetchPlan: async () => 'pro', now: 1000 }), 'pro');
  assert.deepEqual(await getLocal(STORAGE_KEYS.PLAN), { plan: 'pro', checkedAt: 1000 });
  assert.equal(await refreshPlan({ session: async () => ({ uid: 'u' }), fetchPlan: async () => null, now: 2000 }), 'pro');
  assert.deepEqual(await getLocal(STORAGE_KEYS.PLAN), { plan: 'pro', checkedAt: 1000 });
  assert.equal(await refreshPlan({ session: async () => null, fetchPlan: async () => 'pro' }), null);
  assert.equal(await getLocal(STORAGE_KEYS.PLAN), null);
});

test('저장 문구 — 무료는 3개까지 새로 추가 · 같은 문장은 그대로 위로 · Pro는 제한 없음', async () => {
  await asPlan('free');
  for (let i = 0; i < 3; i += 1) assert.equal((await addSnippet({ text: `문장 ${i}` })).ok, true);
  assert.deepEqual(await addSnippet({ text: '네 번째' }), { ok: false, reason: 'plan-limit', limit: 3 });
  assert.equal((await addSnippet({ text: '문장 0' })).reason, 'duplicate', '이미 있는 문장은 막지 않는다');
  assert.equal((await listSnippets()).length, 3);
  await asPlan('pro');
  assert.equal((await addSnippet({ text: '네 번째' })).ok, true);
});

test('개인 용어집 — 무료는 5개까지 새로 추가(PlanLimitError, 화면 문구 그대로) · 덮어쓰기는 된다 · Pro는 제한 없음', async () => {
  await asPlan('free');
  for (let i = 0; i < 5; i += 1) await addPersonalGlossaryEntry(term(i));
  await assert.rejects(
    () => addPersonalGlossaryEntry(term(5)),
    (e) => e instanceof PlanLimitError && /개인 용어를 5개까지/.test(e.message) && /Pro에서 더 쓸 수 있어요/.test(e.message),
  );
  await addPersonalGlossaryEntry({ ...term(0), targetText: 'changed' });
  assert.equal((await listPersonalGlossary()).length, 5);
  await asPlan('team');
  await addPersonalGlossaryEntry(term(5));
  assert.equal((await listPersonalGlossary()).length, 6);
});

test('수정 습관 학습 — 무료는 기록하지 않고 알릴 분류도 없음 · Pro는 기록', async () => {
  await asPlan('free');
  const outcome = await recordEdit('Sorry, sorry — please review.', 'please review.');
  assert.deepEqual(outcome.categoryIds, []);
  assert.deepEqual(await getLearnedCounts(), {});
  await asPlan('pro');
  assert.ok((await recordEdit('Sorry, sorry — please review.', 'please review.')).categoryIds.length > 0);
  assert.ok(Object.keys(await getLearnedCounts()).length > 0);
});

test('하루 한도 문구 — 무료·모름만 Pro 하루 횟수를 덧붙이고, 낸 사람에게는 권하지 않는다 (2026-11-06)', async () => {
  const { dailyLimitText, DAILY_LIMIT_TEXT } = await import('../src/lib/planCache.js');
  const { PLAN_LIMITS } = await import('../src/core/refine/quality.js');
  for (const plan of ['free', null, undefined]) {
    const text = dailyLimitText(plan, { billing: true });
    assert.match(text, new RegExp(`${PLAN_LIMITS.free.daily}회`));
    assert.match(text, new RegExp(`Pro는 하루 ${PLAN_LIMITS.pro.daily}회`));
  }
  for (const plan of ['pro', 'team', 'beta']) assert.equal(dailyLimitText(plan, { billing: true }), DAILY_LIMIT_TEXT);
  assert.equal(dailyLimitText('free', { billing: false }), DAILY_LIMIT_TEXT, '결제 진입점 꺼짐');
});

test('유예 종료일 표시 — 한국 날짜 「12월 5일」, 틀린 값은 null', async () => {
  const { graceDateText } = await import('../src/lib/teamClient.js');
  assert.equal(graceDateText('2026-12-05T08:20:00.000Z'), '12월 5일');
  assert.equal(graceDateText('2026-12-04T15:30:00.000Z'), '12월 5일', 'UTC 4일 15:30 = 한국 5일 00:30');
  assert.equal(graceDateText(null), null);
  assert.equal(graceDateText('nope'), null);
});
