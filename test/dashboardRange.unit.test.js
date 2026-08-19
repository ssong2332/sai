/**
 * 대시보드 기간 합산 (2026-08-16 ②).
 * 🔴 「최근 7일」이 눌러도 아무 일이 없는 버튼이 되면 안 된다 — 날짜별 원자료에서 다시 센다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sumRecentDays } from '../dashboard/src/liveData.js';

function key(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('최근 7일만 합산한다 — 그보다 오래된 날짜는 빠진다', () => {
  const byDate = {
    [key(0)]: { refined: 5, venting: 1 },
    [key(3)]: { refined: 2 },
    [key(20)]: { refined: 100, venting: 9 },
  };
  assert.deepEqual(sumRecentDays(byDate, 7), { refined: 7, venting: 1 });
});

test('30일이면 전부 들어온다', () => {
  const byDate = { [key(0)]: { refined: 1 }, [key(20)]: { refined: 2 } };
  assert.deepEqual(sumRecentDays(byDate, 30), { refined: 3 });
});

test('🔴 오늘 것이 잘리지 않는다 — 경계에서 하루가 사라지면 안 된다', () => {
  assert.deepEqual(sumRecentDays({ [key(0)]: { refined: 1 } }, 1), { refined: 1 });
});

test('숫자가 아닌 필드는 건너뛴다', () => {
  const byDate = { [key(0)]: { refined: 2, teamId: 'x', dateKey: 'y' } };
  assert.deepEqual(sumRecentDays(byDate, 7), { refined: 2 });
});

test('빈 입력은 빈 결과다', () => {
  assert.deepEqual(sumRecentDays(null, 7), {});
});

/* ── 빈 팀도 목록에 남는다 (2026-08-16 실측이 잡은 결함) ──────────────── */

import { readLiveScenarios } from '../dashboard/src/liveData.js';

function encode(payload) {
  // 확장 쪽 인코딩과 짝 — 한글 팀 이름 보존.
  return Buffer.from(unescape(encodeURIComponent(JSON.stringify(payload))), 'binary').toString('base64');
}

test('🔴 지표가 0건인 팀도 목록에 남는다 — 빼면 그 팀을 고른 사용자에게 다른 팀이 열린다', () => {
  const hash = `#sai=${encode({
    teams: [
      { teamId: 't-empty', teamName: '132', counts: {}, byDate: {} },
      { teamId: 't-full', teamName: '어떻게든되겠조', counts: { refined: 19, venting: 2 }, byDate: {} },
    ],
  })}`;
  const scenarios = readLiveScenarios(hash);
  assert.equal(scenarios.length, 2, '빈 팀이 사라졌다');
  assert.equal(scenarios[0].teamName, '132');
  assert.equal(scenarios[0].empty, true, '빈 팀임을 화면이 말할 수 있어야 한다');
  assert.equal(scenarios[1].empty, false);
});

test('맨 앞이 사이드패널에서 고른 팀이다', () => {
  const hash = `#sai=${encode({ teams: [{ teamId: 'a', teamName: '고른 팀', counts: { refined: 3 } }] })}`;
  assert.equal(readLiveScenarios(hash)[0].teamName, '고른 팀');
});
