/**
 * 사이 Team Health — **웹 예시 전용** 진입점 (`/dashboard/`, 시안 「Seam」).
 *
 * 🔴 2026-10-25 (0.1.21) — 실제 팀 지표는 **확장 안 대시보드**(`src/dashboard/`)에서만 본다. 이 페이지는
 *    주소의 `#sai=`를 읽지 않는다 — 팀 합계가 URL·방문 기록에 남지 않게 하려는 것이다. 옛 확장이 `#sai=`를
 *    붙여 열어도 무시하고 주소에서 지운다(이 탭의 현재 기록만 바뀐다 — 이미 남은 방문 기록은 지우지 못한다).
 * 🔴 화면 코드는 확장과 **같은 한 벌**이다(`src/dashboard/seam/`). 여기서는 예시 데이터만 넣는다.
 */

import '../../src/dashboard/seam/seam.css';
import { mountSeamMarkup } from '../../src/dashboard/seam/markup.js';
import { buildRows } from '../../src/dashboard/seam/model.js';
import { demoTeams } from '../../src/dashboard/seam/demoData.js';
import { mount } from '../../src/dashboard/seam/app.js';

if (/[#&]sai=/.test(location.hash)) {
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    /* 바꾸지 못해도 읽지는 않는다 */
  }
}

mountSeamMarkup(document.getElementById('seam'));
const today = new Date();
const teams = demoTeams(today).map((t) => ({ ...t, rows: buildRows(t.byDate, t.coverageDays, today) }));
mount(teams, { demo: true, sourceLine: '사이 Team Health · 예시 데이터 — 실제 팀 지표는 확장 안에서 봐요' });
