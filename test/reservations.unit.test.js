/**
 * 예약 발송 (S14 후속 / Spec 필수 6).
 *
 * 🔴 이 파일이 존재하는 이유 = **실측으로 잡은 결함의 회귀 방지** (2026-08-14, S27 통합 점검):
 *    `sendAtISO`에 `Date` 객체를 그대로 넘겨 저장했더니 `chrome.storage.local`에서 **`{}`로
 *    뭉개졌고**, background의 `Date.parse({})`가 `NaN`이 되어 **알람이 한 번도 걸리지 않았다.**
 *    단위 테스트가 없어서 못 잡았고, 저장소 덤프를 눈으로 보고서야 드러났다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addReservation,
  listReservations,
  removeReservation,
  clearReservations,
  MAX_RESERVATIONS,
} from '../src/lib/reservations.js';

const base = { text: '내일 보낼 문장입니다', recipientName: 'Sarah', sendAtLabel: '수 09:00' };

/* ── 판정표 — sendAtISO 직렬화 (회귀 방지) ──────────────────────────────── */

test('🔴 Date를 넘겨도 ISO **문자열**로 저장된다 — 객체로 저장되면 알람이 안 걸린다', async () => {
  await clearReservations();
  const when = new Date('2026-08-20T00:00:00.000Z');
  const { entry } = await addReservation({ ...base, sendAtISO: when });

  assert.equal(typeof entry.sendAtISO, 'string', 'Date가 그대로 저장되면 storage에서 {}로 뭉개진다');
  assert.equal(entry.sendAtISO, '2026-08-20T00:00:00.000Z');
});

test('🔴 저장된 값이 background의 `Date.parse`로 되살아난다 — 알람이 실제로 걸리는 조건', async () => {
  await clearReservations();
  const when = new Date('2026-08-20T00:00:00.000Z');
  await addReservation({ ...base, sendAtISO: when });
  const [saved] = await listReservations();

  const parsed = Date.parse(saved.sendAtISO);
  assert.ok(Number.isFinite(parsed), 'NaN이면 background가 알람 생성을 건너뛴다');
  assert.equal(parsed, when.getTime());
});

test('ISO 문자열을 그대로 넘겨도 동작한다', async () => {
  await clearReservations();
  const { entry } = await addReservation({ ...base, sendAtISO: '2026-08-20T00:00:00.000Z' });
  assert.equal(entry.sendAtISO, '2026-08-20T00:00:00.000Z');
});

test('시각이 없으면 null이다 — 지어내지 않는다', async () => {
  await clearReservations();
  const { entry } = await addReservation({ ...base, sendAtISO: null });
  assert.equal(entry.sendAtISO, null);
});

test('🔴 잘못된 값은 조용히 통과시키지 않고 null로 만든다', async () => {
  await clearReservations();
  for (const bad of ['그냥 문자열', {}, NaN, new Date('오류')]) {
    const { entry } = await addReservation({ ...base, sendAtISO: bad });
    assert.equal(entry.sendAtISO, null, `${JSON.stringify(bad)}가 그대로 저장되면 안 된다`);
  }
});

/* ── 판정표 — 기본 동작 ─────────────────────────────────────────────────── */

test('본문이 비면 저장하지 않는다', async () => {
  await clearReservations();
  const outcome = await addReservation({ ...base, text: '   ' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'empty');
});

test('최신 예약이 목록 맨 앞에 온다', async () => {
  await clearReservations();
  await addReservation({ ...base, text: '첫 번째 문장' });
  await addReservation({ ...base, text: '두 번째 문장' });
  const list = await listReservations();
  assert.equal(list[0].text, '두 번째 문장');
});

test('개별 삭제가 된다 — Zero Retention 단서의 조건이다', async () => {
  await clearReservations();
  const { entry } = await addReservation(base);
  assert.equal(await removeReservation(entry.id), true);
  assert.deepEqual(await listReservations(), []);
});

test('없는 id를 지우려 하면 false', async () => {
  await clearReservations();
  assert.equal(await removeReservation('rv-없음'), false);
});

test('상한을 넘으면 저장하지 않는다', async () => {
  await clearReservations();
  for (let i = 0; i < MAX_RESERVATIONS; i += 1) {
    await addReservation({ ...base, text: `문장 ${i}` });
  }
  const outcome = await addReservation({ ...base, text: '넘치는 문장' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'full');
});

test('🔴 저장 항목에 예상 밖의 필드가 없다 (Spec 필수 5 — 저장 범위를 좁게 유지)', async () => {
  await clearReservations();
  const { entry } = await addReservation({ ...base, sendAtISO: new Date() });
  assert.deepEqual(
    Object.keys(entry).sort(),
    ['createdAt', 'id', 'recipientName', 'sendAtISO', 'sendAtLabel', 'text'],
  );
});
