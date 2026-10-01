/**
 * provider 기본 순서 — 네 곳이 같아야 한다 (L03, 2026-10-01).
 *
 * 🔴 이 테스트가 지키는 것: **gemini가 기본**이고(Spec §0), 서버 판정·폴오버 사슬·로컬 프록시·회귀 러너·
 *    health가 **같은 순서**를 쓴다. 한 곳만 openai를 먼저 보면 「로컬에선 되는데 배포하면 다르다」가
 *    시작된다(CLAUDE.md 「셋의 기본값 순서는 항상 같아야 한다」).
 * 🔴 그리고 확장이 provider를 **강제하지 않는다** — 강제(명시 요청)는 서버 폴오버를 끈다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FAILOVER_CHAIN } from '../src/core/refine/failover.js';
import { healthPayload } from '../functions/health.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('🔴 폴오버 사슬 1번이 gemini다', () => {
  assert.equal(FAILOVER_CHAIN[0].provider, 'gemini');
});

test('🔴 서버 판정 — 미지정이면 gemini를 먼저 본다', () => {
  const source = read('../functions/index.js');
  const geminiFirst = source.indexOf("if (gemini) return { provider: 'gemini', apiKey: gemini };");
  // 🔴 같은 문장이 위쪽 「명시 openai」 줄에도 있다 — gemini 줄 **뒤에서** 찾는다.
  const openaiAfter = source.indexOf("return openai ? { provider: 'openai', apiKey: openai } : null;", geminiFirst);
  assert.ok(geminiFirst > 0 && openaiAfter > geminiFirst, '미지정 기본 순서가 gemini → openai가 아니다');
  assert.doesNotMatch(source, /if \(openai\) return \{ provider: 'openai'/, '옛 순서(openai 먼저)가 남아 있다');
});

test('🔴 로컬 프록시·회귀 러너 — GEMINI 키가 있으면 gemini가 기본', () => {
  for (const file of ['../server/refine-proxy.js', '../scripts/refine-live.js']) {
    const source = read(file);
    assert.match(source, /process\.env\.GEMINI_API_KEY \? 'gemini' : 'openai'/, `${file}의 기본 순서가 다르다`);
    assert.doesNotMatch(source, /process\.env\.OPENAI_API_KEY \? 'openai' : 'gemini'/, `${file}에 옛 순서가 남았다`);
  }
});

test('health의 보고 순서도 gemini가 먼저다', () => {
  const body = healthPayload({ selected: { provider: 'gemini' }, keys: { openai: 'x', gemini: 'y' } });
  assert.deepEqual(body.availableProviders, ['gemini', 'openai']);
});

test('🔴 확장이 provider를 강제하지 않는다 — 강제하면 서버 폴오버가 꺼진다', () => {
  const background = read('../src/background/index.js');
  assert.doesNotMatch(background, /TEMP_FORCE_PROVIDER\s*=/);
  assert.doesNotMatch(background, /provider:\s*['"](gemini|openai)['"]/);
});
