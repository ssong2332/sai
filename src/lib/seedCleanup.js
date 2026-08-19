/**
 * 예전에 자동으로 심어진 데모 데이터 청소 (2026-08-15 사용자 요청).
 *
 * 🔴 **코드에서 시드를 지우는 것만으로는 부족하다.** 이미 설치해 쓰던 사람의
 *    `chrome.storage.local`에는 그대로 남아 있고, 그 값들은 **교정 결과를 실제로 바꾼다**
 *    (용어집은 문장을 치환하고, 수신자 태그는 프롬프트에 실리며 타임존은 퇴근 요정·회의 추천의
 *    기준이 된다). 화면에서 지워 주지 않으면 사용자는 자기가 넣은 적 없는 규칙이 자기 메시지를
 *    고치는 것을 계속 겪는다.
 *
 * 🔴 **사용자가 손댄 것은 건드리지 않는다.** id가 우리 시드의 것이면서 **내용까지 그대로일 때만**
 *    지운다. 「배포 → rollout」을 「배포 → deploy」로 고쳐 쓰고 있었다면 그건 이제 사용자의
 *    데이터다 — 우리가 심었다는 이유로 지우면 남의 설정을 지우는 것이다.
 *
 * 🔴 **한 번만 돈다.** 지운 뒤 다시 등록한 사람의 것을 다음 실행에서 또 지우면 안 된다.
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

/** 지웠는지 여부만 남기는 플래그. 🔴 내용은 저장하지 않는다. */
const DONE_KEY = 'sai.seedCleanup.v1';

/** 예전 `glossary.js`가 심던 값 — id와 내용이 **둘 다** 맞아야 지운다. */
const LEGACY_GLOSSARY = [
  { id: 'gl-1', sourceText: '배포', targetText: 'rollout' },
  { id: 'gl-2', sourceText: '사이', targetText: 'Sai' },
  { id: 'gl-3', sourceText: '기획서', targetText: 'product spec' },
  { id: 'gl-4', sourceText: '갈아엎다', targetText: 'rework from scratch' },
];

/** 예전 `recipients.js`가 심던 값. */
const LEGACY_RECIPIENTS = [
  { id: 'rc-miguel', name: 'Miguel', timeZone: 'Europe/Berlin' },
  { id: 'rc-sarah', name: 'Sarah', timeZone: 'America/New_York' },
];

function matchesLegacy(entry, legacyList, fields) {
  const legacy = legacyList.find((item) => item.id === entry?.id);
  if (!legacy) return false;
  return fields.every((field) => (entry?.[field] ?? '') === (legacy[field] ?? ''));
}

/**
 * 남아 있는 데모 시드를 지운다. 이미 돌았으면 아무 일도 하지 않는다.
 * @returns {Promise<{glossary: number, recipients: number}>} 지운 개수.
 */
export async function removeLegacySeeds() {
  const done = await getLocal(DONE_KEY, false);
  if (done === true) return { glossary: 0, recipients: 0 };

  let glossaryRemoved = 0;
  let recipientsRemoved = 0;

  try {
    const glossary = await getLocal(STORAGE_KEYS.GLOSSARY_PERSONAL, null);
    if (Array.isArray(glossary)) {
      const kept = glossary.filter(
        (entry) => !matchesLegacy(entry, LEGACY_GLOSSARY, ['sourceText', 'targetText']),
      );
      glossaryRemoved = glossary.length - kept.length;
      if (glossaryRemoved > 0) await setLocal(STORAGE_KEYS.GLOSSARY_PERSONAL, kept);
    }

    const recipients = await getLocal(STORAGE_KEYS.RECIPIENTS, null);
    if (Array.isArray(recipients)) {
      const kept = recipients.filter(
        (person) => !matchesLegacy(person, LEGACY_RECIPIENTS, ['name', 'timeZone']),
      );
      recipientsRemoved = recipients.length - kept.length;
      if (recipientsRemoved > 0) await setLocal(STORAGE_KEYS.RECIPIENTS, kept);
    }

    // 🔴 성공했을 때만 플래그를 세운다 — 중간에 실패하면 다음 실행에서 다시 시도해야 한다.
    await setLocal(DONE_KEY, true);
  } catch {
    /* 다음 실행에서 다시 시도된다. 청소 실패가 패널을 막지 않는다. */
  }

  return { glossary: glossaryRemoved, recipients: recipientsRemoved };
}
