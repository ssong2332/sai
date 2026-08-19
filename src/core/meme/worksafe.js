/**
 * Work-Safe Filter (S16 / Spec 필수 8 · §7 표 4번 audit 4).
 *
 * 🔴 **거부 우선(deny-by-default) 설계.** 이 필터가 지키는 대상은 "재미"가 아니라 **사용자의 업무
 *    관계**다. 애매한 표현 하나가 업무 메시지에 섞이면 이 제품이 막으려던 오해를 우리가 만들어
 *    내는 셈이 된다. 그래서 ① 금지 패턴에 걸리면 차단하고, ② 걸리지 않아도 **사람이 검수한
 *    목록에 없으면 차단한다**(`reviewed: true`). 자동 수집분은 검수 전까지 절대 쓰이지 않는다.
 *
 * 🔴 **국가 단위 단정 금지** (Spec 필수 2 3순위 · 필수 9 G1/G2): 밈은 **언어**에 붙지 국적·국민성에
 *    붙지 않는다. "○○ 나라 사람들은 ~" 형태의 해설은 금지 패턴으로 직접 막는다.
 *
 * 🔴 이 모듈은 네트워크를 쓰지 않는다 — 순수 판정 함수다. 수집(RSS/크론)은 별도이며, 수집된 것도
 *    반드시 이 필터를 통과해야 한다.
 */

/**
 * 차단 사유 코드. 화면·로그에는 **사유 코드만** 남기고 걸린 표현 원문을 남기지 않는다
 * (비속어를 로그에 복사해 두는 꼴을 만들지 않는다).
 */
export const BLOCK_REASONS = {
  PROFANITY: 'profanity',
  HATE: 'hate',
  SEXUAL: 'sexual',
  VIOLENCE: 'violence',
  CONTROVERSIAL: 'controversial',
  MOCKERY: 'mockery',
  NATIONAL_GENERALIZATION: 'national-generalization',
  UNREVIEWED: 'unreviewed',
};

/**
 * 금지 패턴. 🔴 완전한 목록이 아니다 — 그래서 이것만으로 통과시키지 않고 검수 목록(`reviewed`)을
 *    함께 요구한다. 이 배열은 "검수자가 놓친 것을 잡는 2차 그물"이지 1차 방어선이 아니다.
 */
const DENY_PATTERNS = [
  // 비속어 — 영어·한국어에서 업무 메시지에 절대 들어가면 안 되는 축.
  [/\b(fuck|shit|bitch|asshole|bastard|damn|crap|piss)\w*/i, BLOCK_REASONS.PROFANITY],
  [/(씨발|시발|병신|지랄|좆|개새|미친놈|미친년|엿먹)/, BLOCK_REASONS.PROFANITY],

  // 혐오·차별 — 인종·성별·종교·성적지향·장애.
  [/\b(retard\w*|fag\w*|nigg\w+|tranny|chink|spic|kike)\b/i, BLOCK_REASONS.HATE],
  [/(장애인새끼|병신새끼|틀딱|급식충|맘충|한남충|김치녀|짱깨|쪽바리|흑형)/, BLOCK_REASONS.HATE],

  // 성적 표현.
  [/\b(porn|sex|nude|horny|nsfw|dick|boob)\w*/i, BLOCK_REASONS.SEXUAL],
  [/(야동|섹스|음란|19금)/, BLOCK_REASONS.SEXUAL],

  // 폭력·자해.
  [/\b(kill yourself|kys|suicide|murder|rape)\b/i, BLOCK_REASONS.VIOLENCE],
  [/(자살|죽어버려|때려죽|자해)/, BLOCK_REASONS.VIOLENCE],

  // 정치·종교 논쟁 소재 — 업무 메시지에서 편을 가르는 순간 관계가 상한다.
  [/\b(trump|biden|putin|abortion|antifa|zionist|jihad)\b/i, BLOCK_REASONS.CONTROVERSIAL],
  [/(좌빨|우꼴|친일파|빨갱이|탄핵|대깨)/, BLOCK_REASONS.CONTROVERSIAL],

  // 특정 실존 인물 조롱.
  [/\b(is an idiot|is a moron|sucks at)\b/i, BLOCK_REASONS.MOCKERY],
  [/(조롱|비하하는|놀리는 말)/, BLOCK_REASONS.MOCKERY],
];

/**
 * 🔴 국가 단위 단정 — "○○ 나라/사람들은 ~하다" 형태의 일반화. Spec 필수 2 3순위와 필수 9가
 *    금지하는 서술이며, 밈 해설에 특히 스며들기 쉬워 별도로 막는다.
 */
const NATIONAL_GENERALIZATION = [
  /\b(americans?|germans?|koreans?|japanese|chinese|indians?|french|british)\s+(are|always|never|tend to|typically)\b/i,
  /(미국인|독일인|한국인|일본인|중국인|인도인|프랑스인|영국인)(들)?(은|는)\s*(보통|대개|항상|절대|원래)/,
  /(그 나라|이 나라|해당 국가)\s*(사람|국민)(들)?(은|는)/,
];

/**
 * 표현 하나가 업무 안전한지 판정한다.
 *
 * @param {{text: string, meaning?: string, language?: string, reviewed?: boolean}} entry
 * @returns {{safe: boolean, reasons: string[]}} 🔴 걸린 표현 원문은 반환값에 담지 않는다 —
 *   사유 코드만 담는다(비속어를 로그·화면으로 옮겨 나르지 않기 위해).
 */
export function checkWorkSafe(entry) {
  const haystack = `${entry?.text ?? ''} ${entry?.meaning ?? ''}`;
  const reasons = new Set();

  for (const [pattern, reason] of DENY_PATTERNS) {
    if (pattern.test(haystack)) reasons.add(reason);
  }
  for (const pattern of NATIONAL_GENERALIZATION) {
    if (pattern.test(haystack)) reasons.add(BLOCK_REASONS.NATIONAL_GENERALIZATION);
  }

  // 🔴 금지 패턴에 안 걸려도 **검수 통과 표시가 없으면 쓰지 않는다** (deny-by-default).
  //    자동 수집(RSS/크론)으로 들어온 것은 여기서 전부 막히며, 사람이 검수해야 풀린다.
  if (entry?.reviewed !== true) reasons.add(BLOCK_REASONS.UNREVIEWED);

  return { safe: reasons.size === 0, reasons: [...reasons] };
}

/** 목록에서 업무 안전한 것만 남긴다. */
export function filterWorkSafe(entries) {
  return (entries ?? []).filter((entry) => checkWorkSafe(entry).safe);
}
