/**
 * 3초 퀵 온보딩 (S11 / Spec 권장 9 F-15) — 내 언어 · 주 협업 지역 · 기본 톤 3문항.
 *
 * 🔴 **`partnerRegion`은 소통 언어 기본값을 정하는 데만 쓴다.** Spec 권장 9는 "주 협업 국가"를
 *    묻지만, 필수 2 3순위와 필수 9는 국가 기반 성향 추론을 금지한다. 두 요구가 충돌하는 것처럼
 *    보이지만 실제로는 아니다 — 우리가 이 값에서 끌어내는 것은 **"이 지역과는 어떤 언어로
 *    쓰는가"라는 사실 매핑뿐**이고, "이 나라 사람은 이런 성향이다"라는 추론은 하지 않는다.
 *    그래서 이 값은 `targetLanguage` 기본값 계산 외의 어떤 경로로도 나가지 않는다.
 *
 * 🔴 세 문항 모두 **고정 선택지**다(자유 입력 없음) — 프롬프트로 흘러가는 값에 자유 문자열을
 *    두지 않는다는 프로젝트 규칙(용어집·수신자 태그와 동일).
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

/**
 * 내 언어 — 교정 요청의 `sourceLanguage` 기본값이자 **해독 결과를 보여줄 언어**.
 *
 * 🔴 **일본어를 넣었다** (2026-08-20 사용자 결정 ⓓ). 코어는 7개(ko·en·zh·ja·de·fr·es)를
 *    받는데 이 목록이 3개뿐이라, **일본어로 문장을 쓰는 사용자는 다듬기 소스를 ja로 정할
 *    방법이 없었다** — 코어는 되는데 입구만 없는 상태였다(ja→en 실호출로 확인).
 * 🔴 de·fr·es는 **넣지 않았다**(사용자 결정). 넣어도 비용은 같지만 선택지가 7개로 늘어
 *    온보딩 첫 화면이 길어진다. 필요해지면 이 배열에 한 줄씩 더하면 된다 —
 *    `languagePairFrom`·`detectLanguage`·코어는 이미 그 값을 다룬다.
 */
export const MY_LANGUAGES = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'zh', label: '中文' },
];

/**
 * 주 협업 지역 → **실무 소통 언어**. 라벨에 언어를 함께 적어, 이 질문이 국민성이 아니라
 * 언어를 묻는 것임을 화면에서도 분명히 한다.
 */
export const PARTNER_REGIONS = [
  { id: 'english', label: '영어권', language: 'en' },
  { id: 'chinese', label: '중화권', language: 'zh' },
  { id: 'korean', label: '한국어권', language: 'ko' },
];

/**
 * 기본 톤 — S13의 1순위 협업 성향(`collabStyleId`)과 **같은 어휘를 쓴다.** 온보딩에서 고른 톤이
 * 곧 프로필 1순위가 되도록 연결해, 두 화면이 서로 다른 값을 말하는 상황을 만들지 않는다.
 */
export const DEFAULT_TONES = [
  { id: 'direct', label: '직접적으로' },
  { id: 'warm', label: '부드럽게' },
  { id: 'brief', label: '짧게' },
];

const EMPTY = { language: null, partnerRegion: null, tone: null, completedAt: null };

export async function getOnboarding() {
  return getLocal(STORAGE_KEYS.ONBOARDING, EMPTY);
}

/** 온보딩을 아직 끝내지 않았으면 true — 사이드패널이 이때만 질문을 띄운다. */
export async function needsOnboarding() {
  const stored = await getOnboarding();
  return !stored?.completedAt;
}

/**
 * 온보딩 결과를 저장한다.
 * 🔴 기본 톤은 S13 프로필의 `collabStyleId`에도 함께 반영한다 — 온보딩에서 "짧게"를 골랐는데
 *    프로필 1순위가 비어 있으면, 사용자가 답한 것이 교정에 아무 영향도 주지 않는다.
 */
export async function saveOnboarding({ language, partnerRegion, tone }) {
  const next = {
    language: language ?? null,
    // 🔴 화면에서는 더 이상 묻지 않지만, 이미 저장된 값은 그대로 지킨다(위 주석).
    partnerRegion: partnerRegion ?? null,
    tone: tone ?? null,
    completedAt: new Date().toISOString(),
  };
  await setLocal(STORAGE_KEYS.ONBOARDING, next);

  if (tone) {
    // 순환 import를 피하려고 지연 로드한다(profile.js는 storage.js만 의존).
    const { setProfile } = await import('./profile.js');
    await setProfile({ collabStyleId: tone });
  }
  return next;
}

/** 다시 하기 — 저장값을 지워 질문이 다시 뜨게 한다. */
export async function resetOnboarding() {
  await setLocal(STORAGE_KEYS.ONBOARDING, EMPTY);
}

/**
 * 교정 요청에 쓸 언어쌍 기본값.
 * 🔴 여기가 `partnerRegion`이 쓰이는 **유일한 지점**이다(위 헤더 주석 참조).
 *
 * @returns {{sourceLanguage: string, targetLanguage: string}}
 */
export function languagePairFrom(onboarding) {
  const sourceLanguage = MY_LANGUAGES.find((item) => item.id === onboarding?.language)?.id ?? 'ko';
  const region = PARTNER_REGIONS.find((item) => item.id === onboarding?.partnerRegion);
  // 상대 언어가 내 언어와 같으면 교정할 방향이 없다 — 기본값(en)으로 되돌린다.
  const targetLanguage =
    region && region.language !== sourceLanguage ? region.language : sourceLanguage === 'en' ? 'ko' : 'en';
  return { sourceLanguage, targetLanguage };
}

/** 화면 표시용 라벨. 모르는 id는 null — 지어내지 않는다. */
export function onboardingLabels(onboarding) {
  return {
    language: MY_LANGUAGES.find((item) => item.id === onboarding?.language)?.label ?? null,
    partnerRegion: PARTNER_REGIONS.find((item) => item.id === onboarding?.partnerRegion)?.label ?? null,
    tone: DEFAULT_TONES.find((item) => item.id === onboarding?.tone)?.label ?? null,
  };
}
