/**
 * 단축키 명령 계약 (2026-08-19 — 「저장 문구 열기」 추가).
 *
 * 🔴 이 테스트가 지키는 것: **manifest·background·콘텐츠 스크립트 셋이 같은 문자열을 쓴다.**
 *    한 곳만 고치면 단축키가 «조용히» 아무 일도 하지 않는다 — 오류도 안 나서 가장 찾기 어렵다.
 * 🔴 크롬은 확장당 기본 단축키를 **4개까지만** 준다. 넘으면 나머지는 조용히 비워진다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = read('../src/manifest.js');
const background = read('../src/background/index.js');
const overlay = read('../src/content/SaiOverlay.jsx');

const COMMANDS = ['_execute_action', 'refine-selection', 'open-snippets'];

test('🔴 manifest에 세 명령이 모두 있다', () => {
  for (const name of COMMANDS) {
    assert.ok(manifest.includes(name), `manifest에 ${name}이 없다`);
  }
});

test('🔴 기본 단축키가 4개를 넘지 않는다 — 넘으면 크롬이 조용히 비워 둔다', () => {
  const keys = manifest.match(/suggested_key: \{ default: '[^']+' \}/g) ?? [];
  assert.ok(keys.length <= 4, `기본 단축키가 ${keys.length}개다`);
});

test('🔴 기본 단축키가 서로 겹치지 않는다', () => {
  const keys = (manifest.match(/default: '(Alt\+[A-Z])'/g) ?? []).map((m) => m.slice(10, -1));
  assert.equal(keys.length, new Set(keys).size, `겹치는 단축키가 있다: ${keys.join(', ')}`);
});

test('🔴 크롬이 이미 쓰는 조합을 피한다 — Alt+F/Alt+E는 크롬 메뉴다', () => {
  const keys = (manifest.match(/default: '(Alt\+[A-Z])'/g) ?? []).map((m) => m.slice(10, -1));
  for (const reserved of ['Alt+F', 'Alt+E']) {
    assert.ok(!keys.includes(reserved), `${reserved}는 크롬 메뉴와 겹친다`);
  }
});

test('🔴 background가 전달하는 명령과 콘텐츠 스크립트가 받는 명령이 같다', () => {
  for (const name of ['refine-selection', 'open-snippets']) {
    assert.ok(background.includes(`'${name}'`), `background가 ${name}을 모른다`);
    assert.ok(overlay.includes(`'${name}'`), `콘텐츠 스크립트가 ${name}을 안 받는다`);
  }
});

test('🔴 표에 없는 명령은 전달하지 않는다', () => {
  assert.match(background, /FORWARDED_COMMANDS/, '명령 화이트리스트가 없다');
});
