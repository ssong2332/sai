/**
 * 예시 데이터 — `#sai=`가 없을 때만 쓴다 (시안 「Seam」의 생성기 그대로).
 *
 * 🔴 전부 합성이다. 화면 상단·바닥에 「예시 데이터」라고 반드시 밝힌다.
 * 🔴 확장이 보내는 것과 같은 모양(`byDate` = 날짜 키 → 팀 합계)으로 만든다 — 실데이터와 같은
 *    `buildRows`를 지나가므로, 예시가 실제 제품보다 많은 것을 약속하지 않는다.
 * 🔴 사람 단위 값은 없다 — 팀 합계뿐이다.
 */

import { dateKey } from './model.js';

function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function makeByDate(seed, opts, today) {
  const r = rng(seed);
  const byDate = {};
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (let i = 119; i >= 0; i -= 1) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    const wd = d.getDay();
    const weekend = wd === 0 || wd === 6;
    const t = 1 - i / 119;
    let refined = weekend ? Math.round(r() * 3) : Math.round(opts.base + r() * opts.base * 0.7 + (wd === 1 ? 4 : 0));
    const rate = Math.max(0.03, opts.rate - t * opts.improve + (r() - 0.5) * 0.05);
    const c = { refined };
    const spike = opts.spikes.includes(i) ? 1 : 0;
    if (spike) c.refined = refined = refined + 9;
    const f = (share, extra = 0) => Math.max(0, Math.round(refined * rate * share + (r() - 0.6) + extra));
    c.misread = f(0.42, spike * 4);
    c.urgencyGap = f(0.18, spike * 2);
    c.missing = f(0.2, spike * 1 + (wd === 1 ? 1 : 0));
    c.venting = f(0.12, spike * 3);
    c.forceOffHours = Math.max(0, f(0.08, spike * 2) + (wd === 4 || wd === 5 ? Math.round(r() * 1.6) : 0));
    c.clear = Math.min(c.misread, Math.round(c.misread * (0.35 + t * 0.45) + r() * 0.8));
    c.schedule = Math.max(0, Math.round((wd >= 4 && !weekend ? 1.4 : 0.5) * (0.4 + t) + r() - 0.4));
    c.sensitiveBlocked = r() < 0.12 + t * 0.08 ? 1 : 0;
    c.decoded = weekend ? Math.round(r() * 1.5) : Math.round(opts.inbound + r() * opts.inbound * 0.8 + spike * 5);
    c.decodeUrgencyGap = Math.max(0, Math.min(c.decoded, Math.round(c.decoded * (opts.opaque - t * 0.08 + spike * 0.25) + (r() - 0.5))));
    const crit = Math.min(refined, Math.round(refined * (0.08 + spike * 0.3 + (wd === 5 ? 0.06 : 0)) + (r() - 0.6)));
    const low = Math.min(refined - crit, Math.round(refined * (0.28 + t * 0.06) + (r() - 0.5)));
    c.urgencyCritical = Math.max(0, crit);
    c.urgencyLow = Math.max(0, low);
    c.urgencyNormal = Math.max(0, refined - c.urgencyCritical - c.urgencyLow);
    c.teamGlossaryApplied = Math.max(0, Math.min(refined, Math.round(refined * (opts.glossary + t * 0.12) + (r() - 0.5))));
    byDate[dateKey(d)] = c;
  }
  return byDate;
}

/** 예시 팀 3개 — 시안과 같은 이름·시드. 자료 범위는 120일. */
export function demoTeams(today = new Date()) {
  return [
    { a: '프론트엔드팀', b: '백엔드팀', byDate: makeByDate(7, { base: 9, rate: 0.2, improve: 0.11, spikes: [19, 47], inbound: 3, opaque: 0.22, glossary: 0.18 }, today) },
    { a: '제품팀', b: '싱가포르 지사', byDate: makeByDate(31, { base: 6, rate: 0.16, improve: 0.04, spikes: [8, 9, 66], inbound: 5, opaque: 0.38, glossary: 0.1 }, today) },
    { a: 'QA팀', b: '외주 개발사', byDate: makeByDate(91, { base: 5, rate: 0.24, improve: -0.03, spikes: [3, 33], inbound: 4, opaque: 0.3, glossary: 0.06 }, today) },
  ].map((t) => ({ ...t, coverageDays: 120, demo: true }));
}
