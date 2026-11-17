/**
 * 요청 길이 상한 (2026-11-07 전수 점검). 서버(Worker `requestTooLong`)와 확장 화면이 **같은 값**을 쓴다.
 *
 * | 값 | 상한 | 근거 |
 * |---|---|---|
 * | `MAX_TEXT_CHARS` | 10,000자 | 업무 메시지 한 통은 대개 수백~수천 자. 넘으면 비용이 건당 추정값보다 커진다 |
 * | `MAX_DECISIONS_CHARS` | 40,000자 | 결정 요약은 대화 전체를 읽는다 |
 * | `MAX_GLOSSARY_ENTRIES` | 300개 | 개인·팀 용어집을 합친 요청 한 건의 항목 수 |
 * | `MAX_GLOSSARY_TERM_CHARS` | 200자 | 용어 하나의 원문·번역어 — Firestore 규칙(`firestore.rules` 용어집 200자)과 같다 |
 * | `MAX_REQUEST_EXTRA_CHARS` | 160,000자 | 본문 상한을 뺀 요청 전체(JSON) — 용어 300개 × 200자 두 칸 + 키를 담고 남는다. 프로필·수신자처럼 따로 상한이 없는 칸이 커지는 것을 막는다(2026-11-17) |
 *
 * 🔴 값을 바꾸면 서버와 확장이 함께 바뀐다(이 파일 하나). 서버는 넘으면 400 `text-too-long`으로 거절하고
 *    사용량을 세지 않는다. 확장은 같은 값으로 미리 막아 안내한다.
 */
export const MAX_TEXT_CHARS = 10_000;
export const MAX_DECISIONS_CHARS = 40_000;
export const MAX_GLOSSARY_ENTRIES = 300;
export const MAX_GLOSSARY_TERM_CHARS = 200;
export const MAX_REQUEST_EXTRA_CHARS = 160_000;

/**
 * 확장이 보낼 용어집을 서버 상한 안으로 맞춘다 (2026-11-17 점검).
 * 서버는 항목이 `MAX_GLOSSARY_ENTRIES`개를 넘으면 요청 전체를 거절하고, `MAX_GLOSSARY_TERM_CHARS`자를 넘는 용어는 뺀다.
 * 개인 용어(우선순위가 높다)를 먼저 `personalLimit`개까지, 남은 자리만큼 팀 용어를 싣는다.
 * @returns {{personal: object[], team: object[]}}
 */
export function fitGlossary(personal, team, personalLimit = null) {
  const short = (e) => !(e?.sourceText?.length > MAX_GLOSSARY_TERM_CHARS) && !(e?.targetText?.length > MAX_GLOSSARY_TERM_CHARS);
  const p = personal.filter(short).slice(0, Math.min(personalLimit ?? MAX_GLOSSARY_ENTRIES, MAX_GLOSSARY_ENTRIES));
  return { personal: p, team: team.filter(short).slice(0, MAX_GLOSSARY_ENTRIES - p.length) };
}

/** 화면 안내 — 서버 400 `text-too-long`과 확장 사전 검사가 같은 문구를 쓴다. */
export const TEXT_TOO_LONG_NOTICE = `글이 너무 길어요 — 한 번에 ${MAX_TEXT_CHARS.toLocaleString('ko-KR')}자까지 처리할 수 있어요. 나눠서 다시 시도해 주세요.`;
