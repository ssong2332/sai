/**
 * 다듬기 품질 모드 (2026-10-30 사용자 결정 — 빠른 · 기본 · 심층).
 *
 * 🔴 **모델은 사용자가 고르지 않는다.** 확장은 모드 **이름**만 보내고, 모델·사고·effort는 서버가 이 표에서만
 *    정한다(Spec §0). 확장이 모델을 실으면 요청 조작으로 아무 모델이나 부를 수 있고 폴오버도 꺼진다.
 * 🔴 표 밖 값·없음은 `DEFAULT_QUALITY`(2026-10-31부터 **빠른** — 월 $100 예산, 사용자 결정). 옛 확장(이 필드를 모름)도 빠른으로 다듬는다.
 * 🔴 기본·심층은 Worker가 1인 하루 횟수와 이달 추정 비용으로 빠른까지 낮출 수 있다 — `workers/refine/src/qualityAllowance.js`.
 * 🔴 anthropic 단계에만 적용한다. 폴오버로 다른 provider가 답하면 그 provider 기본값을 쓴다.
 *
 * | 모드 | 모델 | 사고 | effort | provider 제한 시간 | 회귀 21건 `--quality` 3회 평균 · 응답 중앙값/p90 · 건당 (2026-10-30 실측) |
 * |---|---|---|---|---|---|
 * | `fast` 빠른 | Haiku 5.5 | 끔 | low | 20초 | 19.33 · 2.6초/4.1초 · 약 $0.0008 |
 * | `standard` 기본 | Sonnet 5.5 | adaptive | medium | 20초 | 21.00 · 3.8초/5.2초 · 약 $0.016 |
 * | `deep` 심층 | Opus 5.5 | adaptive | medium | 25초 | 21.00 · 9.5초/11.9초 · 약 $0.038 (effort low는 20.33으로 기본보다 낮아 탈락) |
 * 🔴 고른 근거·탈락 후보는 `docs/QualityModes.md`(평가 기준표). Opus 5.5는 사고를 끌 수 없고(adaptive만),
 *    Sonnet 5.5는 `disabled`가 400이다 — `test/quality.unit.test.js`가 잠근다. 심층 제한 시간 25초는 확장 쪽 30초
 *    (`REFINE_TIMEOUT_MS`)보다 짧아야 서버 폴백 문구가 확장 시간 초과보다 먼저 나간다.
 */

export const QUALITY_MODES = {
  fast: { model: 'claude-haiku-5-5', thinking: 'disabled', effort: 'low', timeoutMs: 20_000 },
  standard: { model: 'claude-sonnet-5-5', thinking: 'adaptive', effort: 'medium', timeoutMs: 20_000 },
  deep: { model: 'claude-opus-5-5', thinking: 'adaptive', effort: 'medium', timeoutMs: 25_000 },
};

export const QUALITY_IDS = Object.keys(QUALITY_MODES);
/** 화면 이름 — 설정 칩·팝업 표시가 같은 말을 쓴다. */
export const QUALITY_LABELS = { fast: '빠른', standard: '기본', deep: '심층' };
export const DEFAULT_QUALITY = 'fast';

/**
 * 1인 하루 상위 모드 횟수(2026-10-31 사용자 결정 — 월 $100 예산). 넘으면 Worker가 빠른 모드로 다듬는다(거절 아님).
 * 판정은 Worker `qualityAllowance.js` — 설정 안내 문구도 이 숫자를 읽는다.
 */
export const PREMIUM_DAILY_LIMITS = Object.freeze({ standard: 10, deep: 3 });

/**
 * 요금제별 하루 한도 — `docs/BillingDesign.md` 2절 · Spec §0(2026-10-31 확정).
 * 🔴 한 곳에만 둔다 — Worker `billing.js`가 판정에, 확장 설정 「지금 플랜」이 안내에 같은 표를 읽는다(2026-11-01 코어로 옮김).
 */
export const PLAN_LIMITS = Object.freeze({
  beta: Object.freeze({ daily: 20, standard: 10, deep: 3 }), // 2026-11-02 공개 전 100 → 20(`refineQuota.js`)
  free: Object.freeze({ daily: 20, standard: 0, deep: 0 }),
  pro: Object.freeze({ daily: 200, standard: 10, deep: 3 }),
  team: Object.freeze({ daily: 200, standard: 20, deep: 5 }),
});

/**
 * 요금제별 기능 한도(2026-11-05 사용자 결정 「무료 2단계 — B안, 개인 용어집 5 · 저장 문구 3, 나머지 추천대로」).
 * 🔴 한 곳에만 둔다 — Worker(회신 횟수·개인 용어 수·학습 버림)와 확장(화면 숨김·추가 막기)이 같은 표를 읽는다.
 * `null` = 제한 없음. 저장된 데이터는 지우지 않는다 — 한도는 「쓰기·새로 추가」에만 건다.
 * | 요금제 | 회신 초안/일 | 개인 용어집 | 저장 문구 | 예약·회의 추천 | 수정 습관 학습 |
 * |---|---|---|---|---|---|
 * | free | 3 | 5 | 3 | 숨김 | 숨김(기록 안 함) |
 * | beta · pro · team | 제한 없음 | 제한 없음 | 제한 없음 | 보임 | 보임 |
 * 상대 시간대 표시 · 퇴근 시간 경고는 무료에도 보인다(표에 없음 = 모두).
 */
const FULL_FEATURES = Object.freeze({ replyDaily: null, personalGlossary: null, snippets: null, scheduling: true, learning: true });
export const PLAN_FEATURES = Object.freeze({
  free: Object.freeze({ replyDaily: 3, personalGlossary: 5, snippets: 3, scheduling: false, learning: false }),
  beta: FULL_FEATURES,
  pro: FULL_FEATURES,
  team: FULL_FEATURES,
});

/** 요금제 → 기능 한도. 모르는 값은 free(🔴 잠그는 쪽 — 결제 안 한 사람에게 열어 주지 않는다). */
export function featuresFor(plan) {
  return Object.hasOwn(PLAN_FEATURES, plan) ? PLAN_FEATURES[plan] : PLAN_FEATURES.free;
}

/** 한도에 닿았을 때 붙이는 한 줄 — 확장 화면이 같은 말을 쓴다. */
export const PLAN_UPSELL_NOTE = 'Pro에서 더 쓸 수 있어요';

/** 서버가 모드를 낮췄을 때 팝업에 붙이는 말(응답 `qualityDowngrade`). 모르는 사유는 표시하지 않는다. */
export const QUALITY_DOWNGRADE_NOTES = Object.freeze({
  daily: '오늘 쓸 수 있는 횟수를 다 써서 빠른 모드로 다듬었어요',
  budget: '이번 달은 빠른 모드로 다듬어요',
  unavailable: '잠시 빠른 모드로 다듬었어요',
  plan: '무료 요금제는 빠른 모드로 다듬어요 — 기본·심층은 Pro에서 쓸 수 있어요', // 2026-10-31 결제(`BILLING_ENFORCED`)
});

/** 표에 있는 이름이면 그 이름, 아니면 기본 모드. */
export function resolveQuality(value) {
  return typeof value === 'string' && Object.hasOwn(QUALITY_MODES, value) ? value : DEFAULT_QUALITY;
}

/**
 * 요청에 실을 모드 — 내가 고른 것 → (안 골랐으면) 팀 기본 모드 → 기본값(2026-11-01 사용자 결정 「팀원이 안 고른 때만」).
 * `mine`이 null/undefined면 「한 번도 안 고름」이다(저장값 없음).
 */
export function effectiveQuality(mine, teamDefault = null) {
  return resolveQuality(mine ?? teamDefault ?? null);
}

/**
 * 한 provider 단계에 얹을 값. 🔴 anthropic 단계만 — 폴오버로 groq 등이 답하면 빈 객체(그 provider 기본값).
 * @returns {{model?: string, thinking?: string, effort?: string, timeoutMs?: number}}
 */
export function qualityStepDeps(quality, provider) {
  if (provider !== 'anthropic') return {};
  const resolved = resolveQuality(quality);
  const { model, thinking, effort, timeoutMs } = QUALITY_MODES[resolved];
  return { model, thinking, effort, timeoutMs, ...(resolved === 'fast' ? { glossaryRetry: GLOSSARY_RETRY_FAST } : {}) };
}

/**
 * 빠른 모드에서 **용어가 빠져 다시 부를 때만** 쓰는 모델 (2026-11-02 사용자 결정 「재호출만 기본 모델」).
 * 🔴 실측: 진행보고·부드럽게 프로필 + 대화 참고에서 Haiku는 팀 「배포 → ABC」를 재호출로도 두 곳 0/6.
 * 🔴 기본 모드 모델(Sonnet)을 쓰되 **사고 없이·effort low** — 재호출은 15초에 끊긴다(`index.js` `RETRY_TIMEOUT_MS`).
 *    사고를 켜면 그 안에 못 끝날 수 있다. 이 재호출 비용은 월 예산 추정(`qualityAllowance.js`)에 잡히지 않는다.
 * 🔴 Sonnet 5.5는 `{type: 'disabled'}`를 400으로 거절한다(2026-11-02 실측 — "send between_tools instead").
 *    `between_tools`가 이 모델의 「응답 전 사고 없음」이다(`providers/anthropic.js` `thinkingConfig`).
 */
export const GLOSSARY_RETRY_FAST = Object.freeze({ model: QUALITY_MODES.standard.model, thinking: 'between_tools', effort: 'low' });
