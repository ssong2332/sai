/**
 * 내 요금제 — 이 기기에 저장해 두고 화면·콘텐츠 스크립트·백그라운드가 같이 읽는다(2026-11-05 「무료 2단계」).
 *
 * 🔴 기능을 숨기는 판정은 이 값으로 한다. 서버가 회신 횟수·개인 용어 수·학습 기록을 다시 거르므로(Worker `applyPlanFeatures`)
 *    이 값을 조작해도 서버 비용이 드는 쪽은 열리지 않는다 — 로컬 기능(저장 문구·예약)은 화면 잠금뿐이다(약한 잠금, 기록).
 * 🔴 저장값은 요금제 이름과 확인 시각뿐이다 — 토큰·이메일·결제 정보 없음.
 *
 * | 상황 | 저장 | `getFeatures()` |
 * |---|---|---|
 * | 결제 진입점 꺼짐(`FEATURES.billing`) | — | 제한 없음(예전과 같다) |
 * | 서버가 요금제를 답함 | `{plan, checkedAt}` | 그 요금제 표(`PLAN_FEATURES`) |
 * | 로그인 안 함 | 지움 | 무료 |
 * | 서버·네트워크 오류 | 그대로 둠 | 마지막 값, 단 7일이 지나면 무료 |
 * | 저장값 없음 | — | 무료(🔴 결제 안 한 사람에게 열어 주지 않는 쪽) |
 */
import { FEATURES } from '../config.js';
import { featuresFor, PLAN_UPSELL_NOTE } from '../core/refine/quality.js';
import { getSession } from './authClient.js';
import { getMyPlan } from './billingClient.js';
import { getLocal, removeLocal, setLocal, STORAGE_KEYS } from './storage.js';

export const PLAN_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 무료 한도에 닿아 **새로 추가**를 막았다(2026-11-05). 🔴 이미 있는 항목·같은 항목 덮어쓰기는 막지 않는다.
 * 화면은 `message`를 그대로 보여 준다(용어집 편집기·설정 페이지가 오류 문구를 그대로 띄운다).
 */
export class PlanLimitError extends Error {
  constructor(kind, limit) {
    super(planLimitText(kind, limit));
    this.name = 'PlanLimitError';
    this.kind = kind;
    this.limit = limit;
  }
}

const KIND_LABEL = { personalGlossary: '개인 용어', snippets: '저장 문구' };

/** 「무료 요금제는 개인 용어를 5개까지 저장할 수 있어요 — Pro에서 더 쓸 수 있어요」 */
export function planLimitText(kind, limit) {
  const label = KIND_LABEL[kind] ?? '항목';
  return `무료 요금제는 ${label}를 ${limit}개까지 저장할 수 있어요 — ${PLAN_UPSELL_NOTE}`;
}
const KNOWN = ['free', 'beta', 'pro', 'team'];

/** 저장된 요금제(오래됐거나 없으면 `null`). */
export async function getCachedPlan({ now = Date.now() } = {}) {
  const stored = await getLocal(STORAGE_KEYS.PLAN, null);
  if (!stored || !KNOWN.includes(stored.plan) || !Number.isFinite(stored.checkedAt)) return null;
  return now - stored.checkedAt <= PLAN_CACHE_MAX_AGE_MS ? stored.plan : null;
}

/** 위 판정표의 `getFeatures()` 열. */
export function featuresFromCache(plan) {
  if (!FEATURES.billing) return featuresFor('beta');
  return featuresFor(plan ?? 'free');
}

export async function getFeatures(opts) {
  return featuresFromCache(await getCachedPlan(opts));
}

/**
 * 서버에 다시 묻고 저장한다. 결과 요금제(모르면 마지막 저장값)를 돌려준다.
 * @param {{fetchPlan?: Function, session?: Function, now?: number}} [deps] 테스트용
 */
export async function refreshPlan({ fetchPlan = getMyPlan, session = getSession, now = Date.now() } = {}) {
  if (!FEATURES.billing) return null;
  if (!(await session())) {
    await removeLocal(STORAGE_KEYS.PLAN);
    return null;
  }
  const plan = await fetchPlan();
  if (KNOWN.includes(plan)) {
    await setLocal(STORAGE_KEYS.PLAN, { plan, checkedAt: now });
    return plan;
  }
  return getCachedPlan({ now });
}
