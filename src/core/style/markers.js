/**
 * 완곡·캐주얼 표지 사전 (2026-08-14 이동 — 나를 보는 판정과 상대를 보는 판정이 공유한다).
 *
 * 🔴 **한 곳에만 둔다.** `core/github/signals.js`(상대의 공개 활동 판정)와 「내 문체」가 같은
 *    사전을 써야 "상대는 완곡하다"와 "나는 안 그렇다"가 같은 기준에서 나온다. 사전이 갈리면
 *    두 화면이 서로 다른 말을 하고 아무도 그걸 눈치채지 못한다.
 *
 * 🔴 **2026-08-17 — 이 파일은 복원본이다.**
 *    「내 문체」 기능을 삭제하면서 `src/core/style/` 디렉터리를 통째로 지웠는데, 이 파일만은
 *    **S22(상대 판정)가 여전히 쓰고 있었다.** 문체 전용이라고 넘겨짚은 것이 잘못이다 —
 *    바로 위 주석이 "한 곳에만 둔다"고 적어 둔 그 공유 파일이었다. 삭제 직후 테스트가
 *    `ERR_MODULE_NOT_FOUND`로 잡아냈다(`test/github.unit.test.js`).
 *    파일이 git에 없어(untracked) 되돌릴 수 없었고, **빌드 산출물(`dist/assets/*.js`)에 남아
 *    있던 정규식 배열에서 그대로 복원**했다. 규칙 자체는 번들 그대로라 판정 결과는 같지만,
 *    원본에 있던 각 표현의 선정 근거 주석은 복원하지 못했다.
 *    🔴 교훈: 디렉터리를 지우기 전에 **그 안의 파일을 누가 import하는지** 먼저 본다.
 */

/**
 * 완곡 표지 — "돌려 말하고 있다"의 신호.
 * 🔴 영어는 단어 경계(`\b`)를 건다. `might`가 `mighty` 안에서 걸리면 판정이 통째로 무의미해진다.
 */
const HEDGE_PATTERNS = [
  /\bmaybe\b/i,
  /\bperhaps\b/i,
  /\bmight\b/i,
  /\bi wonder\b/i,
  /\bif possible\b/i,
  /\bjust a thought\b/i,
  /\bnot sure\b/i,
  /\bcould we\b/i,
  /\bwould it be\b/i,
  /\bkind of\b/i,
  /\bsort of\b/i,
  /\bi think maybe\b/i,
  /혹시/,
  /괜찮으시다면/,
  /가능하시면/,
  /어려우시면/,
  /해도 될까요/,
  /인 것 같/,
  /좀\s*그런/,
  /부담되시면/,
];

/** 캐주얼 표지 — 축약형·구어체. 🔴 한국어는 경계가 없으므로 형태 자체로 좁게 잡는다. */
const CASUAL_PATTERNS = [
  /\bgonna\b/i,
  /\bwanna\b/i,
  /\bkinda\b/i,
  /\bgotta\b/i,
  /\blemme\b/i,
  /\btbh\b/i,
  /\bimo\b/i,
  /\bnp\b/i,
  /ㅋㅋ|ㅎㅎ/,
  /넵\b/,
  /굿\b/,
  /~+요/,
];

/** @returns {boolean} 완곡 표지가 하나라도 있으면 true. */
export function isHedged(text) {
  return HEDGE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * @param {string} text
 * @param {string[]} [phrases] 밈 사전에서 온 추가 표현(소문자 비교).
 *   🔴 사전을 인자로 받는다 — 이 모듈이 밈 데이터를 직접 알면 두 곳이 서로를 import한다.
 * @returns {boolean}
 */
export function isCasual(text, phrases = []) {
  const lowered = String(text ?? '').toLowerCase();
  if (phrases.some((phrase) => phrase && lowered.includes(phrase))) return true;
  return CASUAL_PATTERNS.some((pattern) => pattern.test(text));
}
