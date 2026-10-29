/**
 * 다듬기 품질 모드 (2026-10-30 사용자 결정 — 빠른 · 기본 · 심층).
 *
 * 🔴 **모델은 사용자가 고르지 않는다.** 확장은 모드 **이름**만 보내고, 모델·사고·effort는 서버가 이 표에서만
 *    정한다(Spec §0). 확장이 모델을 실으면 요청 조작으로 아무 모델이나 부를 수 있고 폴오버도 꺼진다.
 * 🔴 표 밖 값·없음은 `DEFAULT_QUALITY` — 옛 확장(이 필드를 모름)도 기본 모드로 다듬는다.
 * 🔴 anthropic 단계에만 적용한다. 폴오버로 다른 provider가 답하면 그 provider 기본값을 쓴다.
 *
 * | 모드 | 모델 | 사고 | effort | provider 제한 시간 | 회귀 21건 3회 평균 · 응답 중앙값/p90 (2026-10-30 실측) |
 * |---|---|---|---|---|---|
 * | `fast` 빠른 | Haiku 5.5 | 끔 | low | 20초 | 19.0 · 2.6초/4.2초 · 건당 약 $0.0008 |
 * | `standard` 기본 | Sonnet 5.5 | adaptive | medium | 20초 | 20.7 · 4.1초/5.4초 · 약 $0.016 |
 * | `deep` 심층 | Opus 5.5 | adaptive | low | 25초 | 21.0(3회 모두 21/21) · 5.6초/7.1초 · 약 $0.032 |
 * 🔴 고른 근거·탈락 후보는 `docs/QualityModes.md`(평가 기준표). Opus 5.5는 사고를 끌 수 없고(adaptive만),
 *    Sonnet 5.5는 `disabled`가 400이다 — `test/quality.unit.test.js`가 잠근다. 심층 제한 시간 25초는 확장 쪽 30초
 *    (`REFINE_TIMEOUT_MS`)보다 짧아야 서버 폴백 문구가 확장 시간 초과보다 먼저 나간다.
 */

export const QUALITY_MODES = {
  fast: { model: 'claude-haiku-5-5', thinking: 'disabled', effort: 'low', timeoutMs: 20_000 },
  standard: { model: 'claude-sonnet-5-5', thinking: 'adaptive', effort: 'medium', timeoutMs: 20_000 },
  deep: { model: 'claude-opus-5-5', thinking: 'adaptive', effort: 'low', timeoutMs: 25_000 },
};

export const QUALITY_IDS = Object.keys(QUALITY_MODES);
/** 화면 이름 — 설정 칩·팝업 표시가 같은 말을 쓴다. */
export const QUALITY_LABELS = { fast: '빠른', standard: '기본', deep: '심층' };
export const DEFAULT_QUALITY = 'standard';

/** 표에 있는 이름이면 그 이름, 아니면 기본 모드. */
export function resolveQuality(value) {
  return typeof value === 'string' && Object.hasOwn(QUALITY_MODES, value) ? value : DEFAULT_QUALITY;
}

/**
 * 한 provider 단계에 얹을 값. 🔴 anthropic 단계만 — 폴오버로 groq 등이 답하면 빈 객체(그 provider 기본값).
 * @returns {{model?: string, thinking?: string, effort?: string, timeoutMs?: number}}
 */
export function qualityStepDeps(quality, provider) {
  if (provider !== 'anthropic') return {};
  const { model, thinking, effort, timeoutMs } = QUALITY_MODES[resolveQuality(quality)];
  return { model, thinking, effort, timeoutMs };
}
