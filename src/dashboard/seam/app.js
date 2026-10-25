/**
 * Seam 화면 그리기 — 시안(`seam/template.html`)의 렌더링을 그대로 옮겼다.
 *
 * 🔴 숫자·문장은 전부 `model.js`(순수 함수)에서 받는다. 여기는 SVG·HTML 조각을 만들고 사건을 잇는다.
 * 🔴 팀 이름 같은 바깥 문자열은 `esc()`를 거친다 — 사용자가 지은 팀 이름을 HTML로 해석하지 않는다.
 */

import {
  EVENTS, F, P, WD, STEADY_MIN,
  sum, ratio, healthOf, safeMax, laneHeight, frac, fmtD, pct, esc,
  splitWindow, periodOptions, defaultPeriod, isEmpty,
  dailyGap, worstDay, topCause, headline, deltaOf, storyFacts,
  actions, briefLines, briefText, weekdayFold, threadRows,
  pickDays, selectedSummary, dayStrip, dayTable, PERIODS,
} from './model.js';
import { daysNeeded } from '../range.js';

const THEME_KEY = 'sai-dashboard-theme';
/** 「실마다 따로 보기」 보기 방식(흐름/날짜별) — 이 브라우저의 편의 설정일 뿐이다. */
const VIEW_KEY = 'sai-dashboard-threads-view';
function readView() {
  try { return localStorage.getItem(VIEW_KEY) === 'dates' ? 'dates' : 'flow'; } catch { return 'flow'; }
}
const shortD = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const $ = (id) => document.getElementById(id);
const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** 매끄러운 곡선(캣멀-롬 → 베지어). */
function path(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/**
 * @param {Array<{a: string, b: string, rows: object[], coverageDays: number, status?: string}>} teams
 *   `status` — 'ready'(그릴 수 있음) · 'idle'(아직 안 읽음) · 'loading' · 'error'. 없으면 'ready'.
 * @param {object} opts
 * @param {boolean} opts.demo 예시 데이터인가 — 상단·바닥에 밝힌다.
 * @param {(i: number, days: number) => Promise<{rows: object[], coverageDays: number}>} [opts.load]
 *   확장 페이지만 준다. 팀 `i`의 최근 `days`일이 읽혀 있게 하고 지금까지 읽은 것을 돌려준다(빠진 날만 읽는다).
 *   🔴 없으면(웹 예시) 받은 자료 범위 안에서만 그린다 — 예전과 같다.
 * @param {number} [opts.initial] 처음 고른 팀 번호.
 * @param {number} [opts.otherDays] 「맡은 관계 나란히」에서 다른 팀을 읽을 날 수.
 * @param {(next: 'light'|'dark') => void} [opts.saveTheme] 밝기 버튼 — 없으면 이 브라우저(localStorage)에만 기억한다.
 * @param {(error: unknown) => string} [opts.errorText] 읽기 실패를 사람 말로.
 * @param {string} [opts.sourceLine] 바닥 줄의 출처 문구.
 */
export function mount(teams, opts = {}) {
  const { demo = false, load = null, otherDays = 30, saveTheme = null } = opts;
  const errorText = opts.errorText ?? (() => '불러오지 못했어요');
  const lazy = typeof load === 'function';
  const subject = demo ? '두 팀 사이' : '팀과 동료들 사이';
  for (const t of teams) if (!t.status) t.status = 'ready';
  const first = Number.isInteger(opts.initial) && teams[opts.initial] ? opts.initial : 0;
  // picked·anchor·focus는 「날짜별」의 고른 날·Shift 기준 날·키보드 위치(이번 기간 rows 안의 칸 번호).
  // compare — 「앞 기간과 비교」를 위해 더 읽어도 되는가. 웹 예시는 자료가 이미 다 있으므로 늘 켜져 있다.
  const state = { team: first, days: lazy ? 30 : defaultPeriod(teams[first].coverageDays), compare: !lazy, sel: null, view: readView(), picked: null, anchor: null, focus: null, showZero: false };
  /** 진행 중인 읽기 · 실패한 읽기({message, want}). 화면은 둘 중 하나만 말한다. */
  const net = { busy: false, error: null, seq: 0 };
  let briefCopy = '';
  let shown = null;
  const periodsOf = (t) => (lazy ? PERIODS : periodOptions(t.coverageDays));

  const team = () => teams[state.team];
  const pairLabel = (t) => `${t.a} ↔ ${t.b}`;
  const windowRows = () => splitWindow(team().rows, state.days);

  $('demo').hidden = !demo;
  $('demo-note').hidden = !demo;
  $('foot-src').textContent = opts.sourceLine ?? (demo ? '사이 Team Health · 예시 데이터' : '사이 Team Health · 팀 합계');

  /* ── 숫자 굴리기 ── */
  function roll(el, to, digits = 1) {
    if (to == null) { el.textContent = '—'; shown = null; return; }
    const from = shown ?? to; shown = to;
    if (reduce || from === to) { el.textContent = to.toFixed(digits); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (from + (to - from) * e).toFixed(digits);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ── 히어로: 두 실과 장부 ── */
  function drawWeave(rows) {
    const svg = $('weave');
    const W = Math.max(320, Math.round(svg.parentNode.clientWidth || 1240)), narrow = W < 640;
    const H = narrow ? 250 : 300, L = narrow ? 8 : 96, R = narrow ? 8 : 24;
    const mid = narrow ? 120 : 150, minGap = 6, maxGap = narrow ? 150 : 200;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const n = rows.length, step = (W - L - R) / Math.max(1, n - 1);
    const x = (i) => L + i * step;
    // 신호 수는 메시지 수를 넘을 수 있다 — 벌어짐은 1에서 자른다(dailyGap).
    const daily = dailyGap(rows);
    const peakRatio = Math.max(0.25, ...daily);
    const gap = daily.map((v) => minGap + Math.sqrt(v / peakRatio) * (maxGap - minGap) * 0.6);
    const top = rows.map((_, i) => [x(i), mid - gap[i] / 2]);
    const bot = rows.map((_, i) => [x(i), mid + gap[i] / 2]);
    const pTop = path(top), pBot = path(bot);
    const area = pTop + ' ' + path(bot.slice().reverse()).replace(/^M/, 'L') + ' Z';
    const worst = worstDay(rows);
    if (state.sel == null || state.sel >= n) state.sel = worst ?? n - 1;

    // 2026-10-25 사용자 결정 — 아래 신호 막대(장부)는 뺐다. 실의 벌어짐이 이미 마찰을 말하므로 같은 말을 두 번
    //    하지 않는다. 그날의 건수는 커서 옆 말풍선(`tip`)이 알려 준다.
    const fC = rows.map((d) => sum([d], F)), pC = rows.map((d) => sum([d], P));

    let weekends = '', axis = '';
    rows.forEach((d, i) => {
      if (d.wd === 6) weekends += `<rect class="weekend" x="${(x(i) - step / 2).toFixed(1)}" y="8" width="${(step * 2).toFixed(1)}" height="${H - 40}"/>`;
      const every = n > 40 ? 14 : narrow && n > 20 ? 10 : 7;
      if ((n - 1 - i) % every === 0) axis += `<line x1="${x(i)}" y1="${H - 30}" x2="${x(i)}" y2="${H - 24}"/><text x="${x(i)}" y="${H - 8}" text-anchor="middle">${i === n - 1 ? '오늘' : fmtD(d.date)}</text>`;
    });

    let callout = '', desc = `${n}일 동안 ${subject}의 마찰 비율. 기록된 신호가 아직 없어요.`;
    if (worst != null) {
      const wx = x(worst), wy = mid - gap[worst] / 2, flip = wx > W * 0.6;
      const wd = rows[worst], wdF = sum([wd], F), cause = topCause(wd);
      const steadyNote = wd.c.refined < STEADY_MIN ? ' · 글이 적은 날이에요' : '';
      callout = `<g class="callout"><line x1="${wx}" y1="${wy - 6}" x2="${wx}" y2="22"/><text x="${wx + (flip ? -8 : 8)}" y="26" text-anchor="${flip ? 'end' : 'start'}">가장 벌어진 날 · ${fmtD(wd.date)} (${WD[wd.wd]})</text><text class="sub" x="${wx + (flip ? -8 : 8)}" y="42" text-anchor="${flip ? 'end' : 'start'}">${narrow || !cause ? '' : `${cause.label} ${cause.count}건이 가장 많았어요`}${steadyNote}</text></g>`;
      desc = `${n}일 동안 ${subject}의 마찰 비율. 가장 벌어진 날은 ${fmtD(wd.date)}, 다듬은 글 ${wd.c.refined}건에서 마찰 신호 ${wdF}건.`;
    }

    const t = team();
    $('lg-a').textContent = t.a; $('lg-b').textContent = t.b;
    svg.innerHTML = `<desc id="weave-desc">${esc(desc)}</desc>
      <defs><linearGradient id="gapfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb12e" stop-opacity=".02"/><stop offset=".5" stop-color="#ffb12e" stop-opacity=".16"/><stop offset="1" stop-color="#ffb12e" stop-opacity=".02"/></linearGradient></defs>
      ${weekends}
      <line class="seamline" x1="${L}" y1="${mid}" x2="${W - R}" y2="${mid}"/>
      <g class="axis">${axis}</g>
      <path class="gap" d="${area}"/>
      <path class="strand a" d="${pTop}"/>
      <path class="strand b" d="${pBot}"/>
      ${narrow ? '' : `<text class="team-label a" x="${L - 12}" y="${mid - gap[0] / 2 - 2}" text-anchor="end">${esc(t.a)}</text>
      <text class="team-label b" x="${L - 12}" y="${mid + gap[0] / 2 + 12}" text-anchor="end">${esc(t.b)}</text>`}
      ${callout}
      <g id="cursor"></g>
      <g id="hits">${rows.map((_, i) => `<rect class="hit" data-i="${i}" x="${(x(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H - 30}"/>`).join('')}</g>`;
    svg.querySelectorAll('.strand').forEach((p) => p.style.setProperty('--len', Math.ceil(p.getTotalLength())));
    svg.classList.remove('drawn'); void svg.getBBox(); svg.classList.add('drawn');
    svg._geo = { x, mid, gap, H, W, fC, pC, narrow };
    svg.tabIndex = 0;
    svg.setAttribute('aria-label', '날짜 선택 — 왼쪽·오른쪽 화살표로 날짜를 옮겨요');
    placeCursor(rows);
  }

  /** 커서 말풍선 — 아래 실 밑에 그날의 마찰 신호 수(와 다듬은 글·긍정 신호)를 띄운다. 가장자리에서는 안쪽으로 접는다. */
  function tip(g, i, d) {
    const ref = d.c.refined || 0, w = g.narrow ? 156 : 176, h = 46, cx = g.x(i);
    const left = Math.min(Math.max(cx - w / 2, 4), g.W - w - 4);
    const top = Math.min(g.mid + g.gap[i] / 2 + 12, g.H - 30 - h - 2);
    return `<g class="tip" aria-hidden="true"><rect x="${left}" y="${top}" width="${w}" height="${h}" rx="10"/>`
      + `<text class="tip-1" x="${left + 12}" y="${top + 20}">${fmtD(d.date)} · 마찰 신호 ${g.fC[i]}건</text>`
      + `<text class="tip-2" x="${left + 12}" y="${top + 36}">다듬은 글 ${ref}건 · 긍정 신호 ${g.pC[i]}건</text></g>`;
  }

  function placeCursor(rows) {
    const svg = $('weave'), g = svg._geo, i = state.sel;
    svg.querySelector('#cursor').innerHTML = `<line class="cursor" x1="${g.x(i)}" y1="12" x2="${g.x(i)}" y2="${g.H - 30}"/><circle class="cursor-dot" cx="${g.x(i)}" cy="${g.mid - g.gap[i] / 2}" r="4.5"/><circle class="cursor-dot" cx="${g.x(i)}" cy="${g.mid + g.gap[i] / 2}" r="4.5"/>${tip(g, i, rows[i])}`;
    $('th-day').textContent = fmtD(rows[i].date);
    const d = rows[i], fN = sum([d], F), pN = sum([d], P), ref = d.c.refined || 0;
    const chipRow = (kind) => EVENTS.filter((e) => e.kind === kind).map((e) => `<span class="chip ${kind === 'f' ? 'snag' : 'stitch'}${d.c[e.id] ? '' : ' zero'}"><b class="num">${d.c[e.id] || 0}</b>${e.label}</span>`).join('');
    $('day').innerHTML = `<div class="day-date num">${fmtD(d.date)}<small>${WD[d.wd]}요일 · 다듬은 메시지 ${ref}건</small></div>
      <div class="chip-rows"><div class="chip-row"><span class="chip-k f">마찰 신호 ${fN}건</span><div class="chips">${chipRow('f')}</div></div><div class="chip-row"><span class="chip-k p">긍정 신호 ${pN}건</span><div class="chips">${chipRow('p')}</div></div></div>
      <div class="day-note">${ref === 0 ? '이날은 다듬은 메시지가 없어요.' : `다듬은 글 ${ref}건에서 마찰 신호 ${fN}건 · 긍정 신호 ${pN}건${fN > ref ? ' — 한 글에서 신호가 여러 개 잡히기도 해요' : ''}${ref < STEADY_MIN ? ' · 글이 적은 날이라 흐름 판단에는 덜 반영했어요' : ''}`}</div>`;
    // 「날짜별」은 위에서 커서가 지나갈 때마다 다시 그리지 않는다 — 누르거나 화살표로 고를 때만(pick의 commit).
    if (state.view === 'flow') {
      const { cur, prev } = windowRows();
      drawThreads(cur, prev);
    }
  }

  /* ── 실마다 따로 보기: 흐름 / 날짜별 ── */
  function drawThreadSection() {
    const dates = state.view === 'dates';
    $('threads').hidden = dates;
    $('dates').hidden = !dates;
    $('th-p-flow').hidden = dates;
    $('th-p-dates').hidden = !dates;
    $('th-view').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    const { cur, prev } = windowRows();
    if (dates) drawDates(cur); else drawThreads(cur, prev);
  }

  function drawDates(cur) {
    const n = cur.length;
    if (state.picked == null) { state.picked = state.sel == null ? [] : [state.sel]; state.anchor = state.sel; }
    const picked = new Set(state.picked);
    const focusI = Math.max(0, Math.min(n - 1, state.focus ?? state.picked[state.picked.length - 1] ?? state.sel ?? n - 1));
    const strip = dayStrip(cur);
    const cells = strip.map((c) => `<button type="button" class="dc lv${c.level}${c.weekend ? ' wkend' : ''}" data-i="${c.i}" aria-pressed="${picked.has(c.i)}" tabindex="${c.i === focusI ? 0 : -1}" aria-label="${fmtD(c.date)} ${WD[c.wd]}요일 · 마찰 신호 ${c.f}건"><span class="dc-t" aria-hidden="true">${c.monthStart ? `${c.date.getMonth() + 1}월` : WD[c.wd]}</span><span class="dc-n num" aria-hidden="true">${c.date.getDate()}</span></button>`).join('');
    const cols = n <= 30 ? n : Math.ceil(n / 2);

    const s = selectedSummary(cur, state.picked);
    const t = dayTable(cur, state.picked, { showZero: state.showZero });
    const dcols = t.compact ? [] : t.cols;
    const span = 3 + dcols.length;
    const head = `<tr><th scope="col" class="lab">신호</th>${dcols.map((c) => `<th scope="col" class="dcol num">${shortD(c.date)}<small>${WD[c.wd]}</small></th>`).join('')}<th scope="col" class="tot">${t.compact ? `${s.days}일 합계` : '합계'}</th><th class="bcol" aria-hidden="true"></th></tr>`;
    const refRow = `<tr class="ref"><th scope="row" class="lab">다듬은 글</th>${dcols.map((c) => `<td class="dcol num">${c.refined}</td>`).join('')}<td class="tot num">${s.refined}</td><td class="bcol"></td></tr>`;
    const body = t.groups.map((g) => {
      const rows = g.rows.length
        ? g.rows.map((r) => `<tr><th scope="row" class="lab">${r.label}<small>${r.desc}</small></th>${t.compact ? '' : r.vals.map((v) => `<td class="dcol num${v ? '' : ' z'}">${v}</td>`).join('')}<td class="tot num">${r.tot}</td><td class="bcol"><span class="mbar ${g.kind}" aria-hidden="true"><i style="width:${Math.round(r.share * 100)}%"></i></span></td></tr>`).join('')
        : `<tr class="none"><td colspan="${span}">고른 날에는 ${g.label}가 없어요</td></tr>`;
      return `<tr class="grp ${g.kind}"><th scope="colgroup" colspan="${span}">${g.label} <b class="num">${g.tot}</b>건${g.hidden && g.rows.length ? `<small> · 0건 ${g.hidden}줄 숨김</small>` : ''}</th></tr>${rows}`;
    }).join('');

    $('dates').innerHTML = `<div class="dates-top"><span class="dates-key"><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i>마찰 신호가 많은 날일수록 짙어요</span>
        <button type="button" class="textbtn" data-act="clear"${s.days ? '' : ' disabled'}>선택 지우기</button></div>
      <div class="dstrip" role="group" aria-label="날짜 고르기 — 왼쪽·오른쪽 화살표로 옮기고 Enter로 켜고 꺼요" style="--cols:${cols}">${cells}</div>
      <div class="dates-sum"><span aria-live="polite">${s.days ? `<b class="num">${s.days}</b>일 선택 · 다듬은 글 <b class="num">${s.refined}</b>건 · 마찰 신호 <b class="num">${s.f}</b>건 · 긍정 신호 <b class="num">${s.p}</b>건` : '위에서 날짜를 하나 이상 골라 주세요.'}</span>
        ${s.days ? `<button type="button" class="textbtn" data-act="zero" aria-pressed="${state.showZero}">0건도 보기</button>` : ''}</div>
      ${s.days ? `<table class="dt${t.compact ? ' compact' : ''}"><caption class="sr">고른 날의 신호별 건수</caption><thead>${head}</thead><tbody>${refRow}${body}</tbody></table>` : ''}`;
  }

  function refocusDay(i) {
    const b = $('dates').querySelector(`.dc[data-i="${i}"]`);
    if (b) b.focus();
  }

  function drawStory(cur, prev) {
    const s = storyFacts(cur, prev);
    $('story').innerHTML = `
      <article class="beat"><div class="beat-k">흐름</div>
        <p class="beat-t">${s.trend <= 0 ? `기간 후반에 마찰 비율이 <em class="p">${pct(s.early ?? 0)} → ${pct(s.late ?? 0)}</em>로 내려왔어요.` : `기간 후반에 마찰 비율이 <em class="s">${pct(s.early ?? 0)} → ${pct(s.late ?? 0)}</em>로 올라갔어요.`}</p>
        <p class="beat-n">앞 ${state.days}일 전체는 ${s.b == null ? '자료 없음' : pct(s.b)}, 이번 기간 전체는 ${s.a == null ? '—' : pct(s.a)}.</p></article>
      <article class="beat"><div class="beat-k">가장 큰 원인</div>
        <p class="beat-t">${s.fTot ? `마찰의 <em class="s">${Math.round(s.topShare * 100)}%</em>가 「${s.top.label}」에서 나왔어요.` : '이 기간에는 마찰 신호가 없었어요.'}</p>
        <p class="beat-n">그중 <b class="num">${s.clr}</b>건은 교정을 거쳐 명확한 요청으로 나갔어요 (감지 ${s.mis}건 대비 ${s.mis ? Math.round((s.clr / s.mis) * 100) : 0}%).</p></article>
      <article class="beat"><div class="beat-k">요일</div>
        <p class="beat-t">${s.offTop ? `오프타임 강행은 <em class="r">${WD[s.offTop.wd]}요일</em>에 가장 많았어요.` : '이 기간에는 오프타임 강행이 없었어요.'}</p>
        <p class="beat-n">${s.offTop ? `${s.offTop.count}건 — 마감이 몰리는 요일엔 예약 제안을 먼저 써 보세요.` : '퇴근 시간 뒤 메시지는 모두 예약으로 나갔어요.'}</p></article>`;
  }

  function drawThreads(cur, prev) {
    const sel = state.sel, n = cur.length, w = 600, h = 44, bw = w / n;
    // 고른 날은 빨간 막대 대신 회색 세로 띠로 — 막대 색은 그대로 둔다(2026-10-25 사용자 지적).
    const band = sel == null ? '' : `<rect class="selband" x="${(sel * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${h}"/>`;
    $('threads').innerHTML = threadRows(cur, prev).map((e) => {
      const bars = band + e.vals.map((v, i) => {
        if (!v) return '';
        const bh = Math.max(3, (v / e.max) * (h - 6));
        return `<rect class="${e.kind === 'f' ? 's' : 'p'}" x="${(i * bw + bw * 0.18).toFixed(1)}" y="${(h - 2 - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}"/>`;
      }).join('');
      return `<div class="thread">
        <div class="thread-name"><span class="thread-tag ${e.kind === 'f' ? 'snag' : 'stitch'}">${e.kind === 'f' ? '마찰' : '긍정'}</span><br>${e.label}<small>${e.desc}</small></div>
        <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${e.label} 날짜별 ${e.tot}건"><line class="base" x1="0" y1="${h - 1.5}" x2="${w}" y2="${h - 1.5}"/>${bars}</svg>
        <div class="thread-total"><b class="num">${e.tot}</b><span class="${e.dir}">${e.pt == null ? '비교할 앞 기간 없음' : e.change}</span></div>
      </div>`;
    }).join('');
  }

  function drawRhythm(cur) {
    const { by, peak, maxR } = weekdayFold(cur);
    const order = [1, 2, 3, 4, 5, 6, 0];
    $('rhythm').innerHTML = order.map((k, j) => {
      const b = by[k];
      return `<div class="wd${k === peak ? ' peak' : ''}"><div class="wd-h">${WD[k]}<span class="num">${b.r ? pct(b.f / b.r) : '—'}</span></div>
        <div class="wd-col" aria-hidden="true"><div class="r" style="height:${frac(b.r, maxR) * 100}%;animation-delay:${j * 40}ms"></div><div class="f" style="height:${frac(b.f, maxR) * 100}%;animation-delay:${j * 40 + 120}ms"></div></div>
        <div class="wd-foot">다듬은 <b class="num">${b.r}</b> · 마찰 <b class="num">${b.f}</b></div></div>`;
    }).join('');
  }

  function drawActs(list) {
    $('acts').innerHTML = list.length
      ? list.map((a, i) => `<li class="act${a.hot ? ' hot' : ''}"><span class="act-n num">${i + 1}</span><div><h3>${a.title}</h3><p>${a.body}</p></div><div class="act-why"><b class="num">${a.why}</b>${a.tag}${a.hot ? ' · 늘고 있음' : ''}</div></li>`).join('')
      : '<li class="act"><span class="act-n">✓</span><div><h3>지금은 따로 손볼 곳이 보이지 않아요</h3><p>이번 기간에는 한쪽으로 몰린 마찰이 없어요.</p></div></li>';
  }

  function drawSaved(cur) {
    const mis = sum(cur, ['misread']), clr = sum(cur, ['clear']), sb = sum(cur, ['sensitiveBlocked']), sch = sum(cur, ['schedule']);
    const ref = sum(cur, ['refined']), gl = sum(cur, ['teamGlossaryApplied']);
    const cell = (n, label, note, f) => `<div class="sv"><b class="num">${n}</b><span>${label}</span>${f == null ? '' : `<div class="meter" aria-hidden="true"><i style="width:${Math.round(f * 100)}%"></i></div>`}<small>${note}</small></div>`;
    $('saved').innerHTML = [
      cell(clr, '오해 소지를 정리해 보냄', `감지된 ${mis}건 중 ${mis ? Math.round((clr / mis) * 100) : 0}%`, frac(clr, mis)),
      cell(sch, '퇴근 시간 대신 예약으로', '상대의 업무 시간에 도착하도록 미뤘어요', null),
      cell(sb, '민감정보 전송을 막음', '키·카드번호 같은 값이 나가기 전에 멈췄어요', null),
      cell(gl, '팀 용어집으로 맞춘 글<span class="new">새 지표</span>', `다듬은 글의 ${Math.round(frac(gl, ref) * 100)}%`, frac(gl, ref)),
    ].join('');
  }

  function bars(cur, layers, H) {
    const W = 600, n = cur.length, bw = W / n;
    const max = safeMax(cur.map((d) => layers.reduce((s, l) => s + (d.c[l.k] || 0), 0)));
    let g = '';
    cur.forEach((d, i) => {
      let y = H - 18;
      layers.forEach((l) => {
        const v = d.c[l.k] || 0;
        if (!v) return;
        const h = (v / max) * (H - 26);
        y -= h;
        g += `<rect class="${l.cls}" x="${(i * bw + bw * 0.15).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/>`;
      });
    });
    const tick = (i) => `<text class="ax" x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${i === n - 1 ? '오늘' : fmtD(cur[i].date)}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img"><line class="base" x1="0" y1="${H - 17.5}" x2="${W}" y2="${H - 17.5}"/>${g}${tick(0)}${tick(Math.floor(n / 2))}${tick(n - 1)}</svg>`;
  }

  function drawInbound(cur, prev) {
    const dec = sum(cur, ['decoded']), gapN = sum(cur, ['decodeUrgencyGap']);
    const pd = prev.length ? sum(prev, ['decoded']) : 0, pg = prev.length ? sum(prev, ['decodeUrgencyGap']) : 0;
    const r = frac(gapN, dec), pr = pd ? frac(pg, pd) : null;
    const view = cur.map((d) => ({ ...d, c: { ...d.c, decodeSame: Math.max(0, (d.c.decoded || 0) - (d.c.decodeUrgencyGap || 0)) } }));
    $('inbound').innerHTML = `<div class="panel-top"><div><b class="num">${dec}</b>뜻 풀기로 연 글<span class="new">새 지표</span></div><div><b class="num">${Math.round(r * 100)}%</b>겉말과 의도가 달랐음${pr == null ? '' : ` · 앞 기간 ${Math.round(pr * 100)}%`}</div></div>
      ${bars(view, [{ k: 'decodeUrgencyGap', cls: 'inb-gap' }, { k: 'decodeSame', cls: 'inb-bar' }], 150)}
      <div class="key"><span><i style="background:var(--focus)"></i>의도가 달랐던 글</span><span><i style="background:var(--bar)"></i>겉말 그대로였던 글</span></div>`;
  }

  function drawTemp(cur) {
    // 분모는 세 긴급도의 합 — 모델이 긴급도를 내지 못한 다듬기는 세지 않으므로 refined보다 작을 수 있다.
    const c = sum(cur, ['urgencyCritical']), nn = sum(cur, ['urgencyNormal']), l = sum(cur, ['urgencyLow']), all = c + nn + l;
    const p = (v) => Math.round(frac(v, all) * 100);
    $('temp').innerHTML = `<div class="panel-top"><div><b class="num">${p(c)}%</b>Critical<span class="new">새 지표</span></div><div><b class="num">${p(nn)}%</b>Normal</div><div><b class="num">${p(l)}%</b>Low</div></div>
      ${bars(cur, [{ k: 'urgencyCritical', cls: 'u-c' }, { k: 'urgencyNormal', cls: 'u-n' }, { k: 'urgencyLow', cls: 'u-l' }], 150)}
      <div class="key"><span><i style="background:var(--seam)"></i>Critical</span><span><i style="background:var(--bar)"></i>Normal</span><span><i style="background:#7d8fff"></i>Low</span></div>`;
  }

  function drawCompare() {
    $('cmp').innerHTML = teams.map((t, i) => {
      if (t.status !== 'ready' || !t.rows.length) {
        const msg = t.status === 'error' ? '읽지 못했어요 — 누르면 다시 읽어요' : t.status === 'loading' ? '불러오는 중…' : `이 칸이 보이면 최근 ${otherDays}일을 읽어요`;
        return `<button type="button" class="cm cm-wait" data-i="${i}" aria-current="${i === state.team}"><span class="cm-h"><b>${esc(t.a)}</b> ↔ ${esc(t.b)}</span><span class="cm-n num">—</span><span class="cm-d">${msg}</span></button>`;
      }
      const { cur, prev } = splitWindow(t.rows, Math.min(state.days, t.rows.length));
      const a = ratio(cur), b = prev.length ? ratio(prev) : null, h = healthOf(cur);
      const daily = dailyGap(cur);
      const W = 300, H = 64, mid = 32, n = cur.length, x = (k) => 4 + (k * (W - 8)) / Math.max(1, n - 1);
      const g = daily.map((v) => 3 + Math.sqrt(Math.min(1, v / 0.6)) * 26);
      const top = path(daily.map((_, k) => [x(k), mid - g[k] / 2])), bot = path(daily.map((_, k) => [x(k), mid + g[k] / 2]));
      const area = top + ' ' + path(daily.map((_, k) => [x(k), mid + g[k] / 2]).reverse()).replace(/^M/, 'L') + ' Z';
      const diff = a != null && b != null ? (a - b) * 100 : null;
      return `<button type="button" class="cm" data-i="${i}" aria-current="${i === state.team}"><span class="cm-h"><b>${esc(t.a)}</b> ↔ ${esc(t.b)}</span><span class="cm-n num">${h == null ? '—' : h.toFixed(1)}</span>
        <span class="cm-d ${diff == null ? '' : diff > 0 ? 'up' : 'down'}">${a == null ? '아직 쌓인 신호가 없어요' : diff == null ? '비교할 앞 기간 없음' : `마찰 비율 ${Math.abs(diff).toFixed(1)}%p ${diff > 0 ? '늘었어요' : '줄었어요'}`}${t.rows.length < state.days ? ` · 최근 ${t.rows.length}일만 읽었어요` : ''}</span>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="g" d="${area}"/><path class="a" d="${top}"/><path class="b" d="${bot}"/></svg></button>`;
    }).join('');
    $('cmp').querySelectorAll('.cm').forEach((btn) => btn.addEventListener('click', () => {
      selectTeam(Number(btn.dataset.i));
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    }));
    // 🔴 비교에 자료가 모자란 팀이 있으면 그렇다고 말한다 — 짧은 범위로 그린 것을 숨기지 않는다.
    const note = $('cmp-note');
    const short = teams.filter((t) => t.status === 'ready' && t.rows.length && t.rows.length < state.days).length;
    const parts = [];
    if (lazy && teams.length > 1) parts.push(`다른 팀은 이 칸이 화면에 들어올 때 팀마다 최근 ${otherDays}일만 읽어요.`);
    if (short) parts.push(`${short}개 팀은 고른 기간(${state.days}일)보다 짧게 읽어서, 읽은 날까지만 그렸어요. 그 팀을 누르면 필요한 만큼 더 읽어요.`);
    note.hidden = parts.length === 0;
    note.textContent = parts.join(' ');
  }

  /** 「맡은 관계 나란히」 — 아직 안 읽은 팀을 하나씩 읽는다(확장 페이지만). */
  async function loadOthers() {
    for (let i = 0; i < teams.length; i += 1) {
      const t = teams[i];
      if (t.status !== 'idle') continue;
      t.status = 'loading';
      drawCompare();
      try {
        Object.assign(t, await load(i, otherDays));
        t.status = 'ready';
      } catch {
        t.status = 'error';
      }
      drawCompare();
    }
  }

  function drawBrief(cur, prev, acts) {
    const lines = briefLines(cur, prev, state.days);
    const next = acts[0];
    $('brief').innerHTML = `<div class="brief-grid"><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      <div class="next"><b>이번 주에 하나만 한다면</b><p>${next ? next.title : '지금처럼 유지하기'}</p><small>${next ? next.why : ''}</small></div></div>`;
    briefCopy = briefText({ pairLabel: pairLabel(team()), days: state.days, lines, next });
  }

  function drawRange() {
    const t = team();
    const opts = periodsOf(t);
    const wrap = $('range');
    wrap.querySelectorAll('button').forEach((b) => b.remove());
    opts.forEach((d) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.days = String(d);
      btn.textContent = `${d}일`;
      btn.setAttribute('aria-pressed', String(d === state.days));
      btn.disabled = net.busy;
      btn.addEventListener('click', () => request({ days: d }));
      wrap.appendChild(btn);
    });
    drawRangeNote();
    knobNow();
  }

  /**
   * 기간 아래 한 줄 — 읽는 중 · 실패(다시 시도) · 앞 기간 자료가 없음(더 읽기) · 앞 기간이 비어 비교 안 함.
   * 🔴 앞 기간이 자료 범위 밖이면 비교를 만들지 않는다 — 그 이유를 숨기지 않는다.
   */
  function drawRangeNote() {
    const t = team();
    const note = $('range-note');
    let html = '';
    if (net.busy) {
      html = '필요한 날짜를 더 불러오는 중이에요…';
    } else if (net.error) {
      html = `${esc(net.error.message)} <button type="button" class="textbtn" data-act="retry">다시 시도</button>`;
    } else if (t.coverageDays < state.days * 2) {
      html = lazy
        ? `앞 ${state.days}일 자료는 아직 읽지 않아서 비교하지 않았어요. <button type="button" class="textbtn" data-act="compare">앞 ${state.days}일과 비교하기</button> <span class="range-cost">(${state.days * 2 - t.coverageDays}일치를 더 읽어 모두 ${state.days * 2}일을 봐요)</span>`
        : esc(`최근 ${t.coverageDays}일 자료만 있어서, 이 기간은 앞 기간과 비교하지 않아요.`);
    } else {
      const { cur, prev } = splitWindow(t.rows, state.days);
      // 비교 중이면 두 기간의 날짜와 합친 날 수를 밝힌다 — 「앞 30일과 비교」가 60일을 보고 있다는 걸 숨기지 않는다.
      const before = t.rows.slice(-state.days * 2, -state.days);
      const span = (rows) => `${fmtD(rows[0].date)}~${fmtD(rows.at(-1).date)}`;
      html = prev.length
        ? esc(`앞 ${state.days}일(${span(prev)})과 이번 ${state.days}일(${span(cur)})을 비교하고 있어요 · 모두 ${state.days * 2}일`)
        : esc(`앞 ${state.days}일(${span(before)})까지 모두 ${state.days * 2}일을 읽었지만, 그 기간에 다듬은 글이 없어서 비교하지 않았어요.`);
    }
    note.hidden = html === '';
    note.innerHTML = html;
  }

  /**
   * 기간·비교·팀 바꾸기의 단일 입구. 확장 페이지면 **모자란 날만** 먼저 읽고, 다 읽은 뒤에 화면을 바꾼다.
   * 🔴 읽기에 실패하면 화면은 그대로 두고(지어낸 숫자를 그리지 않는다) 실패와 「다시 시도」만 보인다.
   * 🔴 연달아 누르면 마지막 요청만 화면에 반영한다.
   */
  async function request(next) {
    const want = { team: state.team, days: state.days, compare: state.compare, ...next };
    const t = teams[want.team];
    const seq = ++net.seq;
    const need = lazy ? daysNeeded(want.days, want.compare) : 0;
    if (lazy && (t.status !== 'ready' || t.coverageDays < need)) {
      net.busy = true; net.error = null;
      drawRange();
      try {
        Object.assign(t, await load(want.team, need));
        t.status = 'ready';
      } catch (error) {
        if (seq !== net.seq) return;
        net.busy = false;
        net.error = { message: errorText(error), want };
        drawRange();
        return;
      }
      if (seq !== net.seq) return;
      net.busy = false;
    }
    net.error = null;
    const teamChanged = want.team !== state.team;
    state.team = want.team; state.days = want.days; state.compare = want.compare;
    if (teamChanged) { $('team').value = String(state.team); shown = null; }
    render();
  }

  function placeKnob(btn) {
    const k = $('knob');
    k.style.left = '0';
    k.style.width = btn.offsetWidth + 'px';
    k.style.transform = `translateX(${btn.offsetLeft}px)`;
  }
  function knobNow() {
    const b = document.querySelector('.range button[aria-pressed="true"]');
    if (b) placeKnob(b);
  }

  function render() {
    const t = team();
    if (!periodsOf(t).includes(state.days)) state.days = lazy ? 30 : defaultPeriod(t.coverageDays);
    const { cur, prev } = windowRows();
    state.sel = null;
    // 기간·팀이 바뀌면 칸 번호의 뜻이 바뀐다 — 고른 날을 비우고 위에서 고른 날로 다시 시작한다.
    state.picked = null; state.anchor = null; state.focus = null;
    $('kick').textContent = `최근 ${state.days}일`;
    const hl = headline(cur, prev, state.days, subject);
    $('hl').innerHTML = hl.thin ? `${esc(hl.lead)} <span class="thin">${esc(hl.thin)}</span> ${esc(hl.rest)}` : esc(hl.lead);
    const h = healthOf(cur);
    $('idx').classList.toggle('is-empty', h == null);
    roll($('idx'), h);
    const dl = $('delta'), delta = deltaOf(cur, prev, state.days);
    dl.hidden = !delta;
    if (delta) { dl.className = `delta ${delta.dir}`; dl.textContent = delta.text; }
    drawRange();
    drawWeave(cur);

    const empty = isEmpty(cur);
    $('empty').hidden = !empty;
    $('filled').hidden = empty;
    if (!empty) {
      drawStory(cur, prev);
      const acts = actions(cur, prev);
      drawBrief(cur, prev, acts);
      drawActs(acts);
      drawSaved(cur);
      drawInbound(cur, prev);
      drawTemp(cur);
      drawRhythm(cur);
      drawThreadSection();
    }
    drawCompare();
  }

  function selectTeam(i) {
    if (!teams[i]) return;
    if (!lazy) {
      state.team = i;
      $('team').value = String(i);
      shown = null;
      render();
      return;
    }
    if (teams[i].status === 'error') teams[i].status = 'idle';
    request({ team: i });
  }

  $('range-note').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'compare') request({ compare: true });
    if (act === 'retry' && net.error) request(net.error.want);
  });

  /* ── 사건 ── */
  const weave = $('weave');
  /**
   * 위의 날짜 고르기. `commit`(누름·화살표)일 때만 「날짜별」의 고른 날을 **그 하루로 바꾼다** —
   * 커서가 지나가기만 해도(pointermove) 여러 날 고른 것이 지워지면 안 된다.
   */
  function pick(i, commit = false) {
    const rows = windowRows().cur;
    state.sel = Math.max(0, Math.min(rows.length - 1, i));
    placeCursor(rows);
    if (commit && state.view === 'dates') {
      state.picked = [state.sel]; state.anchor = state.sel; state.focus = state.sel;
      drawDates(rows);
    }
  }
  weave.addEventListener('pointermove', (e) => { const t = e.target.closest('.hit'); if (t) pick(Number(t.dataset.i)); });
  weave.addEventListener('click', (e) => { const t = e.target.closest('.hit'); if (t) pick(Number(t.dataset.i), true); });
  weave.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); pick(state.sel + (e.key === 'ArrowRight' ? 1 : -1), true); }
    if (e.key === 'Home') { e.preventDefault(); pick(0, true); }
    if (e.key === 'End') { e.preventDefault(); pick(1e9, true); }
  });

  $('th-view').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b || b.dataset.view === state.view) return;
    state.view = b.dataset.view === 'dates' ? 'dates' : 'flow';
    try { localStorage.setItem(VIEW_KEY, state.view); } catch { /* 저장이 막혀도 이번 화면에서는 바뀐다 */ }
    drawThreadSection();
  });

  const dates = $('dates');
  dates.addEventListener('click', (e) => {
    const cur = windowRows().cur;
    const cell = e.target.closest('.dc');
    if (cell) {
      const i = Number(cell.dataset.i);
      state.picked = pickDays(state.picked, i, { shift: e.shiftKey, anchor: state.anchor, n: cur.length });
      if (!e.shiftKey || state.anchor == null) state.anchor = i;
      state.focus = i;
      drawDates(cur);
      refocusDay(i);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear') { state.picked = []; state.anchor = null; drawDates(cur); refocusDay(state.focus ?? state.sel); }
    if (act === 'zero') { state.showZero = !state.showZero; drawDates(cur); dates.querySelector('[data-act="zero"]')?.focus(); }
  });
  dates.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.dc');
    if (!cell) return;
    const n = windowRows().cur.length, i = Number(cell.dataset.i);
    const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(n - 1, to));
    cell.tabIndex = -1;
    const next = dates.querySelector(`.dc[data-i="${j}"]`);
    if (next) { next.tabIndex = 0; next.focus(); }
    state.focus = j;
  });

  $('copy').addEventListener('click', async () => {
    const btn = $('copy');
    try {
      await navigator.clipboard.writeText(briefCopy);
      btn.textContent = '복사했어요';
    } catch {
      const r = document.createRange();
      r.selectNodeContents($('brief'));
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      btn.textContent = '선택했어요 — Ctrl+C';
    }
    setTimeout(() => { btn.textContent = '글로 복사'; }, 1800);
  });

  const sel = $('team');
  sel.innerHTML = teams.map((t, i) => `<option value="${i}">${esc(pairLabel(t))}</option>`).join('');
  sel.value = String(state.team); // 처음 고른 팀(`?team=`)을 선택 상자에도 보인다.
  sel.addEventListener('change', () => selectTeam(Number(sel.value)));

  $('theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    // 확장 페이지는 확장 설정(`sai.theme`)에 쓴다 — 사이드패널·설정 페이지와 같은 값이다.
    if (saveTheme) { saveTheme(root.dataset.theme); return; }
    try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch { /* 저장이 막혀도 이번 화면에서는 바뀐다 */ }
  });

  document.fonts?.ready.then(knobNow);
  let rz;
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    knobNow();
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      const s = state.sel;
      drawWeave(windowRows().cur);
      state.sel = s;
      placeCursor(windowRows().cur);
    }, 150);
  });

  render();

  // 「맡은 관계 나란히」의 다른 팀은 그 칸이 화면 가까이 올 때만 읽는다(확장 페이지).
  if (lazy && teams.some((t) => t.status === 'idle')) {
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { io.disconnect(); loadOthers(); }
      }, { rootMargin: '200px' });
      io.observe($('cmp'));
    } else {
      loadOthers();
    }
  }
}
