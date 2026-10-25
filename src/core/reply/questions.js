/**
 * 회신 초안 질문 모드 (S37 후속 → L29 2026-10-25 재설계).
 *
 * 🔴 **질문은 초안이 실제로 비운 자리에서 나온다.** 예전(2026-08-14~10-24)에는 의도별 고정 질문
 *    세트(`REPLY_QUESTIONS`)를 초안 **전에** 물었다. 그런데 의도가 같아도 메시지마다 빈칸이 다르다 —
 *    출시 지연을 묻는 메시지에 「정보 제공」을 고르면 「무엇을 소개할까요? (하는 일 개요·협업 가능
 *    분야·팀 규모)」가 나왔고(L18 발견 D1), 같은 메시지를 자동 모드로 돌리면 초안이 `[지연 이유]`·
 *    `[예상 일정]`으로 정확히 겨냥했다. **질문 모드가 자동 모드보다 못했다.**
 *    그래서 순서를 뒤집는다: 초안을 먼저 만들고(자동 모드와 같은 요청), 그 초안의 `[…]`
 *    자리표시자 하나하나를 질문으로 삼는다. 묻는 것과 비어 있는 것이 정의상 일치한다.
 *
 * 🔴 **추가 LLM 호출이 없다.** 질문 모드도 호출은 1회(초안)다. 답은 자리표시자에 **코드로 대입**한다 —
 *    답을 실어 다시 생성하면 호출이 2배가 되고, 다시 만든 초안은 문장·빈칸 구성이 바뀌어 사용자가
 *    방금 답한 질문과 어긋날 수 있다. 대입 후 문장은 어차피 「다듬기」(번역·윤문)를 거쳐 나간다.
 *
 * 🔴 **모든 질문은 건너뛸 수 있다.** 답하지 않은 칸은 자리표시자로 남고, 초안 아래 「채워 주세요」가
 *    그대로 짚는다. 답을 강제하면 아무 값이나 넣은 것이 사실처럼 초안에 박힌다.
 *
 * 🔴 대입은 **초안 문장을 고치는 것이 아니라 사용자가 손으로 채우는 일을 대신하는 것**이다 —
 *    `verify.js`의 「코드가 모델 출력을 재작성하지 않는다」와 충돌하지 않는다. 대입한 값은 사용자가
 *    준 값이라 `answersToText`로 검증기에 「사용자 값」으로 넘긴다.
 */

/** 답변 하나의 최대 길이. 서버 `answers` 계약(`index.js`)과 같은 상한을 쓴다. */
export const MAX_ANSWER_LENGTH = 200;

/** 한 초안에서 묻는 자리표시자 수 상한 — 그 이상은 초안 안에서 직접 채우는 편이 빠르다. */
export const MAX_PLACEHOLDER_QUESTIONS = 6;

/**
 * 자리표시자 목록(`collectPlaceholders` 결과, 대괄호 포함)을 질문 목록으로 바꾼다.
 * 🔴 라벨은 모델이 쓴 그대로다. 프롬프트가 자리표시자를 **검토 언어(사용자의 언어)**로 쓰게 하므로
 *    (`prompt.js` NO_FABRICATION_RULE · COMPOSE_ORDER_RULE) 한국어 사용자에게는 `지연 이유`처럼
 *    보인다. 라벨을 질문문으로 다시 꾸미지 않는다 — 조사·어미를 붙이다 뜻이 틀어지면 질문이
 *    빈칸과 다시 어긋난다.
 *
 * @param {string[]} placeholders 예: `['[지연 이유]', '[예상 일정]']`
 * @returns {{id: string, placeholder: string, label: string}[]}
 */
export function buildPlaceholderQuestions(placeholders = []) {
  const out = [];
  for (const placeholder of placeholders) {
    if (typeof placeholder !== 'string') continue;
    const label = placeholder.replace(/^\[|\]$/g, '').trim();
    if (label === '') continue;
    out.push({ id: placeholder, placeholder, label });
    if (out.length >= MAX_PLACEHOLDER_QUESTIONS) break;
  }
  return out;
}

/**
 * 화면 상태(`{placeholder: '답'}`)를 답변 목록으로 바꾼다.
 * 답하지 않은 항목은 **빠진다** — 빈 값으로 대입하면 문장에 구멍이 생기고, 그 구멍은 경고도 안 뜬다.
 *
 * @returns {{placeholder: string, question: string, answer: string}[]}
 */
export function buildAnswerList(questions = [], answers = {}) {
  const out = [];
  for (const item of questions) {
    const raw = answers[item.id];
    if (typeof raw !== 'string') continue;
    const answer = raw.trim().slice(0, MAX_ANSWER_LENGTH);
    if (answer === '') continue;
    out.push({ placeholder: item.placeholder, question: item.label, answer });
  }
  return out;
}

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JONG_RIEUL = 8;

/**
 * 한국어 조사 짝: [받침 있을 때, 받침 없을 때]. 🔴 긴 것부터 대조한다(`으로`가 `로`보다 먼저).
 * `으로/로`는 ㄹ 받침이면 `로`다.
 */
const PARTICLE_PAIRS = [
  ['으로', '로'],
  ['을', '를'],
  ['은', '는'],
  ['이', '가'],
  ['과', '와'],
];

/**
 * 자리표시자 **바로 뒤** 조사를 대입한 값의 받침에 맞춘다.
 *
 * 🔴 모델은 조사를 **라벨**에 맞춰 쓴다 — `[지연 이유]로`. 여기에 「자료 대기 중」을 넣으면
 *    「자료 대기 중로」가 된다. 사용자가 손으로 채웠다면 자연히 고쳤을 부분이다.
 * 🔴 **좁게만 고친다.** ① 값이 한글 음절로 끝날 때만(숫자·영문은 읽는 법이 갈려 판정 못 함)
 *    ② 조사 뒤가 한글이 아닐 때만(공백·문장부호·끝) — `[날짜]이후`의 「이」를 조사로 오인하지
 *    않으려는 것이다. 판정이 안 서면 모델이 쓴 그대로 둔다(틀려도 다듬기가 다시 본다).
 */
function adjustParticle(value, after) {
  const last = value.charCodeAt(value.length - 1);
  if (!(last >= HANGUL_FIRST && last <= HANGUL_LAST)) return after;
  const jong = (last - HANGUL_FIRST) % 28;
  for (const [withBatchim, withoutBatchim] of PARTICLE_PAIRS) {
    for (const written of [withBatchim, withoutBatchim]) {
      if (!after.startsWith(written)) continue;
      const next = after.charCodeAt(written.length);
      if (next >= HANGUL_FIRST && next <= HANGUL_LAST) return after;
      let wanted = jong === 0 ? withoutBatchim : withBatchim;
      if (withBatchim === '으로' && jong === JONG_RIEUL) wanted = withoutBatchim;
      return wanted + after.slice(written.length);
    }
  }
  return after;
}

/**
 * 초안의 자리표시자를 사용자가 준 답으로 바꾼다. **같은 자리표시자가 여러 번 나오면 전부** 바꾼다.
 * 🔴 대상은 사용자가 **지금 편집 중인 문장**이다 — 모델 원본에 대입하면 사용자가 손으로 고친
 *    부분이 사라진다. 사용자가 이미 지운 자리표시자는 그냥 건너뛴다.
 *
 * @param {string} draft
 * @param {{placeholder: string, answer: string}[]} answerList
 * @returns {string}
 */
export function fillPlaceholders(draft, answerList = []) {
  let out = String(draft ?? '');
  for (const { placeholder, answer } of answerList) {
    if (!placeholder || !answer) continue;
    const parts = out.split(placeholder);
    if (parts.length === 1) continue;
    out = parts
      .map((part, index) => (index === 0 ? part : answer + adjustParticle(answer, part)))
      .join('');
  }
  return out;
}

/**
 * 사용자가 답한 값들을 한 덩어리 문자열로 잇는다.
 * 🔴 `verify.js`가 **"사용자가 직접 넣은 값은 지어낸 값이 아니다"**를 판정하는 데 쓴다 — 대입한
 *    값 속 숫자·요일이 「확인 필요」로 뜨지 않게 한다.
 */
export function answersToText(answerList = []) {
  return answerList.map((item) => item.answer).join(' ');
}
