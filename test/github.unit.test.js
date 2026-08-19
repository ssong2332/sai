/**
 * S22 — GitHub 공개 활동 분석 단위 테스트 (Spec audit 3 · 필수 5 · 필수 9).
 *
 * 🔴 이 테스트가 지키려는 핵심:
 *    ① **본문이 결과에 새지 않는다** (Zero Retention). 반환값 전체를 문자열로 훑어 원문 조각이
 *       하나라도 있으면 실패한다.
 *    ② **표본이 적으면 아무것도 제안하지 않는다** — 근거 없는 사람 판단을 만들지 않는다.
 *    ③ **모르는 것을 0으로 세지 않는다** — 타임존 미등록이면 오전 신호는 null이고 태그가 안 붙는다.
 *    ④ **판정표대로만** 동작한다 — 표에 없는 태그를 지어내지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzePublicActivity,
  collectSignals,
  suggestTags,
  TAG_RULES,
  MIN_WRITINGS,
  SKIP_REASONS,
} from '../src/core/github/index.js';
import { RECIPIENT_TAGS } from '../src/lib/recipients.js';

/** 이벤트 한 건 만들기 — 실제 응답 모양을 그대로 흉내 낸다. */
function comment(body, iso, type = 'IssueCommentEvent') {
  const payload =
    type === 'PullRequestReviewEvent' ? { review: { body } } : { comment: { body } };
  return { type, created_at: iso, payload };
}

/** 같은 날 같은 시각대에 n건 — 시각을 분 단위로 벌린다. */
function manyComments(n, body, { hourUtc = 3, spreadMinutes = 240 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const minutes = Math.round((i * spreadMinutes) / Math.max(n - 1, 1));
    const date = new Date(Date.UTC(2026, 6, 1, hourUtc, 0, 0) + minutes * 60_000);
    return comment(body, date.toISOString());
  });
}

/* ── Zero Retention ──────────────────────────────────────────────────── */

test('🔴 결과 어디에도 코멘트 본문이 남지 않는다 (Spec 필수 5)', () => {
  const secret = 'PLEASE_DO_NOT_LEAK_THIS_SENTENCE';
  const events = manyComments(20, `${secret} maybe we could ship it`);
  const result = analyzePublicActivity(events, { timeZone: 'Europe/Berlin' });

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(secret), '반환값에 코멘트 본문이 들어 있다');
  assert.ok(!serialized.includes('PLEASE_DO_NOT'), '본문 조각이 들어 있다');
});

test('🔴 신호 객체는 수치와 null뿐이다 — 문자열 필드가 없다', () => {
  const events = manyComments(20, 'short one');
  const { signals } = analyzePublicActivity(events);
  for (const [key, value] of Object.entries(signals)) {
    assert.ok(
      typeof value === 'number' || value === null,
      `signals.${key}가 수치가 아니다: ${typeof value}`,
    );
  }
});

test('🔴 본문이 없는 이벤트 종류는 읽지 않는다', () => {
  const events = [
    { type: 'PushEvent', created_at: '2026-07-01T03:00:00Z', payload: { comment: { body: 'x' } } },
    { type: 'WatchEvent', created_at: '2026-07-01T03:00:00Z', payload: { comment: { body: 'y' } } },
  ];
  assert.equal(collectSignals(events).writingCount, 0);
});

/* ── 표본 게이트 ─────────────────────────────────────────────────────── */

test('🔴 코멘트가 최소치 미만이면 아무것도 제안하지 않는다', () => {
  const events = manyComments(MIN_WRITINGS - 1, 'ok');
  const result = analyzePublicActivity(events);
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.skipped, SKIP_REASONS.TOO_FEW);
  assert.match(result.message, /판단하지 않았어요/);
});

test('제안이 비면 이유가 반드시 함께 온다 — 조용히 빈 목록을 주지 않는다', () => {
  for (const count of [0, 5, MIN_WRITINGS - 1]) {
    const result = analyzePublicActivity(manyComments(count, 'ok'));
    assert.equal(result.suggestions.length, 0);
    assert.ok(result.skipped, `${count}건에서 skipped가 비어 있다`);
    assert.ok(result.message.length > 0, `${count}건에서 안내 문구가 없다`);
  }
});

/* ── 모르는 것을 0으로 세지 않는다 ──────────────────────────────────── */

test('🔴 타임존이 없으면 오전 신호는 0이 아니라 null이다 — "모른다"와 "없다"는 다르다', () => {
  // 🔴 09:00~11:00 UTC 안에 모은다 — 120분을 넘기면 12시를 넘어가 오전 비율이 1이 아니게 된다
  //    (처음에 600분으로 잡았다가 0.3이 나와 테스트가 실패했다. 코드가 아니라 데이터가 틀렸다).
  const events = manyComments(20, 'ok', { hourUtc: 9, spreadMinutes: 120 });
  assert.equal(analyzePublicActivity(events).signals.morningRatio, null, 'null이 아니라 0으로 셌다');
  assert.equal(analyzePublicActivity(events, { timeZone: 'UTC' }).signals.morningRatio, 1);
});

test('🔴 `morning-fast`는 어떤 경우에도 제안되지 않는다 — 2026-08-19에 태그를 없앴다', () => {
  const events = manyComments(20, 'ok', { hourUtc: 9, spreadMinutes: 120 });
  for (const options of [undefined, { timeZone: 'UTC' }]) {
    const out = analyzePublicActivity(events, options);
    assert.ok(
      !out.suggestions.some((item) => item.tagId === 'morning-fast'),
      '없앤 태그가 되살아났다',
    );
  }
});

test('잘못된 타임존 문자열에도 죽지 않고 null로 떨어진다', () => {
  const events = manyComments(20, 'ok');
  const result = analyzePublicActivity(events, { timeZone: 'Not/AZone' });
  assert.equal(result.signals.morningRatio, null);
});

/* ── 판정표 ─────────────────────────────────────────────────────────── */

test('🔴 제안하는 태그 id는 전부 고정 집합에 있다 — 태그를 지어내지 않는다', () => {
  const known = new Set(RECIPIENT_TAGS.map((tag) => tag.id));
  for (const rule of TAG_RULES) {
    assert.ok(known.has(rule.tagId), `판정표 ${rule.id}번의 ${rule.tagId}가 고정 집합에 없다`);
  }
});

test('짧은 코멘트 → `짧은 메시지 선호` · 긴 코멘트 → `배경 설명 선호` (동시에 붙지 않는다)', () => {
  const short = analyzePublicActivity(manyComments(20, 'lgtm'));
  const long = analyzePublicActivity(manyComments(20, 'x'.repeat(300)));

  const ids = (r) => r.suggestions.map((s) => s.tagId);
  assert.ok(ids(short).includes('prefers-short'));
  assert.ok(!ids(short).includes('prefers-context'));
  assert.ok(ids(long).includes('prefers-context'));
  assert.ok(!ids(long).includes('prefers-short'));
});

test('완곡 표현이 많으면 `직접적 표현 선호`가 붙지 않는다', () => {
  const hedged = manyComments(20, 'maybe we could take another look, not sure though');
  const result = analyzePublicActivity(hedged);
  assert.ok(!result.suggestions.some((s) => s.tagId === 'prefers-direct'));
  assert.ok(result.signals.hedgeRatio > 0.15);
});

test('🔴 캐주얼 판정에 밈 시드를 쓴다 — 해설 표시와 같은 사전', () => {
  // 'circle back'은 밈 시드 항목이고 축약형 목록에는 없다.
  const events = manyComments(20, 'lets circle back on this');
  const result = analyzePublicActivity(events);
  assert.equal(result.signals.casualRatio, 1);
  assert.ok(result.suggestions.some((s) => s.tagId === 'casual-ok'));
});

test('몰아서 처리한 흔적 → `비동기 소통 선호`', () => {
  // 20건을 40분 안에 몰아넣는다(창 30분·최소 3건).
  const burst = manyComments(20, 'ok', { spreadMinutes: 40 });
  assert.ok(analyzePublicActivity(burst).suggestions.some((s) => s.tagId === 'async-friendly'));

  // 20건을 20일에 걸쳐 흩뿌리면 몰림이 아니다.
  const spread = manyComments(20, 'ok', { spreadMinutes: 20 * 24 * 60 });
  assert.ok(!analyzePublicActivity(spread).suggestions.some((s) => s.tagId === 'async-friendly'));
});

test('모든 제안에 근거 문구가 붙는다 — 근거 없이 태그만 들이밀지 않는다', () => {
  const result = analyzePublicActivity(manyComments(20, 'lgtm'), { timeZone: 'UTC' });
  assert.ok(result.suggestions.length > 0);
  for (const suggestion of result.suggestions) {
    assert.equal(typeof suggestion.evidence, 'string');
    assert.ok(suggestion.evidence.length > 0, `${suggestion.tagId}에 근거가 없다`);
  }
});

test('중앙값을 쓴다 — 긴 코멘트 하나에 휘둘리지 않는다', () => {
  const events = [...manyComments(19, 'lgtm'), comment('x'.repeat(9000), '2026-07-02T03:00:00Z')];
  const { signals } = analyzePublicActivity(events);
  assert.ok(signals.lengthMedian <= 80, `중앙값이 ${signals.lengthMedian}로 튀었다`);
});

test('빈 입력·잘못된 입력에서 죽지 않는다', () => {
  for (const input of [[], null, undefined, [{}], [{ type: 'IssueCommentEvent' }]]) {
    const result = analyzePublicActivity(input);
    assert.equal(result.suggestions.length, 0);
    assert.equal(result.signals.writingCount, 0);
  }
});

test('suggestTags는 신호가 없으면 게이트로 막는다', () => {
  assert.equal(suggestTags(null).skipped, SKIP_REASONS.TOO_FEW);
  assert.equal(suggestTags({ writingCount: 0 }).skipped, SKIP_REASONS.TOO_FEW);
});
