/**
 * 공개 빌드의 host_permissions (L11 — 2026-09-30).
 *
 * 🔴 이 테스트가 지키는 것: **배포 함수를 가리키는 빌드에는 localhost 권한이 없다.**
 *    스토어 심사는 권한마다 사유를 묻는데, 쓰지 않는 `127.0.0.1` 권한은 댈 사유가 없다.
 * 🔴 그리고 2026-08-19에 막은 함정(엔드포인트만 로컬로 바꾸고 권한을 빠뜨려 조용히 전부 실패)이
 *    되살아나지 않는다 — 로컬을 가리키면 권한이 **자동으로** 붙는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEPLOYED_ENDPOINT,
  FEATURES,
  LOCAL_PROXY_ENDPOINT,
  LOCAL_PROXY_HOST_PERMISSIONS,
  REFINE_ENDPOINT,
  localProxyHostPermissions,
} from '../src/config.js';

const manifest = readFileSync(new URL('../src/manifest.js', import.meta.url), 'utf8');

test('🔴 기본 설정(배포 함수)에서는 localhost 권한이 없다', () => {
  assert.equal(REFINE_ENDPOINT, DEPLOYED_ENDPOINT, '공개 빌드는 배포 함수를 가리켜야 한다');
  assert.deepEqual(LOCAL_PROXY_HOST_PERMISSIONS, []);
});

test('🔴 로컬 프록시를 가리키면 그 오리진 권한이 자동으로 붙는다', () => {
  assert.deepEqual(localProxyHostPermissions(LOCAL_PROXY_ENDPOINT), ['http://127.0.0.1:8787/*']);
});

test('🔴 manifest에 localhost 권한을 손으로 적지 않는다 — config에서 파생한 값만 펼친다', () => {
  const hardcoded = manifest
    .split('\n')
    .filter((line) => /^\s*'http:\/\/(127\.0\.0\.1|localhost)/.test(line));
  assert.deepEqual(hardcoded, [], `손으로 적은 localhost 권한: ${hardcoded.join(' | ')}`);
  assert.ok(manifest.includes('...LOCAL_PROXY_HOST_PERMISSIONS'), 'manifest가 파생 권한을 펼치지 않는다');
});

test('🔴 GitHub 권한은 FEATURES.githubLookup이 켜졌을 때만 붙는다 (L17)', () => {
  const hardcoded = manifest
    .split('\n')
    .filter((line) => /^\s*'https:\/\/(api\.)?github\.com/.test(line));
  assert.deepEqual(hardcoded, [], `손으로 적은 GitHub 권한: ${hardcoded.join(' | ')}`);
  assert.ok(
    manifest.includes("...(FEATURES.githubLookup ? ['https://api.github.com/*', 'https://github.com/login/*'] : [])"),
    'GitHub 권한이 플래그에 묶여 있지 않다',
  );
});

test('🔴 공개 빌드 기본값 — 포인트·GitHub 불러오기는 꺼져 있다 (L17)', () => {
  assert.equal(FEATURES.points, false, '포인트는 사용처가 생길 때까지 끈다(Spec §0 유료화 나중)');
  assert.equal(FEATURES.githubLookup, false, 'GitHub 불러오기는 실확장 확인 전까지 끈다');
});

test('🔴 캘린더 — oauth2 블록과 www.googleapis.com 권한은 FEATURES.calendar에 묶여 있다 (L10)', () => {
  assert.equal(FEATURES.calendar, false, '캘린더는 구글 OAuth 검증 전까지 끈다(Spec §0)');
  const hardcoded = manifest.split('\n').filter((line) => /^\s*'https:\/\/www\.googleapis\.com\/\*'/.test(line));
  assert.deepEqual(hardcoded, [], '캘린더 권한이 손으로 적혀 있다');
  assert.ok(manifest.includes("...(FEATURES.calendar ? ['https://www.googleapis.com/*'] : [])"));
  assert.match(manifest, /\.\.\.\(FEATURES\.calendar\s*\?\s*\{\s*oauth2:/, 'oauth2 블록이 플래그에 묶여 있지 않다');
});

test('🔴 로그인에 필요한 identity 권한은 캘린더와 무관하게 남는다 (L10)', () => {
  assert.match(manifest, /'identity',/);
});
