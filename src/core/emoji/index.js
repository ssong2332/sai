/**
 * 이모지 문화 오해 자동 교체 (S19 / Spec 권장 4) + 위험 표현 탐지 (S19 / Spec 권장 6 F-18).
 *
 * 🔴 **국가 단위 단정 금지** (Spec 필수 2 3순위 · 필수 9 G1/G2): 사유 문구에 "○○ 나라에서는
 *    모욕이다" 같은 서술을 쓰지 않는다. 실제로 이모지 해석은 국가보다 세대·업계·개인차가 크고,
 *    국가로 단정하는 순간 이 제품이 막으려는 고정관념을 우리가 만든다. 그래서 사유는 항상
 *    **"받는 사람에 따라 다르게 읽힐 수 있다"** 수준으로만 쓴다.
 *
 * 🔴 **순수 함수다** — 네트워크·저장소를 쓰지 않는다. 권장 6이 요구하는 "2차 안전망"은 서버
 *    판정(`misreadRisks`)과 **독립적으로** 로컬에서 한 번 더 거르는 것이 목적이라, 서버 응답에
 *    의존하면 안전망이 아니게 된다.
 */

/**
 * 판정표 C — 교체 대상 이모지.
 * `to`가 빈 문자열이면 삭제한다(업무 메시지에 대체재가 없는 경우).
 */
export const EMOJI_RULES = [
  { from: '👍', to: '✅', reason: '승인 표시는 해석이 갈릴 수 있어 안전한 기호로 바꿨어요' },
  { from: '👌', to: '✅', reason: '손 모양 이모지는 해석이 갈릴 수 있어요' },
  { from: '✌️', to: '✅', reason: '손 모양 이모지는 해석이 갈릴 수 있어요' },
  { from: '✌', to: '✅', reason: '손 모양 이모지는 해석이 갈릴 수 있어요' },
  { from: '🤙', to: '✅', reason: '손 모양 이모지는 해석이 갈릴 수 있어요' },
  { from: '🤟', to: '✅', reason: '손 모양 이모지는 해석이 갈릴 수 있어요' },
  { from: '☝️', to: '', reason: '지시하는 손짓으로 읽힐 수 있어 뺐어요' },
  { from: '🙏', to: '', reason: '기도·감사·하이파이브로 갈려서 뺐어요 — 감사는 문장으로 쓰는 편이 확실해요' },
  { from: '😂', to: '🙂', reason: '상황에 따라 비웃음으로 읽힐 수 있어요' },
  { from: '🤣', to: '🙂', reason: '상황에 따라 비웃음으로 읽힐 수 있어요' },
  { from: '😅', to: '🙂', reason: '난처함이 비꼼으로 읽힐 수 있어요' },
  { from: '💩', to: '', reason: '업무 메시지에 적합하지 않아 뺐어요' },
  { from: '🖕', to: '', reason: '업무 메시지에 적합하지 않아 뺐어요' },
];

/**
 * 위험한 이모지를 **즉시 교체하고 무엇을 바꿨는지 함께 돌려준다** (권장 4: "자동 교체 후 안내").
 *
 * 🔴 조용히 바꾸지 않는다 — 사용자가 쓴 것을 우리가 고쳤으면 반드시 알린다. 반환값의
 *    `replacements`가 그 안내의 근거이며, 비어 있으면 아무것도 바꾸지 않았다는 뜻이다.
 *
 * @param {string} text
 * @returns {{text: string, replacements: {from: string, to: string, reason: string}[]}}
 */
export function swapRiskyEmoji(text) {
  let output = String(text ?? '');
  const replacements = [];

  for (const rule of EMOJI_RULES) {
    if (!output.includes(rule.from)) continue;
    output = output.split(rule.from).join(rule.to);
    replacements.push(rule);
  }

  // 이모지를 지운 자리에 생긴 이중 공백·문장부호 앞 공백을 정리한다.
  if (replacements.some((rule) => rule.to === '')) {
    output = output.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,!?。，！？])/g, '$1').trim();
  }

  return { text: output, replacements };
}

/**
 * 원문에 있었지만 **교정문에는 남지 않은** 위험 이모지를 찾는다 (S27 실측 후 추가).
 *
 * 🔴 왜 필요한가: `swapRiskyEmoji`는 *교정문에 남은* 이모지만 바꾼다. 그런데 실사용 실측
 *    (2026-08-14)에서 모델이 번역 과정에 이모지를 **스스로 떨어뜨려** 교체할 대상이 없었다.
 *    위험은 사라졌지만 사용자는 "내가 쓴 👍가 어디 갔지?"만 남는다 — 우리가 바꾼 게 아니어도
 *    **없어졌다는 사실과 이유는 알려야** 조용한 변경이 아니게 된다(권장 4의 "안내" 취지).
 * 🔴 교정문에 그대로 남아 있는 이모지는 여기서 빼고 `swapRiskyEmoji`가 처리한다 — 두 안내가
 *    같은 이모지를 두 번 말하면 안 된다.
 *
 * @param {string} sourceText 원문.
 * @param {string} refinedText 교정문(이모지 교체 **전** 기준).
 * @returns {{from: string, reason: string}[]} 원문에만 있던 위험 이모지.
 */
export function findDroppedRiskyEmoji(sourceText, refinedText) {
  const source = String(sourceText ?? '');
  const refined = String(refinedText ?? '');
  return EMOJI_RULES.filter((rule) => source.includes(rule.from) && !refined.includes(rule.from)).map(
    (rule) => ({ from: rule.from, reason: rule.reason }),
  );
}

/* ── 판정표 D — 위험 표현 (권장 6 F-18) ───────────────────────────────── */

/**
 * 🔴 **Spec이 명시한 3종만** 본다: 명령조 · 단정적 부정 · 과도한 사과(3회 이상).
 *    "위험해 보이는 것"을 임의로 늘리면 밑줄이 너무 많아져 사용자가 전부 무시하게 된다 —
 *    안전망은 드물게 켜져야 안전망이다.
 */
export const RISK_KINDS = {
  IMPERATIVE: 'imperative',
  ABSOLUTE_NEGATIVE: 'absolute-negative',
  EXCESSIVE_APOLOGY: 'excessive-apology',
};

export const RISK_LABELS = {
  [RISK_KINDS.IMPERATIVE]: '명령조로 읽힐 수 있어요',
  [RISK_KINDS.ABSOLUTE_NEGATIVE]: '단정적인 부정이에요',
  [RISK_KINDS.EXCESSIVE_APOLOGY]: '사과가 반복돼요 (3회 이상)',
};

/**
 * 🔴 한국어 쪽은 "반드시"와 "해야" 사이에 목적어·부사가 들어간다("반드시 **오늘까지** 해야").
 *    처음에 `반드시\s*\S+(해야)`로 썼다가 그 간격을 못 넘어 실패했다(테스트로 발견). 문장 경계를
 *    넘지 않도록 상한(20자)을 두고, 최소 매칭으로 가장 가까운 서술어까지만 잡는다.
 *
 * 🔴 **주어를 고정하지 않는다**(2026-08-13 실사용에서 발견): 처음엔 Spec의 예시 문구 `You must~`를
 *    문자 그대로 넣었는데, 실제 교정문은 수동태로 나온다 — "**This must be done** by today",
 *    "The fix **needs to** be deployed". 의무를 만드는 것은 주어가 아니라 조동사이므로 `must`·
 *    `have/has to`·`need(s) to`를 주어와 무관하게 잡는다. `without fail`(반드시)도 같은 계열이다.
 */
const IMPERATIVE =
  /\b(must|have to|has to|needs? to|make sure|be sure to|without fail)\b|반드시[^.!?\n]{0,20}?(해야|하셔야|하십시오|해\s*주세요)/gi;
/**
 * 🔴 여기도 실제 출력 형태에 맞췄다(2026-08-13): "절대 안 됩니다"가 영어로는 `never`뿐 아니라
 *    `cannot be used`·`is not possible`처럼 나온다. 다만 단순 `not`까지 잡으면 평범한 부정문이
 *    전부 걸려 밑줄이 무의미해지므로, **단정 강도가 있는 형태만** 넣는다.
 */
/**
 * 🔴 실사용에서 놓친 형태 2가지를 추가했다(2026-08-13 사용자 실측):
 *    ① `must not` — "절대 미뤄지면 안 됩니다"가 이렇게 번역되는데 잡히지 않았다.
 *    ② 한국어 `절대 … 안/못` 사이에 말이 들어가는 경우("절대 **미뤄지면** 안") — 명령조에서
 *       겪은 것과 같은 함정이라, 같은 방식(문장 경계 안에서 최소 매칭)으로 고쳤다.
 */
const ABSOLUTE_NEGATIVE =
  /\b(never|impossible|not possible|no way|won'?t work|cannot|can'?t|must not|may not)\b|절대[^.!?\n]{0,15}?(안|못|없)|불가능/gi;
const APOLOGY_TOKEN = /\b(sorry|apologies|apologize)\b|죄송|미안/gi;

/** 사과는 **3회째부터** 위험으로 본다 — 1~2회는 정상적인 예의다. */
const APOLOGY_THRESHOLD = 3;

/**
 * 위험 표현의 **위치 구간**을 돌려준다. 화면에서 그 구간에만 노란 밑줄을 긋는다.
 *
 * 🔴 반환값은 인덱스와 종류뿐이다 — 잘라낸 문자열을 담지 않는다(Zero Retention 습관을 여기서도
 *    유지한다. 호출자는 원문을 이미 갖고 있으므로 조각을 또 만들 이유가 없다).
 *
 * @param {string} text
 * @returns {{start: number, end: number, kind: string}[]} 시작 위치 오름차순, 겹치지 않음.
 */
export function findRiskySpans(text) {
  const source = String(text ?? '');
  const spans = [];

  const collect = (pattern, kind, skipFirst = 0) => {
    pattern.lastIndex = 0;
    let match;
    let seen = 0;
    while ((match = pattern.exec(source)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      seen += 1;
      if (seen > skipFirst) {
        spans.push({ start: match.index, end: match.index + match[0].length, kind });
      }
    }
  };

  collect(IMPERATIVE, RISK_KINDS.IMPERATIVE);
  collect(ABSOLUTE_NEGATIVE, RISK_KINDS.ABSOLUTE_NEGATIVE);

  // 🔴 사과는 총 횟수가 임계치 이상일 때만, 그것도 **3번째부터** 표시한다.
  const apologyCount = (source.match(APOLOGY_TOKEN) ?? []).length;
  if (apologyCount >= APOLOGY_THRESHOLD) {
    collect(APOLOGY_TOKEN, RISK_KINDS.EXCESSIVE_APOLOGY, APOLOGY_THRESHOLD - 1);
  }

  // 겹치는 구간은 먼저 시작한 것만 남긴다 — 겹쳐 그리면 밑줄이 깨진다.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) continue;
    merged.push(span);
  }
  return merged;
}
