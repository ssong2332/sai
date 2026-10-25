/**
 * Seam 화면 그리기 — 시안(`seam/template.html`)의 렌더링을 그대로 옮겼다.
 *
 * 🔴 숫자·문장은 전부 `model.js`(순수 함수)에서 받는다. 여기는 SVG·HTML 조각을 만들고 사건을 잇는다.
 * 🔴 팀 이름 같은 바깥 문자열은 `esc()`를 거친다 — 주소창에서 온 값을 HTML로 해석하지 않는다.
 */

import {
  EVENTS, F, P, WD, STEADY_MIN,
  sum, ratio, healthOf, safeMax, frac, fmtD, pct, esc,
  splitWindow, periodOptions, defaultPeriod, isEmpty,
  dailyGap, worstDay, topCause, headline, deltaOf, storyFacts,
  actions, briefLines, briefText, weekdayFold, threadRows,
} from './model.js';

const THEME_KEY = 'sai-dashboard-theme';
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
 * @param {Array<{a: string, b: string, rows: object[], coverageDays: number}>} teams
 * @param {{demo: boolean}} opts
 */
export function mount(teams, { demo }) {
  const subject = demo ? '두 팀 사이' : '팀과 동료들 사이';
  const state = { team: 0, days: defaultPeriod(teams[0].coverageDays), sel: null };
  let briefCopy = '';
  let shown = null;

  const team = () => teams[state.team];
  const pairLabel = (t) => `${t.a} ↔ ${t.b}`;
  const windowRows = () => splitWindow(team().rows, state.days);

  $('demo').hidden = !demo;
  $('foot-src').textContent = demo ? '사이 Team Health · 예시 데이터' : '사이 Team Health · 확장에서 넘겨받은 팀 합계';

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
    const LED = narrow ? 64 : 84, H = (narrow ? 250 : 300) + LED, L = narrow ? 8 : 96, R = narrow ? 8 : 24;
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

    const base = H - 30 - LED / 2, half = LED / 2 - 6;
    const fC = rows.map((d) => sum([d], F)), pC = rows.map((d) => sum([d], P));
    const cMax = safeMax([...fC, ...pC]), bw = Math.max(2, Math.min(10, step * 0.46));
    let marks = `<line class="ledger-base" x1="${L}" y1="${base}" x2="${W - R}" y2="${base}"/>`;
    rows.forEach((d, i) => {
      const fh = Math.sqrt(fC[i] / cMax) * half, ph = Math.sqrt(pC[i] / cMax) * half; // 제곱근 — 한두 건인 날도 보이게
      if (fC[i]) marks += `<rect class="snagmark" data-i="${i}" x="${(x(i) - bw / 2).toFixed(1)}" y="${(base - 1 - fh).toFixed(1)}" width="${bw.toFixed(1)}" height="${fh.toFixed(1)}" rx="${(bw / 2).toFixed(1)}"/>`;
      if (pC[i]) marks += `<rect class="stitchmark" data-i="${i}" x="${(x(i) - bw / 2).toFixed(1)}" y="${(base + 1).toFixed(1)}" width="${bw.toFixed(1)}" height="${ph.toFixed(1)}" rx="${(bw / 2).toFixed(1)}"/>`;
    });
    marks += `<text class="ledger-k" x="${W - R}" y="${base - half - 4}" text-anchor="end">마찰 신호 ↑</text><text class="ledger-k" x="${W - R}" y="${base + half + 12}" text-anchor="end">긍정 신호 ↓</text>`;

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
      callout = `<g class="callout"><line x1="${wx}" y1="${wy - 6}" x2="${wx}" y2="22"/><text x="${wx + (flip ? -8 : 8)}" y="26" text-anchor="${flip ? 'end' : 'start'}">가장 벌어진 날 · ${fmtD(wd.date)} (${WD[wd.wd]})</text><text class="sub" x="${wx + (flip ? -8 : 8)}" y="42" text-anchor="${flip ? 'end' : 'start'}">다듬은 글 ${wd.c.refined}건에서 마찰 신호 ${wdF}건${narrow || !cause ? '' : ` · ${cause.label} ${cause.count}건이 가장 많았어요`}${steadyNote}</text></g>`;
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
      <g class="marks">${marks}</g>
      <path class="strand a" d="${pTop}"/>
      <path class="strand b" d="${pBot}"/>
      ${narrow ? '' : `<text class="team-label a" x="${L - 12}" y="${mid - gap[0] / 2 - 2}" text-anchor="end">${esc(t.a)}</text>
      <text class="team-label b" x="${L - 12}" y="${mid + gap[0] / 2 + 12}" text-anchor="end">${esc(t.b)}</text>`}
      ${callout}
      <g id="cursor"></g>
      <g id="hits">${rows.map((_, i) => `<rect class="hit" data-i="${i}" x="${(x(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H - 30}"/>`).join('')}</g>`;
    svg.querySelectorAll('.strand').forEach((p) => p.style.setProperty('--len', Math.ceil(p.getTotalLength())));
    svg.classList.remove('drawn'); void svg.getBBox(); svg.classList.add('drawn');
    svg._geo = { x, mid, gap, H };
    svg.tabIndex = 0;
    svg.setAttribute('aria-label', '날짜 선택 — 왼쪽·오른쪽 화살표로 날짜를 옮겨요');
    placeCursor(rows);
  }

  function placeCursor(rows) {
    const svg = $('weave'), g = svg._geo, i = state.sel;
    svg.querySelector('#cursor').innerHTML = `<line class="cursor" x1="${g.x(i)}" y1="12" x2="${g.x(i)}" y2="${g.H - 30}"/><circle class="cursor-dot" cx="${g.x(i)}" cy="${g.mid - g.gap[i] / 2}" r="4.5"/><circle class="cursor-dot" cx="${g.x(i)}" cy="${g.mid + g.gap[i] / 2}" r="4.5"/>`;
    const d = rows[i], fN = sum([d], F), pN = sum([d], P), ref = d.c.refined || 0;
    const chips = EVENTS.map((e) => `<span class="chip ${e.kind === 'f' ? 'snag' : 'stitch'}${d.c[e.id] ? '' : ' zero'}"><b class="num">${d.c[e.id] || 0}</b>${e.label}</span>`).join('');
    $('day').innerHTML = `<div class="day-date num">${fmtD(d.date)}<small>${WD[d.wd]}요일 · 다듬은 메시지 ${ref}건</small></div>
      <div><div class="chips">${chips}</div></div>
      <div class="day-note">${ref === 0 ? '이날은 다듬은 메시지가 없어요.' : `다듬은 글 ${ref}건에서 마찰 신호 ${fN}건 · 긍정 신호 ${pN}건${fN > ref ? ' — 한 글에서 신호가 여러 개 잡히기도 해요' : ''}${ref < STEADY_MIN ? ' · 글이 적은 날이라 흐름 판단에는 덜 반영했어요' : ''}`}</div>`;
    const { cur, prev } = windowRows();
    drawThreads(cur, prev);
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
    $('threads').innerHTML = threadRows(cur, prev).map((e) => {
      const bars = e.vals.map((v, i) => {
        if (!v) return '';
        const bh = Math.max(3, (v / e.max) * (h - 6));
        return `<rect class="${i === sel ? 'hl' : e.kind === 'f' ? 's' : 'p'}" x="${(i * bw + bw * 0.18).toFixed(1)}" y="${(h - 2 - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}"/>`;
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
      const { cur, prev } = splitWindow(t.rows, Math.min(state.days, t.rows.length));
      const a = ratio(cur), b = prev.length ? ratio(prev) : null, h = healthOf(cur);
      const daily = dailyGap(cur);
      const W = 300, H = 64, mid = 32, n = cur.length, x = (k) => 4 + (k * (W - 8)) / Math.max(1, n - 1);
      const g = daily.map((v) => 3 + Math.sqrt(Math.min(1, v / 0.6)) * 26);
      const top = path(daily.map((_, k) => [x(k), mid - g[k] / 2])), bot = path(daily.map((_, k) => [x(k), mid + g[k] / 2]));
      const area = top + ' ' + path(daily.map((_, k) => [x(k), mid + g[k] / 2]).reverse()).replace(/^M/, 'L') + ' Z';
      const diff = a != null && b != null ? (a - b) * 100 : null;
      return `<button type="button" class="cm" data-i="${i}" aria-current="${i === state.team}"><span class="cm-h"><b>${esc(t.a)}</b> ↔ ${esc(t.b)}</span><span class="cm-n num">${h == null ? '—' : h.toFixed(1)}</span>
        <span class="cm-d ${diff == null ? '' : diff > 0 ? 'up' : 'down'}">${a == null ? '아직 쌓인 신호가 없어요' : diff == null ? '비교할 앞 기간 없음' : `마찰 비율 ${Math.abs(diff).toFixed(1)}%p ${diff > 0 ? '늘었어요' : '줄었어요'}`}</span>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="g" d="${area}"/><path class="a" d="${top}"/><path class="b" d="${bot}"/></svg></button>`;
    }).join('');
    $('cmp').querySelectorAll('.cm').forEach((btn) => btn.addEventListener('click', () => {
      selectTeam(Number(btn.dataset.i));
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    }));
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
    const opts = periodOptions(t.coverageDays);
    const wrap = $('range');
    wrap.querySelectorAll('button').forEach((b) => b.remove());
    opts.forEach((d) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.days = String(d);
      btn.textContent = `${d}일`;
      btn.setAttribute('aria-pressed', String(d === state.days));
      btn.addEventListener('click', () => { state.days = d; render(); });
      wrap.appendChild(btn);
    });
    // 🔴 앞 기간이 자료 범위 밖이면 비교를 만들지 않는다 — 그 이유를 숨기지 않는다.
    const note = $('range-note');
    const noPrev = t.coverageDays < state.days * 2;
    note.hidden = !noPrev;
    if (noPrev) note.textContent = `확장이 최근 ${t.coverageDays}일 자료만 보내서, 이 기간은 앞 기간과 비교하지 않아요.`;
    knobNow();
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
    if (!periodOptions(t.coverageDays).includes(state.days)) state.days = defaultPeriod(t.coverageDays);
    const { cur, prev } = windowRows();
    state.sel = null;
    $('kick').textContent = `최근 ${state.days}일`;
    const hl = headline(cur, prev, state.days, subject);
    $('hl').innerHTML = hl.thin ? `${esc(hl.lead)} <span class="thin">${esc(hl.thin)}</span> ${esc(hl.rest)}` : esc(hl.lead);
    roll($('idx'), healthOf(cur));
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
    }
    drawCompare();
  }

  function selectTeam(i) {
    state.team = i;
    $('team').value = String(i);
    shown = null;
    render();
  }

  /* ── 사건 ── */
  const weave = $('weave');
  function pick(i) {
    const rows = windowRows().cur;
    state.sel = Math.max(0, Math.min(rows.length - 1, i));
    placeCursor(rows);
  }
  weave.addEventListener('pointermove', (e) => { const t = e.target.closest('.hit'); if (t) pick(Number(t.dataset.i)); });
  weave.addEventListener('click', (e) => { const t = e.target.closest('.hit'); if (t) pick(Number(t.dataset.i)); });
  weave.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); pick(state.sel + (e.key === 'ArrowRight' ? 1 : -1)); }
    if (e.key === 'Home') { e.preventDefault(); pick(0); }
    if (e.key === 'End') { e.preventDefault(); pick(1e9); }
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
  sel.addEventListener('change', () => selectTeam(Number(sel.value)));

  $('theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
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
}
