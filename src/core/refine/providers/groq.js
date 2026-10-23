/**
 * Groq provider — **시험용 옵션** (2026-10-23 사용자 요청, Tasks L30).
 * 기본 provider 순서·폴오버 사슬은 바꾸지 않는다 — `--provider groq`로 명시할 때만 쓴다.
 *
 * 🔴 **OpenAI provider를 그대로 재사용한다** — Groq는 OpenAI 호환 `/chat/completions`를 제공한다
 *    (console.groq.com/docs/openai). 다른 점만 여기 둔다: 엔드포인트, 모델, 추론 깊이.
 * 🔴 `openai/gpt-oss-120b`는 추론을 끌 수 없다(low/medium/high) — 지연을 줄이려 `low`로 둔다.
 *    응답 message에 `reasoning` 필드가 붙지만 우리는 `content`만 읽는다.
 * 🔴 `temperature: 0`은 Groq가 1e-8로 바꾼다 — 완전 결정성은 보장되지 않는다(추정).
 * 🔴 데이터: 계약상 입력·출력 학습 사용 금지, 무보존(ZDR)은 콘솔 Data Controls에서 켠다.
 */

import { callOpenAI } from './openai.js';

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export function callGroq(payload, deps) {
  return callOpenAI(payload, {
    ...deps,
    model: deps.model ?? DEFAULT_GROQ_MODEL,
    endpoint: GROQ_ENDPOINT,
    extraBody: { reasoning_effort: 'low' },
  });
}
