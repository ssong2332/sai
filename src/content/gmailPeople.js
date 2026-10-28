/**
 * Gmail 대화 상대 후보 (2026-10-28 사용자 승인 — 판정표 G1~G7 · 읽기 규칙 R1~R6).
 *
 * 🔴 Gmail에서는 줄 단위 규칙(`detectPeople.js`)을 쓰지 않는다 — 「임시보관함에 저장됨」 같은 화면 문구와
 *    본문 라벨이 이름으로 잡혔다. 대신 **사람 요소만** 읽는다(받는사람 칩 · 보낸사람 머리줄).
 * 🔴 Gmail 화면 구조에 기댄다(Lessons #3·#4). 구조가 바뀌면 **후보 없음**으로 끝난다 — 엉뚱한 후보는 내지 않는다.
 *    요소는 2026-10-28 사용자 Gmail 진단(이름·주소 가림)으로 확인했다.
 * 🔴 Zero Retention: 읽은 이름·주소는 화면 후보로만 쓰고 저장하지 않는다. 저장은 사용자가 「추가」를 누를 때.
 *
 * | # | 상황 | 후보 |
 * |---|---|---|
 * | R1 | 쓰는 칸이 든 쓰기 창의 받는사람 칸(`[name="to"]`) 칩 `[role="option"]` | 칩의 `data-name` (최대 3) — 참조·숨은참조 칸은 읽지 않는다 |
 * | R2 | 칩 이름이 비었거나 `@`가 있거나 주소와 같음 | 그 칩은 후보 없음 (주소에서 이름을 지어내지 않는다) |
 * | R3 | 받는사람 칩이 하나도 없음 | 열린 메일 보낸사람 `span.gD`의 `name` — 나를 뺀 마지막 한 명 |
 * | R4 | 주소가 내 주소 (`span.g2` 중 이름이 「나」·「me」) | 제외 |
 * | R5 | 메일 목록 줄(`tr[role="row"]`) 안 | 읽지 않는다 |
 * | R6 | 화면 문구·본문 | 읽지 않는다 |
 * | S1 | 이름 맨 앞의 괄호 한 덩어리 「(소속)」 | 뗀다 — 남는 게 없으면 떼지 않는다 |
 */

/** R4 — Gmail이 내 주소를 받는사람 줄에 표시하는 이름(한국어·영어). */
const SELF_NAMES = ['나', 'me'];

/** S1 — 「(반도체디스플레이장비운영학과)박선후」 → 「박선후」. 전각 괄호도 같다. */
const LEADING_AFFILIATION = /^\s*[(（][^()（）]*[)）]\s*/;

export function stripAffiliation(name) {
  const text = String(name ?? '').trim();
  const stripped = text.replace(LEADING_AFFILIATION, '').trim();
  return stripped || text;
}

function normEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * 읽어 온 사람 요소 → 후보 이름. DOM 없이 테스트한다.
 *
 * @param {{toChips?: {name?: string, email?: string}[], senders?: {name?: string, email?: string}[], selfEmails?: string[]}} people
 * @param {number} [limit]
 * @returns {string[]}
 */
export function pickGmailPeople({ toChips = [], senders = [], selfEmails = [] } = {}, limit = 3) {
  const self = new Set(selfEmails.map(normEmail).filter(Boolean));
  const usable = (person) => {
    const name = String(person?.name ?? '').trim();
    const email = normEmail(person?.email);
    if (!name || name.includes('@') || name.toLowerCase() === email) return null; // R2
    if (email && self.has(email)) return null; // R4
    return stripAffiliation(name); // S1
  };

  // 🔴 받는사람 칩이 있으면 그것만 본다 — 주소뿐인 칩이라도 보낸사람으로 넘어가지 않는다(R2: 받는 사람은 그 주소다).
  // R3 — 내가 마지막에 답했으면 그 앞 사람이다: 나를 뺀 뒤 마지막 한 명.
  const pool = toChips.length > 0 ? toChips : senders.filter((person) => usable(person)).slice(-1); // R1 · R3
  const names = [];
  for (const person of pool) {
    const name = usable(person);
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

function isVisible(element) {
  try {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  } catch {
    return false;
  }
}

/** R5 — 메일 목록 줄이 아닌, 화면에 보이는 요소만. */
function readable(element) {
  return !element.closest('tr[role="row"]') && isVisible(element);
}

/**
 * Gmail 화면에서 후보 이름을 읽는다 (실브라우저에서만 검증 가능).
 *
 * @param {Element|null} anchorElement 작성 중인 칸 또는 선택된 요소.
 * @param {Document} [doc]
 * @returns {string[]}
 */
export function collectGmailPeople(anchorElement, doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return [];
  try {
    // R1 — 쓰는 칸에서 위로 올라가며 받는사람 칸이 든 가장 가까운 쓰기 창.
    let compose = null;
    for (let node = anchorElement?.parentElement ?? null; node && node !== doc.body; node = node.parentElement) {
      if (node.querySelector('[name="to"]')) {
        compose = node;
        break;
      }
    }
    const toChips = compose
      ? [...compose.querySelectorAll('[name="to"] [role="option"]')].map((el) => ({
          name: el.getAttribute('data-name'),
          email: el.getAttribute('data-hovercard-id'),
        }))
      : [];

    const main = doc.querySelector('[role="main"]');
    const senders = main
      ? [...main.querySelectorAll('span.gD[email]')].filter(readable).map((el) => ({
          name: el.getAttribute('name'),
          email: el.getAttribute('email'),
        }))
      : [];
    const selfEmails = main
      ? [...main.querySelectorAll('span.g2[email]')]
          .filter((el) => readable(el) && SELF_NAMES.includes(String(el.getAttribute('name') ?? '').trim().toLowerCase()))
          .map((el) => el.getAttribute('email'))
      : [];

    return pickGmailPeople({ toChips, senders, selfEmails });
  } catch {
    return []; // 구조가 달라 읽지 못하면 빈손.
  }
}
