/**
 * S31 — 설정 동기화 단위 테스트 (Spec 필수 5 · `docs/WebSplit.md`).
 *
 * 🔴 이 테스트가 지키려는 핵심:
 *    ① **본문이 올라갈 경로가 없다** — 저장 문구·예약·결정 로그를 건드리지 않는다.
 *    ② **규칙 화이트리스트에 없는 필드를 만들지 않는다** — 보내면 문서 전체가 거절된다.
 *    ③ **학습 횟수는 더하지 않고 최댓값을 쓴다** — 더하면 반복 동기화로 무한히 불어난다.
 *    ④ **updateMask 없이 PATCH하지 않는다** — 다른 필드가 지워진다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeFields,
  decodeFields,
  onboardingToFields,
  fieldsToOnboarding,
  mergeCounts,
  syncNow,
  syncErrorMessage,
  SYNC_ERRORS,
} from '../src/lib/syncClient.js';
import { setLocal, getLocal, removeLocal, STORAGE_KEYS } from '../src/lib/storage.js';

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const result = handler(url, init, calls.length) ?? {};
    return {
      ok: result.status === undefined || (result.status >= 200 && result.status < 300),
      status: result.status ?? 200,
      json: async () => result.body ?? {},
      text: async () => JSON.stringify(result.body ?? {}),
    };
  };
  impl.calls = calls;
  return impl;
}

async function signedIn() {
  await setLocal(STORAGE_KEYS.AUTH, {
    uid: 'uid-1',
    email: 'a@b.com',
    idToken: 'tok',
    refreshToken: 'r',
    expiresAt: Date.now() + 3_600_000,
  });
}

/* ── 인코딩 ─────────────────────────────────────────────────────────── */

test('🔴 문자열·정수·문자열 배열만 인코딩한다 — 임의 객체를 통째로 넣는 경로가 없다', () => {
  const fields = encodeFields({
    language: 'ko',
    count: 3,
    partnerRegions: ['eu'],
    nested: { body: '메시지 본문' }, // 🔴 버려져야 한다
    floaty: 1.5,
    nothing: null,
  });
  assert.deepEqual(Object.keys(fields).sort(), ['count', 'language', 'partnerRegions']);
  assert.ok(!JSON.stringify(fields).includes('메시지 본문'));
});

test('인코딩 ↔ 디코딩이 왕복한다', () => {
  const original = { language: 'ko', count: 7, partnerRegions: ['eu', 'us'] };
  assert.deepEqual(decodeFields(encodeFields(original)), original);
});

/* ── 규칙 화이트리스트 ──────────────────────────────────────────────── */

test('🔴 온보딩 매핑이 규칙에 없는 필드를 만들지 않는다', () => {
  const allowed = new Set([
    'language',
    'partnerRegions',
    'tone',
    'honorificLevel',
    'directness',
    'emojiPreference',
    'updatedAt',
  ]);
  const fields = onboardingToFields({
    language: 'ko',
    tone: 'polite',
    partnerRegion: 'eu',
    completedAt: '2026-08-14T00:00:00Z', // 🔴 규칙에 없다 — 빠져야 한다
  });
  for (const key of Object.keys(fields)) {
    assert.ok(allowed.has(key), `규칙에 없는 필드를 만들었다: ${key}`);
  }
  assert.equal('completedAt' in fields, false);
});

test('partnerRegion(단수) → partnerRegions(복수 배열)로 감싼다', () => {
  assert.deepEqual(onboardingToFields({ partnerRegion: 'eu' }).partnerRegions, ['eu']);
  assert.deepEqual(fieldsToOnboarding(encodeFields({ partnerRegions: ['eu'] })), {
    partnerRegion: 'eu',
  });
});

test('없는 값을 지어내지 않는다', () => {
  assert.deepEqual(onboardingToFields({}), {});
  assert.deepEqual(onboardingToFields(null), {});
  assert.deepEqual(fieldsToOnboarding(null), {});
});

/* ── 병합 ───────────────────────────────────────────────────────────── */

test('🔴 학습 횟수는 더하지 않고 최댓값을 쓴다 — 더하면 반복 동기화로 불어난다', () => {
  const local = { 'fewer-apologies': 3 };
  const remote = { 'fewer-apologies': 5, 'shorter-intro': 2 };
  const merged = mergeCounts(local, remote);
  assert.deepEqual(merged, { 'fewer-apologies': 5, 'shorter-intro': 2 });

  // 멱등: 같은 병합을 두 번 해도 값이 안 변한다.
  assert.deepEqual(mergeCounts(merged, remote), merged);
});

test('음수·비정수 원격 값은 무시한다', () => {
  assert.deepEqual(mergeCounts({ a: 1 }, { a: -5, b: 1.5, c: 'x' }), { a: 1 });
});

/* ── 동기화 흐름 ────────────────────────────────────────────────────── */

test('🔴 본문이 든 저장 키를 건드리지 않는다 (Spec 필수 5)', async () => {
  await signedIn();
  await setLocal(STORAGE_KEYS.SNIPPETS, [{ text: '이건 절대 안 나가야 하는 교정문' }]);
  await setLocal(STORAGE_KEYS.RESERVATIONS, [{ text: '예약 메시지 본문' }]);
  await setLocal(STORAGE_KEYS.ONBOARDING, { language: 'ko', tone: 'polite' });
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'fewer-apologies': 2 });

  const impl = fakeFetch((url) => (url.includes('learnedPatterns') ? { body: {} } : { body: {} }));
  await syncNow({ fetchImpl: impl });

  const sent = JSON.stringify(impl.calls.map((c) => c.body));
  assert.ok(!sent.includes('절대 안 나가야'), '스니펫 본문이 전송됐다');
  assert.ok(!sent.includes('예약 메시지 본문'), '예약 본문이 전송됐다');

  await removeLocal(STORAGE_KEYS.SNIPPETS);
  await removeLocal(STORAGE_KEYS.RESERVATIONS);
});

test('🔴 PATCH에 updateMask가 반드시 붙는다 — 없으면 다른 필드가 지워진다', async () => {
  await signedIn();
  await setLocal(STORAGE_KEYS.ONBOARDING, { language: 'ko' });
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'fewer-apologies': 2 });

  const impl = fakeFetch(() => ({ body: {} }));
  await syncNow({ fetchImpl: impl });

  const patches = impl.calls.filter((c) => c.init.method === 'PATCH');
  assert.ok(patches.length > 0, 'PATCH를 한 번도 안 보냈다');
  for (const call of patches) {
    assert.match(call.url, /updateMask\.fieldPaths=/, `updateMask 없는 PATCH: ${call.url}`);
  }
});

test('원격이 앞서면 로컬 학습 횟수가 올라간다', async () => {
  await signedIn();
  await setLocal(STORAGE_KEYS.ONBOARDING, { language: 'ko' });
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'fewer-apologies': 1 });

  const impl = fakeFetch((url) =>
    url.includes('learnedPatterns') && !url.includes('updateMask')
      ? {
          body: {
            documents: [{ fields: encodeFields({ kind: 'fewer-apologies', count: 9 }) }],
          },
        }
      : { body: {} },
  );
  await syncNow({ fetchImpl: impl });
  assert.equal((await getLocal(STORAGE_KEYS.LEARNED_PATTERNS, {}))['fewer-apologies'], 9);
});

test('🔴 로컬 설정이 원격보다 우선한다 — 방금 바꾼 설정이 되돌아가지 않는다', async () => {
  await signedIn();
  await setLocal(STORAGE_KEYS.ONBOARDING, { language: 'ko', tone: 'casual' });

  const impl = fakeFetch((url, init) =>
    !init.method && url.includes('/users/uid-1') && !url.includes('learnedPatterns')
      ? { body: { fields: encodeFields({ language: 'en', tone: 'polite' }) } }
      : { body: {} },
  );
  await syncNow({ fetchImpl: impl });
  const stored = await getLocal(STORAGE_KEYS.ONBOARDING, {});
  assert.equal(stored.tone, 'casual', '원격 값이 로컬을 덮어썼다');
  assert.equal(stored.language, 'ko');
});

test('로그인하지 않았으면 아무 요청도 보내지 않는다', async () => {
  await removeLocal(STORAGE_KEYS.AUTH);
  const impl = fakeFetch(() => ({ body: {} }));
  await assert.rejects(
    () => syncNow({ fetchImpl: impl }),
    (e) => e.reason === SYNC_ERRORS.NOT_SIGNED_IN,
  );
  assert.equal(impl.calls.length, 0);
});

test('규칙이 거절하면(403) 사용자에게 "다시 시도"를 권하지 않는다', async () => {
  await signedIn();
  await setLocal(STORAGE_KEYS.ONBOARDING, { language: 'ko' });
  const impl = fakeFetch(() => ({ status: 403, body: {} }));
  await assert.rejects(
    () => syncNow({ fetchImpl: impl }),
    (e) => e.reason === SYNC_ERRORS.REJECTED,
  );
  const message = syncErrorMessage(SYNC_ERRORS.REJECTED);
  assert.ok(!message.includes('다시 시도'), '규칙 거절인데 재시도를 권한다');
});

test('모든 실패 사유에 사람이 읽을 문구가 있다', () => {
  for (const reason of Object.values(SYNC_ERRORS)) {
    const message = syncErrorMessage(reason);
    assert.ok(message.length > 0, `${reason}에 문구가 없다`);
    assert.ok(!message.includes('undefined'));
  }
});

/* ── L22 — 학습 내역 삭제가 서버에도 반영된다 (2026-09-30) ───────────────── */

import { flushLearnedDeletions } from '../src/lib/syncClient.js';
import { removeLearnedPattern, clearLearnedPatterns, getLearnedDeletions } from '../src/lib/profile.js';

/** 학습 패턴 컬렉션만 흉내 내는 상태 있는 가짜 Firestore. */
function fakeFirestore(initial, { failDelete = false } = {}) {
  const docs = new Map(Object.entries(initial));
  const impl = fakeFetch((url, init) => {
    const one = url.match(/learnedPatterns\/([^?]+)/);
    const method = init.method ?? 'GET';
    if (one && method === 'DELETE') {
      if (failDelete) return { status: 500, body: {} };
      docs.delete(decodeURIComponent(one[1]));
      return { body: {} };
    }
    if (one && method === 'PATCH') {
      const decoded = decodeFields(JSON.parse(init.body).fields);
      docs.set(decoded.kind, decoded.count);
      return { body: {} };
    }
    if (url.endsWith('/learnedPatterns') && method === 'GET') {
      return {
        body: {
          documents: [...docs].map(([kind, count]) => ({
            name: `projects/p/databases/(default)/documents/users/uid-1/learnedPatterns/${encodeURIComponent(kind)}`,
            fields: encodeFields({ kind, count }),
          })),
        },
      };
    }
    return { body: {} };
  });
  impl.docs = docs;
  return impl;
}

async function resetLearned() {
  await removeLocal(STORAGE_KEYS.LEARNED_PATTERNS);
  await removeLocal(STORAGE_KEYS.LEARNED_DELETIONS);
  await removeLocal(STORAGE_KEYS.ONBOARDING);
}

test('🔴 L22 개별 삭제한 항목이 다음 동기화에서 되살아나지 않는다 — 서버 문서도 지워진다', async () => {
  await resetLearned();
  await signedIn();
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'fewer-apologies': 5, 'more-direct': 2 });
  await removeLearnedPattern('fewer-apologies');

  const remote = fakeFirestore({ 'fewer-apologies': 5, 'more-direct': 2 });
  await syncNow({ fetchImpl: remote });

  assert.equal((await getLocal(STORAGE_KEYS.LEARNED_PATTERNS, {}))['fewer-apologies'], undefined, '로컬에 되살아났다');
  assert.equal(remote.docs.has('fewer-apologies'), false, '서버 문서가 남았다');
  assert.equal(remote.docs.get('more-direct'), 2, '지우지 않은 항목까지 건드렸다');
  assert.deepEqual(await getLearnedDeletions(), { all: false, kinds: [] }, '대기 목록이 비워지지 않았다');
});

test('🔴 L22 삭제는 병합보다 먼저 일어난다 — DELETE가 목록 GET보다 앞선다', async () => {
  await resetLearned();
  await signedIn();
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'fewer-apologies': 1 });
  await removeLearnedPattern('fewer-apologies');

  const remote = fakeFirestore({ 'fewer-apologies': 9 });
  await syncNow({ fetchImpl: remote });
  const order = remote.calls.map((c) => `${c.init.method ?? 'GET'} ${c.url.includes('learnedPatterns') ? 'lp' : 'user'}`);
  assert.ok(order.includes('DELETE lp'), `DELETE를 보내지 않았다: ${order.join(', ')}`);
  assert.ok(order.indexOf('DELETE lp') < order.indexOf('GET lp'), `순서가 틀렸다: ${order.join(', ')}`);
});

test('🔴 L22 전체 삭제는 로컬에 없던(다른 기기에서 올린) 서버 항목까지 지운다', async () => {
  await resetLearned();
  await signedIn();
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'fewer-apologies': 1 });
  await clearLearnedPatterns();

  const remote = fakeFirestore({ 'fewer-apologies': 1, 'from-other-device': 4 });
  await syncNow({ fetchImpl: remote });
  assert.equal(remote.docs.size, 0, `서버에 남았다: ${[...remote.docs.keys()].join(', ')}`);
  assert.deepEqual(await getLocal(STORAGE_KEYS.LEARNED_PATTERNS, {}), {});
});

test('🔴 L22 서버 삭제가 실패하면 병합하지 않고 멈춘다 — 대기 목록은 남는다', async () => {
  await resetLearned();
  await signedIn();
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'fewer-apologies': 1 });
  await removeLearnedPattern('fewer-apologies');

  const remote = fakeFirestore({ 'fewer-apologies': 9 }, { failDelete: true });
  await assert.rejects(() => syncNow({ fetchImpl: remote }));
  assert.equal((await getLocal(STORAGE_KEYS.LEARNED_PATTERNS, {}))['fewer-apologies'], undefined, '실패했는데 병합해서 되살렸다');
  assert.deepEqual((await getLearnedDeletions()).kinds, ['fewer-apologies']);
});

test('L22 로그인 전에 지우면 요청 없이 대기 목록에만 남는다', async () => {
  await resetLearned();
  await removeLocal(STORAGE_KEYS.AUTH);
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'fewer-apologies': 1 });
  await removeLearnedPattern('fewer-apologies');

  const impl = fakeFetch(() => ({ body: {} }));
  await assert.rejects(
    () => flushLearnedDeletions({ fetchImpl: impl }),
    (e) => e.reason === SYNC_ERRORS.NOT_SIGNED_IN,
  );
  assert.equal(impl.calls.length, 0);
  assert.deepEqual((await getLearnedDeletions()).kinds, ['fewer-apologies']);
});

test('L22 지운 뒤 새로 쌓인 같은 항목은 새 값으로 올라간다 — 옛 서버 값이 이기지 않는다', async () => {
  await resetLearned();
  await signedIn();
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'fewer-apologies': 7 });
  await removeLearnedPattern('fewer-apologies');
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'fewer-apologies': 1 }); // 삭제 후 새로 1회

  const remote = fakeFirestore({ 'fewer-apologies': 7 });
  await syncNow({ fetchImpl: remote });
  assert.equal((await getLocal(STORAGE_KEYS.LEARNED_PATTERNS, {}))['fewer-apologies'], 1);
  assert.equal(remote.docs.get('fewer-apologies'), 1);
});

test('L22 대기 목록이 비었으면 flush는 요청을 보내지 않는다', async () => {
  await resetLearned();
  await signedIn();
  const impl = fakeFetch(() => ({ body: {} }));
  assert.deepEqual(await flushLearnedDeletions({ fetchImpl: impl }), { deleted: 0 });
  assert.equal(impl.calls.length, 0);
});
