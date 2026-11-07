/**
 * 교정문 첫 글자 대문자 보정 (2026-11-07 K9, 사용자 결정 「고쳐」).
 *
 * 🔴 **실측한 결함**: 빠른 모드(Haiku 5.5) 한국어 → 독일어 교정문이 「vielen Dank für …」처럼 소문자로 시작했다
 *    (같은 문장 4회 중 3회, 기본 모드 0/3). 인사(「Hallo, …」)를 붙였다가 이름 없는 인사 규칙 때문에 인사만 지운
 *    흔적으로 추정한다(미확인). 문장 첫 글자 소문자는 받는 사람에게 실수처럼 보인다.
 * 🔴 **고쳐 쓰지 않는다 — 첫 글자 하나만.** 프롬프트로 확률을 낮추는 대신 결과가 확실히 틀린 모양일 때만 코드가 바로잡는다.
 *
 * 판정표 (위에서부터 처음 맞는 행 하나만 적용한다)
 * | 조건 | 결과 |
 * |---|---|
 * | 상대 언어가 라틴 문자권(en·de·fr·es)이 아님 | 그대로 |
 * | 첫 단어(여는 부호 ¿¡«"'( 뒤)가 소문자로 시작하지 않음 | 그대로 |
 * | 첫 덩어리(공백 전)에 숫자·`.`·`@`·`/`·`:`가 있음 — 주소·코드·버전 | 그대로 |
 * | 첫 단어에 대문자가 섞임(iPhone·eBay) | 그대로 |
 * | 원문에 그 단어가 소문자 그대로 있음(브랜드·용어를 원문대로 둔 것) | 그대로 |
 * | 그 밖 | 첫 글자만 대문자 |
 */

const LATIN_TARGETS = new Set(['en', 'de', 'fr', 'es']);
const OPENERS = /^[\s¿¡«»"'“‘„(\[]*/u;

/**
 * @param {string} refined 교정문.
 * @param {string} targetLanguage 상대 언어.
 * @param {string} [originalText] 원문 — 원문에 같은 소문자 단어가 있으면 건드리지 않는다.
 * @returns {string} 보정한 교정문(바꿀 것이 없으면 그대로).
 */
export function capitalizeSentenceStart(refined, targetLanguage, originalText = '') {
  if (typeof refined !== 'string' || !LATIN_TARGETS.has(targetLanguage)) return refined;
  const lead = refined.match(OPENERS)[0];
  const rest = refined.slice(lead.length);
  const chunk = rest.split(/\s/, 1)[0] ?? '';
  if (chunk === '' || /[\d.@/:]/.test(chunk)) return refined;
  const word = (chunk.match(/^\p{L}+/u) ?? [''])[0];
  if (word === '' || !/^\p{Ll}/u.test(word)) return refined;
  if (word !== word.toLowerCase()) return refined;
  if (String(originalText ?? '').includes(word)) return refined;
  return `${lead}${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
}
