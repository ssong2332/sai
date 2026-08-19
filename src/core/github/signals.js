/**
 * GitHub 공개 활동 → 관측 신호 (S22 / Spec audit 3).
 *
 * 🔴 **Zero Retention (Spec 필수 5).** 이 모듈은 글 **본문을 입력으로 받아 수치만 내보낸다.**
 *    반환값에 본문·발췌·인용이 들어갈 필드 자체가 없다. 호출부는 계산이 끝나면 원본 배열을
 *    버리며, 어떤 경로로도 저장·전송하지 않는다(테스트가 강제한다).
 *
 * 🔴 **사람에 대한 점수를 만들지 않는다 (필수 9 G1/G2).** 여기서 나오는 것은 "코멘트 길이
 *    중앙값 62자" 같은 **관측값**이지 "소통 점수 62점"이 아니다. 관측값은 화면에서 근거 문구로만
 *    쓰이고 저장되지 않으며, 저장되는 것은 판정표가 내놓는 **태그 id뿐**이다.
 *
 * 🔴 **감정을 추론하지 않는다** (Lessons #7 / EU AI Act Art 5(1)(f)). 길이·시각·표현 빈도만 본다.
 *    "화가 나 있다"·"스트레스가 높다" 같은 축은 만들지 않는다.
 *
 * 🔴 **이름·아바타·국가에서 아무것도 유추하지 않는다** (필수 2 3순위). 입력에 그 필드가 오더라도
 *    읽지 않는다. 시간대는 **사용자가 수신자에 직접 등록한 IANA 타임존**만 쓴다.
 *
 * 🔴 이 파일은 네트워크를 모른다 — 순수 함수다. 수집은 `src/lib/githubClient.js`가 한다.
 */

import { isHedged, isCasual } from '../style/markers.js';

/**
 * **사람이 쓴 글**이 들어 있는 이벤트 종류. 🔴 여기 없는 종류는 **본문을 읽지 않는다** —
 * "혹시 몰라서" 넓게 읽으면 Zero Retention 경계가 흐려진다.
 *
 * 🔴 **`PullRequestEvent`(PR 설명문)는 2026-08-14 사용자 승인으로 추가**했다. 실측에서 코멘트가
 *    0건인데 PR은 149건인 계정이 있었다 — PR을 열고 푸시는 활발하지만 리뷰 대화가 없는 패턴으로,
 *    코멘트만 보면 이 기능이 아무것도 못 한다. PR 설명도 사람이 쓴 글이라 길이·완곡도·캐주얼
 *    판정에 같은 자격으로 쓸 수 있다.
 * 🔴 **`action === 'opened'`일 때만 읽는다.** `PullRequestEvent`는 opened·closed·reopened·
 *    synchronize마다 발생하며 payload에 **같은 PR 설명이 매번 들어 있다.** 거르지 않으면 PR 하나가
 *    수십 건으로 부풀어 표본 게이트(15건)를 가짜로 통과시킨다.
 */
const WRITING_EVENTS = {
  IssueCommentEvent: (payload) => payload?.comment?.body,
  PullRequestReviewCommentEvent: (payload) => payload?.comment?.body,
  PullRequestReviewEvent: (payload) => payload?.review?.body,
  CommitCommentEvent: (payload) => payload?.comment?.body,
  PullRequestEvent: (payload) =>
    payload?.action === 'opened' ? payload?.pull_request?.body : undefined,
};

/**
 * 🔴 완곡·캐주얼 표지는 **`core/style/markers.js` 한 곳에만** 둔다(2026-08-14 이동). 나를 보는
 *    S30 대안이 같은 목록을 써야 하는데, 복제하면 같은 문장에 대해 "상대는 완곡하다"와 "나는
 *    완곡하지 않다"가 동시에 나올 수 있다. 판정 기준이 갈리는 것을 원천 차단한다.
 */

/** 몰아서 처리했다고 볼 시간 창(분)과 그 안의 최소 건수. */
const BURST_WINDOW_MIN = 30;
const BURST_MIN_COUNT = 3;

/**
 * 이벤트 배열에서 사람이 쓴 글 본문과 시각만 뽑는다.
 * 🔴 **여기서 나온 배열은 호출부 밖으로 나가지 않는다** — `collectSignals()` 안에서만 살고
 *    반환값에는 포함되지 않는다.
 */
function extractWritings(events) {
  const out = [];
  for (const event of events ?? []) {
    const read = WRITING_EVENTS[event?.type];
    if (!read) continue;
    const body = read(event.payload);
    const at = event?.created_at;
    if (typeof body !== 'string' || body.trim().length === 0) continue;
    if (typeof at !== 'string') continue;
    const time = Date.parse(at);
    if (Number.isNaN(time)) continue;
    out.push({ body, time });
  }
  return out;
}

/** 중앙값 — 평균을 쓰지 않는 이유: 긴 설계 문서 하나가 전체를 끌어올린다. */
function median(numbers) {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * UTC 시각을 **상대 현지 시각의 시(hour)**로 바꾼다.
 * 🔴 타임존을 모르면 `null`을 준다 — UTC로 대신 계산하면 "오전 활동"이 통째로 거짓이 된다.
 *    모르는 것은 추측하지 않고 그 신호를 **버린다**(판정표 4번이 자동으로 안 걸린다).
 */
function localHour(time, timeZone) {
  if (!timeZone) return null;
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    }).format(new Date(time));
    const hour = Number.parseInt(formatted, 10);
    return Number.isNaN(hour) ? null : hour % 24;
  } catch {
    // 잘못된 타임존 문자열 — 위와 같은 이유로 신호를 버린다.
    return null;
  }
}

function ratio(count, total) {
  return total === 0 ? 0 : count / total;
}

/**
 * 공개 이벤트에서 관측 신호를 뽑는다.
 *
 * @param {object[]} events `GET /users/{id}/events/public` 응답 배열.
 * @param {object} [options]
 * @param {string} [options.timeZone] 수신자에 **사용자가 등록한** IANA 타임존. 없으면 시간대
 *   신호(`morningRatio`)를 계산하지 않고 `null`로 둔다.
 * @param {string[]} [options.casualPhrases] 캐주얼 판정에 쓸 표현 목록(밈 시드). 소문자 비교.
 * @returns {{writingCount, lengthMedian, hedgeRatio, morningRatio, burstRatio, casualRatio}}
 *   🔴 **전부 수치다.** 본문·발췌·사용자명·국가가 들어갈 필드가 없다.
 */
export function collectSignals(events, { timeZone = null, casualPhrases = [] } = {}) {
  const writings = extractWritings(events);
  const writingCount = writings.length;

  if (writingCount === 0) {
    return {
      writingCount: 0,
      lengthMedian: 0,
      hedgeRatio: 0,
      morningRatio: null,
      burstRatio: 0,
      casualRatio: 0,
    };
  }

  const lengths = writings.map((entry) => entry.body.trim().length);

  const hedged = writings.filter((entry) => isHedged(entry.body)).length;

  const needles = casualPhrases
    .map((phrase) => String(phrase ?? '').toLowerCase())
    .filter((phrase) => phrase.length > 0);
  const casual = writings.filter((entry) => isCasual(entry.body, needles)).length;

  // 🔴 타임존을 모르면 이 신호는 계산하지 않는다(null) — 0이 아니다. 0은 "오전 활동이 없다"는
  //    뜻이 되어 판정표에 거짓 근거를 준다.
  const hours = writings.map((entry) => localHour(entry.time, timeZone)).filter((h) => h !== null);
  const morningRatio =
    hours.length === 0 ? null : ratio(hours.filter((h) => h >= 6 && h < 12).length, hours.length);

  // 몰아서 처리 — 자기 자신을 포함해 30분 창 안에 3건 이상이면 그 글을 '몰림'으로 본다.
  const times = writings.map((entry) => entry.time).sort((a, b) => a - b);
  const windowMs = BURST_WINDOW_MIN * 60 * 1000;
  const bursty = times.filter(
    (time) => times.filter((other) => Math.abs(other - time) <= windowMs).length >= BURST_MIN_COUNT,
  ).length;

  return {
    writingCount,
    lengthMedian: median(lengths),
    hedgeRatio: ratio(hedged, writingCount),
    morningRatio,
    burstRatio: ratio(bursty, writingCount),
    casualRatio: ratio(casual, writingCount),
  };
}
