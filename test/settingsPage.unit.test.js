/**
 * 확장 설정 페이지 계약 (2026-10-25 — 자세한 설정을 확장 안 페이지로).
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① manifest가 설정 페이지를 `options_ui`(탭으로 열기)로 싣는다 — chrome://extensions 「옵션」이 같은 페이지를 연다.
 *    ② 사이드패널 「자세한 설정」이 그 페이지를 연다. 사이트 개발 빌드 전용 「웹에서 열기」는 없다.
 *    ③ 사이드패널 설정 시트에는 필수만 — 옮긴 토글의 저장 키를 시트가 더는 쓰지 않는다(두 곳에서 다른 기본값을 쓰는 일 방지).
 *    ④ 표시 설정 기본값 표가 팝업 기본값과 같다(웹 브리지 표와도 같다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DISPLAY_SETTINGS, coerceDisplayValue, readDisplaySettings, writeDisplaySetting } from '../src/lib/displaySettings.js';
import { clearAllLocal, getLocal, STORAGE_KEYS, THREAD_CONTEXT_DEFAULT } from '../src/lib/storage.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = read('../src/manifest.js');
const panel = read('../src/sidepanel/App.jsx');
const page = read('../src/settings/App.jsx');

test('🔴 manifest — 설정 페이지를 탭으로 여는 options_ui', () => {
  assert.match(manifest, /options_ui:\s*\{\s*page:\s*'src\/settings\/index\.html',\s*open_in_tab:\s*true,?\s*\}/);
});

test('🔴 사이드패널 — 「자세한 설정」이 확장 설정 페이지를 연다', () => {
  assert.ok(panel.includes('chrome.runtime.openOptionsPage()'));
  assert.ok(panel.includes("chrome.runtime.getURL('src/settings/index.html')"), 'openOptionsPage 실패 시 같은 페이지로');
  assert.equal(panel.includes('SITE_URL'), false, '사이트 개발 빌드 전용 「웹에서 열기」가 남아 있다');
  assert.equal(panel.includes('웹에서 열기'), false);
});

test('🔴 사이드패널 시트 — 옮긴 토글의 저장 키를 더는 쓰지 않는다', () => {
  for (const key of ['BACK_TRANSLATION', 'HIGHLIGHT_HINTS', 'REFINE_REASONING', 'THREAD_CONTEXT', 'SNIPPET_INSERT_MODE']) {
    assert.equal(new RegExp(`STORAGE_KEYS\\.${key}\\b`).test(panel), false, `사이드패널이 아직 ${key}를 쓴다`);
  }
  assert.equal(panel.includes('chrome://extensions/shortcuts'), false, '단축키 카드는 설정 페이지로 옮겼다');
  // 남긴 필수: 다크 모드 · 「보내는 글 기본값」(상대 지역 · 기본 톤) · 자세한 설정
  for (const text of ['다크 모드', '보내는 글 기본값', 'label="상대 지역"', 'label="기본 톤"', '자세한 설정']) {
    assert.ok(panel.includes(text), `시트에 ${text}가 없다`);
  }
});

test('🔴 「나」와 「보내는 글 기본값」 — 같은 값이 한 화면에 두 번 없다(2026-10-25)', () => {
  // 사이드패널 시트에는 내 언어가 없다(프로필 › 내 정보에만).
  const sheet = panel.slice(panel.indexOf('function SettingsTab('), panel.indexOf('/* ── 홈 — 온보딩 결과'));
  assert.ok(sheet.length > 0);
  assert.equal(sheet.includes('label="내 언어"'), false, '시트에 내 언어가 남아 있다');
  assert.ok(sheet.includes('보내는 글 기본값'));
  assert.ok(sheet.includes('label="상대 지역"') && sheet.includes('label="기본 톤"'));
  assert.equal(sheet.includes('언어와 톤'), false);

  // 설정 페이지: 내 언어는 「나」 패널에만, 상대 지역·기본 톤은 「보내는 글 기본값」에만.
  const me = page.slice(page.indexOf('function MePanel('), page.indexOf('/* ── 용어집'));
  const send = page.slice(page.indexOf('function LanguagePanel('), page.indexOf('/* ── 나 '));
  assert.ok(me.length > 0 && send.length > 0);
  assert.equal((page.match(/label="내 언어"/g) ?? []).length, 1);
  assert.ok(me.includes('label="내 언어"'));
  assert.ok(me.indexOf('label="내 언어"') < me.indexOf('label="표시 이름"'), '내 언어가 「나」 맨 위가 아니다');
  assert.equal(send.includes('label="내 언어"'), false);
  assert.ok(send.includes('label="상대 지역"') && send.includes('label="기본 톤"'));
  assert.equal(me.includes('label="상대 지역"') || me.includes('label="기본 톤"'), false);
  // 해시 id는 그대로 — 예전 #language 링크가 계속 맞는다.
  assert.ok(page.includes("{ id: 'language', label: '보내는 글 기본값'"));
});

test('🔴 설정 페이지 — 사이트 끄기 안내가 「단축키는 산다」를 말한다', () => {
  assert.equal(page.includes('사이 버튼·팝업·단축키가 반응하지 않아요'), false);
  assert.equal(page.includes('사이 버튼과 팝업이 뜨지 않아요'), false);
  assert.ok((page.match(/단축키\(Alt\+D 등\)로는 그대로 쓸 수 있어요/g) ?? []).length >= 2);
});

test('🔴 설정 페이지 — 단축키 변경은 chrome.tabs.create로 연다(<a href>는 크롬이 막는다)', () => {
  assert.ok(page.includes("openTab('chrome://extensions/shortcuts')"));
  assert.ok(page.includes('chrome.tabs.create'));
  assert.equal(/href=["']chrome:\/\//.test(page), false);
  assert.ok(page.includes('chrome.commands'), '실제 할당값을 읽는다');
  assert.ok(page.includes('지정 안 됨'), '크롬이 비워 둔 단축키를 숨기지 않는다');
});

test('🔴 설정 페이지 — 학습 내역 삭제는 서버 기록을 바로 지운다(사이드패널과 같은 판정)', () => {
  assert.ok(page.includes('flushLearnedDeletions'));
  assert.ok(page.includes('SYNC_ERRORS.NOT_SIGNED_IN'));
});

test('표시 설정 기본값 — 팝업이 읽는 기본값과 같다', () => {
  const fallbacks = Object.fromEntries(Object.entries(DISPLAY_SETTINGS).map(([field, spec]) => [field, spec.fallback]));
  assert.deepEqual(fallbacks, {
    theme: 'light',
    backTranslation: true,
    refineReasoning: false,
    highlightHints: false,
    threadContext: THREAD_CONTEXT_DEFAULT,
    threadContextPreview: false,
    replyAuto: false,
    snippetInsertMode: 'replace',
    quality: 'standard', // 2026-10-30 품질 모드 — 표 밖 값은 기본 모드(`quality.unit.test.js`)
  });
  assert.equal(coerceDisplayValue('theme', 'purple'), 'light');
  assert.equal(coerceDisplayValue('backTranslation', 'yes'), true);
});

test('표시 설정 쓰기 — 형식 밖 값은 쓰지 않는다', async () => {
  await clearAllLocal();
  await writeDisplaySetting('theme', 'dark');
  await writeDisplaySetting('snippetInsertMode', 'append');
  assert.equal(await getLocal(STORAGE_KEYS.THEME), 'dark');
  await assert.rejects(() => writeDisplaySetting('theme', 'purple'));
  await assert.rejects(() => writeDisplaySetting('backTranslation', 'on'));
  await assert.rejects(() => writeDisplaySetting('nope', true));
  const all = await readDisplaySettings();
  assert.equal(all.theme, 'dark');
  assert.equal(all.snippetInsertMode, 'append');
  assert.equal(all.threadContext, THREAD_CONTEXT_DEFAULT);
});

test('🔴 설정 페이지는 웹 브리지를 거치지 않는다', () => {
  assert.equal(/from '[^']*siteBridge/.test(page), false);
  assert.equal(/from '[^']*bridge\.js'/.test(page), false);
  assert.equal(page.includes('handleSiteMessage'), false);
});
