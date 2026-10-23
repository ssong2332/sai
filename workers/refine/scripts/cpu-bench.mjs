/**
 * CPU 추정 벤치 — Worker 핸들러를 **Node에서** 가짜 Claude 응답으로 돌려 요청당 동기 처리 시간을 잰다(L33).
 *
 * 🔴 **이 숫자는 추정이다.** Cloudflare 무료 플랜 한도는 요청당 **CPU 10ms**(fetch 대기는 안 셈)인데,
 *    여기서 재는 것은 Node(V8)·이 PC의 CPU 시간이다. workerd도 V8이라 자릿수는 맞을 가능성이 높지만
 *    CPU 성능·JIT 상태·isolate 콜드 스타트가 다르다. **진짜 값은 사용자 승인 배포 후** Cloudflare 대시보드
 *    (Workers → sai-refine → Metrics 「CPU time」) 또는 `npx wrangler tail --format json`의 `cpuTime`으로 확인한다.
 * 🔴 네트워크 없음 — 토큰은 로컬 키, Claude는 즉시 응답하는 가짜 fetch. 가짜 fetch가 즉시 끝나므로
 *    요청 하나의 벽시계 시간 ≈ CPU 시간이다(대기 0). `process.cpuUsage()`(모든 스레드 합)도 함께 본다 —
 *    WebCrypto 서명 검증이 libuv 스레드에서 돌 수 있어서다.
 * 🔴 측정 대상(서버 쪽 동기 작업 전부): 토큰 검증(RS256) · 본문 JSON 파싱 · 코어 정규화 · `buildRefinePayload`
 *    (instruction 조립·용어집 일치 표시) · 캐시 키 sha256 · SDK 요청 조립/응답 파싱 · `normalizeRefineResponse` ·
 *    응답 JSON 직렬화. 숫자·직급·용어집 대조(numberCheck·titleCheck·glossaryCheck·intentDrift)는 **확장 팝업에서**
 *    돈다(서버 코어 `refine()`은 부르지 않는다) — 서버 CPU에는 들어가지 않는다.
 *
 * 실행: `npm run bench:cpu` (workers/refine 안에서) · 옵션 `--n 300`
 */

import { performance } from 'node:perf_hooks';
import { jwtVerify } from 'jose';

import { MemoryCacheStore, RefineCallError } from '../../../src/core/refine/index.js';
import { buildRefinePayload } from '../../../src/core/refine/prompt.js';
import { normalizeRefineResponse } from '../../../src/core/refine/schema.js';
import { computeCacheKey } from '../../../src/core/refine/cache.js';
import { callAnthropic } from '../../../src/core/refine/providers/anthropic.js';
import { classifyHttpFailure, parseJsonContent } from '../../../src/core/refine/providers/index.js';
import { GLOSSARY_SEED } from '../../../test/refine.cases.js';
import { createHandler } from '../src/handler.js';
import { createNoopUsageStore } from '../src/usageStore.js';
import {
  PROJECT_ID,
  TEST_ENV,
  fakeAnthropicFetch,
  goodRaw,
  makeKeys,
  refineRequest,
  signIdToken,
} from '../test/helpers.js';

const argN = process.argv.indexOf('--n');
const N = argN > 0 ? Number(process.argv[argN + 1]) : 500;
const WARMUP = 50;

// ── 입력: 실사용보다 무거운 쪽으로 — 긴 본문 + 용어집 + 직전 대화 10개(서버 상한 근처).
const LONG_TEXT =
  '김수진 대리님, 안녕하세요. 어제 공유드린 Nexus 결제 모듈 배포 건 관련해서 확인 부탁드립니다. ' +
  '8/4 오후 3시까지 QA 결과를 받아야 하고, 응답 시간이 200ms를 넘으면 롤백합니다. ' +
  '예산은 3,000만원이고 서버 3대 중 2대는 이미 교체했습니다. 혹시 일정이 어려우시면 말씀 부탁드립니다. ';
const BODY = {
  text: LONG_TEXT.repeat(3), // 약 600자
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  referenceDate: '2026-08-12',
  glossary: GLOSSARY_SEED,
  threadContext: Array.from({ length: 10 }, (_, i) => ({ text: `이전 메시지 ${i}: 지난주 배포 일정 공유드립니다. 확인 부탁드립니다.` })),
  bypassCache: true, // 🔴 캐시 적중이면 코어 일을 거의 안 한다 — 최악(미적중)을 잰다
};
const RAW = {
  ...goodRaw(),
  refined: 'Hi Sujin Kim, regarding the Nexus payment module deployment I shared yesterday: '.repeat(6),
  backTranslation: '김수진 님, 어제 공유한 Nexus 결제 모듈 배포 관련입니다. '.repeat(6),
  misreadRisks: [{ phrase: '확인 부탁드립니다', risk: 'ambiguous', suggestion: 'Please confirm by Aug 4, 2026.' }],
  appliedGlossary: [{ sourceText: '김수진', appliedText: 'Sujin Kim' }],
};

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { mean: samples.reduce((a, b) => a + b, 0) / samples.length, p50: pick(0.5), p95: pick(0.95), max: sorted.at(-1) };
};
const fmt = (s) => `평균 ${s.mean.toFixed(3)} · p50 ${s.p50.toFixed(3)} · p95 ${s.p95.toFixed(3)} · 최대 ${s.max.toFixed(3)} ms`;

/** 비동기 작업 하나를 N번 — 벽시계 표본 + 전체 process CPU 합(모든 스레드). */
async function bench(label, fn) {
  for (let i = 0; i < WARMUP; i += 1) await fn();
  const samples = [];
  const cpu0 = process.cpuUsage();
  for (let i = 0; i < N; i += 1) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  const cpu = process.cpuUsage(cpu0);
  const cpuPerReq = (cpu.user + cpu.system) / 1000 / N;
  console.log(`${label.padEnd(34)} 벽시계 ${fmt(stats(samples))} | process CPU/건 ${cpuPerReq.toFixed(3)} ms`);
  return { ...stats(samples), cpuPerReq };
}

const keys = await makeKeys();
const token = await signIdToken(keys);
const fetchImpl = fakeAnthropicFetch(RAW);
const handle = createHandler({
  jwks: keys.jwks,
  fetchImpl,
  usageStore: createNoopUsageStore(),
  cache: new MemoryCacheStore(),
  logger: { log() {}, warn() {}, error() {} }, // 로그 출력 비용은 빼고 잰다(운영 로그는 한 줄)
});
const bodyText = JSON.stringify(BODY);

// ── 콜드: 이 프로세스의 첫 요청(SDK 동적 import·모듈 초기화·JIT 전). Worker isolate 첫 요청에 해당.
{
  const t0 = performance.now();
  const c0 = process.cpuUsage();
  const res = await handle(refineRequest(token, bodyText), TEST_ENV);
  const c = process.cpuUsage(c0);
  if (res.status !== 200) throw new Error(`콜드 요청 실패 status=${res.status}`);
  console.log(`콜드 첫 요청(동적 import 포함)              벽시계 ${(performance.now() - t0).toFixed(2)} ms | process CPU ${((c.user + c.system) / 1000).toFixed(2)} ms`);
}

console.log(`\n반복 N=${N} (워밍업 ${WARMUP}) · 본문 ${BODY.text.length}자 · 용어집 ${BODY.glossary.length} · 맥락 ${BODY.threadContext.length}개\n`);

const total = await bench('① 핸들러 전체(요청→응답 JSON)', async () => {
  const res = await handle(refineRequest(token, bodyText), TEST_ENV);
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  await res.text();
});

await bench('② 토큰 검증(jose RS256)', () =>
  jwtVerify(token, keys.jwks, { algorithms: ['RS256'], issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID }),
);

const payloadInput = { ...BODY, userUrgency: null, honorificLevel: null };
await bench('③ buildRefinePayload', async () => buildRefinePayload(payloadInput));

const payload = buildRefinePayload(payloadInput);
await bench('④ 캐시 키 sha256', async () => computeCacheKey({ model: 'anthropic:claude-haiku-5-5', promptVersion: 'x', payload }));

// 🔴 2026-10-23부터 `npm run bench:cpu`는 `--import ./test/sdkAlias.mjs`로 돈다 — 배포본처럼 SDK 대신 대역(`src/anthropicFetch.js`).
await bench('⑤ provider 호출(대역 — 조립·가짜 응답 파싱)', () =>
  callAnthropic(payload, {
    apiKey: 'test-key-not-real',
    fetchImpl,
    errors: { RefineCallError, classifyHttpFailure, parseJsonContent },
  }),
);

await bench('⑥ normalizeRefineResponse', async () => normalizeRefineResponse(structuredClone(RAW), { userUrgency: null }));

console.log(`\n요청 본문(Claude로 가는 JSON) ${JSON.stringify(fetchImpl.seen.bodies.at(-1)).length.toLocaleString()}자 · 가짜 fetch 호출 ${fetchImpl.seen.calls}회`);
/**
 * 🔴 판정은 **process CPU/건**으로 한다 — 벽시계가 아니다(2026-10-23 첫 실행에서 확인). WebCrypto 서명 검증은
 *    Node에서 libuv 스레드풀로 넘어가서, 벽시계에는 스레드 대기·스케줄링이 섞인다(② p50 벽시계 5ms vs CPU 0.8ms).
 *    Worker는 fetch 같은 I/O 대기를 CPU로 세지 않고, 실제 연산만 센다 — 그쪽에 가까운 것은 CPU 합이다.
 *    단 process CPU에는 GC·다른 스레드도 섞여 **위쪽으로 치우친** 값이다. 건별 분포(p95)는 Windows에서
 *    `process.cpuUsage` 해상도가 거칠어(약 15.6ms 틱 — 🔴 추정) 평균만 낸다.
 */
const verdict = total.cpuPerReq <= 10 ? '이내' : '초과';
console.log(
  `\n🔴 추정 판정: ① 건당 process CPU ${total.cpuPerReq.toFixed(2)} ms → 무료 플랜 10ms ${verdict}` +
    ` (Node·이 PC 기준 평균. 실제 cpuTime·분포는 배포 후 Cloudflare에서 확인)`,
);
