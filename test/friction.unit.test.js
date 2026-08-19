/**
 * 협업 마찰·긍정 카운트 (Spec §3 F-10/F-26 / 2026-08-15).
 *
 * 🔴 이 테스트가 지키는 것 세 가지:
 *    ① 저장물에 **정수와 날짜밖에 없다** (Zero Retention · 개인 식별 금지)
 *    ② 업로드가 실패해도 **카운트가 사라지지 않는다**
 *    ③ 표본이 없을 때 건강도가 **100이 아니라 null**이다
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordFrictionEvent,
  takeFrictionBatch,
  clearSentFriction,
  healthIndex,
  FRICTION_EVENTS,
  EVENT_POLARITY,
  EVENT_LABELS,
  NO_TEAM_BUCKET,
  LEGACY_TEAM_BUCKET,
  pendingFrictionTeams,
} from '../src/lib/friction.js';

/** 🔴 `storage.js`는 Promise 계약이다(콜백 대역은 실패한다 — usage 테스트에서 겪음). */
function installStorage() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {},
  };
  return store;
}

const MON = new Date(2026, 7, 17, 10, 0);
const TUE = new Date(2026, 7, 18, 10, 0);

test('센 만큼 묶음에 담긴다', async () => {
  installStorage();
  await recordFrictionEvent(FRICTION_EVENTS.MISREAD, MON);
  await recordFrictionEvent(FRICTION_EVENTS.MISREAD, MON);
  await recordFrictionEvent(FRICTION_EVENTS.CLEAR, MON);
  const batch = await takeFrictionBatch(NO_TEAM_BUCKET);
  assert.equal(batch.length, 1);
  assert.equal(batch[0].dateKey, '2026-08-17');
  assert.equal(batch[0].counts.misread, 2);
  assert.equal(batch[0].counts.clear, 1);
  assert.equal(batch[0].counts.venting, 0);
});

test('🔴 날짜별로 따로 쌓는다 — 합치면 리더가 보는 추세가 하루씩 밀린다', async () => {
  installStorage();
  await recordFrictionEvent(FRICTION_EVENTS.VENTING, MON);
  await recordFrictionEvent(FRICTION_EVENTS.VENTING, TUE);
  const batch = await takeFrictionBatch(NO_TEAM_BUCKET);
  assert.deepEqual(
    batch.map((item) => [item.dateKey, item.counts.venting]),
    [['2026-08-17', 1], ['2026-08-18', 1]],
  );
});

test('🔴 묶음을 읽어도 지워지지 않는다 — 업로드 실패 시 카운트가 사라지면 안 된다', async () => {
  installStorage();
  await recordFrictionEvent(FRICTION_EVENTS.SCHEDULE, MON);
  await takeFrictionBatch(NO_TEAM_BUCKET);
  const again = await takeFrictionBatch(NO_TEAM_BUCKET);
  assert.equal(again[0].counts.schedule, 1, '읽기만으로 사라졌다');
});

test('🔴 보낸 만큼만 뺀다 — 업로드 중에 늘어난 카운트를 삼키면 안 된다', async () => {
  installStorage();
  await recordFrictionEvent(FRICTION_EVENTS.MISREAD, MON);
  const sent = await takeFrictionBatch(NO_TEAM_BUCKET); // misread: 1 을 올리는 중…
  await recordFrictionEvent(FRICTION_EVENTS.MISREAD, MON); // …그 사이에 하나 더 발생
  await clearSentFriction(NO_TEAM_BUCKET, sent);
  const left = await takeFrictionBatch(NO_TEAM_BUCKET);
  assert.equal(left[0].counts.misread, 1, '올리지 않은 이벤트가 사라졌다');
});

test('전부 0이 된 날짜는 들고 다니지 않는다', async () => {
  installStorage();
  await recordFrictionEvent(FRICTION_EVENTS.CLEAR, MON);
  await clearSentFriction(NO_TEAM_BUCKET, await takeFrictionBatch(NO_TEAM_BUCKET));
  assert.deepEqual(await takeFrictionBatch(NO_TEAM_BUCKET), []);
});

test('모르는 종류는 무시한다 — 집계가 기능을 막지 않는다', async () => {
  installStorage();
  await recordFrictionEvent('gossip', MON);
  assert.deepEqual(await takeFrictionBatch(NO_TEAM_BUCKET), []);
});

test('🔴 저장물에 정수와 날짜 말고는 없다 (Spec 필수 5 · 9)', async () => {
  const store = installStorage();
  await recordFrictionEvent(FRICTION_EVENTS.VENTING, MON);
  const saved = store['sai.friction.pending'];
  // 🔴 2026-08-19부터 **팀별**로 나뉜다 — 팀 id와 날짜, 정수뿐이다.
  assert.deepEqual(Object.keys(saved), ['byTeam']);
  for (const [teamId, days] of Object.entries(saved.byTeam)) {
    assert.equal(typeof teamId, 'string');
    for (const [dateKey, counts] of Object.entries(days)) {
      assert.match(dateKey, /^\d{4}-\d{2}-\d{2}$/);
      for (const value of Object.values(counts)) assert.equal(typeof value, 'number');
    }
  }
  // 개인 식별자가 들어갈 자리 자체가 없다.
  const dumped = JSON.stringify(saved);
  assert.ok(!/uid|email|name|text/i.test(dumped), `식별자로 보이는 키가 있다: ${dumped}`);
});

/* ── 건강도 지수 (Spec §3 공식) ─────────────────────────────────────── */

test('🔴 다듬은 기록이 없으면 100이 아니라 null — 안 쓰는 팀이 가장 건강한 팀이 되면 안 된다', () => {
  assert.equal(healthIndex({}), null);
  assert.equal(healthIndex({ misread: 3, clear: 2 }), null, '분모가 없으면 지수도 없다');
});

test('마찰이 없으면 100, 다듬은 만큼 마찰이면 0', () => {
  assert.equal(healthIndex({ refined: 10, clear: 3, schedule: 1 }), 100);
  assert.equal(healthIndex({ refined: 4, misread: 2, venting: 2 }), 0);
});

test('🔴 공식의 분모는 다듬은 총수다 — 긍정 신호 합계가 아니다', () => {
  // 마찰 9 / 다듬은 100 → 100 - 9 = 91. 예전 공식(긍정+마찰)이면 여기서 50 근처가 나온다.
  assert.equal(healthIndex({ refined: 100, misread: 6, venting: 2, forceOffHours: 1, clear: 5 }), 91);
});

test('🔴 한 메시지가 마찰 둘을 내면 비율이 100%를 넘을 수 있다 — 0에서 막는다', () => {
  assert.equal(healthIndex({ refined: 2, misread: 2, venting: 2 }), 0);
});

test('🔴 refined는 막대로 그리는 신호가 아니라 분모다', () => {
  assert.equal(EVENT_POLARITY.refined, 'volume');
});

test('🔴 모든 이벤트에 극성과 화면 문구가 있다 — 빠지면 대시보드가 빈칸을 그린다', () => {
  for (const key of Object.values(FRICTION_EVENTS)) {
    assert.ok(
      ['friction', 'positive', 'volume'].includes(EVENT_POLARITY[key]),
      `${key}: 극성 없음`,
    );
    assert.equal(typeof EVENT_LABELS[key], 'string');
  }
});

test('🔴 「제때 회신함」은 계약에 없다 — 셀 수 없는 지표를 만들지 않는다', () => {
  assert.ok(!Object.values(FRICTION_EVENTS).includes('ontime'));
  assert.equal(EVENT_LABELS.ontime, undefined);
});

/* ── v7: 동시 기록 경합 (2026-08-16 실확장에서 잡힘) ─────────────────── */

/** 실제 저장소처럼 **지연**이 있는 대역 — 지연이 없으면 경합이 재현되지 않는다. */
function installSlowStorage(delayMs = 1) {
  const store = {};
  const wait = () => new Promise((r) => setTimeout(r, delayMs));
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => {
          await wait();
          return key in store ? { [key]: store[key] } : {};
        },
        set: async (items) => {
          await wait();
          Object.assign(store, items);
        },
      },
    },
    runtime: {},
  };
  return store;
}

test('🔴 한 번의 교정이 낸 이벤트 셋이 모두 남는다 — 하나만 살아남던 경합', async () => {
  // 실확장 증상: 대시보드에 「하소연 2건」은 뜨는데 분모 「다듬은 메시지」가 0건이라
  // Health Index가 계산조차 되지 않았다. 호출부가 await 없이 부르는 것이 정상 동작이므로
  // 직렬화는 `friction.js` 안에서 해야 한다.
  installSlowStorage();
  recordFrictionEvent(FRICTION_EVENTS.REFINED, MON);
  recordFrictionEvent(FRICTION_EVENTS.MISREAD, MON);
  recordFrictionEvent(FRICTION_EVENTS.VENTING, MON);

  const batch = await takeFrictionBatch(NO_TEAM_BUCKET);
  assert.equal(batch[0].counts.refined, 1, '분모가 사라졌다');
  assert.equal(batch[0].counts.misread, 1);
  assert.equal(batch[0].counts.venting, 1);
});

test('🔴 같은 종류를 연달아 세도 합계가 맞는다', async () => {
  installSlowStorage();
  for (let i = 0; i < 5; i += 1) recordFrictionEvent(FRICTION_EVENTS.REFINED, MON);
  const batch = await takeFrictionBatch(NO_TEAM_BUCKET);
  assert.equal(batch[0].counts.refined, 5);
});

test('🔴 업로드가 빼는 동안 발생한 이벤트가 사라지지 않는다', async () => {
  installSlowStorage();
  await recordFrictionEvent(FRICTION_EVENTS.REFINED, MON);
  const sent = await takeFrictionBatch(NO_TEAM_BUCKET);
  // 업로드 응답 처리와 새 이벤트가 겹치는 상황
  clearSentFriction(NO_TEAM_BUCKET, sent);
  recordFrictionEvent(FRICTION_EVENTS.REFINED, MON);

  const left = await takeFrictionBatch(NO_TEAM_BUCKET);
  assert.equal(left[0]?.counts.refined, 1, '겹친 이벤트가 삼켜졌다');
});

/* ── 팀별 분리 (2026-08-19 — 대시보드 기준 불일치) ──────────────────── */

test('🔴 팀이 다르면 카운트가 섞이지 않는다 — 섞이면 팀장이 남의 팀 마찰을 본다', async () => {
  installStorage();
  await recordFrictionEvent(FRICTION_EVENTS.MISREAD, { teamId: 'A', now: MON });
  await recordFrictionEvent(FRICTION_EVENTS.MISREAD, { teamId: 'B', now: MON });
  await recordFrictionEvent(FRICTION_EVENTS.MISREAD, { teamId: 'B', now: MON });

  const a = await takeFrictionBatch('A');
  const b = await takeFrictionBatch('B');
  assert.equal(a[0].counts.misread, 1);
  assert.equal(b[0].counts.misread, 2);
});

test('🔴 팀 없는 카운트는 올릴 목록에 안 들어간다 — 나중에 팀에 들어가도 그 팀 것이 아니다', async () => {
  installStorage();
  await recordFrictionEvent(FRICTION_EVENTS.VENTING, { teamId: NO_TEAM_BUCKET, now: MON });
  await recordFrictionEvent(FRICTION_EVENTS.VENTING, { teamId: 'A', now: MON });

  const teams = await pendingFrictionTeams();
  assert.deepEqual(teams, ['A']);
  // 세기는 한다 — 버리지 않는다.
  assert.equal((await takeFrictionBatch(NO_TEAM_BUCKET))[0].counts.venting, 1);
});

test('🔴 한 팀을 지워도 다른 팀 카운트는 남는다', async () => {
  installStorage();
  await recordFrictionEvent(FRICTION_EVENTS.CLEAR, { teamId: 'A', now: MON });
  await recordFrictionEvent(FRICTION_EVENTS.CLEAR, { teamId: 'B', now: MON });

  await clearSentFriction('A', await takeFrictionBatch('A'));
  assert.deepEqual(await takeFrictionBatch('A'), []);
  assert.equal((await takeFrictionBatch('B'))[0].counts.clear, 1);
});

test('🔴 옛 저장물(팀 구분 없음)은 버리지 않고 레거시 칸으로 옮긴다', async () => {
  const store = installStorage();
  store['sai.friction.pending'] = { byDate: { '2026-08-17': { misread: 3 } } };

  const teams = await pendingFrictionTeams();
  assert.deepEqual(teams, [LEGACY_TEAM_BUCKET], '옛 카운트가 사라졌다');
  const days = await takeFrictionBatch(LEGACY_TEAM_BUCKET);
  assert.equal(days[0].counts.misread, 3);
});

test('🔴 옛 호출 방식(두 번째 인자가 Date)도 그대로 동작한다 — 호출부 10곳을 한 번에 못 고칠 때', async () => {
  installStorage();
  await recordFrictionEvent(FRICTION_EVENTS.MISREAD, MON);
  const days = await takeFrictionBatch(NO_TEAM_BUCKET);
  assert.equal(days[0].counts.misread, 1, '팀 없는 칸으로 들어가야 한다');
});
