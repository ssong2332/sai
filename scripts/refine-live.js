#!/usr/bin/env node
/**
 * `/v1/refine` 실 API 통합 러너 — 선별 20건(`test/refine.cases.js`)을 실제 LLM 호출로 돌린다.
 *
 * 사용:
 *   ANTHROPIC_API_KEY=... node scripts/refine-live.js               # 기본 (Spec §0 — Claude)
 *   GEMINI_API_KEY=... node scripts/refine-live.js --provider gemini  # 사슬 밖 provider는 명시
 *   [--bypass-cache] [--model <이름>] [--delay <ms>]
 *
 * 🔴 `--delay <ms>`: 건 사이 대기(2026-10-23 추가). Gemini 무료 티어·OpenAI TPM처럼 **분당 한도**가 있는
 *    provider는 연달아 부르면 중간부터 429가 난다(CLAUDE.md — 건당 15초 간격 권장).
 *
 * 🔴 provider 기본값 — **키가 있는 사슬 첫 provider**(2026-10-23: anthropic → groq. 그전: 10-01 L03 gemini 먼저,
 *    08-17~09-30 OpenAI 먼저). `failover.js` `pickDefaultProvider` 하나로 고르며 Functions·프록시·Worker와 같다.
 *    셋 중 하나만 바꾸면 "로컬에선 되는데 배포하면 다르다"가 시작된다 — 실제로 Gemini
 *    시절 역번역 문제를 그 계열로 4번 오진했다.
 * 🔴 키가 없으면 **실행하지 않고 종료 코드 2로 끝난다.** 미실행을 "통과"로 기록하지 않기 위함이다
 *    (`docs/reference/TestCases-legacy.md` 금지 2행).
 * 🔴 여기 쓰이는 입력은 전부 레거시 문서의 합성 테스트 문장이며 실제 사용자 메시지가 아니다.
 */

import { refine, MemoryCacheStore, PROVIDERS } from '../src/core/refine/index.js';
import { REFINE_CASES, judgeCase } from '../test/refine.cases.js';
// L30 — Claude 실제 사용 토큰(숫자만). 다른 provider는 집계하지 않는다.
import { anthropicUsage } from '../src/core/refine/providers/anthropic.js';
import { DEFAULT_PROVIDER_ORDER, pickDefaultProvider } from '../src/core/refine/failover.js';
import { QUALITY_MODES } from '../src/core/refine/quality.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const bypassCache = args.includes('--bypass-cache');
// 2026-10-30 품질 모드 — `--quality <fast|standard|deep>`은 서버와 같은 표(`quality.js`)를 쓴다.
//    후보 탐색용 `--model`·`--thinking`·`--effort`가 있으면 표 값보다 이긴다.
const qualityName = flag('--quality');
if (qualityName && !QUALITY_MODES[qualityName]) {
  console.error(`알 수 없는 품질 모드: ${qualityName} (가능: ${Object.keys(QUALITY_MODES).join(', ')})`);
  process.exit(2);
}
const qualityConfig = qualityName ? QUALITY_MODES[qualityName] : {};
const model = flag('--model') ?? qualityConfig.model;
const thinking = flag('--thinking') ?? qualityConfig.thinking;
const effort = flag('--effort') ?? qualityConfig.effort;
const timeoutMs = qualityConfig.timeoutMs;
const delayMs = Number(flag('--delay') ?? 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 🔴 2026-10-23 — 키가 있는 사슬 첫 provider(배포본·프록시·Worker와 같은 함수, `test/providerDefaults.unit.test.js`).
//    둘 다 없으면 anthropic으로 두고 아래에서 exit 2 — 사슬 밖으로 조용히 내려가지 않는다.
const providerName =
  flag('--provider') ??
  pickDefaultProvider((name) => Boolean(process.env[PROVIDERS[name]?.envKey])) ??
  DEFAULT_PROVIDER_ORDER[0];

const provider = PROVIDERS[providerName];
if (!provider) {
  console.error(`알 수 없는 provider: ${providerName} (가능: ${Object.keys(PROVIDERS).join(', ')})`);
  process.exit(2);
}

const apiKey = process.env[provider.envKey];
if (!apiKey) {
  console.error(`${provider.envKey}가 없어 실행하지 않습니다. 20건은 "미실행(-)"으로 남습니다.`);
  console.error(`실행:  ${provider.envKey}=... node scripts/refine-live.js --provider ${providerName}`);
  process.exit(2);
}

const cache = new MemoryCacheStore();
const rows = [];
let passed = 0;
let fellBack = 0;

let calls = 0;
for (const testCase of REFINE_CASES) {
  if (testCase.skip) {
    rows.push({ id: testCase.id, field: testCase.field, result: '제외', detail: testCase.skipReason ?? '' });
    continue;
  }

  if (delayMs > 0 && calls > 0) await sleep(delayMs);
  calls += 1;
  const startedAt = Date.now();
  let result;
  try {
    result = await refine(
      { ...testCase.request, bypassCache },
      { apiKey, provider: providerName, model, cache, thinking, effort, timeoutMs },
    );
  } catch (error) {
    rows.push({ id: testCase.id, field: testCase.field, result: 'ERROR', detail: error.message, ms: Date.now() - startedAt });
    continue;
  }
  const latencyMs = Date.now() - startedAt;

  // 폴백 응답은 실제 판정 결과가 아니다 — 통과로 세지 않는다.
  if (result.fallback) {
    fellBack += 1;
    rows.push({
      id: testCase.id,
      field: testCase.field,
      result: '폴백',
      detail: `${result.fallbackReason}${result.fallbackDetail ? ` — ${result.fallbackDetail}` : ''}`,
      ms: latencyMs,
    });
    continue;
  }

  const { pass, failures } = judgeCase(testCase, result);
  if (pass) passed += 1;
  rows.push({ id: testCase.id, field: testCase.field, result: pass ? 'PASS' : 'FAIL', detail: failures.join('; '), ms: latencyMs });
}

console.log(
  `\nprovider=${providerName}  model=${model ?? provider.defaultModel}  bypassCache=${bypassCache}\n`,
);
console.log('| ID | 검증 필드 | 결과 | ms | 실패 사유 |');
console.log('|---|---|---|---|---|');
for (const row of rows) {
  console.log(`| ${row.id} | ${row.field} | ${row.result} | ${row.ms ?? '-'} | ${row.detail || ''} |`);
}

const attempted = rows.filter((row) => row.result !== '제외').length;
console.log(`\n결과: ${passed}/${attempted} 통과 · 폴백 ${fellBack}건`);

/**
 * 🔴 실제 사용량·비용 (2026-10-23 L30). 단가는 2026-10-23 공식 요금표의 Claude Haiku 5.5(프롬프트 10만 토큰 이하)
 *    입력 $0.10 · 출력 $0.50 · 캐시 읽기 $0.01 · 캐시 쓰기(5분) $0.125 / 100만 토큰. 다른 모델이면 단가가 다르다.
 */
if (providerName === 'anthropic' && anthropicUsage.calls > 0) {
  const u = anthropicUsage;
  const usd = (u.input * 0.1 + u.output * 0.5 + u.cacheRead * 0.01 + u.cacheWrite * 0.125) / 1e6;
  console.log(
    `실사용: 호출 ${u.calls} · 입력 ${u.input} · 출력(사고 포함) ${u.output} · 캐시 읽기 ${u.cacheRead} · 캐시 쓰기 ${u.cacheWrite} 토큰` +
      ` → 약 $${usd.toFixed(4)} (건당 $${(usd / u.calls).toFixed(5)}, Haiku 5.5 단가 기준)`,
  );
}
process.exit(passed === attempted ? 0 : 1);
