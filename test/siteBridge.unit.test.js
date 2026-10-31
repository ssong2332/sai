/**
 * 웹 설정 브리지 (`src/background/siteBridge.js`, 2026-10-24 — `docs/WebSplit.md` 「C — 로컬 브리지」).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 허용 목록 밖 오리진은 아무것도 못 한다(`forbidden_origin`) — 기본 빌드의 허용 목록은 비어 있다.
 *    ② 틀린 값이 하나라도 섞인 요청은 **아무것도 쓰지 않는다**(`bad_request`).
 *    ③ 금지 키(토큰·저장 문구·예약·결정 로그·수신자·팀…)의 값이 **어떤 응답에도** 섞이지 않는다.
 *    ④ 사이드패널과 같은 규칙 — 학습 삭제 대기 기록, 말투↔기본 톤 연결, 용어집 덮어쓰기.
 *
 * 🔴 실제 `src/lib/*.js`를 그대로 쓴다(확장 밖이라 `storage.js`의 메모리 폴백). 대역은 버전·세션·오리진뿐이다.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { handleSiteMessage, SITE_PROTOCOL_VERSION } from '../src/background/siteBridge.js';
import { clearAllLocal, getLocal, setLocal, STORAGE_KEYS } from '../src/lib/storage.js';
import { SYNC_ERRORS } from '../src/lib/syncClient.js';
import { SITE_ALLOWED_ORIGINS, SITE_EXTERNALLY_CONNECTABLE_MATCHES, SITE_URL, siteAllowedOrigins } from '../src/config.js';

const SITE = 'http://localhost:5180';
const sender = { origin: SITE };
const deps = { allowedOrigins: [SITE], getVersion: () => '9.9.9' };

const send = (message, overrides = {}) => handleSiteMessage(message, sender, { ...deps, ...overrides });

beforeEach(async () => {
  await clearAllLocal();
});

/* ── ① 오리진 ─────────────────────────────────────────── */

test('🔴 허용 목록 밖 오리진은 forbidden_origin — 다른 확장·남의 사이트·sender 없음', async () => {
  for (const bad of [{ origin: 'https://evil.example' }, { origin: 'chrome-extension://abc' }, {}, undefined, null]) {
    assert.deepEqual(await handleSiteMessage({ type: 'site:get' }, bad, deps), {
      ok: false,
      error: 'forbidden_origin',
    });
  }
});

test('🔴 기본 빌드의 허용 목록은 비어 있다 — localhost:5180도 거절된다', async () => {
  assert.deepEqual(SITE_ALLOWED_ORIGINS, []);
  assert.deepEqual(SITE_EXTERNALLY_CONNECTABLE_MATCHES, []);
  assert.equal(SITE_URL, null, '공개 빌드는 사이트 미배포라 버튼을 그리지 않는다');
  // 대역 없이 실제 기본 허용 목록으로 보낸다.
  assert.deepEqual(await handleSiteMessage({ type: 'site:hello' }, sender), { ok: false, error: 'forbidden_origin' });
});

test('개발 스위치를 켜면 localhost:5180만 붙는다', () => {
  assert.deepEqual(siteAllowedOrigins(false), []);
  assert.deepEqual(siteAllowedOrigins(true), ['http://localhost:5180']);
  assert.deepEqual(siteAllowedOrigins(true, 'https://sai.example/app'), ['https://sai.example', 'http://localhost:5180']);
});

/* ── 형식 ─────────────────────────────────────────────── */

test('메시지 형식이 틀리면 bad_request, 모르는 type은 unknown_type', async () => {
  for (const bad of [null, 'site:get', [], { type: 3 }, {}]) {
    assert.deepEqual(await send(bad), { ok: false, error: 'bad_request' });
  }
  assert.deepEqual(await send({ type: 'site:snippets:get' }), { ok: false, error: 'unknown_type' });
  assert.deepEqual(await send({ type: 'toString' }), { ok: false, error: 'unknown_type' });
});

test('저장소가 깨지면 failed — 사유 문구를 싣지 않는다', async () => {
  const response = await send(
    { type: 'site:get' },
    {
      getLocal: async () => {
        throw new Error('storage exploded SECRETWORD');
      },
    },
  );
  assert.deepEqual(response, { ok: false, error: 'failed' });
});

/* ── site:hello ───────────────────────────────────────── */

test('site:hello — 프로토콜·버전·로그인 여부(불리언)만', async () => {
  assert.deepEqual(await send({ type: 'site:hello' }), {
    ok: true,
    protocol: SITE_PROTOCOL_VERSION,
    version: '9.9.9',
    signedIn: false,
  });
  await setLocal(STORAGE_KEYS.AUTH, { uid: 'u1', email: 'me@example.com', idToken: 'tok', refreshToken: 'ref' });
  const response = await send({ type: 'site:hello' });
  assert.equal(response.signedIn, true);
  assert.deepEqual(Object.keys(response).sort(), ['ok', 'protocol', 'signedIn', 'version']);
});

/* ── site:get ─────────────────────────────────────────── */

test('site:get — 기본값은 그 설정이 효과를 내는 화면의 기본값이다', async () => {
  const { ok, settings } = await send({ type: 'site:get' });
  assert.equal(ok, true);
  assert.deepEqual(settings.display, {
    theme: 'light',
    backTranslation: true,
    refineReasoning: false,
    highlightHints: true, // 2026-10-31 기본값 변경 — 팝업도 같은 값(displaySettings)
    threadContext: false, // THREAD_CONTEXT_DEFAULT
    threadContextPreview: true, // 2026-10-31
    replyAuto: false,
    snippetInsertMode: 'append', // 2026-10-31
  });
  assert.deepEqual(settings.language, { myLanguage: null, partnerRegion: null, tone: null });
  assert.deepEqual(settings.profile, { situationId: null, collabStyleId: null });
  assert.deepEqual(settings.identity, { displayName: '', jobTitle: '' });
  assert.deepEqual(settings.learned, { counts: {} });
  assert.deepEqual(settings.glossary, []);
});

test('site:get — 선택지는 lib 상수표의 {id,label}뿐이다 (hint·language 같은 내부 필드 없음)', async () => {
  const { settings } = await send({ type: 'site:get' });
  const keys = ['languages', 'partnerRegions', 'tones', 'situations', 'collabStyles', 'learnedCategories', 'glossaryLanguages'];
  assert.deepEqual(Object.keys(settings.options).sort(), [...keys].sort());
  for (const key of keys) {
    assert.ok(settings.options[key].length > 0, key);
    for (const item of settings.options[key]) {
      assert.deepEqual(Object.keys(item).sort(), ['id', 'label'], key);
      assert.equal(typeof item.label, 'string');
    }
  }
  assert.ok(settings.options.glossaryLanguages.some((item) => item.id === 'ja' && item.label === '일본어'));
});

/* ── site:set ─────────────────────────────────────────── */

test('site:set display — 쓰고 갱신된 settings를 돌려준다', async () => {
  const response = await send({
    type: 'site:set',
    section: 'display',
    patch: { theme: 'dark', highlightHints: false, snippetInsertMode: 'replace' }, // 기본값의 반대로 — 정말 썼는지 보이게
  });
  assert.equal(response.ok, true);
  assert.equal(response.settings.display.theme, 'dark');
  assert.equal(response.settings.display.highlightHints, false);
  assert.equal(response.settings.display.snippetInsertMode, 'replace');
  assert.equal(await getLocal(STORAGE_KEYS.THEME), 'dark');
  assert.equal(await getLocal(STORAGE_KEYS.HIGHLIGHT_HINTS), false);
});

test('🔴 site:set — 값 하나만 틀려도 아무것도 쓰지 않는다', async () => {
  const cases = [
    { section: 'display', patch: { theme: 'dark', backTranslation: 'yes' } },
    { section: 'display', patch: { theme: 'blue' } },
    { section: 'display', patch: { theme: 'dark', unknownField: true } },
    { section: 'display', patch: null },
    { section: 'display', patch: [] },
    { section: 'language', patch: { myLanguage: 'fr' } },
    { section: 'language', patch: { tone: 'shouty' } },
    { section: 'profile', patch: { collabStyleId: 'direct', situationId: 'party' } },
    { section: 'identity', patch: { displayName: 42 } },
    { section: 'snippets', patch: {} },
    { section: '__proto__', patch: {} },
    { section: undefined, patch: {} },
  ];
  for (const message of cases) {
    assert.deepEqual(await send({ type: 'site:set', ...message }), { ok: false, error: 'bad_request' }, JSON.stringify(message));
  }
  assert.equal(await getLocal(STORAGE_KEYS.THEME), null, 'theme이 써졌다');
  assert.equal(await getLocal(STORAGE_KEYS.PROFILE), null, 'profile이 써졌다');
});

test('site:set language — 고친 필드만 바꾸고 completedAt을 찍지 않는다 · 톤은 말투로도 반영', async () => {
  const response = await send({ type: 'site:set', section: 'language', patch: { myLanguage: 'ja', tone: 'brief' } });
  assert.equal(response.ok, true);
  assert.deepEqual(response.settings.language, { myLanguage: 'ja', partnerRegion: null, tone: 'brief' });
  assert.equal(response.settings.profile.collabStyleId, 'brief', 'saveOnboarding과 같은 톤 → 프로필 연결');
  assert.equal((await getLocal(STORAGE_KEYS.ONBOARDING)).completedAt, null, '첫 설정 화면이 사라지면 안 된다');

  const second = await send({ type: 'site:set', section: 'language', patch: { partnerRegion: 'chinese' } });
  assert.deepEqual(second.settings.language, { myLanguage: 'ja', partnerRegion: 'chinese', tone: 'brief' });
});

test('🔴 site:set profile — 온보딩을 끝냈으면 말투가 기본 톤으로도 간다 (사이드패널과 같은 규칙)', async () => {
  await setLocal(STORAGE_KEYS.ONBOARDING, { language: 'ko', partnerRegion: null, tone: 'direct', completedAt: '2026-10-01T00:00:00.000Z' });
  const response = await send({ type: 'site:set', section: 'profile', patch: { collabStyleId: 'warm', situationId: 'incident' } });
  assert.equal(response.ok, true);
  assert.deepEqual(response.settings.profile, { situationId: 'incident', collabStyleId: 'warm' });
  assert.equal(response.settings.language.tone, 'warm');
  assert.equal(response.settings.language.myLanguage, 'ko', '다른 온보딩 값은 그대로');
});

test('🔴 site:set profile — 온보딩을 안 끝냈으면 온보딩은 건드리지 않는다', async () => {
  const response = await send({ type: 'site:set', section: 'profile', patch: { collabStyleId: 'warm' } });
  assert.equal(response.settings.profile.collabStyleId, 'warm');
  assert.equal(response.settings.language.tone, null);
  assert.equal(await getLocal(STORAGE_KEYS.ONBOARDING), null, 'completedAt이 찍히면 첫 설정 화면이 사라진다');
});

test('site:set profile — null로 비울 수 있다', async () => {
  await send({ type: 'site:set', section: 'profile', patch: { situationId: 'report' } });
  const response = await send({ type: 'site:set', section: 'profile', patch: { situationId: null } });
  assert.equal(response.settings.profile.situationId, null);
});

test('site:set identity — 다듬어 저장 · 상한(30자, identity.js와 같음)을 넘으면 자르지 않고 거절', async () => {
  const response = await send({ type: 'site:set', section: 'identity', patch: { displayName: '  박수홍 ', jobTitle: 'PM' } });
  assert.deepEqual(response.settings.identity, { displayName: '박수홍', jobTitle: 'PM' });
  assert.deepEqual(await send({ type: 'site:set', section: 'identity', patch: { jobTitle: 'x'.repeat(31) } }), {
    ok: false,
    error: 'bad_request',
  });
  assert.deepEqual(await send({ type: 'site:set', section: 'identity', patch: { jobTitle: 'y'.repeat(41) } }), {
    ok: false,
    error: 'bad_request',
  });
  assert.equal((await getLocal(STORAGE_KEYS.IDENTITY)).jobTitle, 'PM');
});

/* ── 용어집 ───────────────────────────────────────────── */

test('용어집 add → update → remove', async () => {
  const added = await send({
    type: 'site:glossary:add',
    entry: { sourceText: ' 배포 ', targetText: 'deployment', keepSource: false, language: 'en' },
  });
  assert.equal(added.ok, true);
  assert.equal(added.glossary.length, 1);
  const [entry] = added.glossary;
  assert.deepEqual(Object.keys(entry).sort(), ['id', 'keepSource', 'language', 'sourceText', 'targetText']);
  assert.deepEqual({ ...entry, id: undefined }, {
    id: undefined,
    sourceText: '배포',
    targetText: 'deployment',
    keepSource: false,
    language: 'en',
  });

  const updated = await send({ type: 'site:glossary:update', id: entry.id, patch: { targetText: 'rollout' } });
  assert.equal(updated.glossary[0].targetText, 'rollout');

  const kept = await send({ type: 'site:glossary:update', id: entry.id, patch: { keepSource: true } });
  assert.equal(kept.glossary[0].targetText, null, '원문 유지면 번역어는 null(glossary.js 규칙)');

  const removed = await send({ type: 'site:glossary:remove', id: entry.id });
  assert.deepEqual(removed, { ok: true, glossary: [] });
});

test('🔴 용어집 add — 같은 원문 + 같은 언어면 덮어쓴다 (glossary.js와 같은 규칙)', async () => {
  await send({ type: 'site:glossary:add', entry: { sourceText: '배포', targetText: 'deployment', keepSource: false, language: 'en' } });
  await send({ type: 'site:glossary:add', entry: { sourceText: '배포', targetText: '部署', keepSource: false, language: 'zh' } });
  const third = await send({ type: 'site:glossary:add', entry: { sourceText: '배포', targetText: 'rollout', keepSource: false, language: 'en' } });
  assert.equal(third.glossary.length, 2, '언어가 다르면 따로 남고, 같으면 덮어쓴다');
  assert.deepEqual(third.glossary.map((item) => [item.language, item.targetText]).sort(), [
    ['en', 'rollout'],
    ['zh', '部署'],
  ]);
});

test('🔴 용어집 — 형식 위반·길이 초과·없는 id는 bad_request, 아무것도 쓰지 않는다', async () => {
  const bad = [
    { type: 'site:glossary:add', entry: { sourceText: '', targetText: 'x', keepSource: false, language: null } },
    { type: 'site:glossary:add', entry: { sourceText: '배포', targetText: '', keepSource: false, language: null } },
    { type: 'site:glossary:add', entry: { sourceText: '배포', keepSource: false } },
    { type: 'site:glossary:add', entry: { sourceText: 'a'.repeat(201), targetText: 'x', keepSource: false, language: null } },
    { type: 'site:glossary:add', entry: { sourceText: '배포', targetText: 'b'.repeat(201), keepSource: false, language: null } },
    { type: 'site:glossary:add', entry: { sourceText: '배포', targetText: 'x', keepSource: 'no', language: null } },
    { type: 'site:glossary:add', entry: { sourceText: '배포', targetText: 'x', keepSource: false, language: 'xx' } },
    { type: 'site:glossary:add', entry: { sourceText: '배포', targetText: 'x', keepSource: false, scope: 'team' } },
    { type: 'site:glossary:add', entry: null },
    { type: 'site:glossary:update', id: 'nope', patch: { targetText: 'x' } },
    { type: 'site:glossary:update', id: 42, patch: { targetText: 'x' } },
    { type: 'site:glossary:remove', id: 'nope' },
    { type: 'site:glossary:remove' },
  ];
  for (const message of bad) {
    assert.deepEqual(await send(message), { ok: false, error: 'bad_request' }, JSON.stringify(message).slice(0, 120));
  }
  assert.equal(await getLocal(STORAGE_KEYS.GLOSSARY_PERSONAL), null);

  const { glossary } = await send({
    type: 'site:glossary:add',
    entry: { sourceText: '배포', targetText: 'deployment', keepSource: false, language: null },
  });
  // 번역어를 비우면서 원문 유지도 아니면 거절 — 저장된 값은 그대로.
  assert.deepEqual(await send({ type: 'site:glossary:update', id: glossary[0].id, patch: { targetText: null } }), {
    ok: false,
    error: 'bad_request',
  });
  assert.equal((await getLocal(STORAGE_KEYS.GLOSSARY_PERSONAL))[0].targetText, 'deployment');
});

/* ── 학습 ─────────────────────────────────────────────── */

const signedOut = { flushLearnedDeletions: async () => { throw Object.assign(new Error('x'), { reason: SYNC_ERRORS.NOT_SIGNED_IN }); } };

test('🔴 site:learned:remove — 서버 삭제 대기(sai.profile.learned.deleted)에 올린다', async () => {
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'no-emoji': 4, shorter: 2 });
  const response = await send({ type: 'site:learned:remove', categoryId: 'no-emoji' }, signedOut);
  assert.deepEqual(response, { ok: true, learned: { counts: { shorter: 2 } }, server: 'local' });
  assert.deepEqual(await getLocal(STORAGE_KEYS.LEARNED_DELETIONS), { all: false, kinds: ['no-emoji'] });

  assert.deepEqual(await send({ type: 'site:learned:remove', categoryId: 'no-emoji' }), { ok: false, error: 'bad_request' });
  assert.deepEqual(await send({ type: 'site:learned:remove', categoryId: 7 }), { ok: false, error: 'bad_request' });
});

test('🔴 site:learned:clear — 전부 지우고 all을 세운다', async () => {
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'no-emoji': 4 });
  const response = await send({ type: 'site:learned:clear' }, signedOut);
  assert.deepEqual(response, { ok: true, learned: { counts: {} }, server: 'local' });
  assert.deepEqual(await getLocal(STORAGE_KEYS.LEARNED_DELETIONS), { all: true, kinds: [] });
});

test('🔴 site:learned:* — 사이드패널처럼 지운 즉시 서버 삭제를 부른다', async () => {
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'no-emoji': 4, shorter: 2 });
  let calls = 0;
  const flushed = { flushLearnedDeletions: async () => { calls += 1; return { deleted: 1 }; } };
  const removed = await send({ type: 'site:learned:remove', categoryId: 'no-emoji' }, flushed);
  assert.equal(removed.server, 'deleted');
  const cleared = await send({ type: 'site:learned:clear' }, flushed);
  assert.equal(cleared.server, 'deleted');
  assert.equal(calls, 2);
});

test('🔴 site:learned:* — 서버 삭제가 실패해도 로컬 삭제는 성공이고 later를 알린다', async () => {
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'no-emoji': 4 });
  const failing = { flushLearnedDeletions: async () => { throw Object.assign(new Error('x'), { reason: SYNC_ERRORS.NETWORK }); } };
  const response = await send({ type: 'site:learned:remove', categoryId: 'no-emoji' }, failing);
  assert.deepEqual(response, { ok: true, learned: { counts: {} }, server: 'later' });
  assert.deepEqual(await getLocal(STORAGE_KEYS.LEARNED_DELETIONS), { all: false, kinds: ['no-emoji'] });
});

test('🔴 site:learned:* — 실패한 요청(bad_request)은 서버 삭제를 부르지 않는다', async () => {
  let calls = 0;
  const flushed = { flushLearnedDeletions: async () => { calls += 1; } };
  assert.deepEqual(await send({ type: 'site:learned:remove', categoryId: 'none' }, flushed), { ok: false, error: 'bad_request' });
  assert.equal(calls, 0);
});

/* ── ③ 금지 키 ────────────────────────────────────────── */

const EXCLUDED_KEYS = [
  STORAGE_KEYS.AUTH,
  STORAGE_KEYS.SNIPPETS,
  STORAGE_KEYS.RESERVATIONS,
  STORAGE_KEYS.DECISION_LOGS,
  STORAGE_KEYS.DECISIONS_CONSENT,
  STORAGE_KEYS.GITHUB_TOKEN,
  STORAGE_KEYS.RECIPIENTS,
  STORAGE_KEYS.RECIPIENT_SELECTED,
  STORAGE_KEYS.TEAM,
  STORAGE_KEYS.TEAMS,
  STORAGE_KEYS.ACTIVE_TEAM,
  STORAGE_KEYS.FRICTION_PENDING,
  STORAGE_KEYS.POINTS,
  STORAGE_KEYS.USAGE_TODAY,
  STORAGE_KEYS.FEEDBACK,
];

test('🔴 금지 키의 값은 어떤 응답에도 섞이지 않는다 — 모든 type을 돌려 본다', async () => {
  for (const key of EXCLUDED_KEYS) assert.ok(key, '모르는 STORAGE_KEYS 이름');
  const sentinel = (key) => `BRIDGESENTINELQX7:${key}`;
  for (const key of EXCLUDED_KEYS) {
    // 문자열 값과, 객체 안에 숨은 값 두 모양으로 심는다.
    await setLocal(key, key === STORAGE_KEYS.AUTH ? { uid: 'UIDSENTINELQX7', email: sentinel(key), idToken: sentinel(key) } : [{ id: 'x', text: sentinel(key) }]);
  }
  await setLocal(STORAGE_KEYS.LEARNED_PATTERNS, { 'no-emoji': 4, shorter: 1 });

  const responses = [];
  const run = async (message) => responses.push(await send(message));
  await run({ type: 'site:hello' });
  await run({ type: 'site:get' });
  await run({ type: 'site:set', section: 'display', patch: { theme: 'dark' } });
  await run({ type: 'site:set', section: 'language', patch: { myLanguage: 'en' } });
  await run({ type: 'site:set', section: 'profile', patch: { collabStyleId: 'brief' } });
  await run({ type: 'site:set', section: 'identity', patch: { displayName: '나' } });
  await run({ type: 'site:glossary:add', entry: { sourceText: '배포', targetText: 'deploy', keepSource: false, language: null } });
  const id = responses.at(-1).glossary[0].id;
  await run({ type: 'site:glossary:update', id, patch: { targetText: 'rollout' } });
  await run({ type: 'site:glossary:remove', id });
  await run({ type: 'site:learned:remove', categoryId: 'shorter' });
  await run({ type: 'site:learned:clear' });
  await run({ type: 'site:set', section: 'snippets', patch: {} });
  await run({ type: 'site:snippets:get' });

  assert.equal(responses.filter((response) => response.ok).length, 11, '정상 요청이 전부 성공해야 검사가 의미 있다');
  const serialized = JSON.stringify(responses);
  assert.ok(!serialized.includes('BRIDGESENTINELQX7'), `🔴 금지 키 값이 응답에 섞였다: ${serialized.slice(0, 300)}`);
  assert.ok(!serialized.includes('UIDSENTINELQX7'), '🔴 uid가 응답에 섞였다');

  // 금지 키는 건드려지지도 않았다.
  for (const key of EXCLUDED_KEYS.filter((k) => k !== STORAGE_KEYS.AUTH)) {
    assert.deepEqual(await getLocal(key), [{ id: 'x', text: sentinel(key) }], key);
  }
});

test('🔴 manifest는 externally_connectable 오리진을 config에서 파생한 값으로만 넣는다', () => {
  const manifest = readFileSync(new URL('../src/manifest.js', import.meta.url), 'utf8');
  assert.ok(manifest.includes('externally_connectable: { matches: SITE_EXTERNALLY_CONNECTABLE_MATCHES }'));
  assert.ok(!manifest.includes('localhost:5180'), 'manifest에 개발 오리진을 손으로 적었다');
});
