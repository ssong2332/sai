/**
 * Cloud Functions CORS 오리진 (L12 — 2026-09-30).
 *
 * 🔴 이 테스트가 지키는 것: **모든 함수가 확장 오리진만 허용한다** — `cors: true`(전체 허용)가
 *    다시 들어오지 않는다. CORS는 보안 장치가 아니지만(curl은 무시한다), 다른 웹사이트의 JS가
 *    사용자 브라우저에서 우리 함수를 부르는 길은 닫는다.
 * 🔴 그리고 **그 오리진이 실제 확장 ID와 같다** — `functions/index.js`의 `EXTENSION_ID`가
 *    `src/manifest.js`의 `key`에서 나오는 ID와 어긋나면 확장 호출이 전부 CORS로 막힌다.
 *    `functions/index.js`는 firebase-admin을 초기화하므로 import하지 않고 소스를 읽는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const functionsSource = read('../functions/index.js');
const manifestSource = read('../src/manifest.js');

/** 크롬 확장 ID = manifest `key`(DER 공개키)의 SHA-256 앞 32 hex를 0-f → a-p로 옮긴 값. */
function extensionIdFromKey(base64Key) {
  const hex = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex');
  return [...hex.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

test('🔴 cors: true(전체 허용)가 없다', () => {
  assert.equal(/cors:\s*true/.test(functionsSource), false);
});

test('🔴 모든 cors 설정이 확장 오리진 하나다', () => {
  const settings = functionsSource.match(/cors:\s*(\[[^\]]*\]|\w+|'[^']*')/g) ?? [];
  assert.ok(settings.length >= 3, `cors 설정이 ${settings.length}개뿐이다 (refineV1·teamV1·health)`);
  for (const setting of settings) {
    assert.equal(setting.replace(/\s+/g, ' '), 'cors: [`chrome-extension://${EXTENSION_ID}`]');
  }
});

test('🔴 EXTENSION_ID가 manifest key에서 나오는 확장 ID와 같다', () => {
  const key = manifestSource.match(/key: '([^']+)'/)?.[1];
  const declared = functionsSource.match(/const EXTENSION_ID = '([a-p]{32})'/)?.[1];
  assert.ok(key, 'manifest에서 key를 찾지 못했다');
  assert.ok(declared, 'functions/index.js에서 EXTENSION_ID를 찾지 못했다');
  assert.equal(extensionIdFromKey(key), declared);
});
