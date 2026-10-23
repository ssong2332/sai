/**
 * `@anthropic-ai/sdk` 대역 — **Worker 번들 전용**, fetch 한 번으로 Messages API를 부른다 (2026-10-23 L33 선택지 A).
 *
 * 🔴 왜: 배포된 `sai-refine`의 `wrangler tail` cpuTime이 새 isolate 첫 교정 34ms·30ms / 데운 뒤 3ms였다
 *    (무료 플랜 한도 10ms). 번들 1,127 KiB 중 SDK가 대부분이고(소스맵 기준 SDK 원문 약 2.8MB vs 코어 91KB),
 *    SDK는 첫 호출 때 모듈 초기화(클래스·리소스 수십 개·OpenTelemetry·웹훅 모듈)를 한다 — 그게 콜드 비용의
 *    유력 후보다(🔴 추정 — 진짜 값은 배포 후 cpuTime으로 확인).
 * 🔴 어떻게: `wrangler.toml` `[alias]`가 `@anthropic-ai/sdk`를 **이 파일로 바꿔 끼운다**. 코어
 *    `src/core/refine/providers/anthropic.js`는 **한 글자도 안 바뀐다** — 요청 본문(모델·max_tokens·effort·
 *    사고 스위치·SYSTEM·payload, temperature 없음)·오류 분류(status + `error.type` → `classifyHttpFailure`,
 *    status 없음 → error)·거절/잘림 → invalid·사고 블록 건너뛰기·울타리 벗기기·usage 누계가 **그대로 코어 코드다**.
 *    그래서 SYSTEM 문구·사고 판정을 복사하거나 export할 필요가 없다(갈라질 곳을 만들지 않는다).
 *    Node 경로(로컬 프록시·Functions·회귀 러너)는 alias가 없으니 계속 진짜 SDK를 쓴다.
 *
 * 이 대역이 흉내 내는 **SDK 표면 — 코어가 실제로 쓰는 것만** (`anthropic.js`의 import·호출 그대로)
 * | 코어가 쓰는 것 | 진짜 SDK 1.1.0 | 이 대역 |
 * |---|---|---|
 * | `default` export 클래스 | `Anthropic` | `AnthropicFetchClient` |
 * | 생성자 `{apiKey, timeout, maxRetries, fetch}` | 같다 | `maxRetries`는 무시 — **재시도 자체가 없다**(코어도 0을 넘긴다) |
 * | `messages.create(params)` → Message | POST `/v1/messages` | 같다 — params를 **손대지 않고** JSON으로 보낸다 |
 * | HTTP 오류 → `error.status`·`error.type` | `APIError.generate`: `type = body.error.type` | 같다(본문이 JSON이 아니면 type `null`) |
 * | 연결 실패·타임아웃 → status 없는 오류 | `APIConnectionError`·`APIConnectionTimeoutError` | 같은 이름으로 던진다 |
 * 🔴 이 표 밖(스트리밍·배치·파일·베타 헤더·자동 재시도·`ANTHROPIC_API_KEY` 환경변수 읽기)은 **구현하지 않는다**.
 *    코어가 새 SDK 기능을 쓰기 시작하면 Worker에서는 여기서 막힌다 — `test/anthropicFetch.test.js`가 표를 잠근다.
 *
 * 🔴 API 키는 `x-api-key` 헤더에만 싣는다(`Authorization`·URL·본문 없음). 오류 메시지에 키·본문을 담지 않는다
 *    (Spec 필수 5 — 응답 본문의 `error.message`도 옮기지 않는다. 쓰는 것은 status·type뿐).
 */

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

/** HTTP 오류 — 코어는 `status`·`type`만 읽는다(진짜 SDK `APIError`와 같은 두 필드). */
export class APIError extends Error {
  constructor(status, type) {
    super(`anthropic http ${status}${type ? ` ${type}` : ''}`);
    this.name = 'APIError';
    this.status = status;
    this.type = type ?? null;
  }
}

/** 연결 실패 — `status`가 없다 → 코어가 error(일시 장애)로 분류한다. */
export class APIConnectionError extends Error {
  constructor(name = 'APIConnectionError') {
    super('anthropic connection error');
    this.name = name;
  }
}

export default class AnthropicFetchClient {
  #apiKey;
  #timeoutMs;
  #fetch;

  /** @param {{apiKey: string, timeout?: number, maxRetries?: number, fetch?: typeof fetch}} options */
  constructor({ apiKey, timeout, fetch: fetchImpl } = {}) {
    this.#apiKey = apiKey;
    this.#timeoutMs = timeout;
    // 🔴 전역 fetch는 **호출 시점에** 잡는다 — 테스트·벤치가 globalThis.fetch를 바꿔 끼워도 따라간다.
    this.#fetch = fetchImpl;
    this.messages = { create: (params) => this.#create(params) };
  }

  async #create(params) {
    const fetchImpl = this.#fetch ?? globalThis.fetch;
    const timedOut = { value: false };
    const controller = new AbortController();
    const timer =
      typeof this.#timeoutMs === 'number' && this.#timeoutMs > 0
        ? setTimeout(() => {
            timedOut.value = true;
            controller.abort();
          }, this.#timeoutMs)
        : null;

    let response;
    try {
      response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'x-api-key': this.#apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    } catch {
      // 🔴 원래 오류(메시지에 URL 등)를 옮기지 않는다 — 이름만. 코어는 status 없음 → error.
      throw new APIConnectionError(timedOut.value ? 'APIConnectionTimeoutError' : 'APIConnectionError');
    } finally {
      if (timer !== null) clearTimeout(timer);
    }

    if (!response.ok) {
      let type = null;
      try {
        const body = await response.json();
        type = typeof body?.error?.type === 'string' ? body.error.type : null;
      } catch {
        // 본문이 JSON이 아니다 — 진짜 SDK도 type null.
      }
      throw new APIError(response.status, type);
    }

    // 200인데 JSON이 아니면 여기서 던진다(status 없음 → 코어가 error). 진짜 SDK도 status 없는 오류다.
    return response.json();
  }
}
