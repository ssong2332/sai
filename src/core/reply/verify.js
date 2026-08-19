/**
 * 회신 초안 검증 (S37) — **화면에 붙는 마지막 안전망.**
 *
 * 🔴 이 모듈이 막으려는 사고 한 가지: **사용자가 하지 않은 약속이 그대로 전송되는 것.**
 *    "화요일 오후 2시에 가능합니다"는 문법적으로 완벽하고, 역번역도 정확하고, 톤도 좋다.
 *    사용자가 그 시간에 가능하다는 사실만 없다. 프롬프트로 금지해도 새는 것은 ②(누락 경고)에서
 *    실측으로 확인했다(원문에 없는 「답변」을 인용으로 지어냈다) — 그래서 코드로 한 겹 더 본다.
 *
 * 판정표 (2026-08-14 확정, 이 표대로만 동작한다)
 * | 조건                                          | 처리                          |
 * |---|---|
 * | 초안에 `[…]` 대괄호                            | 자리표시자로 수집 → "채워서 보내세요" |
 * | 자리표시자 **안**의 숫자·요일                    | 무시 — 사용자가 채울 칸이지 약속이 아니다 |
 * | 자리표시자 **밖**의 숫자·요일·월 이름이 원문에 없음 | 🔴 「확인 필요」로 표시             |
 * | 같은 값이 원문에 있음                            | 통과 — 인용이므로 검증됨          |
 * | 같은 값을 **사용자가 사전 질문에서 답함**          | 통과 — 사용자가 손으로 넣은 값이다 |
 *
 * 🔴 **초안 문장을 고치지 않는다.** 경고만 덧붙인다. 코드가 모델 출력을 재작성하기 시작하면
 *    화면에 보이는 것이 모델의 답인지 우리 코드의 답인지 아무도 구분하지 못한다.
 */

import { occursIn } from '../refine/reasoning.js';

/** `[날짜]`, `[the specific section]` — 줄바꿈 없는 40자 이내만 자리표시자로 본다. */
const PLACEHOLDER_PATTERN = /\[([^[\]\n]{1,40})\]/g;

/** 숫자 덩어리 — `2`, `14:00`, `8/21`, `3.5`, `482`. */
const NUMBER_PATTERN = /\d+(?:[.,:/-]\d+)*/g;

/**
 * 요일·월 이름. 숫자가 없는 구체 약속("Monday에 드릴게요")도 같은 사고를 낸다.
 *
 * 🔴 **언어별 목록이 아니라 언어를 가로지르는 묶음이다** (v5). 예전에는 평평한 목록이었고
 *    "회신은 원문과 같은 언어로 쓰인다"를 전제했다. v5부터 초안은 **사용자의 모국어**로 쓰이고
 *    원문은 상대의 언어라 **항상 언어가 다르다** — 평평한 목록이면 초안의 「화요일」이 원문
 *    "Tuesday"와 대조되지 않아 **멀쩡한 인용이 매번 「확인 필요」로 오탐**한다. 같은 요일은
 *    한 묶음으로 보고, 묶음 안의 어느 표기든 원문·답변에 있으면 통과시킨다.
 */
const NAMED_TIME_GROUPS = [
  ['monday', 'mon', '월요일', '周一'],
  ['tuesday', 'tue', '화요일', '周二'],
  ['wednesday', 'wed', '수요일', '周三'],
  ['thursday', 'thu', '목요일', '周四'],
  ['friday', 'fri', '금요일', '周五'],
  ['saturday', 'sat', '토요일', '周六'],
  ['sunday', 'sun', '일요일', '周日'],
  ['january', '1월'],
  ['february', '2월'],
  ['march', '3월'],
  ['april', '4월'],
  ['may', '5월'],
  ['june', '6월'],
  ['july', '7월'],
  ['august', '8월'],
  ['september', '9월'],
  ['october', '10월'],
  ['november', '11월'],
  ['december', '12월'],
];

/**
 * 문자열 끝에 **바로 붙은** 숫자만 덜어낸다.
 *
 * 🔴 요일·월 표기를 들어낼 때 쓴다(2026-08-14 실측 오탐). 초안의 「08월 18일」에서 `8월`만
 *    빼면 `"0"`이 남아 숫자 검사에 잡히고, 화면에 **「확인 필요 — 8월 · 0 · 18」**로 나온다.
 *    `0`은 사용자가 확인할 값이 아니라 우리가 만든 부스러기다. 경고에 의미 없는 항목이 섞이면
 *    사용자는 경고 전체를 흘려보게 된다 — 이 기능에서 가장 비싼 실패다.
 * 🔴 **끝이 숫자일 때만** 줄인다. `"pr 482 "`(공백으로 끝남)나 `"2026년 "`은 그대로 둔다 —
 *    떨어져 있는 숫자는 표기의 일부가 아니라 별개 값이므로 검사 대상으로 남아야 한다.
 */
function trimTrailingDigits(part) {
  let end = part.length;
  while (end > 0 && part[end - 1] >= '0' && part[end - 1] <= '9') end -= 1;
  return part.slice(0, end);
}

/**
 * 영어로 **풀어 쓴 수**. 🔴 v6 실확장 실측이 잡은 오탐(2026-08-15).
 *
 * 원문 "concerns about the **three** key features"에 대해 초안이 「**3**가지 핵심 기능」이라고
 * 정확히 인용했는데 「확인 필요 — 3」이 떴다. `NUMBER_PATTERN`은 숫자만 뽑으므로 원문의
 * `three`는 **대조 대상이 되지도 못한다.** 이미지 한 장에서 7개 중 4개가 이런 가짜였다
 * (`three`→3, `four-person`→4 …). 🔴 **v5의 요일 문제와 같은 형태다** — 초안은 한국어(숫자),
 * 원문은 영어(단어)라 언어가 다르면 표기가 갈린다. 영어권 문서는 관례적으로 작은 수를 단어로 쓴다.
 *
 * 🔴 **한 방향으로만 쓴다**: 원문에 `three`가 있으면 검증된 숫자 집합에 `3`을 **더한다**.
 *    초안 쪽 숫자 추출은 건드리지 않는다 — 단어를 부분문자열로 대조하면 "phone"의 `one`,
 *    "someone"의 `one`이 걸려 **지어낸 값을 검증됐다고 덮어 버린다**(오탐보다 나쁜 실패).
 * 🔴 **영어만 넣는다.** 한국어 수사(「세」·「두」)는 「세부」·「모두」 같은 낱말에 그대로 들어 있어
 *    경계 판정으로도 못 가른다. 관측된 실패(영어 원문 → 한국어 초안)를 덮으면 충분하고,
 *    반대 방향은 애초에 경고를 만들지 않는다(초안의 단어 표기는 숫자로 추출되지 않는다).
 */
const NUMBER_WORDS = [
  ['0', 'zero'],
  ['1', 'one'],
  ['2', 'two'],
  ['3', 'three'],
  ['4', 'four'],
  ['5', 'five'],
  ['6', 'six'],
  ['7', 'seven'],
  ['8', 'eight'],
  ['9', 'nine'],
  ['10', 'ten'],
  ['11', 'eleven'],
  ['12', 'twelve'],
];

/** 영문 낱말 경계 판정용. 하이픈·공백·한글은 경계로 본다("four-person"의 `four`는 낱말이다). */
function isLatinWordChar(ch) {
  return ch !== '' && /[a-z0-9]/.test(ch);
}

/**
 * `word`가 `text` 안에 **낱말로** 있는가. 🔴 `includes`로는 안 된다 — "phone"이 `one`을,
 * "tenant"가 `ten`을 검증된 값으로 만들어 지어낸 숫자를 조용히 통과시킨다.
 */
function occursAsWord(word, text) {
  const hay = String(text ?? '').toLowerCase();
  const needle = word.toLowerCase();
  if (needle === '') return false;
  for (let from = 0; ; ) {
    const at = hay.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : hay[at - 1];
    const after = hay[at + needle.length] ?? '';
    if (!isLatinWordChar(before) && !isLatinWordChar(after)) return true;
    from = at + 1;
  }
}

/** 자리표시자를 통째로 들어낸다 — 그 안의 값은 사용자가 채울 칸이지 모델의 약속이 아니다. */
function stripPlaceholders(draft) {
  return String(draft ?? '').replace(PLACEHOLDER_PATTERN, ' ');
}

/**
 * 초안에서 자리표시자 목록을 뽑는다.
 * @returns {string[]} 대괄호를 포함한 원문 그대로(`[date]`). 중복 제거.
 */
export function collectPlaceholders(draft) {
  const found = String(draft ?? '').match(PLACEHOLDER_PATTERN) ?? [];
  return [...new Set(found)];
}

/**
 * 초안에는 있는데 원문에는 없는 구체값을 찾는다.
 *
 * @param {string} draft 모델이 만든 회신 초안.
 * @param {string} sourceText 상대가 보낸 원문.
 * @param {string} [userText] 🔴 사용자가 사전 질문에 **직접 답한 값**. 원문에 없어도 통과시킨다 —
 *   사용자가 손으로 넣은 값은 정의상 지어낸 값이 아니다. 여기를 빠뜨리면 질문에 답할수록
 *   「확인 필요」가 늘어나 기능이 서로를 방해한다.
 * @returns {string[]} 확인이 필요한 값들. 없으면 빈 배열.
 */
export function findUnverifiedSpecifics(draft, sourceText = '', userText = '') {
  const body = stripPlaceholders(draft);
  if (body.trim() === '') return [];

  /**
   * 🔴 **숫자는 부분문자열로 대조하면 안 된다** (2026-08-14 테스트가 잡은 결함).
   *    원문 "PR #482"에 대해 초안이 지어낸 "2pm"의 `2`는 `"482".includes("2")`로 **통과해
   *    버린다.** 없는 시각 약속이 무관한 티켓 번호에 가려지는, 이 기능에서 가장 나쁜 실패다.
   *    그래서 원문에서도 같은 규칙으로 숫자 토큰을 뽑아 **완전 일치**로만 통과시킨다.
   *    (요일·월 이름은 단어라 부분문자열 대조가 그대로 성립한다.)
   */
  /** 검증된 출처 둘: 상대가 보낸 원문 + 사용자가 직접 답한 값. */
  const verifiedText = `${sourceText ?? ''}\n${userText ?? ''}`;
  const out = [];
  const seen = new Set();

  /**
   * 🔴 **요일·월을 먼저 처리하고 그 구간을 초안에서 덜어낸다.** 숫자를 먼저 훑으면 한국어 월
   *    표기 「9월」의 `9`가 따로 잡혀 **같은 값이 두 번 보고된다**(2026-08-14 테스트가 잡았다).
   *    원문이 "September"라 숫자 대조로는 통과할 수 없고, 묶음 대조로는 통과하는데, 두 검사가
   *    독립적으로 돌면 통과한 값이 숫자 쪽에서 살아남는다.
   */
  let rest = body;
  for (const group of NAMED_TIME_GROUPS) {
    // 초안에 이 묶음의 표기가 하나라도 있는가 — 있으면 그 표기를 사용자에게 보여준다.
    const inDraft = group.find((word) => occursIn(word, rest));
    if (inDraft === undefined || seen.has(inDraft)) continue;
    seen.add(inDraft);
    /**
     * 이 표기는 요일/월로 판정이 끝났다 — 숫자 검사가 다시 보지 않게 덜어낸다.
     * 🔴 정규식을 만들지 않는다(`split`/`join`). 지금은 우리 상수라 안전하지만, 값에서 정규식을
     *    조립하는 습관 자체를 이 파일에 들이지 않는다. 뒤에 남은 `rest`는 숫자만 뽑는 데 쓰이므로
     *    대소문자를 잃어도 무해하다.
     * 🔴 표기 **앞에 붙은** 숫자도 함께 덜어낸다 — 「08월」의 `0`이 따로 잡히는 오탐을 막는다
     *    (`trimTrailingDigits` 주석 참고).
     */
    const parts = rest.toLowerCase().split(inDraft);
    rest = parts
      .map((part, index) => (index < parts.length - 1 ? trimTrailingDigits(part) : part))
      .join(' ');
    // 🔴 원문·답변에 **묶음 안의 어느 표기든** 있으면 통과다(언어가 달라도 같은 날을 가리킨다).
    if (group.some((word) => occursIn(word, verifiedText))) continue;
    out.push(inDraft);
  }

  const verifiedNumbers = new Set(verifiedText.match(NUMBER_PATTERN) ?? []);
  // 🔴 원문이 「three」라고 풀어 썼으면 초안의 「3」은 인용이다 — 검증된 집합에 더해 준다.
  for (const [digits, word] of NUMBER_WORDS) {
    if (occursAsWord(word, verifiedText)) verifiedNumbers.add(digits);
  }

  for (const value of rest.match(NUMBER_PATTERN) ?? []) {
    if (seen.has(value)) continue;
    seen.add(value);
    if (verifiedNumbers.has(value)) continue; // 원문·답변에 그대로 있으면 통과
    out.push(value);
  }

  return out;
}

/**
 * 화면이 쓰는 단일 진입점.
 *
 * @returns {{placeholders: string[], unverified: string[], needsAttention: boolean}}
 */
export function verifyReplyDraft(result, sourceText = '', userText = '') {
  const draft = typeof result?.draft === 'string' ? result.draft : '';
  if (draft.trim() === '') {
    return { placeholders: [], unverified: [], needsAttention: false };
  }
  const placeholders = collectPlaceholders(draft);
  const unverified = findUnverifiedSpecifics(draft, sourceText, userText);
  return {
    placeholders,
    unverified,
    needsAttention: placeholders.length > 0 || unverified.length > 0,
  };
}
