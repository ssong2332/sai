/**
 * 승인 문장 스니펫 저장소 (S20 / Spec 권장 10 F-16).
 *
 * 🔴 **Zero Retention과의 관계 — 반드시 읽을 것** (`docs/ZeroRetention.md`의 "단서" 절):
 *    이 모듈은 교정문(=메시지 본문 파생 텍스트)을 저장하는 **유일한 영속 경로**다. 필수 5가
 *    막으려는 것은 "사용자가 요청하지도 않았는데 시스템이 본문을 남기는 것"이고, 스니펫은
 *    사용자가 버튼을 눌러 자기 문장을 자기 기기에 두는 것이라 성격이 다르다. 다만 그 구분은
 *    아래 세 조건이 **전부** 지켜질 때만 성립한다:
 *      ① 사용자의 명시적 행동으로만 저장 — 자동 저장·히스토리 금지
 *      ② `chrome.storage.local`에만 저장 — 🔴 서버·Firestore·`chrome.storage.sync` 전송 금지
 *         (sync는 구글 계정을 통해 기기 밖으로 나간다)
 *      ③ 언제든 개별 삭제 가능
 *    이 파일에 서버 전송 코드를 추가하려는 순간 위반이다.
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

/** 저장 상한 — 무한히 쌓이면 사용자가 관리할 수 없고, 본문 보관량만 늘어난다. */
export const MAX_SNIPPETS = 50;

function makeId() {
  return `sn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function listSnippets() {
  const stored = await getLocal(STORAGE_KEYS.SNIPPETS, null);
  return Array.isArray(stored) ? stored : [];
}

/**
 * 스니펫을 저장한다. 같은 문장을 또 저장하면 새로 만들지 않고 기존 것을 최신으로 올린다 —
 * 같은 문장이 여러 벌 쌓이면 목록이 금세 못 쓰게 된다.
 *
 * @param {{text: string, language?: string｜null}} input
 * @returns {Promise<{ok: boolean, reason?: string, entry?: object}>}
 */
export async function addSnippet({ text, language = null }) {
  const body = String(text ?? '').trim();
  if (!body) return { ok: false, reason: 'empty' };

  const list = await listSnippets();
  const existing = list.find((entry) => entry.text === body);
  if (existing) {
    const next = [
      { ...existing, savedAt: new Date().toISOString() },
      ...list.filter((entry) => entry.id !== existing.id),
    ];
    await setLocal(STORAGE_KEYS.SNIPPETS, next);
    return { ok: true, reason: 'duplicate', entry: next[0] };
  }

  if (list.length >= MAX_SNIPPETS) return { ok: false, reason: 'full' };

  const entry = {
    id: makeId(),
    text: body,
    language,
    savedAt: new Date().toISOString(),
    useCount: 0,
  };
  await setLocal(STORAGE_KEYS.SNIPPETS, [entry, ...list]);
  return { ok: true, entry };
}

/** 권장 10 — 원클릭 재사용. 사용 횟수는 목록 정렬용 **수치**일 뿐이다. */
export async function markSnippetUsed(id) {
  const list = await listSnippets();
  const index = list.findIndex((entry) => entry.id === id);
  if (index === -1) return null;
  const next = [...list];
  next[index] = { ...next[index], useCount: (next[index].useCount ?? 0) + 1 };
  await setLocal(STORAGE_KEYS.SNIPPETS, next);
  return next[index];
}

/** 🔴 개별 삭제 — Zero Retention 단서 ③의 조건이다. 빼면 안 된다. */
export async function removeSnippet(id) {
  const list = await listSnippets();
  const next = list.filter((entry) => entry.id !== id);
  if (next.length === list.length) return false;
  await setLocal(STORAGE_KEYS.SNIPPETS, next);
  return true;
}

export async function clearSnippets() {
  await setLocal(STORAGE_KEYS.SNIPPETS, []);
}
