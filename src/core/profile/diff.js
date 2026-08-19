/**
 * 개인 수정 패턴 분류 (S13 / Spec 필수 2 2순위 · §7 표 6번 · 권장 11).
 *
 * 🔴 **Zero Retention (Spec 필수 5)**: 이 모듈은 원문·교정문·수정문을 **어디에도 저장하지 않는다.**
 *    입력 문자열은 분류 계산 동안 메모리에만 존재하고, 밖으로 나가는 값은 `categoryId`(고정 집합의
 *    식별자)와 Levenshtein 거리 **수치**뿐이다. 반환값에 원문 조각을 담지 않는다 — 담는 순간
 *    사이드패널·Firestore 어느 쪽으로든 본문이 샐 경로가 생긴다.
 *
 * 🔴 **분류는 고정 표로만 한다** (2026-08-13 사용자와 확정한 판정표 A). 표의 어느 행에도 맞지
 *    않으면 **기록하지 않는다** — "뭔가 바뀌긴 했으니 일단 남기자"는 추측이고, 그 추측이 나중에
 *    프롬프트에 실려 사용자가 하지도 않은 성향으로 굳는다.
 */

/**
 * 카테고리 고정 집합. `id`는 저장·프롬프트 계약이고, `label`은 화면 표시용 문장(권장 11 —
 * "사람이 읽을 수 있는 문장"). 🔴 `label`은 클라이언트가 조립하는 표시 문자열이며 저장 대상이
 * 아니다. `promptHint`는 프롬프트에 실리는 영어 지시문(2순위로 병기될 때만 쓰인다).
 */
export const DIFF_CATEGORIES = [
  {
    id: 'deadline-explicit',
    label: '"ASAP" 대신 구체적인 마감 시각을 쓰는 편이에요',
    promptHint:
      'This user replaces vague urgency words ("ASAP", "immediately", "바로") with an explicit ' +
      'clock time or date. Prefer stating the concrete deadline already present in the original ' +
      'over a vague urgency adverb. Never invent a deadline that the original does not state.',
  },
  {
    id: 'fewer-apologies',
    label: '사과 표현을 문장당 1회 이하로 줄여요',
    promptHint:
      'This user trims apologetic and cushioning phrases. Keep at most one apology sentence and ' +
      'do not add cushioning that the original does not contain.',
  },
  {
    id: 'no-emoji',
    label: '이모지를 빼는 편이에요',
    promptHint: 'This user removes emoji. Do not add emoji to the output.',
  },
  {
    id: 'shorter',
    label: '더 짧고 간결한 문장을 선호해요',
    promptHint:
      'This user shortens the result. Prefer fewer, tighter sentences — but never drop a ' +
      'deadline, number, or required action in order to be shorter.',
  },
  {
    id: 'honorific-shift',
    label: '종결어미 레벨을 직접 바꾸는 편이에요',
    promptHint:
      'This user adjusts the Korean sentence-final honorific register after the fact. Keep one ' +
      'consistent register across every sentence.',
  },
];

const CATEGORY_BY_ID = new Map(DIFF_CATEGORIES.map((category) => [category.id, category]));

/** Spec 필수 2 과도기 규칙 — 3회 미만이면 2순위로 싣지 않고 1순위만 100% 반영한다. */
export const LEARNING_THRESHOLD = 3;

/**
 * Levenshtein 편집 거리. 두 행만 유지하는 표준 DP — 메시지 길이(수천 자)에서 전체 행렬을 잡으면
 * 불필요하게 크다.
 *
 * @returns {number} 편집 거리(문자 단위).
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length];
}

/* ── 판정표 A의 각 행 ──────────────────────────────────────────────────── */

/**
 * 🔴 **세 언어를 모두 커버한다** — Spec §1이 지원하는 언어는 ko·en·zh인데, 처음에는 ko·en만
 *    넣어서 **중국어를 쓰는 사용자는 어떤 수정을 해도 분류가 안 됐다**(2026-08-13 실측으로 발견:
 *    온보딩에서 중화권을 고르면 교정문이 중국어가 되는데, 사과·마감 패턴이 중국어를 몰라
 *    `shorter`/`no-emoji` 외에는 영원히 안 걸렸다). 언어를 추가할 때는 이 세 패턴을 함께 늘린다.
 */
const VAGUE_URGENCY = /\b(asap|immediately|right away|urgently)\b|즉시|바로|당장|尽快|立刻|马上|趕快|盡快/gi;
/** 구체 시각·날짜 — "3pm", "15:00", "8/14", "8월 14일", "8月14日", "下午3点", "Aug 14". */
const CONCRETE_TIME =
  /\b\d{1,2}\s*(am|pm)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\/\d{1,2}\b|\d{1,2}월\s*\d{1,2}일|\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{1,2}\s*[点點]|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2}\b/gi;
const APOLOGY = /\b(sorry|apolog\w*|excuse me)\b|죄송|미안|양해|抱歉|不好意思|对不起|對不起|打扰|打擾/gi;
/** 이모지 — 그림문자 계열 주요 블록만. 텍스트 기호(→ 등)는 제외한다. */
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/gu;
const HAPSYO = /(습니다|습니까|십시오|ㅂ니다)/g;
const HAEYO = /(아요|어요|네요|예요|에요)/g;

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

/** 표 A 1행 — 모호한 긴급 표현이 줄고, 구체 시각·날짜가 늘었을 때만. */
function isDeadlineExplicit(before, after) {
  const vagueDropped = countMatches(before, VAGUE_URGENCY) > countMatches(after, VAGUE_URGENCY);
  const timeAdded = countMatches(after, CONCRETE_TIME) > countMatches(before, CONCRETE_TIME);
  return vagueDropped && timeAdded;
}

/** 표 A 2행 — 사과·완충 표현 개수가 실제로 줄었을 때만. */
function isFewerApologies(before, after) {
  return countMatches(after, APOLOGY) < countMatches(before, APOLOGY);
}

/** 표 A 3행 — 이모지가 제거됐을 때만(추가는 해당 없음). */
function isEmojiRemoved(before, after) {
  return countMatches(after, EMOJI) < countMatches(before, EMOJI);
}

/** 표 A 4행 — 문장 수가 줄고 길이도 30% 이상 짧아졌을 때만(둘 다 만족해야 한다). */
function isShorter(before, after) {
  const sentenceCount = (text) => (text.match(/[.!?。]|\n/g) ?? []).length;
  const lengthDropped = after.length <= before.length * 0.7;
  return lengthDropped && sentenceCount(after) < sentenceCount(before);
}

/** 표 A 5행 — 합쇼체↔해요체 우세 레벨이 뒤집혔을 때만. */
function isHonorificShift(before, after) {
  const dominant = (text) => {
    const hapsyo = countMatches(text, HAPSYO);
    const haeyo = countMatches(text, HAEYO);
    if (hapsyo === haeyo) return null;
    return hapsyo > haeyo ? 'hapsyo' : 'haeyo';
  };
  const beforeLevel = dominant(before);
  const afterLevel = dominant(after);
  return beforeLevel !== null && afterLevel !== null && beforeLevel !== afterLevel;
}

/** 판정표 A — 순서대로 검사하고, 맞는 행을 **전부** 돌려준다(한 수정이 여러 성향을 보일 수 있다). */
const CLASSIFIERS = [
  ['deadline-explicit', isDeadlineExplicit],
  ['fewer-apologies', isFewerApologies],
  ['no-emoji', isEmojiRemoved],
  ['shorter', isShorter],
  ['honorific-shift', isHonorificShift],
];

/**
 * AI 교정문과 사용자가 최종 적용한 문장을 비교해 **카테고리 id 목록과 편집 거리**만 돌려준다.
 *
 * 🔴 반환값에 텍스트를 담지 않는다(Zero Retention). 호출자는 이 결과만 저장한다.
 *
 * @param {string} aiText AI가 만든 교정문.
 * @param {string} userText 사용자가 실제로 적용한 문장.
 * @returns {{distance: number, categoryIds: string[]}} 표 A 어디에도 안 맞으면 `categoryIds: []`.
 */
export function classifyEdit(aiText, userText) {
  const before = String(aiText ?? '');
  const after = String(userText ?? '');
  const distance = levenshtein(before, after);

  // 편집이 없으면 학습할 게 없다 — "적용만 눌렀다"는 성향이 아니다.
  if (distance === 0) return { distance: 0, categoryIds: [] };

  const categoryIds = CLASSIFIERS.filter(([, matches]) => matches(before, after)).map(([id]) => id);
  return { distance, categoryIds };
}

/** 표시용 문장(권장 11). 모르는 id는 null — 지어내지 않는다. */
export function categoryLabel(id) {
  return CATEGORY_BY_ID.get(id)?.label ?? null;
}

/**
 * 판정표 B — 프롬프트에 2순위로 실을 카테고리를 고른다.
 *
 * 🔴 3회 미만은 싣지 않는다(Spec 필수 2 과도기 규칙: 1순위만 100% 반영).
 * 🔴 국가/문화권(3순위)은 어떤 경우에도 여기서 만들지 않는다 (Spec 필수 9 G1/G2).
 *
 * @param {Record<string, number>} counts 카테고리별 누적 횟수.
 * @returns {{id: string, hint: string}[]}
 */
export function selectLearnedHints(counts) {
  return DIFF_CATEGORIES.filter((category) => (counts?.[category.id] ?? 0) >= LEARNING_THRESHOLD).map(
    (category) => ({ id: category.id, hint: category.promptHint }),
  );
}
