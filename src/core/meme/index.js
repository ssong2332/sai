/**
 * 캐주얼 톤 표현 제공 (S16 / Spec 필수 8).
 *
 * 🔴 **여기가 유일한 출구다.** 시드든 자동 수집분이든 `checkWorkSafe()`를 통과한 것만 나간다 —
 *    "시드는 우리가 만들었으니 믿어도 된다"고 필터를 건너뛰면, 나중에 수집분이 같은 경로로
 *    들어올 때 막을 지점이 사라진다.
 */

import { filterWorkSafe } from './worksafe.js';
import { MEME_SEED, seedForLanguage } from './seed.js';

export { checkWorkSafe, filterWorkSafe, BLOCK_REASONS } from './worksafe.js';
export { MEME_SEED, seedForLanguage } from './seed.js';

/**
 * 프롬프트에 실을 표현 개수 상한.
 *
 * 🔴 **2026-08-18 실측: 이 값을 늘려도 결과가 달라지지 않는다.** 원래 주석은 "너무 많이 실으면
 *    모델이 억지로 끼워 넣는다(실측 아님, 보수적 상한)"였다. 그 걱정을 검증하려고 일정 조율
 *    문장에 **딱 맞는 표현 4개**(`let's sync`, `touch base`, `align on`, `heads-up`)를 직접
 *    실어 보냈는데 — **하나도 쓰이지 않았다.**
 * 🔴 즉 병목은 목록이 아니라 `casualToneRules`의 「never force one in / using none of them is
 *    fine」이다. 그 문구가 충분히 강해서 모델이 항상 「하나도 안 쓰기」를 고른다.
 *    **그 문구를 푸는 것은 업무 메시지에 관용구를 억지로 넣는 위험과 맞바꾸는 일**이라 하지 않았다.
 *    상한을 올리는 것은 토큰만 늘리고 얻는 것이 없다 — 6으로 둔다.
 */
const MAX_EXPRESSIONS = 6;

/**
 * `/v1/refine` payload에 실을 캐주얼 톤 블록을 만든다.
 *
 * @param {string} language 교정문 언어(밈은 **언어**에 붙는다 — 국적이 아니라).
 * @param {boolean} casual 사용자가 캐주얼 톤을 켰는지. 🔴 끄면 null — 밈을 자동 삽입하지 않는다.
 * @returns {{expressions: {text: string, meaning: string}[]}|null}
 */
export function buildCasualToneBlock(language, casual) {
  if (!casual) return null;
  const safe = filterWorkSafe(seedForLanguage(language)).slice(0, MAX_EXPRESSIONS);
  if (safe.length === 0) return null;
  return {
    expressions: safe.map((entry) => ({ text: entry.text, meaning: entry.meaning })),
  };
}

/* ── 밈 해설 (S19 / Spec 권장 4 후반부) ──────────────────────────────────
 *
 * 🔴 위의 `buildCasualToneBlock`과 **방향이 반대다.** 저건 "모델에게 이런 표현을 써도 된다"고
 *    실어 보내는 것(출력 조작)이고, 아래는 "돌아온 문장에 이런 표현이 있으니 뜻을 알려 준다"는
 *    것(표시)이다. 그래서 캐주얼 톤이 꺼져 있어도 아래는 동작한다 — 톤을 껐다고 모델이 관용
 *    표현을 안 쓰는 게 아니고, **모르는 표현을 그대로 보내는 것**이 여기서 막으려는 사고다.
 * 🔴 표시만 한다. 문장을 바꾸지 않는다(이모지 자동 교체와 다른 점).
 */

/**
 * 해설을 붙일 표현 목록.
 *
 * 🔴 **언어로 거르지 않는다**(2026-08-14 판단). `/v1/refine` 응답에 교정문 언어가 실려 오지 않아
 *    화면 쪽에서 알 방법이 없고, 애초에 거를 필요가 없다 — 중국어 표현이 영어 교정문에서
 *    걸릴 일이 없다. 없는 정보를 추측해 거르느니 전부 대조하는 편이 틀릴 여지가 적다.
 *
 * @param {boolean} casual 캐주얼 톤 on/off. 끄면 `explainAlways`인 표현만 남는다 (seed.js 참조).
 * @returns {{id: string, text: string, meaning: string}[]}
 */
export function memeGlossary(casual = false) {
  return filterWorkSafe(MEME_SEED)
    .filter((entry) => casual || entry.explainAlways)
    .map((entry) => ({ id: entry.id, text: entry.text, meaning: entry.meaning }));
}

/** 라틴 문자 낱말 경계 판정용 — 영어 표현이 다른 단어 안에 박혀 걸리는 것을 막는다. */
const LATIN_WORD_CHAR = /[A-Za-z0-9]/;

/**
 * 앞뒤가 같은 낱말의 일부가 아닌지 본다.
 * 🔴 한자·한글에는 낱말 경계 개념이 없어 **라틴 문자로 시작/끝나는 표현에만** 적용한다
 *    (`收到`를 경계로 거르면 `我收到了`에서 아예 안 걸린다).
 */
function hasWordBoundary(source, start, end) {
  if (LATIN_WORD_CHAR.test(source[start])) {
    const before = source[start - 1];
    if (before && LATIN_WORD_CHAR.test(before)) return false;
  }
  if (LATIN_WORD_CHAR.test(source[end - 1])) {
    const after = source[end];
    if (after && LATIN_WORD_CHAR.test(after)) return false;
  }
  return true;
}

/**
 * 문장에서 밈 표현 구간을 찾는다.
 *
 * 🔴 **정규식을 만들지 않는다** — 용어집 하이라이트와 같은 이유다. 표현 문자열이 패턴으로
 *    해석되면 안 되고, 나중에 수집분이 들어오면 남의 데이터가 정규식이 되는 셈이 된다.
 * 🔴 대소문자를 무시한다 — 모델이 문장 첫머리에서 `Heads-up`으로 대문자를 쓴다.
 *    다만 **화면에 보여줄 때는 원문 그대로** 잘라 쓴다(시드의 소문자로 바꿔치지 않는다).
 * 🔴 겹치면 먼저 시작한 쪽만 남긴다 — 겹쳐 그리면 마크업이 깨진다(`findRiskySpans`와 동일 규칙).
 *
 * @param {string} text
 * @param {{id: string, text: string, meaning: string}[]} entries `memeGlossary()` 결과.
 * @returns {{start: number, end: number, body: string, meaning: string}[]} start 오름차순.
 */
export function findMemeSpans(text, entries) {
  const source = String(text ?? '');
  if (!source || !Array.isArray(entries) || entries.length === 0) return [];
  const lower = source.toLowerCase();

  const spans = [];
  for (const entry of entries) {
    const needle = String(entry?.text ?? '').toLowerCase();
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const index = lower.indexOf(needle, from);
      if (index === -1) break;
      const end = index + needle.length;
      if (hasWordBoundary(source, index, end)) {
        spans.push({ start: index, end, body: source.slice(index, end), meaning: entry.meaning });
      }
      // 🔴 `end`가 아니라 +1에서 다시 찾는다 — 다른 표현과 겹치는 후보를 통째로 건너뛰지 않기
      //    위해서다. 겹침 정리는 아래에서 한 번에 한다.
      from = index + 1;
    }
  }

  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const span of spans) {
    const last = kept[kept.length - 1];
    if (last && span.start < last.end) continue;
    kept.push(span);
  }
  return kept;
}
