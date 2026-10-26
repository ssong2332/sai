/**
 * 티켓 칸 정의와 「입력창에 넣을 글」 조립 — `TicketPopup.jsx`에서 분리(2026-10-27, 단위 테스트가 JSX 없이 부르도록).
 *
 * 🔴 세 번째 칸은 「다음 할 일」이다 (2026-10-27 사용자 결정). 예전 「요청사항」/`[Request]`는 작성자 자신의
 *    약속(「금요일까지 다시 공유드릴게요」)까지 요청으로 보이게 했다. 데이터 키는 `request` 그대로(prompt.js 주석).
 */
export const TICKET_SECTIONS = [
  { key: 'problem', label: '문제점', tag: 'Issue' },
  { key: 'impact', label: '영향', tag: 'Impact' },
  { key: 'request', label: '다음 할 일', tag: 'Next step' },
];

/** 근거 없는 칸의 표준 표기 — `schema.js` NO_BASIS와 같은 값. */
const NO_BASIS = '없음';

/**
 * 입력창에 넣을 3단 텍스트를 조립한다. 화면 표시와 실제 적용 텍스트가 갈리지 않도록
 * 여기 한 곳에서만 만든다.
 * 🔴 「없음」 칸은 넣지 않는다 (2026-10-27) — 티켓이 상대 언어로 오면서 `[Impact] 없음`이 영어 글 사이에
 *    한국어로 끼게 됐다. 근거 없는 칸은 상대에게 보낼 정보도 아니다.
 */
export function formatTicketText(ticket) {
  return TICKET_SECTIONS.filter((section) => String(ticket?.[section.key] ?? '').trim() !== NO_BASIS)
    .map((section) => `[${section.tag}] ${ticket[section.key]}`)
    .join('\n');
}
