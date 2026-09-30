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
