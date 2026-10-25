/**
 * 대시보드 기간 합산 (2026-08-16 ②).
 * 🔴 「최근 7일」이 눌러도 아무 일이 없는 버튼이 되면 안 된다 — 날짜별 원자료에서 다시 센다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sumRecentDays } from '../src/dashboard/seam/signals.js';

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

/*
 * 🔴 0.1.21 — `#sai=` 페이로드(readLiveScenarios)는 없앴다. 「빈 팀도 목록에 남는다」는 이제 확장 대시보드가
 *    지킨다 — `test/dashboardOnDemand.unit.test.js`.
 */
