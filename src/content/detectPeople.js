/**
 * 대화 상대 후보 감지 (2026-08-16 사용자 요청 ⑦⑧).
 *
 * 🔴 **자동으로 등록하지 않는다.** 제3자 정보를 동의 없이 수집하는 일이고, Spec 필수 9의
 *    「사용자가 직접 지정한 것만」과 정면으로 충돌한다. 이 모듈은 **후보 이름만 뽑고**, 등록은
 *    사용자가 팝업에서 누를 때만 일어난다.
 *
 * 🔴 **사이트별 선택자를 쓰지 않는다** (Lessons #3·#4 — 마크업이 사이트마다 완전히 다르고
 *    바뀐다). 대신 이미 모아 둔 **직전 대화 텍스트**(`threadContext.js`)에서 구조적 패턴만 본다:
 *    채팅·메일 렌더링은 거의 항상 `이름: 내용` 또는 `이름 <메일>` 꼴로 발화자를 앞에 둔다.
 *
 * 🔴 **못 찾으면 빈손이 낫다.** 아무 낱말이나 이름으로 집으면 사용자가 모르는 사람을 등록하게
 *    되고, 그 사람 이름으로 태그·언어가 붙는다. 확신이 없으면 아무것도 돌려주지 않는다.
 *
 * 🔴 Zero Retention: 후보 이름은 **화면에 보여주기 위해서만** 존재한다. 저장은 사용자가
 *    「추가」를 눌렀을 때 `recipients.js`가 한다.
 */

/** `이름: 내용` — 채팅·회의록·메일 인용에서 가장 흔한 꼴. */
const SPEAKER_PATTERN = /^\s*([^\s:：][^:：\n]{0,29})\s*[:：]\s*\S/;

/** `Sarah <sarah@acme.com>` · `Sarah (Acme)` — 메일 헤더 렌더링. */
const NAME_BEFORE_BRACKET = /^\s*([^\s<(][^<(\n]{0,29})\s*[<(]/;

/**
 * 이름으로 보기 어려운 것들.
 * 🔴 시각·날짜·URL·번호는 `이름:` 패턴에 잘 걸린다("14:30", "https://…", "PR #482: 제목").
 */
const REJECT = [
  /^\d/, // 숫자로 시작 (시각·날짜·번호)
  /^https?$/i,
  /^(re|fw|fwd|참고|공지|알림|note|todo|tip)$/i,
  // 🔴 말줄임 — 잘린 문장 조각이다. `…`는 **한 글자**(U+2026)라 `{2,}`로는 안 잡힌다
  //    (2026-08-16 테스트가 잡은 실수: 「그래서 말인데…」가 이름으로 통과했다).
  /…|\.{2,}/,
  /[?!]/, // 물음표·느낌표가 든 것은 문장이지 이름이 아니다
];

/** 이름 한 개의 최소 조건. */
function looksLikeName(value) {
  const name = String(value ?? '').trim();
  if (name.length < 2 || name.length > 30) return false;
  if (REJECT.some((pattern) => pattern.test(name))) return false;
  // 🔴 낱말 4개를 넘으면 문장이다 — 「오늘 회의 자료 정리했습니다」가 이름이 되면 안 된다.
  if (name.split(/\s+/).length > 4) return false;
  return true;
}

/**
 * 문장 종결 — 이걸로 끝나면 이름이 아니라 말이다.
 * 🔴 한국어 종결어미(`~요`·`~다`·`~죠`…)와 문장부호를 함께 본다. 「컴펌확인해주세요」가
 *    이름으로 잡히면 그 이름으로 수신자가 등록된다.
 */
const SENTENCE_END = /[.!?…]$|(요|다|까|죠|네|음|임|함|세요|니다)$/;

/** 별도 줄에 놓인 이름의 최소 조건. 🔴 짧은 줄은 무엇이든 될 수 있으므로 조건을 겹으로 건다. */
function looksLikeStandaloneName(line) {
  const name = String(line ?? '').trim();
  if (name.length < 2 || name.length > 20) return false;
  if (SENTENCE_END.test(name)) return false;
  return looksLikeName(name);
}

/**
 * 직전 대화 줄들에서 발화자 이름 후보를 뽑는다.
 *
 * @param {string[]} lines `collectThreadContext()`가 모은 대화 조각.
 * @param {number} [limit] 최대 후보 수.
 * @returns {string[]} 자주 나온 순. 없으면 빈 배열.
 */
export function detectSpeakerNames(lines, limit = 3) {
  const counts = new Map();
  const list = Array.isArray(lines) ? lines : [];
  for (const [index, raw] of list.entries()) {
    const line = String(raw ?? '');
    /**
     * 🔴 **구조가 `X: Y`·`X <Y>`면 그 구조로만 판정하고, 실패해도 아래 「별도 줄」로 흘리지
     *    않는다** (2026-08-16 테스트가 잡은 결함). 흘리면 이름 부분이 걸러진 줄이 **통째로**
     *    이름이 된다 — 「FW: 자료」가 이름으로 잡혔다.
     */
    let structural = false;
    let matched = false;
    for (const pattern of [SPEAKER_PATTERN, NAME_BEFORE_BRACKET]) {
      const match = pattern.exec(line);
      if (!match) continue;
      structural = true;
      const name = match[1].trim();
      if (!looksLikeName(name)) break;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      matched = true;
      break; // 한 줄에서 한 번만 센다.
    }
    if (matched || structural) continue;

    /**
     * 🔴 **이름이 자기 줄에 따로 있는 구조** (2026-08-16 실측이 잡은 누락). Slack·Teams를 비롯한
     *    많은 화면이 발화자 이름을 **메시지 위 별도 줄**에 둔다 — `이름: 내용` 꼴만 보던 탓에
     *    프로필에 등록된 사람인데도 감지가 전혀 되지 않았다(실확장 스크린샷의 「제이미」).
     * 🔴 이 패턴은 **가장 위험하다** — 짧은 줄은 무엇이든 될 수 있다. 그래서 조건을 겹으로 건다:
     *    ① 다음 줄이 있고 **그 줄이 더 길다**(이름 위에 본문이 오지는 않는다)
     *    ② 문장 종결이 아니다(마침표·물음표·「~요/다/니다」로 끝나면 문장이다)
     *    ③ 20자 이내
     *    그래도 확신이 없으면 집지 않는다 — 잘못 집으면 사용자가 모르는 사람을 등록하게 된다.
     */
    const next = String(list[index + 1] ?? '');
    if (next.length <= line.length) continue;
    if (!looksLikeStandaloneName(line)) continue;
    const name = line.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

/** 이름 비교 — 공백·대소문자 차이는 같은 사람으로 본다. */
function sameName(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

/**
 * 후보와 등록된 수신자를 맞춰 본다.
 *
 * 🔴 **등록된 사람과 일치할 때만 자동 선택한다.** 그 사람은 사용자가 이미 언어·태그를 정해 둔
 *    상대라, 고르는 수고만 줄이는 것이지 새 판단을 하는 게 아니다.
 * 🔴 등록되지 않은 후보는 **제안으로만** 돌려준다 — 화면이 「＋ Sarah 추가」를 낼 뿐 저장은
 *    사용자가 누를 때만 일어난다.
 *
 * @returns {{matchedId: string|null, suggestion: string|null}}
 */
export function matchRecipient(names, recipients) {
  const list = Array.isArray(recipients) ? recipients : [];
  for (const name of Array.isArray(names) ? names : []) {
    const found = list.find((person) => sameName(person.name, name));
    if (found) return { matchedId: found.id, suggestions: [], suggestion: null };
  }
  /**
   * 🔴 **후보가 여럿이면 여럿을 준다** (2026-08-16 사용자 지적 ⑩). 예전에는 첫 후보만 줬는데,
   *    대화에 여러 사람이 있으면 **엉뚱한 한 명만** 제안되고 진짜 상대는 화면에 안 나온다.
   *    고르게 하는 편이 정확하다 — 우리가 확신 없는 것을 확신한 척하지 않는다.
   */
  const fresh = (names ?? []).filter((name) => !list.some((person) => sameName(person.name, name)));
  return { matchedId: null, suggestions: fresh, suggestion: fresh[0] ?? null };
}
