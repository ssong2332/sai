#!/usr/bin/env node
/**
 * `/v1/refine` 실 API 통합 러너 — 선별 20건(`test/refine.cases.js`)을 실제 LLM 호출로 돌린다.
 *
 * 사용:
 *   OPENAI_API_KEY=... node scripts/refine-live.js                 # 기본 (Spec §6-3 기준 경로)
 *   GEMINI_API_KEY=... node scripts/refine-live.js --provider gemini   # 대체 provider
 *   [--bypass-cache] [--model <이름>]
 *
 * 🔴 provider 기본값 — **OpenAI를 먼저 본다**(2026-08-17 변경, 그전에는 Gemini가 먼저였다).
 *    `functions/index.js`의 판정표·`server/refine-proxy.js`와 **같은 순서**여야 한다.
 *    셋 중 하나만 바꾸면 "로컬에선 되는데 배포하면 다르다"가 시작된다 — 실제로 Gemini
 *    시절 역번역 문제를 그 계열로 4번 오진했다.
 * 🔴 키가 없으면 **실행하지 않고 종료 코드 2로 끝난다.** 미실행을 "통과"로 기록하지 않기 위함이다
 *    (`docs/reference/TestCases-legacy.md` 금지 2행).
 * 🔴 여기 쓰이는 입력은 전부 레거시 문서의 합성 테스트 문장이며 실제 사용자 메시지가 아니다.
 */

import { refine, MemoryCacheStore, PROVIDERS } from '../src/core/refine/index.js';
import { REFINE_CASES, judgeCase } from '../test/refine.cases.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const bypassCache = args.includes('--bypass-cache');
const model = flag('--model');
const providerName =
  flag('--provider') ?? (process.env.OPENAI_API_KEY ? 'openai' : 'gemini');

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

for (const testCase of REFINE_CASES) {
  if (testCase.skip) {
    rows.push({ id: testCase.id, field: testCase.field, result: '제외', detail: testCase.skipReason ?? '' });
    continue;
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await refine(
      { ...testCase.request, bypassCache },
      { apiKey, provider: providerName, model, cache },
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
process.exit(passed === attempted ? 0 : 1);
