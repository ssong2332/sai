/**
 * 요청 길이 상한 (2026-11-07 전수 점검). 서버(Worker `requestTooLong`)와 확장 화면이 **같은 값**을 쓴다.
 *
 * | 값 | 상한 | 근거 |
 * |---|---|---|
 * | `MAX_TEXT_CHARS` | 10,000자 | 업무 메시지 한 통은 대개 수백~수천 자. 넘으면 비용이 건당 추정값보다 커진다 |
 * | `MAX_DECISIONS_CHARS` | 40,000자 | 결정 요약은 대화 전체를 읽는다 |
 * | `MAX_GLOSSARY_ENTRIES` | 300개 | 개인·팀 용어집을 합친 요청 한 건의 항목 수 |
 *
 * 🔴 값을 바꾸면 서버와 확장이 함께 바뀐다(이 파일 하나). 서버는 넘으면 400 `text-too-long`으로 거절하고
 *    사용량을 세지 않는다. 확장은 같은 값으로 미리 막아 안내한다.
 */
export const MAX_TEXT_CHARS = 10_000;
export const MAX_DECISIONS_CHARS = 40_000;
export const MAX_GLOSSARY_ENTRIES = 300;

/** 화면 안내 — 서버 400 `text-too-long`과 확장 사전 검사가 같은 문구를 쓴다. */
export const TEXT_TOO_LONG_NOTICE = `글이 너무 길어요 — 한 번에 ${MAX_TEXT_CHARS.toLocaleString('ko-KR')}자까지 처리할 수 있어요. 나눠서 다시 시도해 주세요.`;
