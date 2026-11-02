/**
 * 품질 모드 허용량 — 1인 하루 상위 모드 횟수 + 이달 추정 비용 안전장치 (2026-10-31 사용자 결정 「추천안으로 진행」).
 *
 * 전제: Claude API 비용은 **월 $100 안**(사용자, 2026-10-31). 기본 모드(Sonnet)는 빠른(Haiku)의 약 20배, 심층(Opus)은
 * 약 50배라(`docs/QualityModes.md` 3절) 상위 모드를 막지 않으면 매일 끝까지 쓰는 사용자 2명이 $100을 다 쓴다.
 *
 * | 판정 순서 | 조건 | 결과 `quality` | `downgrade` |
 * |---|---|---|---|
 * | ① | 이달(서울) 추정 비용 ≥ `MONTHLY_BUDGET_GUARD_MICROS`($90) 이고 요청이 기본·심층 | `fast` | `budget` |
 * | ②' | 그 요금제에서 그 모드가 안 열렸다(`limits[모드]` 0 — 무료, 2026-10-31) | `fast` | `plan` |
 * | ② | 오늘(서울) 그 모드를 이미 그 요금제 한도(`limits`, 기본값 `PREMIUM_DAILY_LIMITS` 기본 10 · 심층 3)만큼 썼다 | `fast` | `daily` |
 * | ③ | 그 밖 | 요청 그대로 | `null` |
 *
 * 🔴 **거절하지 않는다** — 넘친 상위 모드는 빠른 모드로 다듬는다(빠른도 품질 기준 통과, 회귀 평균 19.33/21).
 * 🔴 비용은 **요청을 받을 때** 그 모드의 건당 실측값만큼 더한다(캐시 적중·실패도 센다 — 넘치게 세는 쪽이 안전).
 *    토큰으로 정확히 세지 않는 이유: 응답 전에 판정해야 하고, 콘솔 지출 한도 $100이 마지막 방어선이다.
 * 🔴 저장하는 것은 uid·횟수·금액(정수, 백만분의 1달러)뿐 — 본문·모델명 없음(Spec 필수 5).
 */

import { PREMIUM_DAILY_LIMITS } from '../../../src/core/refine/quality.js';

/** 1인 하루 상위 모드 횟수(기본 10 · 심층 3) — 원본은 `src/core/refine/quality.js`(설정 안내 문구와 같은 숫자). 빠른은 하루 전체 상한만. */
export { PREMIUM_DAILY_LIMITS };

/** 이달 추정 비용이 이 값 이상이면 상위 모드를 빠른 모드로($90 — 콘솔 한도 $100 전에 멈춘다). 단위: 백만분의 1달러. */
export const MONTHLY_BUDGET_GUARD_MICROS = 90_000_000;

/**
 * 건당 추정 비용(백만분의 1달러) — 2026-10-30 `--quality` 3회 실측 평균(`docs/QualityModes.md` 3절).
 * `other` = 뜻 풀기·회신·결정(Haiku 5.5 사고 끔, L30 실측 $0.00070).
 */
export const COST_ESTIMATE_MICROS = Object.freeze({ fast: 750, standard: 15_700, deep: 38_200, other: 700 });

/**
 * 🔴 2026-11-02 사용자 결정 「수익화 전 공개」 — 이달 추정이 이 값 이상이면 **모든 모드를 멈춘다**(429 `monthly-limit`).
 *    $90 안전장치는 상위 모드만 낮추고 빠른 모드는 계속 돌아서, 콘솔 한도 $100에 닿으면 오류·Groq 폴오버로 조용히 바뀌었다.
 *    $95에서 우리가 먼저 멈추고 「이번 달 무료 사용량이 끝났어요」로 알린다(남은 $5는 추정 오차 여유).
 */
export const MONTHLY_HARD_STOP_MICROS = 95_000_000;

/**
 * 이달 추정 비용 단계 (2026-11-02 사용자 승인 「진행」 — 공개 뒤 비용을 미리 알기 위해). 금액은 밖으로 내지 않는다.
 *
 * | 이달 추정 | 단계 | 뜻 |
 * |---|---|---|
 * | < $50 | `ok` | 평소 |
 * | ≥ $50 | `notice` | 절반 — 사용량 추세를 본다 |
 * | ≥ $80 | `warn` | 곧 상위 모드가 빠른으로 낮아진다($90) |
 * | ≥ $90 | `guard` | 상위 모드 → 빠른(`MONTHLY_BUDGET_GUARD_MICROS`) |
 * | ≥ $95 | `stopped` | 모두 멈춤(`MONTHLY_HARD_STOP_MICROS`) |
 */
export const BUDGET_NOTICE_MICROS = 50_000_000;
export const BUDGET_WARN_MICROS = 80_000_000;

export function budgetLevel(micros) {
  const m = Number(micros) || 0;
  if (m >= MONTHLY_HARD_STOP_MICROS) return 'stopped';
  if (m >= MONTHLY_BUDGET_GUARD_MICROS) return 'guard';
  if (m >= BUDGET_WARN_MICROS) return 'warn';
  if (m >= BUDGET_NOTICE_MICROS) return 'notice';
  return 'ok';
}

/**
 * 실제 호출 1번의 추정 비용 — 모델 이름으로(2026-11-02, 재호출 포함 집계용). 모르는 모델·null은 `other`.
 * 🔴 Sonnet 용어 재호출(사고 없음)은 기본 모드 추정(사고 켬)보다 싸지만 같은 값으로 센다 — 넘치게 세는 쪽이 안전.
 */
export function modelCostMicros(model) {
  const name = String(model ?? '');
  if (name.includes('opus')) return COST_ESTIMATE_MICROS.deep;
  if (name.includes('sonnet')) return COST_ESTIMATE_MICROS.standard;
  if (name.includes('haiku')) return COST_ESTIMATE_MICROS.fast;
  return COST_ESTIMATE_MICROS.other;
}

/**
 * 받을 때 미리 센 1번 **뒤의** 호출 비용 합(재호출·폴오버 단계). 첫 호출은 `admit`이 `costMicros(quality)`로 이미 셌다.
 * @param {Array<{model: string|null}>} calls 코어 `deps.onCall` 기록(순서대로).
 */
export function extraCallsMicros(calls) {
  return (Array.isArray(calls) ? calls.slice(1) : []).reduce((sum, call) => sum + modelCostMicros(call?.model), 0);
}

/** 서울 기준 `YYYY-MM`. 🔴 `toISOString()`은 UTC라 쓰지 않는다(하루 상한과 같은 이유). */
export function seoulMonthKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(now);
}

/**
 * 위 판정표.
 * @param {{requested: string|null, premiumUsed?: Record<string, number>, monthMicros?: number}} input
 *   `requested` = `resolveQuality`를 거친 이름, 다듬기가 아니면 null.
 * @returns {{quality: string|null, downgrade: null|'budget'|'daily'}}
 */
export function decideQuality({ requested, premiumUsed = {}, monthMicros = 0, limits = PREMIUM_DAILY_LIMITS }) {
  if (!requested || !(requested in PREMIUM_DAILY_LIMITS)) return { quality: requested ?? null, downgrade: null };
  if (monthMicros >= MONTHLY_BUDGET_GUARD_MICROS) return { quality: 'fast', downgrade: 'budget' };
  // 2026-10-31 요금제별 한도(`billing.js` PLAN_LIMITS) — 그 요금제에서 아예 안 열린 모드는 사유 `plan`.
  const cap = limits[requested] ?? PREMIUM_DAILY_LIMITS[requested];
  if (cap <= 0) return { quality: 'fast', downgrade: 'plan' };
  if ((premiumUsed[requested] ?? 0) >= cap) return { quality: 'fast', downgrade: 'daily' };
  return { quality: requested, downgrade: null };
}

/** 실제로 쓸 모드의 추정 비용. 다듬기가 아니면(`quality` null) `other`. */
export function costMicros(quality) {
  return COST_ESTIMATE_MICROS[quality ?? 'other'] ?? COST_ESTIMATE_MICROS.other;
}
