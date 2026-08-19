/**
 * 개인 용어집 CRUD (S12 / Spec 필수 7).
 *
 * 🔴 범위: **개인** 탭만 실제 CRUD다. 팀/연동 탭은 S02(팀 계정)·외부 연동이 없어 아직 데이터가
 *    없다는 사실을 그대로 보여준다(지어내지 않는다) — `App.jsx`의 `empty` 문구가 그 역할이다.
 * 🔴 범위: `entryType`은 **term(용어 대응쌍)만** 다룬다. 사람 이름·호칭(`entryType:'person'`)은
 *    `src/core/refine/prompt.js`의 `glossaryRules()`가 이미 프롬프트 차원에서 지원하지만,
 *    Spec 필수 7·사이드패널 화면 모두 "용어 사전"만 요구한다 — 호칭 관리 UI는 범위 밖(만들지 않음).
 * 🔴 우선순위(개인 > 팀/연동 > 기본 AI)는 여기서 정하지 않는다 — `scope` 태그만 붙여 보내고,
 *    실제 우선순위 적용은 프롬프트(`glossaryRules()`)가 규칙으로 강제한다.
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

/**
 * 🔴 **데모 시드를 제거했다** (2026-08-15 사용자 요청).
 *
 * 「배포→rollout」·「사이(원문 유지)」·「기획서→product spec」·「갈아엎다→rework from scratch」
 * 네 개가 신규 설치 시 자동으로 심어졌다. 그런데 용어집은 **교정 결과를 실제로 바꾸는 설정**이다 —
 * 사용자가 등록한 적 없는 대응쌍이 조용히 문장에 적용되고, 화면에는 「용어사전 1개 적용됨」이라고만
 * 뜬다. 자기가 넣지 않은 규칙이 자기 메시지를 고치는 것은 **가짜 데이터를 보여주는 것보다 나쁘다**
 * (S33·S45는 보기만 했지만 이건 상대에게 나가는 문장을 바꾼다).
 * 🔴 시드가 사라졌으므로 아래 「저장된 적 없음(null) vs 비어 있음([])」 구분도 의미가 없어졌다 —
 *    둘 다 빈 목록으로 취급한다.
 */

function makeId() {
  return `gl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 개인 용어집을 읽는다. 등록한 적이 없으면 빈 목록이다 — 아무것도 심지 않는다. */
export async function listPersonalGlossary() {
  const stored = await getLocal(STORAGE_KEYS.GLOSSARY_PERSONAL, null);
  return Array.isArray(stored) ? stored : [];
}

/** @throws {Error} sourceText가 비어 있거나, keepSource가 아닌데 targetText도 없을 때. */
function validateEntry({ sourceText, targetText, keepSource }) {
  if (!sourceText || !sourceText.trim()) throw new Error('원문(sourceText)은 비워둘 수 없어요');
  if (!keepSource && !(targetText && targetText.trim())) {
    throw new Error('번역어를 넣거나 [원문 유지]를 선택해 주세요');
  }
}

/**
 * @param {{sourceText: string, targetText?: string|null, keepSource?: boolean}} input
 * @returns {Promise<object>} 생성된 엔트리(id 포함).
 */
export async function addPersonalGlossaryEntry(input) {
  validateEntry(input);
  const entry = {
    id: makeId(),
    sourceText: input.sourceText.trim(),
    targetText: input.keepSource ? null : input.targetText.trim(),
    keepSource: !!input.keepSource,
    /**
     * 🔴 **어느 언어로 쓸 때 적용할 용어인가** (2026-08-16 사용자 승인 ④).
     *    문제: 항목에는 `targetText` 하나뿐인데 프롬프트는 "나오면 **그대로** 쓰라"고 지시한다.
     *    그래서 팀 용어집에 `배포 → deployment`가 있으면 **중국어 출력에 영어 단어가 박혔다.**
     *    한 팀이 여러 언어로 소통하면 해결할 방법이 없었다.
     * 🔴 **`null`은 「전 언어」다** — 기존 항목은 전부 `null`이라 지금까지와 똑같이 동작한다.
     *    이 필드를 필수로 만들면 이미 등록한 용어가 전부 안 걸리게 되므로 그렇게 하지 않는다.
     */
    language: normalizeLanguage(input.language),
  };
  const list = await listPersonalGlossary();
  /**
   * 🔴 **같은 원문을 두 번 등록하지 않는다** (2026-08-16 실측: 「배포 → rollout」과
   *    「배포 → deployment」가 나란히 남아 있었다). 같은 낱말에 규칙이 둘이면 **어느 쪽이
   *    적용되는지 아무도 모르고**, 모델이 그때그때 다르게 고른다.
   * 🔴 **덮어쓴다** — 나중에 넣은 값을 쓴다. 사용자가 방금 친 것이 지금 의도다.
   */
  /**
   * 🔴 **같은 원문 + 같은 언어**일 때만 덮어쓴다 (2026-08-16 ④에서 조건이 하나 늘었다).
   *    원문만 보면 `배포 → deployment(영어)`를 넣은 뒤 `배포 → 部署(중국어)`를 넣을 때
   *    **영어 항목이 지워진다** — 다국어 팀에서 쓸 수 없게 된다.
   */
  const index = list.findIndex(
    (item) =>
      item.sourceText.trim().toLowerCase() === entry.sourceText.toLowerCase() &&
      (item.language ?? null) === entry.language,
  );
  const next = index === -1 ? [entry, ...list] : list.map((item, i) => (i === index ? { ...entry, id: item.id } : item));
  await setLocal(STORAGE_KEYS.GLOSSARY_PERSONAL, next);
  return next[index === -1 ? 0 : index];
}

/** @returns {Promise<object|null>} 갱신된 엔트리. id가 없으면 null. */
export async function updatePersonalGlossaryEntry(id, patch) {
  const list = await listPersonalGlossary();
  const index = list.findIndex((entry) => entry.id === id);
  if (index === -1) return null;

  const merged = { ...list[index], ...patch };
  validateEntry(merged);
  merged.sourceText = merged.sourceText.trim();
  merged.targetText = merged.keepSource ? null : merged.targetText?.trim();
  merged.language = normalizeLanguage(merged.language);

  const next = [...list];
  next[index] = merged;
  await setLocal(STORAGE_KEYS.GLOSSARY_PERSONAL, next);
  return merged;
}

/** @returns {Promise<boolean>} 실제로 지워졌으면 true. */
export async function removePersonalGlossaryEntry(id) {
  const list = await listPersonalGlossary();
  const next = list.filter((entry) => entry.id !== id);
  if (next.length === list.length) return false;
  await setLocal(STORAGE_KEYS.GLOSSARY_PERSONAL, next);
  return true;
}

/**
 * 저장된 엔트리를 `/v1/refine` payload의 `glossary` 필드 형태로 바꾼다
 * (`src/core/refine/prompt.js`의 `glossaryRules()` 계약과 맞춰야 한다).
 */
export function toRefinePayloadGlossary(entries, targetLanguage = null) {
  return filterByLanguage(entries, targetLanguage).map((entry) => ({
    id: entry.id,
    entryType: 'term',
    scope: 'personal',
    sourceText: entry.sourceText,
    targetText: entry.targetText ?? null,
    keepSource: !!entry.keepSource,
  }));
}

/** 용어에 붙일 수 있는 언어 — 수신자 언어 목록과 같아야 한다(`lib/recipients.js`). */
export const GLOSSARY_LANGUAGES = ['en', 'zh', 'ja', 'de', 'fr', 'es', 'ko'];

/** 🔴 목록 밖 값은 `null`(전 언어)로 떨어뜨린다 — 없는 언어로 잠기면 영영 안 걸린다. */
export function normalizeLanguage(value) {
  return GLOSSARY_LANGUAGES.includes(value) ? value : null;
}

/**
 * 지금 쓰는 언어에 해당하는 항목만 남긴다.
 *
 * 🔴 **언어가 없는 항목은 항상 남는다** — 기존 데이터 전부가 여기 해당한다. 필터가 옛 용어를
 *    조용히 무력화하면, 사용자는 "용어집이 갑자기 안 먹는다"만 겪고 원인을 알 수 없다.
 * 🔴 `targetLanguage`를 모르면(null) **거르지 않는다** — 모를 때 빼는 쪽이 더 위험하다.
 */
export function filterByLanguage(entries, targetLanguage) {
  if (!targetLanguage) return entries;
  return entries.filter((entry) => {
    const lang = entry.language ?? null;
    return lang === null || lang === targetLanguage;
  });
}

/**
 * 같은 원문이 여러 번 있는 항목을 하나로 줄인다 (2026-08-16).
 *
 * 🔴 **덮어쓰기 규칙을 넣기 전에 쌓인 중복은 그대로 남는다.** 「배포 → rollout」과
 *    「배포 → deployment」가 나란히 있으면 어느 쪽이 적용되는지 아무도 모르고, 모델이 그때그때
 *    다르게 고른다 — 화면에서 지우게 하는 대신 한 번에 정리한다.
 * 🔴 **먼저 나온 것을 남긴다.** 목록은 최신이 위이므로(추가 시 `[entry, ...list]`) 결과적으로
 *    **가장 최근에 등록한 값**이 살아남는다 — 사용자가 마지막에 친 것이 지금 의도다.
 * @returns {Promise<number>} 지운 개수.
 */
export async function dedupePersonalGlossary() {
  const list = await listPersonalGlossary();
  const seen = new Set();
  const kept = [];
  for (const entry of list) {
    const key = String(entry.sourceText ?? '').trim().toLowerCase();
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    kept.push(entry);
  }
  const removed = list.length - kept.length;
  if (removed > 0) await setLocal(STORAGE_KEYS.GLOSSARY_PERSONAL, kept);
  return removed;
}
