/**
 * 「누가 할 일인가」 비교 (L28 안전망 B, 2026-10-23 사용자 승인 설계).
 *
 * 🔴 **실측한 결함 2건 — 다듬기가 문장의 행동을 바꿨다**:
 *    - L28(L18 D2, 실확장): 「…재발 방지 테스트 추가를 확인하겠습니다.」(**내 약속**)
 *      → 교정문 "Could you please check…?" → 역번역 「…확인해 주실 수 있나요?」(**상대에게 요청**)
 *    - N-02(Claude Haiku 5.5): 「김 대리님이 확인해 주셔야 합니다.」(**3인칭 전달**)
 *      → 역번역 「김수진 님, 이것을 시간 되실 때 검토해 주시겠어요? …」(**수신자에게 직접 요청**)
 *    날짜·숫자 대조(`verify.js`·`numberCheck.js`)로는 못 잡는다 — 값이 아니라 **누가 하느냐**가 바뀌었다.
 *    교정문(외국어)은 우리가 문법을 못 읽으므로 **원문과 한국어 역번역의 문장 끝**을 비교한다.
 *
 * 🔴 **고쳐 쓰지 않는다. 표시만 한다.** 역번역은 확인 수단일 뿐이고, 교정문을 우리가 바꿀 근거가 없다.
 *
 * 🔴 **틀릴 거면 「못 잡는」 쪽으로 틀린다** (S42·S44 교훈 — 오탐이 잦으면 경고 전체를 흘려본다).
 *    확실한 끝맺음만 분류하고, 나머지는 전부 `unknown`(경고 근거가 되지 않는다).
 *
 * 문장 분류표 (2026-10-23, 위에서부터 처음 맞는 행 하나만 적용한다)
 * | 순서 | 문장 끝 (끝 문장부호·이모지·공백 제거 후)                                   | 추가 조건                      | 분류 |
 * |---|---|---|---|
 * | 1 | `주세요`·`주십시오`·`주시겠어요/습니까/나요`·`주실 수 있나요/있을까요/있으신가요/있습니까`·`주실래요`·`주시면 감사하겠습니다/좋겠습니다`·`주시기/주시길 바랍니다`·`주셨으면 합니다/좋겠습니다`·`줄 수 있나요/있을까요/있어요`·`줄래요` | 없음 | **요청** |
 * | 2 | `부탁드립니다`·`부탁드려요`·`부탁드리겠습니다`·`부탁드릴게요`·`부탁합니다`·`부탁해요` | 없음 | **요청** |
 * | 3 | `~야 합니다/해요/됩니다/돼요` (`해야`·`셔야`·`어야`…)                   | 문장 안에 3인칭 주어(`○○님이`·`○○님께서`·`○○씨가`·`○○팀이`) | **전달** |
 * | 4 | `~겠습니다`·`~겠어요`·`~ㄹ게요/께요`(`할게요`·`드릴게요`)               | 물음표로 끝나지 않음 · 3인칭 주어 없음 · 앞 글자가 존대 `시`가 아님 · 제외어 아님 | **약속** |
 * | 5 | 그 밖                                                                         | —                              | unknown |
 *
 * 약속 제외어 (판단·인사·추측이지 약속이 아니다): `알겠습니다`·`모르겠습니다`·`좋겠습니다`·
 * `감사하겠습니다`·`되겠습니다`·`같겠습니다`·`있겠습니다`·`없겠습니다`·`어렵겠습니다`·`괜찮겠습니다`.
 *
 * 경고 판정표 (원문 문장 분류 묶음 S, 역번역 문장 분류 묶음 B)
 * | 조건 | 경고 |
 * |---|---|
 * | 원문 언어가 `ko`가 아니다 · 폴백 · 역번역이 비었다            | 없음 (판정하지 않음) |
 * | S에 **요청**이 하나라도 있다                                   | 없음 — 원래 부탁하는 글이면 역번역의 부탁은 정상이다 |
 * | B에 요청이 없다                                                | 없음 |
 * | B의 약속 수 < S의 약속 수 (약속이 사라지고 요청이 생김)         | 🔴 「원문은 「제가 하겠다」인데, 상대에게 부탁하는 말로 바뀌었어요」 |
 * | B의 전달 수 < S의 전달 수 (전달이 사라지고 요청이 생김)         | 🔴 「원문은 다른 사람이 할 일을 전하는 말인데, 상대에게 부탁하는 말로 바뀌었어요」 |
 *
 * 🔴 3인칭 주어가 **수신자 본인**일 수 있다(「김 대리님이 확인해 주셔야 합니다」를 김 대리에게 보낸 경우 —
 *    그땐 요청이 맞다). 화면이 아는 수신자 이름(`recipientNames`)이 그 주어에 들어 있으면 그 문장은
 *    unknown으로 친다. 이름 표기가 다르면(「김 대리님」 vs `Sujin Kim`) 못 거른다 — 알려진 한계.
 * 🔴 Zero Retention: 입력 문자열은 이 함수 안에서만 쓰이고 어디에도 저장·기록되지 않는다.
 */

export const INTENT = {
  request: 'request',
  commitment: 'commitment',
  relay: 'relay',
  unknown: 'unknown',
};

const REQUEST_ENDINGS = [
  /주(?:세요|십시오|시겠어요|시겠습니까|시겠나요|실래요)$/,
  /주실\s?수\s?(?:있나요|있을까요|있으신가요|있습니까|있으세요)$/,
  /주시면\s?(?:감사하겠습니다|감사하겠어요|좋겠습니다|좋겠어요|감사드리겠습니다)$/,
  /주시(?:기|길)\s?바랍니다$/,
  /주셨으면\s?(?:합니다|해요|좋겠습니다|좋겠어요)$/,
  /줄\s?수\s?(?:있나요|있을까요|있어요)$/,
  /줄래요$/,
  /부탁\s?(?:드립니다|드려요|드리겠습니다|드릴게요|드릴께요|합니다|해요)$/,
];

/** 「해야 합니다」「셔야 해요」 — 의무. 주어가 3인칭일 때만 전달로 본다. */
const OBLIGATION_ENDING = /야\s?(?:합니다|해요|됩니다|돼요)$/;

/**
 * 3인칭 주어. 🔴 띄어쓰기된 조사만 본다(`님이 `·`님께서 `) — 「님이」가 문장 안 아무 데나
 *    붙은 경우까지 넓히면 「고객님이 말씀하신 대로 제가 하겠습니다」 같은 문장이 약속에서 빠진다
 *    (그건 놓치는 쪽이라 허용).
 * 캡처 1번은 주어 덩어리(수신자 이름 대조용).
 */
const THIRD_PERSON_SUBJECT = /([가-힣A-Za-z]+(?:\s[가-힣A-Za-z]+)?\s?(?:님|씨|팀))(?:이|께서|가|에서)(?=\s)/;

const COMMITMENT_EXCLUDED = [
  '알겠습니다', '모르겠습니다', '좋겠습니다', '감사하겠습니다', '되겠습니다',
  '같겠습니다', '있겠습니다', '없겠습니다', '어렵겠습니다', '괜찮겠습니다',
  '알겠어요', '모르겠어요', '좋겠어요', '되겠어요', '같겠어요', '있겠어요', '없겠어요',
];

/** 한글 음절의 받침이 ㄹ인가 — 「할게요」「드릴게요」「볼게요」를 알아보려고. */
function hasRieulFinal(ch) {
  const code = ch ? ch.charCodeAt(0) : 0;
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 === 8;
}

function isCommitmentEnding(body) {
  if (COMMITMENT_EXCLUDED.some((w) => body.endsWith(w))) return false;
  const m = body.match(/(.)겠(?:습니다|어요)$/);
  if (m) return m[1] !== '시'; // 「하시겠습니다」— 존대 주어는 내가 아니다
  const g = body.match(/(.)[게께]요$/);
  return Boolean(g && hasRieulFinal(g[1]));
}

/** 문장 나누기. 🔴 끝 부호를 남겨 둔다 — 물음표 여부가 약속 판정에 쓰인다. */
function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 문장 하나를 분류한다 (헤더 문장 분류표).
 * @param {string} sentence
 * @param {{recipientNames?: string[]}} [options]
 * @returns {'request'|'commitment'|'relay'|'unknown'}
 */
export function classifySentence(sentence, { recipientNames = [] } = {}) {
  const raw = String(sentence ?? '').trim();
  const isQuestion = /[?？]\s*[^가-힣A-Za-z0-9]*$/.test(raw);
  // 끝의 문장부호·이모지·「~」·「^^」·따옴표를 떼고 본문 끝만 본다.
  const body = raw.replace(/[^가-힣A-Za-z0-9]+$/u, '');
  if (body === '') return INTENT.unknown;

  if (REQUEST_ENDINGS.some((re) => re.test(body))) return INTENT.request;

  const subject = body.match(THIRD_PERSON_SUBJECT);
  if (subject) {
    // 🔴 주어가 수신자 본인이면 「전달」이 아니라 요청일 수 있다 — 판정하지 않는다.
    const isRecipient = recipientNames
      .map((n) => String(n ?? '').trim())
      .filter((n) => n.length >= 2)
      .some((n) => subject[1].replace(/\s/g, '').includes(n.replace(/\s/g, '')));
    if (isRecipient) return INTENT.unknown;
    return OBLIGATION_ENDING.test(body) ? INTENT.relay : INTENT.unknown;
  }

  if (!isQuestion && isCommitmentEnding(body)) return INTENT.commitment;
  return INTENT.unknown;
}

function countKinds(text, options) {
  const counts = { request: 0, commitment: 0, relay: 0, unknown: 0 };
  for (const s of splitSentences(text)) counts[classifySentence(s, options)] += 1;
  return counts;
}

/**
 * 원문과 한국어 역번역을 비교한다 (헤더 경고 판정표).
 * @param {object} input
 * @param {string} input.sourceText 사용자가 쓴 원문(한국어).
 * @param {string} input.backTranslation 한국어 역번역.
 * @param {string[]} [input.recipientNames] 화면이 아는 수신자 이름.
 * @returns {Array<'commitment'|'relay'>} 바뀐 종류. 없으면 빈 배열.
 */
export function findIntentDrift({ sourceText, backTranslation, recipientNames = [] }) {
  if (String(sourceText ?? '').trim() === '' || String(backTranslation ?? '').trim() === '') return [];
  const options = { recipientNames };
  const src = countKinds(sourceText, options);
  if (src.request > 0) return [];
  const back = countKinds(backTranslation, options);
  if (back.request === 0) return [];

  const drift = [];
  if (back.commitment < src.commitment) drift.push(INTENT.commitment);
  if (back.relay < src.relay) drift.push(INTENT.relay);
  return drift;
}

/**
 * 화면이 쓰는 단일 진입점. 🔴 **폴백 결과는 검사하지 않는다** — 역번역이 없고 교정문이 원문 그대로다.
 *    🔴 한국어 원문만 — 분류표가 한국어 끝맺음만 안다.
 */
export function checkIntentDrift(result, sourceText = '', { recipientNames = [] } = {}) {
  if (!result || typeof result !== 'object' || result.fallback) return [];
  if (result.sourceLanguage !== 'ko') return [];
  return findIntentDrift({
    sourceText,
    backTranslation: result.backTranslation ?? '',
    recipientNames,
  });
}

/** 화면 문구. 🔴 단정하지 않는다 — 역번역 자체가 틀렸을 수도 있어 「확인해 달라」로 끝낸다. */
export function intentDriftWarningText(kind) {
  if (kind === INTENT.commitment) {
    return '원문은 「제가 하겠다」인데, 상대에게 부탁하는 말로 바뀌었어요 — 역번역을 확인해 주세요.';
  }
  if (kind === INTENT.relay) {
    return '원문은 다른 사람이 할 일을 전하는 말인데, 상대에게 부탁하는 말로 바뀌었어요 — 역번역을 확인해 주세요.';
  }
  return '';
}
