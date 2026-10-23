/**
 * 숫자 보존 검사 (L31, 2026-10-23).
 *
 * 🔴 **실측한 결함**: 회귀 실측(L30 ④ Groq)에서 교정문이 원문의 숫자를 **조용히 빠뜨렸다** —
 *    「서버 응답이 평소 200ms에서 3초로 늘었습니다」 → 영어 교정문에 `200ms`가 없었다(P-04·D-05).
 *    문장은 매끄럽고 역번역만 보면 놓치기 쉽다. 숫자는 업무 메시지에서 가장 비싼 정보라
 *    모델과 무관하게 **코드가 대조한다.**
 *
 * 🔴 **고쳐 쓰지 않는다. 표시만 한다.** `names.js`·`missing.js`·`reply/verify.js`와 같은 규칙 —
 *    빠진 숫자를 우리가 끼워 넣으면 어느 자리에 무슨 단위로 넣을지 우리가 맞다는 근거가 없다.
 *
 * 🔴 **틀릴 거면 「못 잡는」 쪽으로 틀린다.** 오탐이 잦으면 사용자는 경고 전체를 흘려본다
 *    (S42·S44 교훈). 그래서 비대칭으로 설계했다:
 *    - 원문 쪽: 숫자 하나마다 **받아 줄 수 있는 표기를 넓게** 만든다(3,000만 → 3000·30000000).
 *    - 교정문 쪽: 보이는 숫자를 **해석 가능한 모든 값으로** 모은다(30 million → 30·30000000).
 *    해석을 더할수록 경고는 **줄어들기만** 한다 — 어떤 규칙을 더해도 새 오탐은 생기지 않는다.
 *
 * 판정표 (2026-10-23, 이 표대로만 동작한다)
 * | 원문의 숫자 형태                              | 교정문에 이것 중 하나가 있으면 통과                     |
 * |---|---|
 * | 정수·소수 `200`·`3.5`                          | 같은 값(`3,5` 유럽식 소수 포함)                        |
 * | 쉼표 묶음 `3,000`                              | `3000`·`3,000`·`3.000`(독일식)                          |
 * | 배수 단위 `3,000만`·`5천만`·`3M`·`3k`          | 원래 수 **또는** 곱한 값(`30,000,000`·`30 million`·`3천만`) |
 * | 한국어 복합 `3억 5천만`                        | 합계(`350 million`) **또는** 각 숫자 전부              |
 * | 시간 단위 `200ms`·`3초`·`5분`·`2시간`           | 같은 값 **또는** 단위 환산값(`0.2 s`·`3000 ms`·`300 seconds`) |
 * | `14시`·`14:00`                                 | 14 **또는** 12시간제 2(`2 PM`), `:00`은 생략 허용      |
 * | 날짜 `8/4`·`2026-08-04`·`8월`                  | 각 숫자 — 12 이하는 **월 이름**으로도(`Aug 4, 2026`)   |
 * | 풀어 쓴 수(교정문 쪽) `three`·`drei`·`三`·`세 가지` | 그 숫자                                             |
 * | **검사하지 않음**                              | 값 `1`(→ "a/an" 등 표기가 너무 많다) · 줄머리 목록 번호 `1.` · 기간 복합 `1시간 30분`(→ "an hour and a half") |
 * | 그 밖에 모르는 형태                           | 각 숫자가 따로 있으면 통과(보수적)                      |
 *
 * 🔴 **알려진 한계(못 잡거나 잡으면 안 되는 것)** — 오탐 쪽:
 *    - 단위 사이 환산 중 시간 외 단위(`14일` → "two weeks"는 7배만 받는다 — `주`·`일` 환산만)
 *    - 통화 환산(`3,000만원` → `$22,000`)은 **경고가 뜬다** — 이 경우는 사용자가 실제로 확인할 값이다.
 *    놓치는 쪽: 교정문에 같은 숫자가 **다른 뜻으로** 있으면 통과한다(대조는 값 단위라 위치를 보지 않는다).
 *
 * 🔴 Zero Retention: 입력 문자열은 이 함수 안에서만 쓰이고 어디에도 저장·기록되지 않는다.
 */

import {
  NAMED_TIME_GROUPS,
  NUMBER_PATTERN,
  NUMBER_WORDS,
  occursAsWord,
} from '../reply/verify.js';

/** 전각 숫자(`２００`)는 반각으로 — 일본어·중국어 교정문에서 실제로 나온다. */
function normalizeDigits(text) {
  return String(text ?? '').replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 비교 키. 🔴 부동소수 오차(`3.5 * 1e6`)·앞자리 0(`08`)·끝자리 0(`3.50`)이 같은 값으로 모이게 한다.
 * @returns {string|null}
 */
function keyOf(n) {
  if (!Number.isFinite(n)) return null;
  return String(Number(n.toPrecision(12)));
}

/** 한·중·일 배수 글자. 「천만」처럼 이어지면 곱한다(1e3 × 1e4). */
const CJK_MULTIPLIERS = {
  십: 10, 백: 100, 천: 1e3, 만: 1e4, 억: 1e8, 조: 1e12,
  十: 10, 百: 100, 千: 1e3, 万: 1e4, 萬: 1e4, 亿: 1e8, 億: 1e8,
};
const CJK_CHAIN = /^\s?([십백천만억조十百千万萬亿億]+)/;

/**
 * 영문 배수. 🔴 뒤에 영문자가 이어지면 배수가 아니다 — `200ms`의 `m`, `3 months`의 `m`.
 *    소문자 `m`(미터일 수도 있다)도 받는다: 해석을 더하는 것은 경고를 줄이기만 한다(헤더 참조).
 */
/**
 * 🔴 복수형·독불서 표기도 받는다 — 「120 millions de wons」(불)에서 `millions`를 못 읽어
 *    멀쩡한 「1억 2천만원」이 경고로 떴다(2026-10-23 탐침). `mil`은 서반아어로 천, 약어로 백만이라
 *    둘 다로 읽는다.
 */
const LATIN_MULTIPLIER =
  /^\s?(thousands?|tausend|millions?|millionen|millones|mio|billions?|milliards?|milliarden|mrd|trillions?|mn|bn|mil|k|m|b)(?![a-z])/i;
const LATIN_MULTIPLIER_VALUES = {
  thousand: [1e3], thousands: [1e3], tausend: [1e3], k: [1e3],
  million: [1e6], millions: [1e6], millionen: [1e6], millones: [1e6], mio: [1e6], mn: [1e6], m: [1e6],
  mil: [1e3, 1e6],
  billion: [1e9, 1e12], billions: [1e9], milliard: [1e9], milliards: [1e9], milliarden: [1e9], mrd: [1e9],
  bn: [1e9], b: [1e9],
  trillion: [1e12], trillions: [1e12],
};

/** 숫자 바로 뒤의 배수 — 해석이 갈리면 전부(없으면 빈 배열). */
function readMultipliers(after) {
  const cjk = after.match(CJK_CHAIN);
  if (cjk) return [[...cjk[1]].reduce((acc, ch) => acc * CJK_MULTIPLIERS[ch], 1)];
  const latin = after.match(LATIN_MULTIPLIER);
  if (latin) return LATIN_MULTIPLIER_VALUES[latin[1].toLowerCase()] ?? [];
  return [];
}

/**
 * 토큰 하나를 값으로 읽는다. 여러 해석이 가능하면 **전부** 돌려준다.
 * @returns {number[]|null} 값으로 읽을 수 없는 묶음(날짜·시각·범위·버전)이면 null.
 */
function parseNumberToken(tok) {
  if (/^\d+(?:\.\d+)?$/.test(tok)) {
    const out = [Number(tok)];
    // `3.000`은 독일식 천 단위일 수 있다 — 3과 3000 둘 다로 읽는다.
    if (/^\d{1,3}\.\d{3}$/.test(tok)) out.push(Number(tok.replace('.', '')));
    return out;
  }
  // 🔴 쉼표 묶음 `3,000`·`30,000,000` — 쉼표를 빼고 하나의 값으로. 따로 자르면 `3`·`000`이 된다.
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(tok)) {
    const out = [Number(tok.replace(/,/g, ''))];
    if (/^\d{1,3},\d{3}$/.test(tok)) out.push(Number(tok.replace(',', '.'))); // 유럽식 소수일 수도
    return out;
  }
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(tok)) {
    return [Number(tok.replace(/\./g, '').replace(',', '.'))]; // 독일식 `30.000.000`·`1.234,5`
  }
  if (/^\d+,\d+$/.test(tok)) return [Number(tok.replace(',', '.'))]; // 유럽식 소수 `3,5`
  return null;
}

/** 묶음 토큰(`8/4`·`14:00`·`2026-08-04`)의 각 숫자. */
function splitParts(tok) {
  return tok.split(/[.,:/-]/).map(Number).filter(Number.isFinite);
}

/**
 * 시간 단위 → 환산값. 🔴 모델이 `200ms`를 `0.2 seconds`로 바꾸는 것은 누락이 아니다.
 * 단위 표기는 원문·교정문 어디서 왔든 같은 규칙으로 읽는다.
 */
const UNIT_CONVERSIONS = [
  { pattern: /^\s?(?:ms|밀리초|millisecond)/i, factors: [1 / 1000] },
  { pattern: /^\s?(?:초|秒|s(?![a-z])|sec|second)/i, factors: [1000, 1 / 60] },
  { pattern: /^\s?(?:분|分|min)/i, factors: [60, 1 / 60] },
  { pattern: /^\s?(?:시간|小时|時間|h(?![a-z])|hr|hour)/i, factors: [60] },
  { pattern: /^\s?(?:주|周|週|week)/i, factors: [7] },
  { pattern: /^\s?(?:일(?!부)|天|日|day)/i, factors: [1 / 7] },
];

/** `14시` → 2도 받는다(`2 PM`). `오후 2시` → 14도 받는다(`14:00`). */
const HOUR_MARK = /^\s?(?:시(?!간)|時|点|o'?clock|h(?![a-z]))/i;
const MONTH_MARK = /^\s?(?:월|月)/;

function twelveHourAlternates(h) {
  if (h >= 13 && h <= 24) return [h - 12];
  if (h >= 1 && h <= 12) return [h + 12];
  return [];
}

/**
 * 한국어·중국어 복합 수 `3억 5천만`·`1万2千`. 두 묶음 이상일 때만 복합으로 본다.
 * @returns {{end: number, total: number, parts: number[]}|null}
 */
function readCjkCompound(src, start) {
  const group = /^(\d[\d,]*(?:\.\d+)?)\s?([십백천만억조十百千万萬亿億]+)/;
  const parts = [];
  let total = 0;
  let pos = start;
  let end = start;
  for (;;) {
    const m = src.slice(pos).match(group);
    if (!m) break;
    const base = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(base)) break;
    parts.push(base);
    total += base * [...m[2]].reduce((acc, ch) => acc * CJK_MULTIPLIERS[ch], 1);
    end = pos + m[0].length;
    pos = end + (src.slice(end).match(/^\s*/)?.[0].length ?? 0);
  }
  if (parts.length < 2) return null;
  return { end, total, parts };
}

/**
 * 🔴 기간 복합 `1시간 30분`·`2분 30초` — 검사하지 않는다(판정표). "an hour and a half"처럼
 *    숫자가 하나도 안 남는 정상 번역이 흔해서, 받아 줄 표기를 다 셀 자신이 없다.
 */
const DURATION_COMPOUND = /^(\d+)\s?(?:시간|분)\s?(\d+)\s?(?:분|초)/;

/** 화면에 보일 이름 — 숫자 + 바로 붙은 단위(`200ms`·`3초`·`30%`). */
const UNIT_SUFFIX =
  /^(?:\s?(?:ms|sec|min|hrs?|px|kb|mb|gb|tb|s|h|k|m|b|x)(?![a-z])|만원|천원|억원|원|초|분|시간|시|일|주|개월|월|년|개|명|건|번|차|배|%)/i;

function labelOf(tok, after) {
  const unit = after.match(UNIT_SUFFIX);
  return unit ? `${tok}${unit[0]}` : tok;
}

/**
 * 텍스트의 숫자를 모두 읽는다(원문·교정문 공용).
 *
 * @returns {Array<
 *   | {kind: 'value', label: string, values: number[], month: boolean, skip: boolean}
 *   | {kind: 'parts', label: string, parts: number[], time: boolean, skip: boolean}
 *   | {kind: 'compound', label: string, values: number[], parts: number[], skip: boolean}
 * >}
 */
function scanNumbers(text) {
  const src = normalizeDigits(text);
  const items = [];
  const re = new RegExp(NUMBER_PATTERN.source, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    const tok = m[0];
    const start = m.index;
    const end = start + tok.length;
    const before = src.slice(0, start);
    const after = src.slice(end);

    const compound = readCjkCompound(src, start);
    if (compound) {
      items.push({
        kind: 'compound',
        label: src.slice(start, compound.end).trim(),
        values: [compound.total],
        parts: compound.parts,
        skip: false,
      });
      re.lastIndex = compound.end;
      continue;
    }

    const duration = src.slice(start).match(DURATION_COMPOUND);
    if (duration) {
      items.push({
        kind: 'compound',
        label: duration[0],
        values: [],
        parts: [Number(duration[1]), Number(duration[2])],
        skip: true,
      });
      re.lastIndex = start + duration[0].length;
      continue;
    }

    // 🔴 줄머리 목록 번호 `1.`·`2)` — 교정문이 글머리표로 바꾸는 건 정상이다.
    const listMarker = /(?:^|\n)\s*$/.test(before) && /^[.)]\s/.test(after);

    const base = parseNumberToken(tok);
    if (base === null) {
      items.push({
        kind: 'parts',
        label: tok,
        parts: splitParts(tok),
        time: tok.includes(':'),
        skip: listMarker,
      });
      continue;
    }

    const values = [...base];
    const multipliers = readMultipliers(after);
    for (const mul of multipliers) for (const v of base) values.push(v * mul);
    for (const { pattern, factors } of UNIT_CONVERSIONS) {
      if (!pattern.test(after)) continue;
      for (const v of base) for (const f of factors) values.push(v * f);
      break;
    }
    if (HOUR_MARK.test(after)) for (const v of base) values.push(...twelveHourAlternates(v));

    items.push({
      kind: 'value',
      label: labelOf(tok, after),
      values,
      month: MONTH_MARK.test(after) && base.some((v) => Number.isInteger(v) && v >= 1 && v <= 12),
      // 🔴 값 1은 검사하지 않는다(판정표) — "a meeting"·"an hour"·"once"·"single"…
      skip: listMarker || (multipliers.length === 0 && base.every((v) => v === 1)),
    });
  }
  return items;
}

/**
 * 풀어 쓴 수 — **교정문 쪽에서만** 쓴다(헤더의 비대칭 원칙). `verify.js`의 `NUMBER_WORDS`(영어
 * 0~12)를 그대로 쓰고, 교정 대상 언어(`RECIPIENT_LANGUAGES`)의 표기를 더한다.
 */
const EXTRA_WORDS = {
  en: [
    ['13', 'thirteen'], ['14', 'fourteen'], ['15', 'fifteen'], ['16', 'sixteen'],
    ['17', 'seventeen'], ['18', 'eighteen'], ['19', 'nineteen'], ['20', 'twenty'],
    ['30', 'thirty'], ['40', 'forty'], ['50', 'fifty'], ['60', 'sixty'], ['100', 'hundred'],
    ['1000', 'thousand'], ['12', 'dozen'], ['0', 'no'], ['0', 'none'],
    // 「24시까지」 → "by midnight", 「12시」 → "noon" (2026-10-23 탐침)
    ['24', 'midnight'], ['0', 'midnight'], ['12', 'midnight'], ['12', 'noon'], ['12', 'midday'],
    ['2', 'twice'], ['2', 'double'], ['2', 'both'], ['2', 'couple'], ['2', 'pair'],
    ['3', 'thrice'], ['3', 'triple'],
    ['0.5', 'half'], ['50', 'half'], ['30', 'half'],
    ['0.25', 'quarter'], ['25', 'quarter'], ['15', 'quarter'],
    ['2', 'second'], ['3', 'third'], ['4', 'fourth'], ['5', 'fifth'], ['6', 'sixth'],
    ['7', 'seventh'], ['8', 'eighth'], ['9', 'ninth'], ['10', 'tenth'], ['11', 'eleventh'],
    ['12', 'twelfth'],
  ],
  de: [
    ['0', 'null'], ['2', 'zwei'], ['3', 'drei'], ['4', 'vier'], ['5', 'fünf'], ['6', 'sechs'],
    ['7', 'sieben'], ['8', 'acht'], ['9', 'neun'], ['10', 'zehn'], ['11', 'elf'], ['12', 'zwölf'],
    ['20', 'zwanzig'], ['30', 'dreißig'], ['100', 'hundert'], ['1000', 'tausend'],
    ['2', 'doppelt'], ['0.5', 'halb'], ['30', 'halb'], ['0.5', 'halbe'], ['30', 'halbe'],
  ],
  fr: [
    ['0', 'zéro'], ['2', 'deux'], ['3', 'trois'], ['4', 'quatre'], ['5', 'cinq'], ['6', 'six'],
    ['7', 'sept'], ['8', 'huit'], ['9', 'neuf'], ['10', 'dix'], ['11', 'onze'], ['12', 'douze'],
    ['20', 'vingt'], ['30', 'trente'], ['100', 'cent'], ['1000', 'mille'], ['2', 'double'],
    ['0.5', 'demi'], ['30', 'demi'], ['0.5', 'demie'], ['30', 'demie'],
  ],
  es: [
    ['0', 'cero'], ['2', 'dos'], ['3', 'tres'], ['4', 'cuatro'], ['5', 'cinco'], ['6', 'seis'],
    ['7', 'siete'], ['8', 'ocho'], ['9', 'nueve'], ['10', 'diez'], ['11', 'once'], ['12', 'doce'],
    ['20', 'veinte'], ['30', 'treinta'], ['100', 'cien'], ['100', 'ciento'], ['1000', 'mil'],
    ['2', 'doble'], ['0.5', 'medio'], ['30', 'media'],
  ],
};

/**
 * 한국어 고유어 수 — 「세 가지」·「두 명」. 🔴 `verify.js`가 한국어 수사를 뺀 이유(「세부」·「모두」에
 *    그대로 들어 있다)는 **원문을 검증된 값으로 넓힐 때**의 위험이다. 여기서는 교정문 쪽이라 잘못
 *    읽어도 경고가 하나 줄 뿐이다. 그래도 낱말 앞 경계는 본다.
 */
const KO_NATIVE = [
  ['2', '두'], ['3', '세'], ['4', '네'], ['5', '다섯'], ['6', '여섯'], ['7', '일곱'],
  ['8', '여덟'], ['9', '아홉'], ['10', '열'], ['20', '스무'], ['20', '스물'],
];

/** 한자 수 `三`·`二十`·`三千万`. 표준 자리 계산(十百千은 묶음 안, 万亿은 묶음 경계). */
const CJK_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CJK_SMALL_UNITS = { 十: 10, 百: 100, 千: 1000 };
const CJK_BIG_UNITS = { 万: 1e4, 萬: 1e4, 亿: 1e8, 億: 1e8 };

function parseCjkNumeral(run) {
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const ch of run) {
    if (ch in CJK_DIGITS) digit = CJK_DIGITS[ch];
    else if (ch in CJK_SMALL_UNITS) {
      section += (digit || 1) * CJK_SMALL_UNITS[ch];
      digit = 0;
    } else if (ch in CJK_BIG_UNITS) {
      total += (section + digit) * CJK_BIG_UNITS[ch];
      section = 0;
      digit = 0;
    }
  }
  return total + section + digit;
}

/**
 * 월 이름 — `verify.js`의 영어 월 묶음(`NAMED_TIME_GROUPS`) + 약어·독·불·서 표기.
 * 🔴 「may」(조동사)·「mar」 같은 겹침은 그대로 둔다 — 교정문 쪽 해석이라 경고를 줄이기만 한다.
 */
const MONTH_EXTRA = [
  ['jan', 'januar', 'janvier', 'enero'],
  ['feb', 'februar', 'février', 'febrero'],
  ['mar', 'märz', 'mars', 'marzo'],
  ['apr', 'avril', 'abril'],
  ['mai', 'mayo'],
  ['jun', 'juni', 'juin', 'junio'],
  ['jul', 'juli', 'juillet', 'julio'],
  ['aug', 'août', 'agosto'],
  ['sep', 'sept', 'septembre', 'septiembre'],
  ['oct', 'oktober', 'octobre', 'octubre'],
  ['nov', 'novembre', 'noviembre'],
  ['dec', 'dezember', 'décembre', 'diciembre'],
];
const MONTH_NAMES = NAMED_TIME_GROUPS.filter((group) => /^\d+월$/.test(group[group.length - 1])).map(
  (group, index) => [...group.filter((word) => !/\d/.test(word)), ...MONTH_EXTRA[index]],
);

const ALL_LANGS = ['en', 'de', 'fr', 'es', 'ko', 'zh', 'ja'];

/**
 * 교정문에 보이는 값 전부 + 언급된 월.
 * @returns {{values: Set<string>, months: Set<number>}}
 */
function collectRefinedValues(refined, langs) {
  const values = new Set();
  const months = new Set();
  const add = (n) => {
    const key = keyOf(n);
    if (key !== null) values.add(key);
  };

  for (const item of scanNumbers(refined)) {
    // 🔴 교정문 쪽은 모든 해석을 더한다 — 묶음의 각 숫자, 복합의 합계·각 숫자까지.
    for (const v of item.values ?? []) add(v);
    for (const p of item.parts ?? []) add(p);
    if (item.kind === 'value') {
      for (const p of splitParts(item.label.match(/^[\d.,]+/)?.[0] ?? '')) add(p);
      if (item.month) for (const v of item.values) if (Number.isInteger(v)) months.add(v);
    }
    if (item.kind === 'parts' && item.time) {
      for (const p of item.parts) for (const alt of twelveHourAlternates(p)) add(alt);
    }
  }

  const lower = String(refined ?? '').toLowerCase();
  const wordLists = [NUMBER_WORDS, ...langs.map((lang) => EXTRA_WORDS[lang] ?? [])];
  for (const list of wordLists) {
    for (const [digits, word] of list) if (occursAsWord(word, lower)) add(Number(digits));
  }
  if (langs.includes('ko')) {
    for (const [digits, word] of KO_NATIVE) {
      if (new RegExp(`(?:^|[^가-힣])${word}(?=\\s|[가-힣])`).test(lower)) add(Number(digits));
    }
  }
  if (langs.includes('zh') || langs.includes('ja')) {
    for (const run of lower.match(/[零〇一二两兩三四五六七八九十百千万萬亿億]+/g) ?? []) {
      add(parseCjkNumeral(run));
      for (const ch of run) if (ch in CJK_DIGITS) add(CJK_DIGITS[ch]);
    }
    // 「一个半小时」·「半分」 — 반은 0.5이자 30(분)이다.
    if (lower.includes('半')) {
      add(0.5);
      add(30);
    }
  }

  MONTH_NAMES.forEach((names, index) => {
    if (names.some((word) => occursAsWord(word, lower))) months.add(index + 1);
  });

  return { values, months };
}

/**
 * 원문에 있던 숫자 중 교정문에 남지 않은 것을 찾는다.
 *
 * @param {object} input
 * @param {string} input.sourceText 사용자가 쓴 원문.
 * @param {string} input.refined 모델이 만든 교정문.
 * @param {string|null} [input.sourceLanguage]
 * @param {string|null} [input.targetLanguage] 풀어 쓴 수를 어느 언어로 읽을지. 모르면 전부 읽는다.
 * @returns {string[]} 화면에 보일 이름(`200ms`·`3,000만원`). 없으면 빈 배열.
 */
export function findDroppedNumbers({ sourceText, refined, sourceLanguage = null, targetLanguage = null }) {
  const src = String(sourceText ?? '');
  const out = String(refined ?? '');
  // 🔴 둘 중 하나라도 비면 판정하지 않는다 — 빈 값으로 "빠졌다"고 말하면 오탐만 만든다.
  if (src.trim() === '' || out.trim() === '') return [];

  /**
   * 🔴 영어는 항상 읽는다 — 어느 언어로 교정하든 모델이 영어 표기를 섞는 일이 흔하다.
   *    원문 언어도 읽는다(고유명사·인용이 원문 표기로 남는다). 대상 언어를 모르면 전부.
   */
  const langs = targetLanguage
    ? [...new Set(['en', targetLanguage, sourceLanguage].filter(Boolean))]
    : ALL_LANGS;
  const { values, months } = collectRefinedValues(out, langs);
  const has = (n) => values.has(keyOf(n));
  const hasPart = (p) => has(p) || (Number.isInteger(p) && p >= 1 && p <= 12 && months.has(p));

  const dropped = [];
  for (const item of scanNumbers(src)) {
    if (item.skip) continue;
    let present;
    if (item.kind === 'value') {
      present = item.values.some(has) || (item.month && item.values.some((v) => months.has(v)));
    } else if (item.kind === 'compound') {
      present = item.values.some(has) || item.parts.every(has);
    } else if (item.time && item.parts.length === 2) {
      // `14:00` → `2 PM`: 시는 12시간제도 받고, 정각(`:00`)의 분은 없어도 된다.
      const [h, mm] = item.parts;
      present = (has(h) || twelveHourAlternates(h).some(has)) && (mm === 0 || has(mm));
    } else {
      present = item.parts.every(hasPart);
    }
    if (!present && !dropped.includes(item.label)) dropped.push(item.label);
  }
  return dropped;
}

/**
 * 화면이 쓰는 단일 진입점. 🔴 **폴백 결과는 검사하지 않는다** — 폴백의 `refined`는 원문 그대로라
 *    (`fallback.js`) 대조할 교정문이 없고, 화면은 이미 「교정하지 못했어요」를 낸다.
 */
export function checkNumbersPreserved(result, sourceText = '') {
  if (!result || typeof result !== 'object' || result.fallback) return [];
  return findDroppedNumbers({
    sourceText,
    refined: result.refined ?? '',
    sourceLanguage: result.sourceLanguage ?? null,
    targetLanguage: result.targetLanguage ?? null,
  });
}

/**
 * 화면 문구. 🔴 **무엇이 잘못됐는지 단정하지 않는다** — 빠진 것인지 다른 표기로 바뀐 것인지
 *    우리는 구분할 수 없다(`names.js` `nameWarningText`와 같은 원칙).
 */
export function numberWarningText(dropped) {
  if (!Array.isArray(dropped) || dropped.length === 0) return '';
  return `원문의 ${dropped.map((v) => `「${v}」`).join(', ')}이(가) 교정문에서 보이지 않아요 — 빠졌거나 다른 표기로 바뀌었을 수 있어요. 보내기 전에 확인해 주세요.`;
}
