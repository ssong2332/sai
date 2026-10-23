/**
 * 확장 버전 — `package.json`과 `src/manifest.js`가 같은 값인지 잠근다 (2026-10-23).
 *
 * 🔴 크롬 확장 카드에는 manifest 값이 뜬다. 둘 중 하나만 올리면 화면 숫자와 릴리스가 어긋나
 *    「다시 로드」가 반영됐는지 확인할 수 없게 된다(CLAUDE.md 「버전 규칙」).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('🔴 package.json과 manifest의 version이 같다', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const manifestSource = readFileSync(new URL('../src/manifest.js', import.meta.url), 'utf8');
  const match = /\bversion:\s*'([0-9.]+)'/.exec(manifestSource);
  assert.ok(match, 'manifest.js에서 version을 찾지 못했다');
  assert.equal(match[1], pkg.version);
});

test('크롬이 받는 형식 — 숫자와 점만, 최대 4개 구간', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.version, /^\d+(\.\d+){0,3}$/);
});
