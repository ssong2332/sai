/**
 * S21 / Spec 권장 8 — 스레드 직전 대화 맥락 5개.
 *
 * 같은 대화방의 직전 메시지 최대 5개(2,000자 이내)를 교정 요청에 함께 실어, 앞뒤 문맥에 맞는
 * 교정을 받는다. 화면에는 "직전 대화 N개 참고함"으로 노출되고 끌 수 있다.
 *
 * 🔴 **Zero Retention (Spec 필수 5)**: 여기서 모은 것은 **남이 쓴 메시지 본문**이다. 요청 본문으로만
 *    흘러가고 `chrome.storage`·`console`·서버 로그 어디에도 저장하지 않는다. 이 파일은 저장 API를
 *    import하지 않으며(`storage.js` 참조 없음), 로그를 남기지 않는다.
 *
 * 🔴 **사이트별 선택자를 쓰지 않는다** (Lessons #3·#4 — 사이트마다 마크업이 달라 범용 규칙이
 *    성립하지 않는다). 대신 **구조 휴리스틱**만 쓴다: 입력창보다 위에 있는, 눈에 보이는,
 *    "메시지처럼 생긴" 텍스트 블록을 문서 순서로 모아 뒤에서 5개.
 *
 * 🔴 그래서 **틀릴 수 있다** — 사이드바 항목이나 공지 배너를 대화로 착각할 수 있다. 이 한계를
 *    숨기지 않는다: 화면이 건수만 말하지 않고 **무엇을 골랐는지 그대로 보여주고**, 한 번의
 *    클릭으로 끌 수 있게 한다. 조용히 엉뚱한 맥락을 섞는 것이 최악이다.
 */

import { detectSensitive, redact } from './sensitiveGuard.js';

/** Spec 권장 8 — 최대 5개. */
export const MAX_THREAD_MESSAGES = 5;
/** Spec 권장 8 — 2,000자 이내. */
export const MAX_THREAD_CHARS = 2000;

/** 이보다 짧으면 대화가 아니라 라벨·버튼 문구일 가능성이 높다. 화면 안내 문구도 이 값을 쓴다. */
export const MIN_MESSAGE_CHARS = 10;
/** 이보다 길면 한 메시지가 아니라 컨테이너를 통째로 집은 것이다. */
const MAX_MESSAGE_CHARS = 1200;
/**
 * 후보 컨테이너를 찾아 올라가는 최대 깊이 — body까지 올라가면 페이지 전체가 대화가 된다.
 *
 * 🔴 처음엔 8로 뒀다가 실브라우저 실측(2026-08-13, ChatGPT 실제 대화 화면)에서 너무 짧다는 게
 *    드러났다: 반응형 레이아웃(Tailwind류 유틸리티 클래스)을 쓰는 현대 SPA는 작성창과 메시지
 *    목록의 공통 조상이 **12~18단계 위**에 있는 경우가 흔하다(실측: descendant 수가 hop12→13에서
 *    40→257로 급증, 실제 스크롤 컨테이너는 hop18에서 발견됨). 8로는 그 근처에도 못 갔다.
 *    24로 올려 여유를 두되, **경계 자체는 여전히 `isScrollable()`이 정한다** — 상한을 늘려도
 *    "대화방 스크롤 영역을 넘지 않는다"는 원칙은 그대로다. 실측에서 그 경계(hop18) 너머
 *    hop21에서 사이드바로 보이는 급증(277→679)이 있었는데, 스크롤 경계가 그보다 먼저 멈춰준다.
 */
const MAX_ANCESTOR_HOPS = 24;
/** 한 후보 블록에서 이 개수 이상 나오면 대화 목록으로 본다. */
const MIN_BLOCKS_FOR_THREAD = 2;

/* ── 1단계: 순수 선택 로직 (DOM 없이 테스트된다) ────────────────────────── */

/**
 * 후보 블록들 중 실제로 실어 보낼 것을 고른다.
 *
 * DOM을 만지지 않는 **순수 함수**다 — 개수 상한·글자수 상한·중복 제거처럼 정확해야 하는 규칙을
 * 브라우저 없이 검증할 수 있게 분리했다(DOM 수집은 실브라우저에서만 확인 가능하다).
 *
 * 판정 규칙:
 * | 조건 | 행동 |
 * |---|---|
 * | 본문이 비었거나 최소 길이 미만 | 제외 |
 * | 최대 길이 초과 | 제외 (컨테이너를 통째로 집은 것) |
 * | 앞서 고른 것과 본문이 같음 | 제외 (같은 노드가 두 경로로 잡히는 경우) |
 * | 개수가 MAX_THREAD_MESSAGES 초과 | **오래된 것부터** 버린다 (가까운 맥락이 더 유용하다) |
 * | 누적 글자수가 MAX_THREAD_CHARS 초과 | **오래된 것부터** 버린다 |
 * | 민감정보 포함 | 버리지 않고 **마스킹**한다 (Spec 필수 11 — 남의 메시지라도 키가 나가면 안 된다) |
 *
 * @param {{text: string}[]} blocks 문서 순서(오래된 것 → 최신)로 정렬된 후보.
 * @returns {{messages: {text: string}[], redactedCount: number}}
 */
export function selectThreadMessages(
  blocks,
  /**
   * 🔴 S25(결정 요약)가 **같은 수집기를 다른 상한으로** 쓴다. 기본값은 Spec 권장 8의 값 그대로라
   *    S21 동작은 바뀌지 않는다 — 결정 요약은 스레드 전체를 읽어야 하므로 상한만 넓혀 부른다.
   *    수집·중복제거·민감정보 마스킹은 **한 벌만 유지한다**(두 벌이 되면 한쪽만 고치는 사고가 난다).
   */
  { maxMessages = MAX_THREAD_MESSAGES, maxChars = MAX_THREAD_CHARS } = {},
) {
  const cleaned = [];
  const seen = new Set();

  for (const block of blocks ?? []) {
    const text = normalizeWhitespace(block?.text);
    if (text.length < MIN_MESSAGE_CHARS) continue;
    if (text.length > MAX_MESSAGE_CHARS) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    cleaned.push(text);
  }

  // 🔴 최신 쪽을 남긴다 — 잘라야 한다면 버릴 것은 먼 과거다.
  const recent = cleaned.slice(-maxMessages);

  // 🔴 글자수 상한도 최신 쪽부터 채운다. 한 메시지를 반토막 내지 않고 통째로 버린다 —
  //    잘린 문장은 맥락이 아니라 오해의 재료다.
  const kept = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const text = recent[i];
    if (total + text.length > maxChars) break;
    total += text.length;
    kept.unshift(text);
  }

  let redactedCount = 0;
  const messages = kept.map((text) => {
    const { findings, hasSensitive } = detectSensitive(text);
    if (!hasSensitive) return { text };
    redactedCount += 1;
    return { text: redact(text, findings) };
  });

  return { messages, redactedCount };
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/* ── 2단계: DOM 수집 (실브라우저에서만 검증 가능) ───────────────────────── */

/**
 * 입력창(또는 선택 영역) 주변에서 직전 대화로 보이는 블록을 모은다.
 *
 * @param {Element|null} anchorElement 작성 중인 입력창, 또는 선택된 요소.
 * @returns {{messages: {text: string}[], redactedCount: number}}
 */
export function collectThreadContext(anchorElement) {
  const empty = { messages: [], redactedCount: 0 };
  if (!anchorElement || typeof document === 'undefined') return empty;

  const anchorRect = rectOf(anchorElement);
  if (!anchorRect) return empty;

  const container = findThreadContainer(anchorElement, anchorRect);
  if (!container) return empty;

  return selectThreadMessages(collectBlocks(container, anchorElement, anchorRect));
}

/* ── S25 — 결정 요약용 수집 (Spec 부가 7) ─────────────────────────────── */

/**
 * 결정 요약이 읽을 상한. 🔴 S21(권장 8)의 5개·2,000자와 **다른 목적**이라 값이 다르다:
 * 교정은 "직전 몇 마디"만 알면 되지만, 결정 요약은 **합의가 어디서 났는지**를 찾아야 해서
 * 스레드를 넓게 봐야 한다. 서버도 24,000자에서 한 번 더 자른다(`core/decisions/index.js`).
 */
export const MAX_DECISION_MESSAGES = 80;
export const MAX_DECISION_CHARS = 20000;

/**
 * 결정 요약에 보낼 스레드 텍스트를 만든다.
 *
 * 🔴 **선택 영역이 있으면 그것을 쓴다** (2026-08-14 사용자 결정). 사용자가 범위를 정한 것이
 *    우리 추측보다 항상 정확하다 — DOM 휴리스틱은 사이트마다 틀린다(Lessons #3·#4).
 * 🔴 선택 영역에도 **민감정보 마스킹을 건다** — 남의 메시지를 그대로 LLM에 넘기지 않는다
 *    (Spec 필수 11). 자동 수집 경로만 마스킹하면 사용자가 직접 고른 구간에 구멍이 생긴다.
 *
 * @param {Element|null} anchorElement 선택이 없을 때 자동 수집의 기준점.
 * @returns {{text: string, source: 'selection'|'thread'|'none', messageCount: number,
 *            redactedCount: number}}
 */
export function collectDecisionThread(anchorElement) {
  const selection = readSelectionText();

  /**
   * 🔴 **선택이 있는데 짧으면, 자동 수집으로 넘어가지 않는다** (2026-08-14 사용자 실측으로
   *    드러난 결함). 예전에는 최소 길이 미만이면 "선택 없음"으로 처리해 **페이지 전체 대화를
   *    대신 요약**했다 — 사용자는 `안녕하세요`를 가리켰는데 화면에는 엉뚱한 대화의 결정 4건이
   *    나왔다. **사용자가 무언가를 가리켰으면 그것을 쓰거나, 못 쓴다고 말한다.** 다른 것으로
   *    조용히 바꿔치기하지 않는다.
   */
  if (selection.tooShort) {
    return { text: '', source: 'selection-too-short', messageCount: 0, redactedCount: 0 };
  }

  if (selection.text) {
    const { findings, hasSensitive } = detectSensitive(selection.text);
    return {
      text: hasSensitive ? redact(selection.text, findings) : selection.text,
      source: 'selection',
      // 선택 영역은 사용자가 한 덩어리로 준 것이라 메시지 단위로 세지 않는다.
      messageCount: 1,
      redactedCount: hasSensitive ? 1 : 0,
    };
  }

  const { messages, redactedCount } = collectThreadForDecisions(anchorElement);
  if (messages.length === 0) {
    return { text: '', source: 'none', messageCount: 0, redactedCount: 0 };
  }
  return {
    text: messages.map((message) => message.text).join('\n'),
    source: 'thread',
    messageCount: messages.length,
    redactedCount,
  };
}

/** 자동 수집 — S21과 **같은 DOM 로직**을 상한만 넓혀 쓴다. */
function collectThreadForDecisions(anchorElement) {
  const empty = { messages: [], redactedCount: 0 };
  if (!anchorElement || typeof document === 'undefined') return empty;

  const anchorRect = rectOf(anchorElement);
  if (!anchorRect) return empty;

  const container = findThreadContainer(anchorElement, anchorRect);
  if (!container) return empty;

  return selectThreadMessages(collectBlocks(container, anchorElement, anchorRect), {
    maxMessages: MAX_DECISION_MESSAGES,
    maxChars: MAX_DECISION_CHARS,
  });
}

/**
 * 🔴 접힌 선택(커서만 있는 상태)은 선택이 아니다 — 「없음」으로 본다.
 * 🔴 **「없음」과 「짧음」을 구분해 돌려준다** — 호출부가 둘을 다르게 처리해야 한다(위 참조).
 *
 * @returns {{text: string, tooShort: boolean}}
 */
function readSelectionText() {
  const none = { text: '', tooShort: false };
  if (typeof window === 'undefined' || !window.getSelection) return none;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return none;
  // 줄바꿈은 살린다 — 화자 구분이 줄로 드러나는 대화가 많다.
  const raw = String(selection.toString() ?? '').replace(/[ \t]+/g, ' ').trim();
  if (!raw) return none;
  if (raw.length < MIN_MESSAGE_CHARS) return { text: '', tooShort: true };
  return { text: raw, tooShort: false };
}

/**
 * 대화 목록을 담고 있을 법한 조상을 찾는다.
 *
 * 🔴 "메시지 블록이 2개 이상 들어 있는 **가장 가까운** 조상"에서 멈춘다. 더 올라가면 사이드바·
 *    헤더까지 삼키고, 덜 올라가면 입력창 래퍼에 갇혀 아무것도 못 찾는다.
 *
 * 🔴 **스크롤 컨테이너를 넘어가지 않는다** (2026-08-13 실측으로 추가한 제약). 작성창 위에 대화가
 *    하나도 없는 배치(작성창이 목록 맨 위)에서, 조건을 만족할 때까지 계속 올라가다가 **왼쪽 내비와
 *    공지 배너를 대화로 집었다**(실측 2건). "못 찾았으면 빈손으로 돌아온다"가 "아무거나 집어온다"
 *    보다 항상 낫다 — 엉뚱한 맥락은 교정을 조용히 망친다.
 */
function findThreadContainer(anchorElement, anchorRect) {
  let node = anchorElement.parentElement;
  for (let hop = 0; node && hop < MAX_ANCESTOR_HOPS; hop += 1) {
    if (collectBlocks(node, anchorElement, anchorRect).length >= MIN_BLOCKS_FOR_THREAD) return node;
    // 대화 목록은 거의 항상 자기 스크롤 영역을 갖는다 — 그 경계가 "이 대화방"의 경계다.
    if (isScrollable(node) || node === document.body) return null;
    node = node.parentElement;
  }
  return null;
}

function isScrollable(element) {
  try {
    const overflowY = getComputedStyle(element).overflowY;
    if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
    return element.scrollHeight > element.clientHeight;
  } catch {
    return false;
  }
}

/**
 * 컨테이너 안에서 "메시지처럼 생긴" 블록을 문서 순서로 모은다.
 *
 * 🔴 **가장 안쪽(leaf-most) 블록만** 센다 — 부모까지 세면 같은 문장이 중첩 깊이만큼 반복된다.
 * 🔴 앵커보다 **위에 있는 것만** 센다 — 아래는 아직 오지 않은 대화이거나 입력 UI다.
 */
function collectBlocks(container, anchorElement, anchorRect) {
  const blocks = [];
  const candidates = container.querySelectorAll('p, li, div, span, td, blockquote, article, section');

  for (const element of candidates) {
    if (element === anchorElement || element.contains(anchorElement)) continue;
    // 우리 UI(Shadow host)는 대화가 아니다.
    if (element.closest?.('[data-sai-root]')) continue;
    // 입력 요소의 내용은 "직전 대화"가 아니라 지금 쓰고 있는 글이다.
    if (element.closest?.('textarea, input, [contenteditable="true"]')) continue;

    const text = normalizeWhitespace(element.textContent);
    if (text.length < MIN_MESSAGE_CHARS || text.length > MAX_MESSAGE_CHARS) continue;

    // leaf-most: 자식 중에도 기준을 만족하는 게 있으면 그 자식이 진짜 메시지다.
    if (hasQualifyingDescendant(element)) continue;

    const rect = rectOf(element);
    if (!rect || rect.width === 0 || rect.height === 0) continue;
    if (rect.bottom > anchorRect.top) continue;
    /**
     * 🔴 작성창과 **같은 세로 열**에 있는 것만 센다 (2026-08-13 실측으로 추가). 대화는 작성창
     *    바로 위에 같은 폭으로 쌓이지만, 왼쪽 내비·사이드바는 옆 열에 있다 — 가로 겹침 하나로
     *    레이아웃 지식 없이 걸러진다.
     */
    if (rect.right <= anchorRect.left || rect.left >= anchorRect.right) continue;

    blocks.push({ text, top: rect.top });
  }

  // querySelectorAll은 이미 문서 순서지만, 화면 배치가 문서 순서와 다른 사이트가 있어
  // 세로 위치로 한 번 더 정렬한다(위 = 오래된 것).
  blocks.sort((a, b) => a.top - b.top);
  return blocks;
}

function hasQualifyingDescendant(element) {
  for (const child of element.querySelectorAll('p, li, div, span, td, blockquote')) {
    const text = normalizeWhitespace(child.textContent);
    if (text.length >= MIN_MESSAGE_CHARS && text.length <= MAX_MESSAGE_CHARS) return true;
  }
  return false;
}

function rectOf(element) {
  try {
    return element.getBoundingClientRect();
  } catch {
    return null;
  }
}
