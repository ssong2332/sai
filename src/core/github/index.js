/**
 * GitHub 공개 활동 → 소통 태그 1차 제안 (S22 / Spec audit 3).
 *
 * 🔴 **여기가 유일한 출구다.** 신호 계산(`signals.js`)과 판정표(`rules.js`)를 따로 부르지 말고
 *    `analyzePublicActivity()`를 쓴다 — 밈 사전을 캐주얼 판정에 넣는 배선이 여기 한 곳에만 있다.
 * 🔴 이 모듈도 네트워크를 모른다. 수집은 `src/lib/githubClient.js`.
 * 🔴 **비공개 레포는 보지 않는다** (2026-08-14 사용자 결정). 스코프를 아예 요청하지 않으므로
 *    토큰이 있어도 볼 수 없다 — 토큰의 용도는 시간당 한도(60 → 5,000)뿐이다.
 */

import { collectSignals } from './signals.js';
import { suggestTags, skipMessage, TAG_RULES, MIN_WRITINGS, SKIP_REASONS } from './rules.js';
import { memeGlossary } from '../meme/index.js';

export { collectSignals } from './signals.js';
export { suggestTags, skipMessage, TAG_RULES, MIN_WRITINGS, SKIP_REASONS } from './rules.js';

/**
 * 공개 이벤트 배열을 받아 태그 제안까지 한 번에 만든다.
 *
 * @param {object[]} events `GET /users/{id}/events/public` 응답.
 * @param {object} [options]
 * @param {string} [options.timeZone] 수신자에 등록된 IANA 타임존. 없으면 오전 신호는 판정하지 않는다.
 * @returns {{signals: object, suggestions: object[], skipped: string|null, message: string}}
 *   🔴 반환값 어디에도 **코멘트 본문이 없다** (Spec 필수 5). 수치와 태그 id, 근거 문구뿐이다.
 */
export function analyzePublicActivity(events, { timeZone = null } = {}) {
  // 🔴 캐주얼 판정에 **밈 시드 전체**(45건)를 쓴다 — 해설 표시와 같은 사전이라 기준이 갈리지 않는다.
  const casualPhrases = memeGlossary(true).map((entry) => entry.text);
  const signals = collectSignals(events, { timeZone, casualPhrases });
  const { suggestions, skipped } = suggestTags(signals);
  return { signals, suggestions, skipped, message: skipMessage(skipped, signals) };
}
