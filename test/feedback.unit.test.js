/**
 * S26 — 의도 검증 피드백 (Spec 부가 5) + 듀얼 시계 계산 근거 (부가 8).
 *
 * 🔴 핵심 검증:
 *    ① 저장되는 것은 **수치 두 개뿐** — 자유 서술이 들어갈 필드가 없다 (Spec 필수 5).
 *    ② 고정 집합('up'|'down') 외의 값은 기록하지 않는다 (본문 유입 경로 차단).
 *    ③ 듀얼 시계가 쓰는 타임존 계산이 실제로 시차를 반영한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getFeedbackCounts,
  recordFeedback,
  clearFeedback,
  FEEDBACK_KINDS,
} from '../src/lib/feedback.js';
import { getLocalParts, isOffHours } from '../src/core/schedule/fairy.js';

/* ── 판정표 — 피드백 ─────────────────────────────────────────────────── */

test('👍를 누르면 up 집계가 올라간다', async () => {
  await clearFeedback();
  const result = await recordFeedback(FEEDBACK_KINDS.UP);
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, { up: 1, down: 0 });
});

test('👎를 누르면 down 집계가 올라간다', async () => {
  await clearFeedback();
  await recordFeedback(FEEDBACK_KINDS.DOWN);
  assert.deepEqual(await getFeedbackCounts(), { up: 0, down: 1 });
});

test('집계가 누적된다', async () => {
  await clearFeedback();
  await recordFeedback(FEEDBACK_KINDS.UP);
  await recordFeedback(FEEDBACK_KINDS.UP);
  await recordFeedback(FEEDBACK_KINDS.DOWN);
  assert.deepEqual(await getFeedbackCounts(), { up: 2, down: 1 });
});

test('🔴 고정 집합에 없는 값은 기록되지 않는다 — 종류가 자유 문자열이 되면 본문이 들어올 수 있다', async () => {
  await clearFeedback();
  const result = await recordFeedback('교정문이 너무 딱딱해요');
  assert.equal(result.ok, false);
  assert.deepEqual(await getFeedbackCounts(), { up: 0, down: 0 });
});

test('🔴 저장 형태에 본문이 들어갈 필드가 없다 (Spec 필수 5)', async () => {
  await clearFeedback();
  await recordFeedback(FEEDBACK_KINDS.UP);
  const counts = await getFeedbackCounts();
  assert.deepEqual(Object.keys(counts).sort(), ['down', 'up']);
  for (const value of Object.values(counts)) {
    assert.equal(typeof value, 'number', '수치가 아닌 값이 저장되면 안 된다');
  }
});

test('초기화하면 집계가 0으로 돌아간다', async () => {
  await recordFeedback(FEEDBACK_KINDS.UP);
  await clearFeedback();
  assert.deepEqual(await getFeedbackCounts(), { up: 0, down: 0 });
});

/* ── 판정표 — 듀얼 시계가 기대는 계산 ─────────────────────────────────── */

test('같은 순간을 두 타임존에서 다른 시각으로 읽는다 — 듀얼 시계의 전제', () => {
  const instant = new Date('2026-08-17T03:00:00Z');
  const seoul = getLocalParts(instant, 'Asia/Seoul'); // UTC+9 → 12:00
  const newYork = getLocalParts(instant, 'America/New_York'); // UTC-4(DST) → 23:00 (전날)
  assert.equal(seoul.hour, 12);
  assert.equal(newYork.hour, 23);
  assert.notEqual(seoul.dateKey, newYork.dateKey, '날짜가 하루 어긋나야 +1일/-1일 표시가 의미를 갖는다');
});

test('퇴근 시간대 배지 판정이 시각과 일치한다', () => {
  const instant = new Date('2026-08-17T03:00:00Z');
  const newYork = getLocalParts(instant, 'America/New_York'); // 23:00
  assert.equal(isOffHours(newYork.hour), true);
  const seoul = getLocalParts(instant, 'Asia/Seoul'); // 12:00
  assert.equal(isOffHours(seoul.hour), false);
});
