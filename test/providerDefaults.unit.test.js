/**
 * provider 기본 순서 — 다섯 곳이 같아야 한다 (L03 2026-10-01 → 2026-10-23 anthropic → groq).
 *
 * 🔴 이 테스트가 지키는 것: **Claude(anthropic)가 기본**이고 예비는 groq뿐이며(Spec §0, 사용자 결정 (b) —
 *    Gemini 무료 티어는 입력을 학습에 쓴다), 서버 판정·폴오버 사슬·로컬 프록시·회귀 러너·Worker·health가
 *    **같은 함수(`pickDefaultProvider`)·같은 순서**를 쓴다. 한 곳만 다르면 「로컬에선 되는데 배포하면 다르다」가
 *    시작된다(CLAUDE.md 「셋의 기본값 순서는 항상 같아야 한다」).
 * 🔴 그리고 확장이 provider를 **강제하지 않는다** — 강제(명시 요청)는 서버 폴오버를 끈다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_PROVIDER_ORDER, FAILOVER_CHAIN, pickDefaultProvider } from '../src/core/refine/failover.js';
import { CHAIN_PROVIDERS, healthPayload } from '../functions/health.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('🔴 기본 순서는 anthropic → groq — gemini·openai는 사슬 밖', () => {
  assert.deepEqual(DEFAULT_PROVIDER_ORDER, ['anthropic', 'groq']);
  assert.equal(FAILOVER_CHAIN[0].provider, 'anthropic');
  for (const outside of ['gemini', 'openai']) {
    assert.ok(!DEFAULT_PROVIDER_ORDER.includes(outside), `${outside}가 기본 순서에 들어갔다`);
  }
});

test('🔴 기본값 판정표 — 키가 있는 첫 provider, 없으면 null(사슬 밖으로 대체하지 않는다)', () => {
  // [키가 있는 provider들, 결과]
  const rows = [
    [['anthropic', 'groq', 'gemini', 'openai'], 'anthropic'],
    [['anthropic'], 'anthropic'],
    [['groq', 'gemini'], 'groq'], //   ANTHROPIC 키 없음 → groq
    [['gemini', 'openai'], null], //   🔴 사슬 키가 없으면 null — gemini로 내려가지 않는다
    [[], null],
  ];
  for (const [keys, expected] of rows) {
    assert.equal(pickDefaultProvider((name) => keys.includes(name)), expected, `키=${keys.join(',') || '없음'}`);
  }
});

test('🔴 로컬 프록시·회귀 러너·Worker — 같은 함수로 고르고, 옛 삼항 순서가 남아 있지 않다', () => {
  for (const file of ['../server/refine-proxy.js', '../scripts/refine-live.js', '../workers/refine/src/handler.js']) {
    const source = read(file);
    assert.match(source, /pickDefaultProvider\(/, `${file}이 공용 기본값 함수를 쓰지 않는다`);
    assert.doesNotMatch(source, /process\.env\.(GEMINI|OPENAI)_API_KEY \? '/, `${file}에 옛 삼항 순서가 남았다`);
  }
});

test('🔴 서버 판정(Functions) — 공용 함수로 고르고, 임시 기본은 사슬 키가 없을 때만', () => {
  const source = read('../functions/index.js');
  const pick = source.indexOf('const provider = pickDefaultProvider((name) => Boolean(keyFor(name)));');
  const interim = source.indexOf('const interim = keyFor(INTERIM_DEFAULT_PROVIDER);');
  assert.ok(pick > 0, 'Functions가 pickDefaultProvider로 고르지 않는다');
  assert.ok(interim > pick, '임시 기본(gemini)이 사슬 판정보다 먼저 온다 — 사슬 키를 등록해도 gemini가 쓰인다');
  assert.match(source, /const INTERIM_DEFAULT_PROVIDER = 'gemini';/);
  assert.doesNotMatch(source, /if \(gemini\) return \{ provider: 'gemini'/, '옛 순서(gemini 먼저)가 남아 있다');
});

test('🔴 Functions — 등록 안 된 시크릿(ANTHROPIC·GROQ)을 defineSecret하지 않는다(배포가 죽는다)', () => {
  const source = read('../functions/index.js');
  const live = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  const defined = [...live.matchAll(/defineSecret\('([A-Z_]+)'\)/g)].map((m) => m[1]).sort();
  // 🔴 시크릿을 새로 등록했으면 이 목록을 함께 고친다 — 등록이 먼저다(functions/index.js 헤더).
  assert.deepEqual(defined, ['GEMINI_API_KEY', 'OPENAI_API_KEY']);
});

test('health의 보고 순서도 사슬 순서가 먼저다', () => {
  assert.deepEqual(CHAIN_PROVIDERS, DEFAULT_PROVIDER_ORDER, 'functions/health.js의 사슬 사본이 어긋났다');
  const body = healthPayload({
    selected: { provider: 'anthropic' },
    keys: { openai: 'x', gemini: 'y', groq: 'z', anthropic: 'w' },
  });
  assert.deepEqual(body.availableProviders, ['anthropic', 'groq', 'gemini', 'openai']);
});

test('🔴 확장이 provider를 강제하지 않는다 — 강제하면 서버 폴오버가 꺼진다', () => {
  const background = read('../src/background/index.js');
  assert.doesNotMatch(background, /TEMP_FORCE_PROVIDER\s*=/);
  assert.doesNotMatch(background, /provider:\s*['"](gemini|openai|anthropic|groq)['"]/);
});
