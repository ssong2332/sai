/**
 * 확장 대시보드 — 이 페이지가 열려 있는 동안만 사는 **팀 × 날짜 캐시** (2026-10-25, 0.1.21).
 *
 * 🔴 메모리에만 둔다 — 저장소·서버에 쓰지 않는다. 탭을 닫으면 사라진다(다음에 열면 다시 30일부터).
 * 🔴 **이미 읽은 날은 다시 읽지 않는다.** 문서가 없던 날(그날 신호 없음)도 「읽었음」으로 기억한다 —
 *    그래야 빈 날을 매번 다시 묻지 않는다. 실패한 요청의 날짜는 기억하지 않는다(다시 시도할 수 있게).
 * 🔴 같은 팀을 동시에 두 번 부르면 앞 요청을 기다린 뒤 **남은 날만** 읽는다.
 * 🔴 들어오는 값은 팀 단위 정수 합계뿐이다(Zero Retention — 본문 없음, 사람 단위 값 없음).
 */

import { missingKeys, coveredDays } from './range.js';

/**
 * @param {{fetchDays: (teamId: string, dateKeys: string[]) => Promise<Record<string, object>>, today?: Date}} deps
 *   `fetchDays`는 요청한 날짜 키 중 **문서가 있던 날만** `{dateKey: counts}`로 돌려준다.
 */
export function createFrictionCache({ fetchDays, today = new Date() }) {
  const teams = new Map();
  /** 이 페이지가 요청한 문서 수(= Firestore 읽기 수 근사 — 없는 문서도 1회로 센다). */
  const stats = { requestedDocs: 0, requests: 0 };

  const slot = (teamId) => {
    if (!teams.has(teamId)) teams.set(teamId, { loaded: new Set(), byDate: {}, inflight: null });
    return teams.get(teamId);
  };

  /** 최근 `days`일이 다 읽혀 있게 한다. 빠진 날만 읽는다. */
  async function ensure(teamId, days) {
    const s = slot(teamId);
    while (s.inflight) {
      try { await s.inflight; } catch { /* 앞 요청의 실패는 그쪽이 알린다 — 아래에서 남은 날을 다시 본다 */ }
    }
    const keys = missingKeys(s.loaded, days, today);
    if (keys.length === 0) return;
    stats.requestedDocs += keys.length;
    stats.requests += 1;
    s.inflight = (async () => {
      const found = await fetchDays(teamId, keys);
      for (const k of keys) {
        s.loaded.add(k);
        if (found && typeof found === 'object' && found[k] && typeof found[k] === 'object') s.byDate[k] = found[k];
      }
    })();
    try {
      await s.inflight;
    } finally {
      s.inflight = null;
    }
  }

  /** 지금까지 읽은 것. `coverageDays`는 오늘부터 끊기지 않은 날 수. */
  function snapshot(teamId) {
    const s = slot(teamId);
    return { byDate: { ...s.byDate }, coverageDays: coveredDays(s.loaded, today) };
  }

  return { ensure, snapshot, stats };
}
