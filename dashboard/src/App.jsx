import { useMemo, useState } from 'react';
import { computeHealthMetrics } from './healthIndex.js';
import { SCENARIOS } from './mockData.js';
// Spec §3 — 확장이 넘겨준 실제 팀 지표(있으면). 없으면 아래 목업으로 간다.
import {
  readLiveScenarios,
  sumRecentDays,
  POSITIVE_IDS,
  FRICTION_IDS,
  EVENT_LABEL,
} from './liveData.js';
import SaiMark from './SaiMark.jsx';
import Segmented from './Segmented.jsx';
import { useTheme } from './theme.js';

/**
 * S18 — 팀 대시보드 (Spec §3). 2026-10-25 디자인 A2로 다시 그렸다(`docs/design/DesignSystem-A2.md`).
 *
 * 화면이 답하는 질문 하나: 「두 쪽 사이의 마찰이 늘고 있나, 줄고 있나 — 어디서 생기나」.
 * - 히어로 = 「사이」 구도: 왼쪽·오른쪽에 두 쪽 이름, 가운데를 잇는 이음선(`--seam`) 위에 Health Index.
 * - 거울 막대 = 같은 이음선을 가운데 세로선으로 쓴다. 긍정 = `--kept`, 마찰 = `--check`.
 * 🔴 색은 뜻이다 — `--seam`은 로고와 이 이음선 두 곳에만. 장식 색을 쓰지 않는다.
 * 🔴 팀 단위 숫자만 그린다. 개인별 숫자 점수는 어디에도 없다(Spec 금지 2).
 * 🔴 이 페이지는 확장과 완전히 분리된 웹페이지다 — `chrome.*` API를 쓰지 않는다.
 * 🔴 데이터 출처(실제 지표 / 데모용 목업)를 화면에서 감추지 않는다(S33·S45에서 반복된 실패).
 */

/** 목업 시나리오의 두 쪽 이름 — 목업 데이터에는 팀 이름이 없어 데모 화면 문구로만 둔다. */
const DEMO_SIDES = { a: '프론트엔드팀', b: '백엔드팀' };

function fmt(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function ThemeIcon({ theme }) {
  // 지금 테마가 아니라 「누르면 바뀔 테마」를 보여 준다(소개 사이트와 같다).
  return theme === 'dark' ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [scenarioKey, setScenarioKey] = useState('week');
  const [view, setView] = useState('chart');

  /**
   * 🔴 **실데이터가 있으면 그것만 그린다.** 목업과 섞으면 어느 막대가 진짜인지 아무도 모른다.
   *    한 번만 읽는다 — 주소가 바뀌지 않는 한 다시 파싱할 이유가 없다.
   */
  const liveTeams = useMemo(() => readLiveScenarios(), []);
  const [teamIndex, setTeamIndex] = useState(0);
  const [rangeDays, setRangeDays] = useState(30);
  /** 🔴 신호 필터 — 기본은 **전부 켬**. 끄면 그 신호가 막대에서도 지수 계산에서도 빠진다. */
  const [hidden, setHidden] = useState(() => new Set());

  const baseLive = liveTeams[teamIndex] ?? liveTeams[0] ?? null;
  /**
   * 🔴 기간을 바꾸면 **날짜별 원자료에서 다시 합산한다**(2026-08-16). 합계 하나만 갖고 있으면
   *    「최근 7일」은 눌러도 아무 일이 없는 버튼이 된다 — S33에서 지운 것과 같은 실패다.
   */
  const live = useMemo(() => {
    if (!baseLive) return null;
    if (rangeDays === 30) return baseLive;
    const counts = sumRecentDays(baseLive.byDate, rangeDays);
    return {
      ...baseLive,
      label: `최근 ${rangeDays}일`,
      total: counts.refined ?? 0,
      positive: baseLive.positive.map((row) => ({ ...row, count: counts[row.id] ?? 0 })),
      friction: baseLive.friction.map((row) => ({ ...row, count: counts[row.id] ?? 0 })),
    };
  }, [baseLive, rangeDays]);

  const rawScenario = live ?? SCENARIOS[scenarioKey];
  // 🔴 끈 신호는 **집계에서도 빠진다** — 화면에서만 숨기면 지수가 화면과 어긋난다.
  const scenario = useMemo(
    () => ({
      ...rawScenario,
      positive: rawScenario.positive.filter((row) => !hidden.has(row.id)),
      friction: rawScenario.friction.filter((row) => !hidden.has(row.id)),
    }),
    [rawScenario, hidden],
  );

  const { positiveTotal, frictionTotal, positiveRows, frictionRows, allRows } = useMemo(() => {
    const posTotal = scenario.positive.reduce((sum, item) => sum + item.count, 0);
    const fricTotal = scenario.friction.reduce((sum, item) => sum + item.count, 0);
    // 🔴 하한 1 — 신호가 모두 0건인 기간이면 0 ÷ 0이 되어 막대 폭이 `NaN%`였다(추이 차트와 같은 규칙).
    const max = Math.max(1, ...scenario.positive.map((i) => i.count), ...scenario.friction.map((i) => i.count));
    // 🔴 최솟값 2%를 둔다(시안 원본 `Math.max(pct, 2)`) — 값이 아주 작아도 막대 자체가
    //    안 보이면 "0건인지 그냥 안 그려진 건지" 구분이 안 된다.
    const pct = (value) => Math.max((value / max) * 100, 2).toFixed(1);
    return {
      positiveTotal: posTotal,
      frictionTotal: fricTotal,
      positiveRows: scenario.positive.map((item) => ({ ...item, pct: pct(item.count) })),
      frictionRows: scenario.friction.map((item) => ({ ...item, pct: pct(item.count) })),
      allRows: [
        ...scenario.positive.map((item) => ({ ...item, kind: 'positive' })),
        ...scenario.friction.map((item) => ({ ...item, kind: 'friction' })),
      ],
    };
  }, [scenario]);

  /**
   * 🔴 분모는 **다듬은 메시지 총수**다 — 긍정 신호 합계가 아니다(2026-08-15, Spec §3 원문 공식).
   *    자세한 이유는 `healthIndex.js` 헤더 참고.
   */
  const totalRefined = scenario.total ?? 0;
  const { frictionRatio, healthIndex } = useMemo(
    () => computeHealthMetrics({ totalCount: totalRefined, frictionCount: frictionTotal }),
    [totalRefined, frictionTotal],
  );
  /** 🔴 `healthIndex`는 표본이 없으면 **null**이다 — 숫자 대신 「—」로 그 사실을 말한다. */
  const hasIndex = typeof healthIndex === 'number';

  /**
   * 바로 앞 같은 길이 기간과의 비교 — 실데이터일 때만(목업에는 날짜별 원자료가 없다).
   * 🔴 앞 기간에 다듬은 메시지가 없으면(확장이 그만큼 오래된 기록을 안 보냈으면) **비교를 그리지 않는다** —
   *    없는 기준과 비교한 화살표는 지어낸 추세다. 끈 신호는 여기서도 빠진다.
   */
  const previous = useMemo(() => {
    if (!baseLive || !hasIndex) return null;
    const both = sumRecentDays(baseLive.byDate, rangeDays * 2);
    const recent = sumRecentDays(baseLive.byDate, rangeDays);
    const prevTotal = (both.refined ?? 0) - (recent.refined ?? 0);
    const prevFriction = FRICTION_IDS.filter((id) => !hidden.has(id)).reduce(
      (sum, id) => sum + (both[id] ?? 0) - (recent[id] ?? 0),
      0,
    );
    const prev = computeHealthMetrics({ totalCount: prevTotal, frictionCount: prevFriction });
    if (typeof prev.healthIndex !== 'number') return null;
    return { ratioDelta: Math.round((frictionRatio - prev.frictionRatio) * 10) / 10 };
  }, [baseLive, rangeDays, hidden, hasIndex, frictionRatio]);

  const sideA = live ? live.teamName : DEMO_SIDES.a;
  const sideB = live ? '주고받은 동료들' : DEMO_SIDES.b;
  const periodLabel = live ? live.label : rawScenario.label;

  const periodOptions = live
    ? [7, 14, 30].map((days) => ({ id: days, label: `최근 ${days}일` }))
    : Object.entries(SCENARIOS).map(([key, s]) => ({ id: key, label: s.label }));
  const viewOptions = [
    { id: 'chart', label: '차트' },
    { id: 'table', label: '표' },
    // 🔴 실데이터일 때만 낸다 — 목업에는 날짜별 원자료가 없어 그릴 것이 없다.
    ...(live ? [{ id: 'trend', label: '추이' }] : []),
  ];

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <header className="nav">
        <div className="wrap nav-row">
          <span className="brand">
            <SaiMark size={30} title="" />
            <span>
              사이 <span className="brand-sub">Team Health</span>
            </span>
          </span>
          <span className="sp" />
          {/**
            * 🔴 팀이 둘 이상이면 **드롭다운**으로 전환한다 (2026-08-16). 이 페이지는 로그인이 없어
            *    스스로 다른 팀을 읽을 수 없으므로, 확장이 넘겨준 목록 안에서만 바꾼다.
            */}
          {liveTeams.length > 1 && (
            <select
              className="team-select"
              aria-label="팀 선택"
              value={teamIndex}
              onChange={(event) => setTeamIndex(Number(event.target.value))}
            >
              {liveTeams.map((item, index) => (
                <option key={item.teamId || index} value={index}>
                  {item.teamName}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="theme-t press"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '밝은 화면으로 바꾸기' : '어두운 화면으로 바꾸기'}
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>
      </header>

      <main id="main" className="wrap main">
        {/* 🔴 데이터 출처를 화면에서 절대 감추지 않는다. 실데이터일 때도 무엇을 보고 있는지 쓴다.
            🔴 **기간을 고정 문구로 쓰지 않는다** (2026-08-16) — 고른 기간과 배너가 서로 다른 말을 하면 안 된다. */}
        {live ? (
          <div className="strip" role="note">
            <span className="strip-dot strip-dot-live" aria-hidden="true" />
            <span>
              <b>{live.teamName}의 실제 지표 · {live.label}</b>
              <span className="strip-meta">팀원들의 사용 기록을 합한 수치예요. 사람별로는 나누지 않아요.</span>
            </span>
          </div>
        ) : (
          <div className="strip strip-demo" role="note">
            <span className="strip-dot" aria-hidden="true" />
            <span>
              <b>데모용 목업 데이터예요.</b>
              <span className="strip-meta">
                확장에서 팀에 들어간 뒤 「대시보드 열기」로 오면 우리 팀의 실제 지표가 보여요.
              </span>
            </span>
          </div>
        )}

        {/* 🔴 **빈 팀은 빈 팀으로 말한다** (2026-08-16). 0만 그려진 화면은 고장과 구분되지 않는다. */}
        {live?.empty && (
          <div className="strip strip-demo" role="status">
            <span className="strip-dot" aria-hidden="true" />
            <span>
              <b>{live.teamName}에는 아직 쌓인 지표가 없어요.</b>
              <span className="strip-meta">팀원이 사이로 메시지를 다듬으면 여기에 쌓여요.</span>
            </span>
          </div>
        )}

        <div className="title-row">
          <div>
            <p className="eyebrow">협업 건강도</p>
            <h1 className="title">두 쪽 사이, {periodLabel}</h1>
          </div>
          <Segmented
            className="period-seg"
            label="기간 선택"
            options={periodOptions}
            value={live ? rangeDays : scenarioKey}
            onChange={live ? setRangeDays : setScenarioKey}
          />
        </div>

        <section className="card hero" aria-label="Health Index">
          <div className="between">
            <div className="side side-a">
              <span className="side-k">{live ? '우리 팀' : '이쪽'}</span>
              <span className="side-name">{sideA}</span>
            </div>
            <div className="seam" key={`${teamIndex}-${periodLabel}`}>
              <span className="seam-line seam-line-a" aria-hidden="true" />
              <span className={`index index-num num${hasIndex ? '' : ' is-empty'}`}>{hasIndex ? fmt(healthIndex) : '—'}</span>
              <span className="seam-line seam-line-b" aria-hidden="true" />
            </div>
            <p className="index-label">Health Index · 100에 가까울수록 마찰이 적어요</p>
            <div className="side side-b">
              <span className="side-k">{live ? '상대 쪽' : '저쪽'}</span>
              <span className="side-name">{sideB}</span>
            </div>
          </div>

          <p className="read">
            {hasIndex ? (
              <>
                다듬은 메시지 <b className="num">{totalRefined}건</b> 중 마찰 신호가{' '}
                <b className="num">{frictionTotal}건</b> 나왔어요.
                {previous && (
                  <span className={`delta ${previous.ratioDelta > 0 ? 'delta-up' : previous.ratioDelta < 0 ? 'delta-down' : ''}`}>
                    {previous.ratioDelta === 0
                      ? ` 바로 앞 ${rangeDays}일과 마찰 비율이 같아요.`
                      : ` 바로 앞 ${rangeDays}일보다 마찰 비율이 ${fmt(Math.abs(previous.ratioDelta))}%p ${
                          previous.ratioDelta > 0 ? '늘었어요' : '줄었어요'
                        }.`}
                  </span>
                )}
              </>
            ) : (
              '이 기간에는 다듬은 메시지가 없어 지수를 계산하지 않아요.'
            )}
          </p>

          <div className="quiet">
            <p className="formula">Health Index = 100 − (마찰 ÷ 다듬은 메시지) × 100</p>
            <dl className="stats">
              <div>
                <dt>마찰 비율</dt>
                {/* 🔴 표본이 없으면 비율도 없다 — 0%로 쓰면 "마찰이 없었다"는 뜻이 되어 버린다. */}
                <dd className="num tone-check">{hasIndex ? `${fmt(frictionRatio)}%` : '—'}</dd>
              </div>
              <div>
                {/* 🔴 분모를 화면에 보여준다 — 공식에 쓰이는 수를 숨기면 지수를 검증할 수 없다. */}
                <dt>다듬은 메시지</dt>
                <dd className="num">{totalRefined}건</dd>
              </div>
              <div>
                <dt>긍정 신호</dt>
                <dd className="num tone-kept">{positiveTotal}건</dd>
              </div>
              <div>
                <dt>마찰 신호</dt>
                <dd className="num tone-check">{frictionTotal}건</dd>
              </div>
            </dl>
            <p className="note">팀 단위로만 합쳐요. 누가 보냈는지, 이름이나 계정은 나오지 않아요.</p>
          </div>
        </section>

        <section className="card signals" aria-labelledby="signals-title">
          <div className="chart-head">
            <div>
              <h2 id="signals-title" className="h2">
                어디서 생기나요
              </h2>
              <p className="chart-sub">
                가운데 선을 기준으로 <span className="key key-friction">왼쪽은 마찰 신호</span>,{' '}
                <span className="key key-positive">오른쪽은 긍정 신호</span>예요.
              </p>
            </div>
            <Segmented
              className="view-seg"
              label="차트 또는 표로 보기"
              options={viewOptions}
              value={view === 'trend' && !live ? 'chart' : view}
              onChange={setView}
            />
          </div>

          {/**
            * 🔴 **신호 필터** (2026-08-16) — 실데이터일 때만. 끄면 막대에서만이 아니라 **지수 계산에서도** 빠진다.
            * 🔴 긍정과 마찰을 줄로 나누고, 색만으로 구분하지 않게 줄마다 **글자 라벨**을 둔다.
            */}
          {live && (
            <div className="filters">
              {[
                { key: 'positive', label: '긍정 신호', rows: rawScenario.positive },
                { key: 'friction', label: '마찰 신호', rows: rawScenario.friction },
              ].map((group) => (
                <div className="filter-row" key={group.key} role="group" aria-label={`${group.label} 켜고 끄기`}>
                  <span className={`filter-label key key-${group.key}`}>{group.label}</span>
                  {group.rows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      aria-pressed={!hidden.has(row.id)}
                      className={`chip press chip-${group.key}`}
                      onClick={() =>
                        setHidden((current) => {
                          const next = new Set(current);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                    >
                      <span className="chip-dot" aria-hidden="true" />
                      {row.label}
                    </button>
                  ))}
                </div>
              ))}
              {/* 🔴 끄면 지수에서도 빠진다는 사실을 화면이 말해야 한다 — 숨기기와 제외는 다르다. */}
              <p className="filter-note">끈 신호는 차트뿐 아니라 건강도와 비율 계산에서도 빠져요.</p>
            </div>
          )}

          {view === 'trend' && live ? (
            <TrendChart byDate={live.byDate} days={rangeDays} hidden={hidden} />
          ) : view === 'table' ? (
            <DivergingTable rows={allRows} />
          ) : (
            <MirrorChart positiveRows={positiveRows} frictionRows={frictionRows} />
          )}
        </section>
      </main>

      <footer className="foot">
        <div className="wrap foot-row">
          <p className="foot-zero">
            <span className="foot-dot" aria-hidden="true" />
            Zero Retention — 메시지 본문은 저장하지 않아요. 여기 보이는 수치는 팀 단위 합계예요.
          </p>
          <p className="foot-copy">© 사이(Sai) · Team Health</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * 거울(mirror) 막대 — 가운데 세로 이음선을 기준으로 마찰 신호는 왼쪽, 긍정 신호는 오른쪽으로 자란다.
 * 라벨은 항상 **바깥쪽**에 붙는다(막대 길이와 무관하게 읽을 수 있는 자리). 좁은 화면에서는 라벨이
 * 자기 막대 위로 올라간다(dashboard.css).
 */
function MirrorChart({ positiveRows, frictionRows }) {
  return (
    <div className="dv-wrap">
      <div className="dv-centerline" aria-hidden="true" />
      <div className="dv-group">
        {positiveRows.map((row) => (
          <div className="dv-row dv-row-positive" key={row.id}>
            <div className="dv-label-col">
              <div className="dv-item-label">{row.label}</div>
              <div className="dv-item-desc">{row.desc}</div>
            </div>
            <div className="dv-bar-col">
              <div className="dv-bar dv-bar-positive" style={{ width: `${row.pct}%` }} />
              <span className="dv-value tone-kept num">{row.count}건</span>
            </div>
          </div>
        ))}
      </div>
      <div className="dv-divider" />
      <div className="dv-group">
        {frictionRows.map((row) => (
          <div className="dv-row dv-row-friction" key={row.id}>
            <div className="dv-bar-col">
              <span className="dv-value tone-check num">{row.count}건</span>
              <div className="dv-bar dv-bar-friction" style={{ width: `${row.pct}%` }} />
            </div>
            <div className="dv-label-col">
              <div className="dv-item-label">{row.label}</div>
              <div className="dv-item-desc">{row.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 접근성 대비 — 같은 데이터의 표 형태(dataviz 스킬: table view exists). */
function DivergingTable({ rows }) {
  return (
    <div className="dv-table-wrap">
      <table className="dv-table">
        <thead>
          <tr>
            <th scope="col">구분</th>
            <th scope="col">항목</th>
            <th scope="col" className="dv-table-desc">
              설명
            </th>
            <th scope="col" className="dv-table-count">
              건수
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <span className={`badge badge-${row.kind}`}>{row.kind === 'positive' ? '긍정' : '마찰'}</span>
              </td>
              <td className="dv-table-label">{row.label}</td>
              <td className="dv-table-desc">{row.desc}</td>
              <td className={`dv-table-count num ${row.kind === 'positive' ? 'tone-kept' : 'tone-check'}`}>
                {row.count}건
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 날짜별 추이 (2026-08-16 사용자 제안 ⑧).
 *
 * 🔴 **기간을 고르게 해 놓고 합계만 보여주면 기간이 무슨 의미인지 알 수 없다.** 「최근 7일」과
 *    「최근 30일」의 차이는 총량이 아니라 **언제 몰렸는가**다 — 그건 날짜축에서만 보인다.
 * 🔴 **끈 신호는 여기서도 빠진다** — 막대 차트와 같은 필터를 쓴다(화면마다 다르면 어느 쪽이
 *    진짜인지 알 수 없다).
 * 🔴 라이브러리를 쓰지 않는다 — 확장·호스팅 모두 외부 스크립트를 싣지 않는 것이 이 프로젝트의
 *    기본이고, 막대 몇 개는 CSS로 충분하다.
 */
function TrendChart({ byDate, days, hidden }) {
  const columns = [];
  const today = new Date();
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const counts = byDate?.[key] ?? {};
    const shown = (ids) => ids.filter((id) => !hidden.has(id));
    const pick = (ids) => shown(ids).reduce((sum, id) => sum + (counts[id] ?? 0), 0);
    /**
     * 🔴 **막대 위에 올리면 어느 신호가 몇 건인지 말한다** (2026-08-16 사용자 요청 ③).
     *    합계 두 개만 보이면 "8/16에 마찰이 22건"까지는 알아도 **무엇 때문인지는 모른다** —
     *    그걸 알려면 필터를 하나씩 꺼 보는 수밖에 없었다. 0건인 신호는 넣지 않는다(잡음).
     */
    const breakdown = (ids) =>
      shown(ids)
        .map((id) => ({ id, label: EVENT_LABEL[id] ?? id, count: counts[id] ?? 0 }))
        .filter((row) => row.count > 0);
    columns.push({
      key,
      label: `${day.getMonth() + 1}/${day.getDate()}`,
      // 🔴 손으로 적지 않는다 — 목록은 `liveData.js`가 단독으로 갖는다(⑦ 재발 방지).
      positive: pick(POSITIVE_IDS),
      friction: pick(FRICTION_IDS),
      positiveRows: breakdown(POSITIVE_IDS),
      frictionRows: breakdown(FRICTION_IDS),
    });
  }

  const max = Math.max(1, ...columns.map((c) => Math.max(c.positive, c.friction)));
  // 🔴 눈금이 촘촘하면 30일에서 글자가 겹친다 — 날짜 라벨은 일정 간격으로만 그린다.
  const labelEvery = days > 14 ? 5 : days > 7 ? 2 : 1;

  return (
    <div className="dash-trend">
      <div className="dash-trend-plot">
        {columns.map((column, index) => (
          <div key={column.key} className="dash-trend-col" tabIndex={0}>
            <div className="dash-trend-bars">
              <span
                className="dash-trend-bar dash-trend-bar-positive"
                style={{ height: `${(column.positive / max) * 100}%` }}
              />
              <span
                className="dash-trend-bar dash-trend-bar-friction"
                style={{ height: `${(column.friction / max) * 100}%` }}
              />
            </div>
            {/* 🔴 마우스가 유일한 경로가 되지 않게 `tabIndex`로 키보드 포커스에서도 열린다. */}
            <div className="dash-trend-tip" role="tooltip">
              <b>{column.label}</b>
              {column.positiveRows.length === 0 && column.frictionRows.length === 0 ? (
                <div className="dash-trend-tip-none">이 날은 기록이 없어요</div>
              ) : (
                <>
                  {column.frictionRows.map((row) => (
                    <div key={row.id} className="dash-trend-tip-row">
                      <span className="dash-swatch dash-swatch-friction" />
                      {row.label} <b>{row.count}건</b>
                    </div>
                  ))}
                  {column.positiveRows.map((row) => (
                    <div key={row.id} className="dash-trend-tip-row">
                      <span className="dash-swatch dash-swatch-positive" />
                      {row.label} <b>{row.count}건</b>
                    </div>
                  ))}
                </>
              )}
            </div>
            <span className="dash-trend-label">
              {index % labelEvery === 0 ? column.label : ''}
            </span>
          </div>
        ))}
      </div>
      {/**
        * 🔴 최댓값을 밝힌다 — 막대 높이만 보고 절대량을 짐작하지 못한다.
        * 🔴 **왜 8개가 아니라 2개인가** (2026-08-16 사용자 질문 ⑥). 30일 × 8신호를 이 폭에
        *    겹쳐 그리면 어느 막대가 무엇인지 읽을 수 없다. 대신 **위 필터로 하나만 켜면 그
        *    신호 하나의 추이**가 되므로, 개별 추이를 못 보는 것이 아니라 **골라서 본다.**
        *    그 사용법을 화면이 직접 말해 준다 — 안 쓰면 없는 기능과 같다.
        */}
      <p className="dash-trend-note">
        세로 최대 {max}건 · 왼쪽이 과거, 오른쪽이 오늘이에요. 켜 둔 신호만 합산하니,{' '}
        <b>위에서 신호 하나만 켜면 그 신호의 추이</b>가 돼요.
      </p>
    </div>
  );
}
