/**
 * 한도 폴오버 규칙 (2026-08-19 사용자 결정 ⓓ).
 *
 * 🔴 **여기서 검사하는 것은 「언제 넘기는가」이지 provider 구현이 아니다.** 실제 호출은
 *    네트워크가 필요하고 한도를 태운다 — 판정 규칙만 표로 고정해 둔다.
 * 🔴 규칙이 세 곳(`server/refine-proxy.js` · `functions/index.js` · `workers/refine/src/handler.js`)에 있으므로,
 *    같은 표를 모두 지키는지 **여기 한 곳에서** 잠근다. 한쪽만 고치면 이 테스트가 깨진다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** 판정표를 코드로 옮긴 것 — 두 파일의 구현이 이 함수와 같아야 한다. */
function shouldFailover({ explicitProvider, fallback, fallbackReason, hasBackup }) {
  if (explicitProvider) return false;
  if (!hasBackup) return false;
  if (!fallback) return false;
  return fallbackReason === 'quota' || fallbackReason === 'auth';
}

test('🔴 폴오버 판정표 — 표에 없는 경우를 임의로 처리하지 않는다', () => {
  const rows = [
    // [명시 provider, fallback, 사유, 예비 있음] → 넘기는가
    [false, true, 'quota', true, true], //  한도 + 예비 있음 → 넘긴다
    [false, true, 'auth', true, true], //   키 무효 + 예비 있음 → 넘긴다 (L15, 2026-10-12 — 키는 provider마다 따로)
    [true, true, 'auth', true, false], //   키 무효라도 명시 요청이면 바꾸지 않는다
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

test('🔴 네 코어가 모두 같은 사유 문자열 `quota`·`auth`를 쓴다 — 하나라도 다르면 폴오버가 조용히 죽는다', () => {
  for (const core of ['refine', 'decode', 'decisions', 'reply']) {
    const source = readFileSync(new URL(`../src/core/${core}/fallback.js`, import.meta.url), 'utf8');
    assert.match(source, /QUOTA:\s*'quota'/, `${core}의 QUOTA 값이 다르다`);
    assert.match(source, /AUTH:\s*'auth'/, `${core}의 AUTH 값이 다르다`);
  }
});

test('🔴 실제 판정 함수 `shouldFailOver`가 위 표와 같다', async () => {
  const { shouldFailOver } = await import('../src/core/refine/failover.js');
  for (const reason of ['quota', 'auth', 'error', 'invalid', undefined]) {
    assert.equal(
      shouldFailOver({ fallback: true, fallbackReason: reason }),
      shouldFailover({ explicitProvider: false, fallback: true, fallbackReason: reason, hasBackup: true }),
      `사유 ${reason}`,
    );
  }
  assert.equal(shouldFailOver({ fallback: false, fallbackReason: 'quota' }), false, '성공인데 넘긴다');
  assert.equal(shouldFailOver(null), false);
});

// 🔴 2026-10-23 — Worker(`workers/refine/src/handler.js`)도 같은 규칙을 갖는다(세 서버).
const SERVERS = ['../server/refine-proxy.js', '../functions/index.js', '../workers/refine/src/handler.js'];

test('🔴 세 서버가 모두 폴오버를 갖고 있다 — 한쪽만 고치면 "로컬에선 되는데 배포하면 다르다"', () => {
  for (const file of SERVERS) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /runWithFailover/, `${file}에 폴오버가 없다`);
    assert.match(source, /providerUsed/, `${file}이 어느 provider가 답했는지 남기지 않는다`);
    // 🔴 사유 비교는 `failover.js`의 `shouldFailOver` 한 곳에서만 — 서버가 문자열을 각자 비교하면 어긋난다.
    assert.match(source, /if \(!shouldFailOver\(result\)\) break;/, `${file}이 공용 판정을 쓰지 않는다`);
    assert.doesNotMatch(source, /fallbackReason !== '/, `${file}이 사유를 직접 비교한다`);
  }
});

test('🔴 캐시 수명 상한 6시간 — 두 서버 모두', () => {
  for (const file of ['../server/refine-proxy.js', '../functions/index.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /CACHE_TTL_MAX_MS = 6 \* 60 \* 60 \* 1000/, `${file}에 상한이 없다`);
    assert.match(source, /SAI_CACHE_TTL_MS/, `${file}이 환경변수를 읽지 않는다`);
  }
});

/* ── 사슬 (2026-08-20 확장) ─────────────────────────────────────────── */

/**
 * 🔴 **예비가 «하나」가 아니라 «사슬»이 됐다.** 근거는 실측이다 — 한도는 **모델별로 따로**라
 *    gpt-4o가 바닥나도 같은 키의 gpt-4.1은 별도 50건을 갖는다.
 * 🔴 표는 **한 파일**(`src/core/refine/failover.js`)에만 있다. 두 서버가 각각 적으면 어긋나고,
 *    그 증상이 「로컬에선 되는데 배포하면 다르다」다 — 그래서 두 서버가 그 파일을 **임포트하는지**
 *    까지 잠근다.
 */
test('🔴 폴오버 사슬 순서 — anthropic → groq (2026-10-23, 그전 10-01 L03은 gemini → openai → openai/gpt-4.1)', async () => {
  const { FAILOVER_CHAIN } = await import('../src/core/refine/failover.js');
  assert.deepEqual(FAILOVER_CHAIN, [
    { provider: 'anthropic', model: null },
    { provider: 'groq', model: null },
  ]);
});

test('🔴 Gemini·OpenAI는 사슬에 없다 — Gemini 무료 티어는 입력을 학습에 쓴다(사용자 결정 (b)), OpenAI 키는 무효', async () => {
  const { FAILOVER_CHAIN } = await import('../src/core/refine/failover.js');
  for (const outside of ['gemini', 'openai']) {
    assert.ok(!FAILOVER_CHAIN.some((step) => step.provider === outside), `사슬에 ${outside}가 있다`);
  }
});

test('🔴 gpt-5 계열은 사슬에 없다 — temperature 0을 거부해 결정성이 깨진다', async () => {
  const { FAILOVER_CHAIN } = await import('../src/core/refine/failover.js');
  for (const step of FAILOVER_CHAIN) {
    assert.doesNotMatch(String(step.model ?? ''), /^gpt-5/, `사슬에 gpt-5 계열이 있다: ${step.model}`);
  }
});

test('🔴 이미 쓴 단계는 다시 시도하지 않는다 — 같은 통에서 또 퍼내지 않게', async () => {
  const { remainingChain } = await import('../src/core/refine/failover.js');

  assert.deepEqual(remainingChain({ provider: 'anthropic', model: null }), [{ provider: 'groq', model: null }]);
  assert.deepEqual(remainingChain({ provider: 'groq', model: null }), [{ provider: 'anthropic', model: null }]);

  // 사슬 밖 provider(Functions 임시 기본 gemini · 명시 요청)에서 시작해도 규칙이 그대로 성립한다.
  assert.deepEqual(remainingChain({ provider: 'gemini', model: null }), [
    { provider: 'anthropic', model: null },
    { provider: 'groq', model: null },
  ]);
});

test('🔴 provider가 같아도 «모델»이 다르면 다른 단계다 — 놓치면 같은 provider의 다른 모델 단계가 건너뛰어진다', async () => {
  const { sameStep } = await import('../src/core/refine/failover.js');
  assert.equal(sameStep({ provider: 'openai', model: 'gpt-4.1' }, { provider: 'openai', model: null }), false);
  assert.equal(sameStep({ provider: 'anthropic', model: null }, { provider: 'anthropic' }), true);
});

test('🔴 세 서버가 사슬 «표»를 각자 적지 않고 같은 파일을 임포트한다', () => {
  for (const file of SERVERS) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /remainingChain/, `${file}이 사슬을 쓰지 않는다`);
    assert.match(source, /failover\.js/, `${file}이 사슬 표를 임포트하지 않는다`);
    assert.match(source, /modelUsed/, `${file}이 어느 «모델»이 답했는지 남기지 않는다`);
    // 🔴 표를 파일 안에 다시 적어 두면 드리프트가 되살아난다.
    assert.doesNotMatch(source, /FAILOVER_CHAIN\s*=/, `${file}이 사슬 표를 자체 정의한다`);
  }
});

test('🔴 사슬 단계의 모델이 provider로 전달된다 — 안 넘기면 3단계가 1단계와 같아진다', () => {
  const proxy = readFileSync(new URL('../server/refine-proxy.js', import.meta.url), 'utf8');
  const fns = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  // 🔴 프록시는 CLI `--model`이 creds를 덮던 버그가 있었다(2026-08-20). creds가 이겨야 한다.
  assert.match(proxy, /model: creds\.model \?\? model/, '프록시에서 CLI 플래그가 creds를 덮는다');
  assert.match(fns, /model: creds\.model/, 'Functions가 단계별 모델을 넘기지 않는다');
});
