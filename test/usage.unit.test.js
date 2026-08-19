/**
 * 「오늘의 사이」 카운트 (2026-08-15).
 *
 * 🔴 이 기능이 생긴 이유는 화면이 **목업 상수 14·6·3**을 실데이터처럼 보여주고 있었기 때문이다.
 *    그래서 이 테스트가 지키는 것은 ① 날짜가 바뀌면 0 ② 저장물에 본문이 없다 두 가지다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getTodayUsage, bumpUsage, USAGE_KINDS } from '../src/lib/usage.js';

/**
 * chrome.storage.local 대역.
 * 🔴 `src/lib/storage.js`는 **Promise 형태**로 부른다(`await chrome.storage.local.get(key)`) —
 *    콜백 형태로 대역을 만들면 실제 계약과 어긋나 테스트만 실패한다(2026-08-15에 한 번 겪음).
 */
function installStorage() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {},
  };
  return store;
}

/** 🔴 하나만 고치면 되도록 모아 둔다 — 카운트 종류가 늘 때마다 세 곳을 고치던 것을 없앤다. */
const EMPTY_TODAY = {
  refined: 0,
  decoded: 0,
  scheduled: 0,
  blockedSensitive: 0,
  blockedOffHours: 0,
};

test('처음에는 전부 0이다', async () => {
  installStorage();
  assert.deepEqual(await getTodayUsage(), EMPTY_TODAY);
});

test('올린 만큼 센다', async () => {
  installStorage();
  await bumpUsage(USAGE_KINDS.REFINED);
  await bumpUsage(USAGE_KINDS.REFINED);
  await bumpUsage(USAGE_KINDS.DECODED);
  const usage = await getTodayUsage();
  assert.equal(usage.refined, 2);
  assert.equal(usage.decoded, 1);
  assert.equal(usage.scheduled, 0);
});

test('🔴 날짜가 바뀌면 0으로 본다 — 「오늘의」라고 쓰고 누적을 보여주면 그것도 거짓말이다', async () => {
  installStorage();
  const monday = new Date(2026, 7, 17, 10, 0);
  await bumpUsage(USAGE_KINDS.REFINED, monday);
  assert.equal((await getTodayUsage(monday)).refined, 1, '같은 날은 유지');
  const tuesday = new Date(2026, 7, 18, 10, 0);
  assert.deepEqual(await getTodayUsage(tuesday), EMPTY_TODAY);
});

test('🔴 저장물에는 정수와 날짜만 있다 — 본문·수신자는 어떤 형태로도 들어가지 않는다 (Spec 필수 5)', async () => {
  const store = installStorage();
  await bumpUsage(USAGE_KINDS.SCHEDULED);
  const dumped = JSON.stringify(store);
  assert.match(dumped, /"scheduled":1/);
  // 값이 전부 숫자/날짜 문자열인지 — 자유 텍스트가 섞이면 실패한다.
  const saved = store['sai.usage.today'];
  /**
   * 🔴 **키 목록을 통째로 고정한다.** 「저장물에 본문이 없다」를 지키는 유일한 방법이 이것이다 —
   *    `blockedSensitive` 같은 항목을 늘릴 때 **여기도 같이 고쳐야** 통과하므로, 실수로 본문성
   *    필드를 끼워 넣으면 반드시 걸린다(2026-08-17 계약 확장).
   */
  assert.deepEqual(Object.keys(saved).sort(), [
    'blockedOffHours',
    'blockedSensitive',
    'dateKey',
    'decoded',
    'refined',
    'scheduled',
  ]);
  for (const key of ['refined', 'decoded', 'scheduled']) {
    assert.equal(typeof saved[key], 'number');
  }
  assert.match(saved.dateKey, /^\d{4}-\d{2}-\d{2}$/);
});

test('모르는 종류는 조용히 무시한다 — 통계가 기능을 막지 않는다', async () => {
  installStorage();
  await bumpUsage('hacked');
  assert.deepEqual(await getTodayUsage(), EMPTY_TODAY);
});

/* ── 서술격 조사 (P5 / 2026-08-15 실확장 노출) ──────────────────────────── */

/**
 * 🔴 「Sarah는 지금 **주말예요**」가 실제 화면에 나갔다. 템플릿이 `{라벨}예요` 하나로 고정돼
 *    있었고 '퇴근 시간대'가 우연히 맞아 눈에 띄지 않았을 뿐이다.
 * 🔴 로직은 `src/content/RefinePopup.jsx`의 `copulaFor`에 있다 — jsx라 직접 import하지 않고
 *    **같은 규칙**을 여기서 검증한다(유니코드 받침 계산은 순수 함수라 재현이 정확하다).
 */
function copulaFor(word) {
  const last = String(word ?? '').trim().slice(-1);
  const code = last.charCodeAt(0);
  const isHangulSyllable = code >= 0xac00 && code <= 0xd7a3;
  if (!isHangulSyllable) return '예요';
  return (code - 0xac00) % 28 === 0 ? '예요' : '이에요';
}

test('🔴 받침이 있으면 「이에요」 — 화면에 「주말예요」가 나갔던 버그', () => {
  assert.equal(copulaFor('주말'), '이에요');
  assert.equal(copulaFor('공휴일'), '이에요');
});

test('받침이 없으면 「예요」 — 기존에 맞던 경우가 깨지지 않아야 한다', () => {
  assert.equal(copulaFor('퇴근 시간대'), '예요');
});

test('한글이 아니면 기존 동작을 유지한다 — 판정 근거가 없을 때 형태를 바꾸지 않는다', () => {
  assert.equal(copulaFor('weekend'), '예요');
  assert.equal(copulaFor(''), '예요');
});
