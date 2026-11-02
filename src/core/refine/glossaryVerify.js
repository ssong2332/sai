/**
 * 용어집 적용 서버 대조 (2026-11-02 실측 후 사용자 승인 「둘 다 고쳐」).
 *
 * 🔴 **실측한 결함 (팀 용어 「배포 → ABC」, 빠른 모드 6회)**: 2회는 교정문에 ABC가 없었다
 *    ("release" 1회 · "deployment" 1회). 그런데 모델은 `appliedGlossary`에
 *    `{id: 't1', appliedText: 'deployment'}`라고 **자기가 쓴 말을 적용했다고 신고**했고,
 *    화면 대조(`glossaryCheck.js`)는 「신고한 말이 교정문에 있는가」만 봐서 통과시켰다 —
 *    실브라우저에 「deployment」 초록 강조 + 「용어사전 1개 적용됨」이 떴다.
 *    모델의 신고는 증거가 아니다. **등록된 번역어**를 기준으로 서버가 다시 쓴다.
 *
 * 판정표 (이 표대로만 동작한다)
 * | 경우 | `appliedGlossary`에 남기는 것 | 화면 (`glossaryCheck.js` 그대로) |
 * |---|---|---|
 * | 원문에 그 용어가 있고 등록된 말이 교정문에 있다 | `appliedText` = 등록된 말 | 적용됨·초록 |
 * | 원문에 그 용어가 있는데 등록된 말이 교정문에 없다 | `appliedText` = 등록된 말 | 「반영되지 않았어요」 경고 |
 * | 등록된 말이 교정문에 원문보다 적게 나온다 | `appliedText` = 등록된 말 | 적용됨·초록 + 「일부만 반영됐어요」 경고 |
 * | 원문에 그 용어가 없다 | 뺀다 (모델이 신고했어도) | 표시 없음 |
 * | 요청에 없는 id를 모델이 신고했다 | 뺀다 | 표시 없음 |
 * | 요청에 용어집이 없다 | 모델 신고 그대로 (이전 동작) | 이전과 같음 |
 * | 같은 원문이 여러 항목 | 개인 > 팀 > 그 밖 — 첫 항목 하나만 | — |
 *
 * 등록된 말: `keepSource`면 원문 그대로, 아니면 `targetText`. 둘 다 없으면 대조하지 않는다.
 * 🔴 고쳐 쓰지 않는다 — 교정문은 건드리지 않고 신고 목록만 바로잡는다(`numberCheck.js`와 같은 원칙).
 * 🔴 Zero Retention: 입력 문자열은 이 함수 안에서만 쓰인다.
 */

import { occursIn } from './reasoning.js';

const SCOPE_RANK = { personal: 0, team: 1 };

function expectedText(entry) {
  if (entry?.keepSource) return String(entry.sourceText ?? '').trim();
  return String(entry?.targetText ?? '').trim();
}

/** 원문에 나오는 항목만, 같은 원문은 우선순위가 가장 높은 것 하나만. */
export function activeGlossaryEntries(glossary, sourceText) {
  const ranked = (Array.isArray(glossary) ? glossary : [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => occursIn(entry?.sourceText, sourceText) && expectedText(entry) !== '')
    .sort(
      (a, b) =>
        (SCOPE_RANK[a.entry.scope] ?? 2) - (SCOPE_RANK[b.entry.scope] ?? 2) || a.index - b.index,
    );
  const seen = new Set();
  const active = [];
  for (const { entry } of ranked) {
    const key = String(entry.sourceText).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    active.push(entry);
  }
  return active;
}

/**
 * `needle`이 `haystack`에 몇 번 나오는가 (겹치지 않게, 대소문자·공백 무시 — `occursIn`과 같은 잣대).
 * 🔴 정규식을 만들지 않는다 — 사용자 문자열을 패턴으로 해석하지 않는다(`reasoning.js`와 같은 원칙).
 */
export function countOccurrences(needle, haystack) {
  const norm = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const a = norm(needle);
  if (a === '') return 0;
  const h = norm(haystack);
  let count = 0;
  for (let at = h.indexOf(a); at !== -1; at = h.indexOf(a, at + a.length)) count += 1;
  return count;
}

/**
 * 원문에 나오는데 등록된 말이 교정문에 **원문보다 적게** 나오는 항목들 (2026-11-02 사용자 승인 「고쳐」).
 * 🔴 실측: 「배포 일정이 … 금요일 배포 전에 …」 + 「배포 → ABC」 → "The ABC schedule … before the Friday release" —
 *    한 곳만 바뀌어도 「있다」로 통과했다. 원문 횟수만큼 나와야 통과다. 0번이면 예전과 같은 「빠짐」이다.
 */
export function missingGlossaryEntries(refined, glossary, sourceText) {
  return activeGlossaryEntries(glossary, sourceText).filter(
    (entry) => countOccurrences(expectedText(entry), refined) < countOccurrences(entry.sourceText, sourceText),
  );
}

/**
 * 교정문에 등록된 말이 나온 횟수의 합 — 원문 횟수까지만 센다. 두 결과가 다 「일부만」일 때 어느 쪽이 나은지 가르는 데 쓴다.
 * 🔴 실측: 첫 결과 0곳 · 재호출 1곳(원문 2곳)인데 「둘 다 glossary」라 첫 결과(0곳)를 줬다.
 */
export function glossaryHitCount(refined, glossary, sourceText) {
  return activeGlossaryEntries(glossary, sourceText).reduce(
    (sum, entry) =>
      sum + Math.min(countOccurrences(expectedText(entry), refined), countOccurrences(entry.sourceText, sourceText)),
    0,
  );
}

/** 원문에 나오는데 등록된 말이 교정문에 없는 항목 수 — 약한 검사(`glossary`) 판정용. */
export function countMissingGlossary(refined, glossary, sourceText) {
  return missingGlossaryEntries(refined, glossary, sourceText).length;
}

/**
 * 재호출 payload에 빠진 용어를 짚는 한 줄을 붙인다 (2026-11-02 실브라우저 후속).
 *
 * 🔴 **실측**: 「배포 일정이 다음 주로 밀렸습니다. 금요일 배포 전에 QA …」 + 팀 「배포 → ABC」는 같은 payload로
 *    다시 불러도 5/5 「deployment」였다(같은 문장에 「배포 → rollout」은 5/5 반영). 코드처럼 생긴 말을 모델이
 *    일반 명사로 되돌린다 — 팀 코드명·제품명이 바로 이런 말이다. 같은 요청을 반복하면 같은 답이 온다.
 * 🔴 붙이는 것은 **용어(원문 → 등록된 말)뿐**이다 — 이미 payload의 `glossary`에 있는 값이고, 메시지 본문은 넣지 않는다.
 *    값은 `JSON.stringify`로 감싸 지시문이 아닌 데이터로 둔다(glossaryRules의 「USER DATA」 원칙).
 */
export function withGlossaryReminder(payload, missing) {
  if (!Array.isArray(missing) || missing.length === 0) return payload;
  const pairs = missing.map((entry) => `${JSON.stringify(entry.sourceText)} -> ${JSON.stringify(expectedText(entry))}`).join(', ');
  const note =
    ' RETRY NOTE: your previous answer did not use these registered glossary entries in every place the original has them: ' +
    pairs +
    '. Each target is a fixed name the user registered (it may look like a code, abbreviation or brand name) — ' +
    'write it exactly as given in EVERY place the original has the source phrase (once per occurrence), even if it looks unusual; ' +
    'do not replace it with a common word.';
  return { ...payload, instruction: `${payload.instruction}${note}` };
}

/** 모델 신고 대신 등록된 말로 `appliedGlossary`를 다시 만든다. 용어집이 없으면 그대로 둔다. */
export function reconcileAppliedGlossary(result, glossary, sourceText) {
  if (!Array.isArray(glossary) || glossary.length === 0) return result;
  const appliedGlossary = activeGlossaryEntries(glossary, sourceText).map((entry) => ({
    id: entry.id,
    sourceText: entry.sourceText,
    appliedText: expectedText(entry),
  }));
  return { ...result, appliedGlossary };
}
