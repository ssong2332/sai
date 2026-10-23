/**
 * Groq provider — 시험용 옵션(2026-10-23). OpenAI provider를 엔드포인트만 바꿔 재사용한다.
 *
 * 🔴 지키는 것: ① Groq 요청은 Groq 엔드포인트·모델·추론 깊이 low ② **OpenAI 요청은 예전과 똑같다**
 *    (재사용하려고 넣은 선택 인자가 운영 경로를 바꾸지 않는다) ③ 기본 순서·폴오버 사슬에 끼어들지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { refine, MemoryCacheStore } from '../src/core/refine/index.js';
import { PROVIDERS } from '../src/core/refine/providers/index.js';
import { FAILOVER_CHAIN } from '../src/core/refine/failover.js';

const BASE_REQUEST = {
  text: '내일 오전까지 리뷰 부탁드립니다',
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  referenceDate: '2026-08-12',
};

const RAW = {
  urgency: 'NORMAL',
  urgencyReason: '통상적인 업무 요청입니다.',
  refined: 'Could you review this by tomorrow morning?',
  refinedReason: '요청을 명시적으로 바꿨습니다.',
  preserved: [],
  misreadRisks: [],
  backTranslation: '내일 오전까지 검토해 주실 수 있을까요?',
  detectedIntent: 'normal',
  intentEvidence: null,
  ticket: null,
  appliedGlossary: [],
  unregisteredHonorifics: [],
};

function stubFetch() {
  const seen = {};
  const impl = async (url, init) => {
    seen.url = url;
    seen.body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      // Groq gpt-oss는 message에 reasoning 필드를 붙인다 — content만 읽어야 한다.
      json: async () => ({ choices: [{ message: { content: JSON.stringify(RAW), reasoning: '...' } }] }),
    };
  };
  impl.seen = seen;
  return impl;
}

const run = (provider, fetchImpl) =>
  refine(BASE_REQUEST, { apiKey: 'k', provider, cache: new MemoryCacheStore(), fetchImpl });

test('🔴 옵션으로만 등록 — 폴오버 사슬에 없다', () => {
  assert.equal(PROVIDERS.groq.envKey, 'GROQ_API_KEY');
  assert.equal(PROVIDERS.groq.defaultModel, 'openai/gpt-oss-120b');
  assert.ok(!FAILOVER_CHAIN.some((step) => step.provider === 'groq'));
});

test('Groq 요청 — 엔드포인트·모델·추론 low, reasoning 필드는 무시하고 content만 읽는다', async () => {
  const fetchImpl = stubFetch();
  const result = await run('groq', fetchImpl);
  assert.equal(fetchImpl.seen.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(fetchImpl.seen.body.model, 'openai/gpt-oss-120b');
  assert.equal(fetchImpl.seen.body.reasoning_effort, 'low');
  assert.deepEqual(fetchImpl.seen.body.response_format, { type: 'json_object' });
  assert.equal(result.fallback, false, result.fallbackDetail);
  assert.equal(result.refined, RAW.refined);
});

test('🔴 OpenAI 요청은 예전과 같다 — 엔드포인트·필드가 바뀌지 않는다', async () => {
  const fetchImpl = stubFetch();
  await run('openai', fetchImpl);
  assert.equal(fetchImpl.seen.url, 'https://api.openai.com/v1/chat/completions');
  assert.deepEqual(Object.keys(fetchImpl.seen.body).sort(), ['messages', 'model', 'response_format', 'temperature']);
  assert.equal(fetchImpl.seen.body.temperature, 0);
});
