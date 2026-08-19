/**
 * 회신 초안 사전 질문 (S37 후속 / 2026-08-14 사용자 요청).
 *
 * 🔴 **질문은 초안이 비울 자리를 정확히 겨냥한다.** 초안은 원문에 없는 구체값을 지어낼 수 없어
 *    `[date]` 같은 자리표시자로 비운다(`prompt.js`). 그 빈칸을 사용자가 **미리** 채우면 초안이
 *    그만큼 완성된 문장으로 나온다. 질문 항목이 곧 자리표시자 목록인 이유가 여기 있다.
 *
 * 🔴 **추가 LLM 호출이 없다.** 질문을 모델에게 만들게 하면 초안 1개당 호출이 2배가 되고,
 *    "질문을 지어냈다"는 새 검증 대상이 생긴다. 의도가 3종뿐이고 각 의도가 요구하는 값이
 *    구조적으로 정해져 있으므로 고정 세트로 충분하다.
 *
 * 🔴 **모든 질문은 건너뛸 수 있다.** 답하지 않으면 그 값은 자리표시자로 남을 뿐이다 —
 *    답을 강제하면 "빨리 초안만 보고 싶은" 사용자가 아무 칩이나 누르고, 그게 사실이 아닌 값으로
 *    초안에 박힌다. 두 장치(질문·자리표시자)는 서로를 대체하지 않고 맞물린다.
 */

/**
 * 의도별 질문. `options`는 객관식 칩, 그 외에는 직접 입력.
 * 🔴 `id`는 화면 상태 키일 뿐이고 서버로는 `question`·`answer` 문자열만 나간다.
 */
export const REPLY_QUESTIONS = {
  accept: [
    {
      id: 'when',
      question: '언제까지 해드릴 수 있나요?',
      options: ['오늘 중', '내일 중', '이번 주 안'],
    },
    {
      id: 'meeting',
      question: '미팅을 제안할까요?',
      options: ['제안 안 함', '짧은 통화', '화면 공유 미팅'],
    },
  ],
  schedule: [
    {
      id: 'why',
      question: '지금 일정이 어려운 이유는 무엇인가요?',
      options: ['다른 업무 우선순위', '자료·정보 대기 중', '검토 범위가 큼'],
    },
    {
      id: 'when',
      question: '언제면 가능한가요?',
      options: ['내일', '이번 주 안', '다음 주'],
    },
  ],
  clarify: [
    {
      id: 'what',
      question: '무엇이 불분명한가요?',
      options: ['작업 범위', '우선순위', '기대하는 결과물'],
    },
    {
      id: 'by',
      question: '언제까지 답을 받아야 하나요?',
      options: ['오늘 중', '내일 중', '급하지 않음'],
    },
  ],
  /**
   * 🔴 아래 셋(v4)은 **질문이 특히 중요하다.** 모델이 사용자의 회사·진척·거절 사유를 알 리
   *    없어서, 답이 없으면 초안이 자리표시자 덩어리가 된다. 질문에 답하는 만큼만 문장이 된다.
   */
  inform: [
    {
      id: 'about',
      question: '무엇을 소개할까요?',
      options: ['하는 일 개요', '협업 가능 분야', '팀 규모·구성'],
    },
    {
      id: 'next',
      question: '다음 단계를 제안할까요?',
      options: ['제안 안 함', '자료 먼저 보내기', '짧은 통화'],
    },
  ],
  update: [
    {
      id: 'stage',
      question: '지금 어느 단계인가요?',
      options: ['막 시작', '진행 중', '거의 마무리'],
    },
    {
      id: 'blocker',
      question: '막고 있는 것이 있나요?',
      options: ['없음', '자료·정보 대기', '다른 팀 확인 필요'],
    },
  ],
  decline: [
    {
      id: 'why',
      question: '거절하는 이유는 무엇인가요?',
      options: ['일정이 안 됨', '담당 범위가 아님', '자원이 부족함'],
    },
    {
      id: 'alt',
      question: '대안을 제시할까요?',
      options: ['제안 안 함', '다른 일정이면 가능', '다른 담당자 연결'],
    },
  ],
};

/** 답변 하나의 최대 길이. 초안 프롬프트에 실리는 값이라 상한을 둔다. */
export const MAX_ANSWER_LENGTH = 200;

/**
 * 화면 상태(`{questionId: '답'}`)를 서버 계약 형태로 바꾼다.
 * 답하지 않은 항목은 **빠진다** — 빈 문자열을 보내면 모델이 "빈 값"을 사실로 취급한다.
 *
 * @returns {{question: string, answer: string}[]}
 */
export function buildAnswerList(intent, answers = {}) {
  const questions = REPLY_QUESTIONS[intent] ?? [];
  const out = [];
  for (const item of questions) {
    const raw = answers[item.id];
    if (typeof raw !== 'string') continue;
    const answer = raw.trim().slice(0, MAX_ANSWER_LENGTH);
    if (answer === '') continue;
    out.push({ question: item.question, answer });
  }
  return out;
}

/**
 * 사용자가 답한 값들을 한 덩어리 문자열로 잇는다.
 * 🔴 `verify.js`가 **"사용자가 직접 넣은 값은 지어낸 값이 아니다"**를 판정하는 데 쓴다.
 */
export function answersToText(answerList = []) {
  return answerList.map((item) => item.answer).join(' ');
}
