/**
 * Seam 대시보드 — **순수 계산만** 모은 모듈 (2026-10-25, 시안 「Seam」 이식).
 *
 * 🔴 DOM을 만지지 않는다. 화면(`app.js`)은 여기서 나온 숫자·문장을 그리기만 한다 —
 *    `test/seamModel.unit.test.js`가 이 파일만으로 집계·주별 흐름·할 일 규칙·문장을 잠근다.
 * 🔴 2026-10-26 사용자 결정 — 「앞 기간과 비교」는 뺐다. 기간(오늘까지 N일) 안의 흐름만 말한다.
 * 🔴 팀 단위 합계만 다룬다. 사람을 가리키는 값은 입력에도 출력에도 없다(Spec 필수 9 G1/G2).
 * 🔴 건강도 지수는 `healthIndex.js`의 `computeHealthMetrics` 하나로만 계산한다(100 − 마찰/다듬은 글).
 * 🔴 하루 단위로는 비율(%)을 보이지 않는다 — 신호 수가 메시지 수를 넘을 수 있다. 날마다는 건수로 말한다.
 */

import { computeHealthMetrics } from './healthIndex.js';
import { FRICTION_IDS, POSITIVE_IDS, CONTEXT_IDS } from './signals.js';

/** 시안 문구(사용자 승인). id·극성은 `signals.js`가 단일 출처다 — 여기에는 화면 문구만 있다. */
const SEAM_COPY = {
  misread: ['오해 소지 표현', '교정 전 원문에서 감지'],
  urgencyGap: ['긴급도가 실제와 다름', '완곡한 표현이 급함을 가림'],
  missing: ['기한·영향이 빠진 요청', '무엇을 언제까지인지 없이 나감'],
  venting: ['하소연으로 감지', '메시지 단위 집계'],
  forceOffHours: ['오프타임 강행 시도', '긴급도를 올려 예약 제한 우회'],
  clear: ['명확한 요청으로 교정', '오해 소지가 정리돼 나감'],
  schedule: ['예약 제안 수락', '오프타임 전송 대신 예약'],
  sensitiveBlocked: ['민감정보 전송을 막음', '보내기 전에 걸러냄'],
};
/** 시안의 표시 순서. 같은 건수일 때 「가장 큰 원인」이 이 순서로 정해진다. */
const SEAM_ORDER = ['misread', 'urgencyGap', 'missing', 'venting', 'forceOffHours', 'clear', 'schedule', 'sensitiveBlocked'];

export const EVENTS = SEAM_ORDER.map((id) => ({
  id,
  kind: FRICTION_IDS.includes(id) ? 'f' : 'p',
  label: SEAM_COPY[id][0],
  desc: SEAM_COPY[id][1],
}));
export const F = EVENTS.filter((e) => e.kind === 'f').map((e) => e.id);
export const P = EVENTS.filter((e) => e.kind === 'p').map((e) => e.id);
export const WD = ['일', '월', '화', '수', '목', '금', '토'];
/** 고를 수 있는 기간(오늘까지 N일). 2026-10-26 — 90일 추가, 비교는 뺐다. */
export const PERIODS = [14, 30, 60, 90];
/** 이보다 적게 다듬은 날은 한두 건으로 비율이 튀므로 「가장 벌어진 날」로 고르지 않는다. */
export const STEADY_MIN = 5;

const ALLOWED_KEYS = ['refined', ...FRICTION_IDS, ...POSITIVE_IDS, ...CONTEXT_IDS];

/* ── 작은 도구 ────────────────────────────────────────────────────────── */

/**
 * HTML 이스케이프. 🔴 팀 이름은 사용자가 지은 문자열이다 — 화면 조각을 문자열로 만들므로
 *    사용자 문자열은 반드시 이걸 거친다(React가 해 주던 일을 여기서 한다).
 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : 0;
}

/** 로컬 날짜 키 — 확장(`friction.js`)과 같은 규칙. */
export function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const sum = (rows, ids) => rows.reduce((s, d) => s + ids.reduce((t, k) => t + (d.c[k] || 0), 0), 0);

/** 기간 전체의 마찰 비율(마찰 신호 / 다듬은 글). 다듬은 글이 없으면 null. 1을 넘을 수 있다. */
export function ratio(rows) {
  const r = sum(rows, ['refined']);
  return r ? sum(rows, F) / r : null;
}

/** 건강도 지수 — `computeHealthMetrics`에 그대로 맡긴다. 표본이 없으면 null. */
export function healthOf(rows) {
  return computeHealthMetrics({ totalCount: sum(rows, ['refined']), frictionCount: sum(rows, F) }).healthIndex;
}

/** 0으로 나누지 않는 최댓값 — 막대 높이·너비의 분모. 빈 배열·NaN이어도 1 아래로 내려가지 않는다. */
export function safeMax(values) {
  let m = 1;
  for (const v of values) if (Number.isFinite(v) && v > m) m = v;
  return m;
}

/** 0~1로 자른 비율. 분모가 0·NaN이면 0. */
export function frac(n, d) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0;
  return Math.max(0, Math.min(1, n / d));
}

export const fmtD = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일`;
export const pct = (x) => `${(x * 100).toFixed(1)}%`;

/* ── 데이터 → 날짜 줄 ─────────────────────────────────────────────────── */

/**
 * 팀의 `byDate`(날짜 키 → 팀 합계)를 **오늘까지 이어진 날짜 줄**로 펼친다.
 * 🔴 없는 날짜는 0으로 둔다(`recorded: false`) — 문서가 없다는 것은 그날 기록된 신호가 없다는 뜻이다.
 * 🔴 허용 키·정수만 받는다 — Firestore 문서도 예시 데이터도 같은 방어를 지난다.
 */
export function buildRows(byDate, coverageDays, today = new Date()) {
  const rows = [];
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (let i = coverageDays - 1; i >= 0; i -= 1) {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    const key = dateKey(date);
    const src = byDate && typeof byDate === 'object' ? byDate[key] : null;
    const c = {};
    if (src && typeof src === 'object') for (const k of ALLOWED_KEYS) if (safeCount(src[k])) c[k] = safeCount(src[k]);
    rows.push({ date, key, wd: date.getDay(), c, recorded: !!src });
  }
  return rows;
}

/** 자료 범위 안에서 고를 수 있는 기간. 하나도 맞지 않으면 범위 전체 하나. */
export function periodOptions(coverageDays) {
  const ok = PERIODS.filter((p) => p <= coverageDays);
  return ok.length ? ok : [Math.max(2, coverageDays)];
}

/** 기본 기간 — 30일이 되면 30일, 아니면 고를 수 있는 가장 긴 것. */
export function defaultPeriod(coverageDays) {
  const opts = periodOptions(coverageDays);
  return opts.includes(30) ? 30 : opts[opts.length - 1];
}

/** 이번 기간 — 오늘까지 `days`일. 자료가 그보다 짧으면 있는 만큼. */
export function periodRows(rows, days) {
  return rows.slice(-days);
}

/** 이 기간에 기록된 숫자가 하나라도 있는가. */
export function isEmpty(rows) {
  return rows.every((d) => Object.values(d.c).every((v) => !v));
}

/**
 * 장부 막대 높이 — 제곱근 눈금, 0이 아니면 최소 3px(한두 건인 날도 보이게). 0이면 0.
 * 🔴 분모는 `safeMax`처럼 1 아래로 내려가지 않는다.
 */
export function laneHeight(count, max, laneH) {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const m = Number.isFinite(max) && max >= 1 ? max : 1;
  return Math.max(3, Math.sqrt(Math.min(1, count / m)) * Math.max(0, laneH));
}

/* ── 하루 단위 ────────────────────────────────────────────────────────── */

/** 그날 마찰 신호 / 다듬은 글, 1에서 자른다(벌어짐 폭에만 쓴다 — 화면에 %로 보이지 않는다). */
export function dailyGap(rows) {
  return rows.map((d) => (d.c.refined ? Math.min(1, sum([d], F) / d.c.refined) : 0));
}

/**
 * 가장 벌어진 날. 다듬은 글이 `STEADY_MIN`건 이상인 날만 본다.
 * 그런 날이 없으면 다듬은 글이 있는 날 중에서, 그것도 없으면 null.
 */
export function worstDay(rows) {
  const daily = dailyGap(rows);
  const pickMax = (ok) => {
    let best = -1;
    daily.forEach((v, i) => { if (ok(rows[i]) && (best < 0 || v > daily[best])) best = i; });
    return best;
  };
  const steady = pickMax((d) => d.c.refined >= STEADY_MIN);
  if (steady >= 0) return steady;
  const any = pickMax((d) => d.c.refined > 0);
  return any >= 0 ? any : null;
}

/** 그날 가장 많았던 마찰 신호. 하나도 없으면 null. */
export function topCause(day) {
  let best = null;
  for (const k of F) if ((day.c[k] || 0) > (best ? best[1] : 0)) best = [k, day.c[k]];
  return best ? { id: best[0], label: labelOf(best[0]), count: best[1] } : null;
}

export const labelOf = (id) => EVENTS.find((e) => e.id === id)?.label ?? id;

/* ── 문장 ─────────────────────────────────────────────────────────────── */

/**
 * 히어로 제목. `subject`는 「두 팀 사이」(예시) 또는 「팀과 동료들 사이」(실데이터).
 * 🔴 앞 기간과 비교하지 않는다 — 이 기간 안의 주별 흐름(`weeklyFlow`)만 말한다. 흐름을 말할 수 없으면 비율만.
 * @returns {{lead: string, thin: string|null, rest: string}} 화면은 thin만 얇게 그린다.
 */
export function headline(cur, days, subject) {
  const a = ratio(cur);
  if (a == null) return { lead: isEmpty(cur) ? '아직 쌓인 신호가 없어요' : '이 기간에는 다듬은 글이 없어요', thin: null, rest: '' };
  const { kind } = weeklyFlow(cur).verdict;
  if (kind === 'down') return { lead: `${subject}가`, thin: `지난 ${days}일 동안`, rest: '점점 촘촘해지고 있어요' };
  if (kind === 'up') return { lead: `${subject}가`, thin: `지난 ${days}일 동안`, rest: '조금씩 벌어지고 있어요' };
  if (kind === 'flat') return { lead: `${subject}가`, thin: `지난 ${days}일 동안`, rest: '고르게 이어지고 있어요' };
  return { lead: `${subject},`, thin: `지난 ${days}일 동안`, rest: `마찰 비율 ${pct(a)}` };
}

/** 히어로의 흐름 알약 — 주별로 오르거나 내릴 때만. 비슷하거나 말할 수 없으면 null. */
export function flowPill(cur) {
  const v = weeklyFlow(cur).verdict;
  if (v.kind !== 'down' && v.kind !== 'up') return null;
  return { dir: v.kind, text: `주별 마찰 비율 ${pct(v.from)} → ${pct(v.to)}` };
}

/** 마찰 신호를 많은 순으로. */
export function frictionRank(rows) {
  return F.map((k) => [k, sum(rows, [k])]).sort((x, y) => y[1] - x[1]);
}

/** 「이 기간의 이야기」 세 꼭지에 들어갈 숫자. */
export function storyFacts(cur) {
  const a = ratio(cur);
  const byF = frictionRank(cur);
  const fTot = sum(cur, F);
  const off = {};
  cur.forEach((d) => { if (d.c.forceOffHours) off[d.wd] = (off[d.wd] || 0) + d.c.forceOffHours; });
  const offTop = Object.entries(off).sort((x, y) => y[1] - x[1])[0] ?? null;
  return {
    a,
    flow: weeklyFlow(cur),
    top: { id: byF[0][0], label: labelOf(byF[0][0]), count: byF[0][1] },
    topShare: fTot ? byF[0][1] / fTot : 0,
    fTot,
    clr: sum(cur, ['clear']),
    mis: sum(cur, ['misread']),
    offTop: offTop ? { wd: Number(offTop[0]), count: offTop[1] } : null,
  };
}

/* ── 다음에 할 일: 데이터 위의 규칙, 근거와 함께 ─────────────────────── */

const ADVICE = {
  misread: ['자주 걸리는 표현을 팀 용어집에 넣어 보세요', '오해 소지로 잡힌 표현 중 반복되는 것을 「권장 표현」으로 등록하면 다음부터 교정이 같은 말로 맞춰져요.'],
  urgencyGap: ['요청할 때 긴급도와 기한을 첫 줄에 쓰기로 합의해 보세요', '완곡한 표현이 실제 급함을 가린 메시지가 많아요. 첫 줄 규칙 하나로 줄일 수 있어요.'],
  missing: ['요청 템플릿을 팀에 공유해 보세요', '「무엇을 · 언제까지 · 안 되면 어떤 영향」 세 줄 템플릿이 기한·영향 누락을 가장 빨리 줄여요.'],
  venting: ['회고나 1:1에서 부담을 직접 들어 보세요', '하소연으로 감지된 메시지가 늘었어요. 이 화면은 누가 썼는지 보여 주지 않아요 — 팀 전체에 열린 질문으로 시작하세요.'],
  forceOffHours: ['마감이 몰리는 요일의 일정을 하루 당겨 보세요', '오프타임 강행이 특정 요일에 몰려요. 그 요일 마감을 앞당기거나 예약 전송을 기본으로 안내하세요.'],
};

/**
 * 판정표 (시안 그대로 — 바꾸면 이 표와 테스트를 같이 바꾼다)
 * | 조건 | 할 일 | 점수 |
 * |---|---|---|
 * | 마찰 신호 k가 마찰의 30% 이상 | ADVICE[k] | 비중 |
 * | 뜻 풀기 5건 이상 & 의도 다름 25% 이상 | 상대 팀과 요청 형식 맞추기 (35% 이상이면 강조 표시) | 그 비율 |
 * | Critical이 긴급도 붙은 글의 14% 이상 | 「진짜 급한 것」 기준 정하기 | 비율 + 0.1 |
 * | 팀 용어집 적용이 다듬은 글의 20% 미만 | 용어집 채우기 | 0.2 − 비율 |
 * 🔴 다듬은 글이 하나도 없으면 아무 할 일도 내지 않는다 — 빈 팀에 「용어집을 채우세요」는 근거가 없다.
 * 최대 5개, 점수 순.
 * 🔴 2026-10-26 — 「앞 기간보다 1.3배」(늘고 있음) 줄은 비교를 빼면서 지웠다.
 */
export function actions(cur) {
  const ref = sum(cur, ['refined']);
  if (!ref) return [];
  const out = [];
  const fTot = sum(cur, F) || 1;
  F.forEach((k) => {
    const now = sum(cur, [k]);
    const share = now / fTot;
    if (now > 0 && share >= 0.3) {
      const why = `마찰의 ${Math.round(share * 100)}% · ${now}건`;
      let body = ADVICE[k][1];
      if (k === 'forceOffHours') {
        const by = WD.map(() => 0);
        cur.forEach((d) => { by[d.wd] += d.c.forceOffHours || 0; });
        const top = by.indexOf(Math.max(...by));
        body = `${WD[top]}요일에 ${by[top]}건이 몰렸어요. ` + body;
      }
      out.push({ id: k, score: share, hot: false, title: ADVICE[k][0], body, why, tag: labelOf(k) });
    }
  });
  const dec = sum(cur, ['decoded']), gapN = sum(cur, ['decodeUrgencyGap']);
  if (dec >= 5 && gapN / dec >= 0.25) {
    out.push({ id: 'inbound', score: gapN / dec, hot: gapN / dec >= 0.35, title: '상대 팀과 요청 형식을 맞춰 보자고 제안해 보세요', body: '받은 글의 실제 의도가 겉말과 다른 경우가 많아요. 상대 쪽에도 「긴급도·기한을 분명히」라는 같은 약속을 제안하면 양쪽이 같이 좋아져요.', why: `받은 글 ${dec}건 중 ${gapN}건(${Math.round((gapN / dec) * 100)}%)`, tag: '상대 쪽 글' });
  }
  const crit = sum(cur, ['urgencyCritical']);
  const urgAll = sum(cur, ['urgencyCritical', 'urgencyNormal', 'urgencyLow']);
  if (urgAll && crit / urgAll >= 0.14) {
    out.push({ id: 'critical', score: crit / urgAll + 0.1, hot: false, title: '「진짜 급한 것」의 기준을 팀이 함께 정해 보세요', body: 'Critical이 잦으면 정말 급한 글이 묻혀요. 기준(예: 고객 영향·오늘 안 배포 차단)을 한 줄로 합의하세요.', why: `다듬은 글의 ${Math.round((crit / urgAll) * 100)}%가 Critical`, tag: '긴급도' });
  }
  const gl = sum(cur, ['teamGlossaryApplied']);
  if (gl / ref < 0.2) {
    out.push({ id: 'glossary', score: 0.2 - gl / ref, hot: false, title: '팀 용어집에 자주 쓰는 말을 더 넣어 보세요', body: '팀 용어집이 일부 글에만 쓰였어요. 제품명·약어·정해진 번역부터 채우면 교정이 팀 말투로 맞춰져요.', why: `다듬은 글의 ${Math.round((gl / ref) * 100)}%에 적용`, tag: '용어집' });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 5);
}

/* ── 회의에 띄울 한 장 ────────────────────────────────────────────────── */

/** 화면과 복사용 글이 같은 문장을 쓴다. */
export function briefLines(cur, days) {
  const a = ratio(cur);
  const h = healthOf(cur);
  const byF = frictionRank(cur);
  const fTot = sum(cur, F);
  const dec = sum(cur, ['decoded']), gapN = sum(cur, ['decodeUrgencyGap']);
  const mis = sum(cur, ['misread']), clr = sum(cur, ['clear']);
  return [
    a == null ? '아직 쌓인 신호가 없어요.' : `협업 건강도 ${h.toFixed(1)} — 지난 ${days}일 마찰 비율 ${pct(a)}, ${flowSentence(weeklyFlow(cur))}.`,
    fTot
      ? `마찰의 ${Math.round((byF[0][1] / fTot) * 100)}%가 「${labelOf(byF[0][0])}」에서 나왔고, 오해 소지 ${mis}건 중 ${clr}건은 교정을 거쳐 정리됐어요.`
      : '이번 기간에는 마찰 신호가 없어요.',
    dec ? `상대 쪽에서 온 글 ${dec}건 중 ${Math.round((gapN / dec) * 100)}%는 겉말과 실제 의도가 달랐어요.` : '이번 기간에는 뜻 풀기로 연 글이 없어요.',
  ];
}

export function briefText({ pairLabel, days, lines, next }) {
  return `[${pairLabel} · 최근 ${days}일]\n` + lines.map((l, i) => `${i + 1}. ${l}`).join('\n') + (next ? `\n→ 이번 주에 하나만: ${next.title} (${next.why})` : '');
}

/* ── 기간의 흐름 — 주 단위 (2026-10-26 사용자 승인 판정표) ─────────────── */
/*
 * 🔴 판정표 (바꾸면 test/seamModel.unit.test.js 「주별 흐름」을 같이 바꾼다)
 * | 조건 | 결과 |
 * |---|---|
 * | 주는 월~일. 기간 처음·끝에 걸린 주는 그 안의 날만 | `days` < 7 → `full: false`(흐리게) |
 * | 7일을 다 못 채웠거나 다듬은 글 `FLOW_MIN_REFINED`(30)건 미만 | `used: false` — 흐리게, 문장 판정에서 뺌 |
 * | 판정에 쓸 수 있는 주가 `FLOW_MIN_WEEKS`(3)개 미만 | `thin` — 「아직 흐름을 말하기엔 일러요」 |
 * | 쓸 수 있는 주의 비율로 그은 직선 기울기 ≤ −`FLOW_STEP`(1)%p/주 | `down` — 낮아지는 흐름 (첫 주 → 끝 주, 직선 위의 값) |
 * | 기울기 ≥ +1%p/주 | `up` — 높아지는 흐름 |
 * | 그 밖 | `flat` — 비슷하게 이어짐 (쓸 수 있는 주 전체 비율) |
 * | 가장 높았던·낮았던 주 | 쓸 수 있는 주 안에서만. `thin`이면 null |
 */
export const FLOW_MIN_REFINED = 30;
export const FLOW_MIN_WEEKS = 3;
export const FLOW_STEP = 1;

/** 최소제곱 직선. 점이 하나뿐이면 기울기 0. */
function fitLine(pts) {
  const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  const den = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const k = den ? pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / den : 0;
  return { k, at: (x) => my + k * (x - mx) };
}

/** 이번 기간을 주(월~일)로 묶고 흐름을 판정한다. 비율은 0~1(1을 넘을 수 있다 — 신호 수가 글 수를 넘기도 한다). */
export function weeklyFlow(rows) {
  const groups = [];
  for (const d of rows) {
    const mon = new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate() - ((d.wd + 6) % 7)).getTime();
    const last = groups[groups.length - 1];
    if (last && last.mon === mon) last.rows.push(d); else groups.push({ mon, rows: [d] });
  }
  const weeks = groups.map((g, i) => {
    const refined = sum(g.rows, ['refined']), f = sum(g.rows, F), full = g.rows.length === 7;
    return {
      i, start: g.rows[0].date, end: g.rows[g.rows.length - 1].date, days: g.rows.length,
      refined, f, ratio: refined ? f / refined : null, full, used: full && refined >= FLOW_MIN_REFINED,
    };
  });
  const used = weeks.filter((w) => w.used);
  if (used.length < FLOW_MIN_WEEKS) return { weeks, used: used.length, verdict: { kind: 'thin' }, hi: null, lo: null };
  const line = fitLine(used.map((w) => ({ x: w.i, y: w.ratio })));
  const first = used[0], last = used[used.length - 1];
  const from = Math.max(0, line.at(first.i)), to = Math.max(0, line.at(last.i));
  const slope = line.k * 100;
  const kind = slope <= -FLOW_STEP ? 'down' : slope >= FLOW_STEP ? 'up' : 'flat';
  const avg = used.reduce((s, w) => s + w.f, 0) / used.reduce((s, w) => s + w.refined, 0);
  const byRatio = [...used].sort((x, y) => y.ratio - x.ratio || x.i - y.i);
  return {
    weeks, used: used.length,
    verdict: { kind, from, to, avg, slope, fromI: first.i, toI: last.i },
    hi: byRatio[0], lo: byRatio[byRatio.length - 1],
  };
}

/**
 * 주별 막대의 세로축 끝(0~1, 10% 단위로 올림). 🔴 흐름에 넣은 주로만 정한다 — 기간 끝에 걸린 이틀짜리 주가
 * 글 1~2건으로 500%가 나와도 축을 늘리지 않는다(2026-10-26 실브라우저에서 막대가 바닥에 붙었다). 넣은 주가 없으면 전부로.
 */
export function flowScaleTop(weeks) {
  const base = weeks.some((w) => w.used) ? weeks.filter((w) => w.used) : weeks;
  return Math.max(0.1, Math.ceil(Math.max(0, ...base.map((w) => w.ratio ?? 0)) * 10) / 10);
}

/** 흐름 판정을 한 문장으로 — 화면 「흐름」 꼭지와 회의용 한 장이 같은 말을 쓴다. */
export function flowSentence(flow) {
  const v = flow.verdict;
  if (v.kind === 'down') return `주별로 보면 낮아지는 흐름이에요 (${pct(v.from)} → ${pct(v.to)})`;
  if (v.kind === 'up') return `주별로 보면 높아지는 흐름이에요 (${pct(v.from)} → ${pct(v.to)})`;
  if (v.kind === 'flat') return `주별로 보면 비슷하게 이어지고 있어요 (약 ${pct(v.avg)})`;
  return '글이 적은 주가 많아 아직 흐름을 말하기엔 일러요';
}

/* ── 요일의 결 ────────────────────────────────────────────────────────── */

/** 요일별 다듬은 글·마찰 신호. `peak`은 다듬은 글이 있는 요일 중 마찰 비율이 가장 높은 요일(없으면 -1). */
export function weekdayFold(rows) {
  const by = WD.map(() => ({ r: 0, f: 0 }));
  rows.forEach((d) => { by[d.wd].r += d.c.refined || 0; by[d.wd].f += sum([d], F); });
  let peak = -1;
  by.forEach((b, i) => { if (b.r && (peak < 0 || b.f / b.r > by[peak].f / by[peak].r)) peak = i; });
  return { by, peak, maxR: safeMax(by.map((b) => b.r)) };
}

/* ── 신호 지도 — 신호 × 날짜 (2026-10-26 사용자 피드백으로 「흐름/날짜별」 두 보기를 하나로) ── */
/*
 * 🔴 입력은 나머지 Seam과 같은 `rows`(buildRows 결과의 이번 기간 조각)뿐이다 — 자료가 어디서
 *    왔는지(확장 페이지의 Firestore 읽기·예시) 가정하지 않는다. 칸 번호 `i`는 그 `rows` 안의 위치다.
 */

/** a..b(순서 무관) 사이의 모든 칸 번호. 자료 범위 `n` 밖은 자른다. */
export function rangeIndices(a, b, n = Infinity) {
  const lo = Math.max(0, Math.min(a, b)), hi = Math.min(n - 1, Math.max(a, b));
  const out = [];
  for (let i = lo; i <= hi; i += 1) out.push(i);
  return out;
}

/**
 * 날짜 고르기 한 번의 결과. 항상 오름차순·중복 없음·범위 안.
 * | 입력 | 결과 |
 * |---|---|
 * | 그냥 누름 | 그 날을 켜거나 끈다 |
 * | Shift + 누름, 기준 날(`anchor`) 있음 | 기준 날 ~ 누른 날을 **모두 켠다**(이미 고른 날은 그대로) |
 * | Shift + 누름, 기준 날 없음 | 그냥 누름과 같다 |
 * | 범위 밖 `i` | 아무것도 바꾸지 않는다 |
 */
export function pickDays(selected, i, { shift = false, anchor = null, n = Infinity } = {}) {
  const set = new Set((selected ?? []).filter((v) => Number.isInteger(v) && v >= 0 && v < n));
  if (Number.isInteger(i) && i >= 0 && i < n) {
    if (shift && Number.isInteger(anchor)) for (const k of rangeIndices(anchor, i, n)) set.add(k);
    else if (set.has(i)) set.delete(i);
    else set.add(i);
  }
  return [...set].sort((x, y) => x - y);
}

/** 고른 날만 — 범위 밖·중복 번호는 버리고 날짜 순으로. */
function pickedRows(rows, idx) {
  return [...new Set(idx ?? [])].filter((i) => Number.isInteger(i) && i >= 0 && i < rows.length).sort((x, y) => x - y).map((i) => rows[i]);
}

/** 「N일 선택 · 다듬은 글 A건 · 마찰 신호 B건 · 긍정 신호 C건」의 숫자. */
export function selectedSummary(rows, idx) {
  const picked = pickedRows(rows, idx);
  return { days: picked.length, refined: sum(picked, ['refined']), f: sum(picked, F), p: sum(picked, P) };
}

/**
 * 칸 색 단계(0~4). 0건은 0(중립), 나머지는 제곱근 눈금으로 1~4.
 * 🔴 분모는 그 줄(신호)의 기간 안 하루 최대 — 0·NaN이어도 1 아래로 내려가지 않는다.
 */
export function heatLevel(count, max) {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const m = Number.isFinite(max) && max >= 1 ? max : 1;
  return Math.max(1, Math.min(4, Math.ceil(Math.sqrt(Math.min(1, count / m)) * 4)));
}

/**
 * 신호 지도 한 장 — 줄은 신호(다듬은 글 + 마찰 무리 + 긍정 무리), 칸은 날.
 * | 값 | 뜻 |
 * |---|---|
 * | `vals`·`levels` | 날마다 건수와 색 단계(**그 줄의** 하루 최대 기준 — 드문 신호도 무늬가 보인다) |
 * | `tot` | 이번 기간 합계 |
 * | `sel` | 고른 날 합계. 고른 날이 없으면 null |
 */
export function signalMap(cur, picked = []) {
  const idx = [...new Set(picked ?? [])].filter((i) => Number.isInteger(i) && i >= 0 && i < cur.length).sort((x, y) => x - y);
  const hasSel = idx.length > 0;
  const line = (id) => {
    const vals = cur.map((d) => d.c[id] || 0);
    const max = safeMax(vals);
    const tot = vals.reduce((s, v) => s + v, 0);
    return {
      vals, max, levels: vals.map((v) => heatLevel(v, max)), tot,
      sel: hasSel ? idx.reduce((s, i) => s + vals[i], 0) : null,
    };
  };
  const groups = [['f', '마찰 신호'], ['p', '긍정 신호']].map(([kind, label]) => {
    const rows = EVENTS.filter((e) => e.kind === kind).map((e) => ({ id: e.id, label: e.label, desc: e.desc, ...line(e.id) }));
    const add = (k) => (rows.some((r) => r[k] == null) ? null : rows.reduce((s, r) => s + r[k], 0));
    return { kind, label, rows, tot: add('tot'), sel: add('sel') };
  });
  return {
    days: cur.map((d, i) => ({
      i, date: d.date, wd: d.wd, weekend: d.wd === 0 || d.wd === 6,
      monthStart: i === 0 || d.date.getDate() === 1, on: idx.includes(i),
    })),
    refined: { id: 'refined', label: '다듬은 글', ...line('refined') },
    groups,
    picked: idx,
    first: hasSel ? cur[idx[0]].date : null,
    last: hasSel ? cur[idx[idx.length - 1]].date : null,
  };
}

