/**
 * 한도 폴오버 규칙 (2026-08-19 사용자 결정 ⓓ).
 *
 * 🔴 **여기서 검사하는 것은 「언제 넘기는가」이지 provider 구현이 아니다.** 실제 호출은
 *    네트워크가 필요하고 한도를 태운다 — 판정 규칙만 표로 고정해 둔다.
 * 🔴 규칙이 두 곳(`server/refine-proxy.js` · `functions/index.js`)에 있으므로, 같은 표를
 *    양쪽에서 지키는지 **여기 한 곳에서** 잠근다. 한쪽만 고치면 이 테스트가 깨진다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** 판정표를 코드로 옮긴 것 — 두 파일의 구현이 이 함수와 같아야 한다. */
function shouldFailover({ explicitProvider, fallback, fallbackReason, hasBackup }) {
  if (explicitProvider) return false;
  if (!hasBackup) return false;
  if (!fallback) return false;
  return fallbackReason === 'quota';
}

test('🔴 폴오버 판정표 — 표에 없는 경우를 임의로 처리하지 않는다', () => {
  const rows = [
    // [명시 provider, fallback, 사유, 예비 있음] → 넘기는가
    [false, true, 'quota', true, true], //  한도 + 예비 있음 → 넘긴다
    [false, true, 'error', true, false], // 네트워크 오류 → 두 번 불러도 같다
    [false, true, 'invalid', true, false], // 형식 오류 → 같은 이유로 또 실패한다
    [false, false, null, true, false], //   성공 → 부를 이유가 없다
    [false, true, 'quota', false, false], // 예비 키 없음 → 부를 곳이 없다
    [true, true, 'quota', true, false], //  명시 요청 → 조용히 바꾸지 않는다
  ];
  for (const [explicitProvider, fallback, fallbackReason, hasBackup, expected] of rows) {
    assert.equal(
      shouldFailover({ explicitProvider, fallback, fallbackReason, hasBackup }),
      expected,
      `명시=${explicitProvider} fallback=${fallback}(${fallbackReason}) 예비=${hasBackup}`,
    );
  }
});

test('🔴 네 코어가 모두 같은 사유 문자열 `quota`를 쓴다 — 하나라도 다르면 폴오버가 조용히 죽는다', () => {
  for (const core of ['refine', 'decode', 'decisions', 'reply']) {
    const source = readFileSync(new URL(`../src/core/${core}/fallback.js`, import.meta.url), 'utf8');
    assert.match(source, /QUOTA:\s*'quota'/, `${core}의 QUOTA 값이 다르다`);
  }
});

test('🔴 두 서버가 모두 폴오버를 갖고 있다 — 한쪽만 고치면 "로컬에선 되는데 배포하면 다르다"', () => {
  for (const file of ['../server/refine-proxy.js', '../functions/index.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /runWithFailover/, `${file}에 폴오버가 없다`);
    assert.match(source, /providerUsed/, `${file}이 어느 provider가 답했는지 남기지 않는다`);
    assert.match(source, /fallbackReason !== 'quota'/, `${file}이 한도 이외에도 넘긴다`);
  }
});

test('🔴 캐시 수명 상한 6시간 — 두 서버 모두', () => {
  for (const file of ['../server/refine-proxy.js', '../functions/index.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /CACHE_TTL_MAX_MS = 6 \* 60 \* 60 \* 1000/, `${file}에 상한이 없다`);
    assert.match(source, /SAI_CACHE_TTL_MS/, `${file}이 환경변수를 읽지 않는다`);
  }
});
