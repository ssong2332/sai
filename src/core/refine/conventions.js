/**
 * 언어권 **어법 관습** (Spec 필수 2 「3순위: 국가/문화권 일반 특성」, 2026-08-16 사용자 승인).
 *
 * 🔴 **「국민성」이 아니라 「어법」이다. 이 구분이 이 파일의 존재 근거다.**
 *    Spec 필수 2는 3순위를 두되 **「국가 단위 뭉뚱그리기 방지」**를 조건으로 달았고, 필수 9
 *    G1/G2와 CLAUDE.md는 국가 단위 단정을 금지한다. 두 요구는 충돌하지 않는다 — 아래 항목은
 *    전부 **그 언어의 업무 문서에서 관측되는 표현 관습**이고, 사람에 대한 서술이 하나도 없다.
 *
 * | 넣는 것 (관측 가능한 어법)                     | 넣지 않는 것 (사람에 대한 단정)      |
 * |---|---|
 * | "I was wondering if…"는 완곡한 **요청**이다     | 🔴 "미국인은 직설적이다"              |
 * | 중국어 업무문은 겸양 표현을 앞에 둔다            | 🔴 "중국인은 격식을 중시한다"         |
 * | 일본어는 `〜のほう`로 단정을 누그러뜨린다        | 🔴 "일본인은 애매하게 말한다"         |
 * | 독일어 업무문은 요청을 직접 서술한다             | 🔴 "독일인은 무뚝뚝하다"              |
 *
 * 🔴 **3순위다 — 항상 밀린다.** 1순위(사용자가 고른 상황·성향)와 2순위(본인 수정 패턴)가 있으면
 *    그쪽이 이긴다. 지시문에 그 순서를 명시하고, 화면(프로필 탭)도 같은 말을 한다.
 *
 * 🔴 **수신자 개인에게 적용하지 않는다.** "이 사람은 이 나라 사람이니까"는 정확히 필수 9가
 *    금지하는 추론이다. 이 규칙은 **출력 언어**에만 걸린다 — 영어로 쓰면 영어 관습, 그뿐이다.
 */

/**
 * 출력 언어별 어법 노트.
 * 🔴 각 항목은 **"이 언어의 업무 문서가 그렇게 쓰인다"**로만 진술한다. 국적·국민을 주어로 쓰는
 *    문장이 하나도 없어야 한다 — 새 항목을 추가할 때 이 규칙을 먼저 확인한다.
 */
const CONVENTIONS = {
  en: [
    'Indirect phrasing often carries a firm ask: "I was wondering if you could…", "it would be ' +
      'great if…", and "when you get a chance" are commonly requests with a real deadline behind ' +
      'them, not optional suggestions.',
    'Hedges like "just", "a few minor", "quick" frequently soften something substantial — do not ' +
      'let them erase the size of the request when rewriting.',
    'A short line of context before the ask reads as considerate; a bare imperative can read as ' +
      'abrupt in written work English.',
  ],
  zh: [
    'Business writing conventionally opens with a courteous line before the request, and closes ' +
      'with a brief expression of thanks or anticipation.',
    'Modal softeners (请 / 麻烦 / 能否) mark politeness rather than uncertainty — keep them; ' +
      'removing them makes a normal request read as a demand.',
  ],
  ja: [
    'Business writing conventionally opens with a set greeting (お世話になっております) and marks ' +
      'requests with keigo; dropping these does not read as efficient, it reads as careless.',
    'Softeners such as 〜のほう, 〜かと思います, and 恐れ入りますが cushion assertions. They are ' +
      'conventional, not evasive — preserve the cushioning while keeping the request unambiguous.',
    'Deadlines and numbers are stated plainly even inside polite framing — do not soften those.',
  ],
  de: [
    'Business writing states the request directly and early; extended preamble can read as ' +
      'unclear rather than polite.',
    'Formal address (Sie) and a plain closing are conventional — directness here is a register, ' +
      'not rudeness, and should not be "softened" into vagueness.',
  ],
  fr: [
    'Business writing conventionally uses a formal opening and a full closing formula; an abrupt ' +
      'start reads as brusque.',
    'Conditional forms (pourriez-vous, je souhaiterais) are the ordinary register for requests — ' +
      'they mark politeness, not hesitation.',
  ],
  es: [
    'Business writing conventionally opens with a brief greeting; requests commonly use ' +
      'conditional forms (podrías, sería posible) as the ordinary polite register.',
  ],
};

/** 지원 언어 — 화면·테스트가 이 목록을 본다. */
export const CONVENTION_LANGUAGES = Object.keys(CONVENTIONS);

/**
 * 출력 언어의 어법 노트를 지시문 문단으로 만든다.
 *
 * @param {string} targetLanguage 출력 언어 코드.
 * @returns {string} 해당 언어 노트가 없으면 **빈 문자열** — 🔴 검증되지 않은 규칙을 지어내지
 *   않는다(`prompt.js`의 기존 원칙과 같다). 모르는 언어는 공통 규칙만으로 처리된다.
 */
export function conventionRules(targetLanguage) {
  const notes = CONVENTIONS[targetLanguage];
  if (!notes || notes.length === 0) return '';
  return (
    'Writing conventions for the OUTPUT language (lowest priority — rank 3). ' +
    'These describe how work messages are conventionally written in this language. ' +
    '🔴 They are NOT claims about people, nationalities, or cultures, and you must not infer ' +
    'anything about the recipient as a person from them. ' +
    'They rank BELOW the sender\'s own settings and learned patterns: where they conflict with ' +
    '"profile" or "recipient", follow those and ignore these. ' +
    'They must never change facts, deadlines, numbers, or required actions. ' +
    notes.join(' ')
  );
}
