/**
 * 사이 Team Health 진입점 — 시안 「Seam」(2026-10-25 사용자 승인).
 *
 * 🔴 **실데이터가 있으면 그것만 그린다**(`#sai=`, `liveData.js`). 예시와 섞으면 어느 수치가 진짜인지
 *    아무도 모른다. 없거나 깨졌으면 예시 데이터로 열고, 상단·바닥에 「예시 데이터」라고 밝힌다.
 * 🔴 실데이터에는 팀 이름이 하나뿐이다 — 상대 쪽 이름을 지어내지 않고 「주고받은 동료들」로 둔다.
 */

import './seam/seam.css';
import { readLiveScenarios } from './liveData.js';
import { buildRows } from './seam/model.js';
import { demoTeams } from './seam/demoData.js';
import { mount } from './seam/app.js';

export const OTHER_SIDE = '주고받은 동료들';

const live = readLiveScenarios();
const today = new Date();
const source = live.length
  ? live.map((s) => ({ a: s.teamName, b: OTHER_SIDE, byDate: s.byDate, coverageDays: s.coverageDays }))
  : demoTeams(today);
const teams = source.map((t) => ({ ...t, rows: buildRows(t.byDate, t.coverageDays, today) }));

mount(teams, { demo: live.length === 0 });
