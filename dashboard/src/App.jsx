import { useEffect, useMemo, useState } from 'react';
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
// 🔴 확장·사이드패널과 같은 로고를 그대로 재사용한다(2026-08-13 사용자 요청 — "우리 프로젝트의
//    결에 맞게"). 시안 원본의 "사" 텍스트 배지는 이 대시보드만의 임시 표기였다.
import SaiMark from '../../src/assets/SaiMark.jsx';

/**
 * S18 — B2B 웹 대시보드 (Spec §3, F-10/F-26 통합).
 * 🔴 2026-08-13 — 클로드 디자인 시안(`Sai Dashboard.dc.html`, 프로젝트
 *    `7c6cc53a-a6ef-4935-b31d-ff63566bdedb`)을 그대로 이식했다. `.dc.html`은 이 프로젝트가 쓰는
 *    빌드 도구(Vite+React)와 다른 자체 런타임(`support.js`, `<x-dc>`)을 쓰므로 그 파일 자체를
 *    옮겨 심지 않고 **같은 결과가 나오도록 React로 새로 짰다** — 레이아웃·수치·인터랙션은
 *    시안과 동일하게 맞췄다.
 *
 * 🔴 이 페이지는 확장과 완전히 분리된 별도 웹페이지다 — `chrome.*` API를 쓰지 않고, 테마는
 *    `localStorage`(이 오리진 전용)로 따로 관리한다.
 * 🔴 v1은 목업 데이터다(Spec §3) — 화면 상단에 그 사실을 숨기지 않고 명시한다.
 * 🔴 발표에서 EU 시장을 전제로 말하지 않는다(Lessons #7) — 이 화면 어디에도 지역 단정 문구가
 *    없다.
 */
export default function App() {
  const [theme, setTheme] = useState('light');
  const [scenarioKey, setScenarioKey] = useState('week');
  const [view, setView] = useState('chart');

  useEffect(() => {
    const stored = localStorage.getItem('sai-dashboard-theme');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    setTheme(stored ?? (prefersDark ? 'dark' : 'light'));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('sai-dashboard-theme', next);
  };

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

  const { positiveTotal, frictionTotal, maxAbs, positiveRows, frictionRows, allRows } = useMemo(() => {
    const posTotal = scenario.positive.reduce((sum, item) => sum + item.count, 0);
    const fricTotal = scenario.friction.reduce((sum, item) => sum + item.count, 0);
    const max = Math.max(...scenario.positive.map((i) => i.count), ...scenario.friction.map((i) => i.count));
    // 🔴 최솟값 2%를 둔다(시안 원본 `Math.max(pct, 2)`) — 값이 아주 작아도 막대 자체가
    //    안 보이면 "0건인지 그냥 안 그려진 건지" 구분이 안 된다.
    const pct = (value) => Math.max((value / max) * 100, 2).toFixed(1);
    return {
      positiveTotal: posTotal,
      frictionTotal: fricTotal,
      maxAbs: max,
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

  /**
   * 🔴 `healthIndex`는 표본이 없으면 **null**이다(`healthIndex.js`). 그대로 CSS에 넣으면
   *    `conic-gradient(... null% ...)`가 되어 게이지가 통째로 사라진다 — 값이 없다는 사실을
   *    화면이 말하게 하고, 게이지는 빈 링으로 그린다.
   */
  const hasIndex = typeof healthIndex === 'number';
  const gaugeStyle = {
    background: hasIndex
      ? `conic-gradient(var(--g-bar) 0 ${healthIndex}%, var(--o-tint) ${healthIndex}% 100%)`
      : 'var(--o-tint)',
  };

  return (
    <div className="dash-shell">
      <header className="dash-header">
        <SaiMark size={30} className="dash-brand-mark" />
        <span className="dash-brand-name">사이 Team Health</span>
        {/* 🔴 실데이터면 실제 팀 이름, 아니면 예시임을 배너와 함께 명시한다. */}
        {/**
          * 🔴 팀이 둘 이상이면 **드롭다운**으로 전환한다 (2026-08-16). 이 페이지는 로그인이 없어
          *    스스로 다른 팀을 읽을 수 없으므로, 확장이 넘겨준 목록 안에서만 바꾼다.
          */}
        {liveTeams.length > 1 ? (
          <select
            className="dash-team-select"
            aria-label="팀 선택"
            value={teamIndex}
            onChange={(event) => setTeamIndex(Number(event.target.value))}
          >
            {liveTeams.map((item, index) => (
              <option key={item.teamId || index} value={index}>
                {item.teamName} 협업 건강도
              </option>
            ))}
          </select>
        ) : (
          <span className="dash-brand-team">
            {live ? `${live.teamName} 협업 건강도` : '프론트엔드팀 ↔ 백엔드팀 협업 건강도'}
          </span>
        )}
        <span className="dash-spacer" />
        <button type="button" className="dash-theme-toggle" onClick={toggleTheme}>
          <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
          {theme === 'dark' ? '라이트' : '다크'}
        </button>
      </header>

      {/* 🔴 데이터 출처를 화면에서 절대 감추지 않는다 — 목업을 실데이터처럼 보이게 하는 것이
          이 프로젝트에서 반복된 실패다(S33·S45). 실데이터일 때도 무엇을 보고 있는지 쓴다. */}
      <div className="dash-mock-banner" role="note">
        <span className="dash-mock-banner-icon" aria-hidden="true">ⓘ</span>
        {live ? (
          <>
            <span className="dash-mock-banner-strong">
              {/* 🔴 **기간을 고정 문구로 쓰면 안 된다** (2026-08-16 사용자 지적) — 14일을
                  골랐는데 배너가 30일이라고 하면 화면이 서로 다른 말을 한다. */}
              {live.teamName}의 실제 지표 — {live.label}
            </span>
            <span className="dash-mock-banner-note">
              팀원들의 사용 기록을 합산한 수치예요. 개인별로는 나뉘지 않아요.
            </span>
          </>
        ) : (
          <>
            <span className="dash-mock-banner-strong">이 화면은 데모용 목업 데이터입니다.</span>
            <span className="dash-mock-banner-note">
              확장에서 팀에 들어간 뒤 「대시보드 열기」로 오면 실제 지표가 보여요.
            </span>
          </>
        )}
      </div>

      <main className="dash-main">
        <div className="dash-title-row">
          <span className="dash-title">협업 건강도 대시보드</span>
          {/**
           * 🔴 실데이터에는 기간 선택을 두지 않는다. 확장이 최근 30일치 **합계 하나**만 넘기므로
           *    「이번 주」를 눌러도 바뀔 것이 없다 — 눌러도 아무 일이 없는 버튼은 고장으로 읽힌다
           *    (S33에서 지운 동작 없는 「수정」·「비공개」 버튼과 같은 실패). 대신 기간을 문구로 쓴다.
           */}
          {live ? (
            <div className="dash-segment" role="tablist" aria-label="기간 선택">
              {[7, 14, 30].map((days) => (
                <button
                  key={days}
                  type="button"
                  role="tab"
                  aria-selected={rangeDays === days}
                  className={
                    rangeDays === days ? 'dash-segment-btn dash-segment-btn-active' : 'dash-segment-btn'
                  }
                  onClick={() => setRangeDays(days)}
                >
                  최근 {days}일
                </button>
              ))}
            </div>
          ) : (
          <div className="dash-segment" role="tablist" aria-label="기간 선택">
            {Object.entries(SCENARIOS).map(([key, s]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={scenarioKey === key}
                className={
                  scenarioKey === key ? 'dash-segment-btn dash-segment-btn-active' : 'dash-segment-btn'
                }
                onClick={() => setScenarioKey(key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          )}
        </div>

        {/* 🔴 **빈 팀은 빈 팀으로 말한다** (2026-08-16). 0만 그려진 화면은 고장과 구분되지
            않는다. 팀을 뺐다가 다른 팀 지표가 열리는 사고를 겪어서, 빼는 대신 명시한다. */}
        {live?.empty && (
          <div className="dash-mock-banner" role="status">
            <span className="dash-mock-banner-icon" aria-hidden="true">ⓘ</span>
            <span className="dash-mock-banner-strong">{live.teamName}에는 아직 쌓인 지표가 없어요.</span>
            <span className="dash-mock-banner-note">
              팀원이 사이로 메시지를 다듬으면 여기에 쌓여요.
            </span>
          </div>
        )}

        <section className="card dash-hero">
          <div className="dash-gauge" style={gaugeStyle} aria-hidden="true">
            <div className="dash-gauge-inner">
              <span className="dash-gauge-value">
                {!hasIndex ? '—' : Number.isInteger(healthIndex) ? healthIndex : healthIndex.toFixed(1)}
              </span>
              <span className="dash-gauge-label">Health Index</span>
            </div>
          </div>
          <div className="dash-hero-side">
            <div className="dash-hero-formula">Health Index = 100 − (마찰 ÷ 다듬은 메시지) × 100</div>
            <div className="dash-stat-row">
              <div>
                <div className="dash-stat-label">마찰 비율</div>
                {/* 🔴 표본이 없으면 비율도 없다 — 0%로 쓰면 "마찰이 없었다"는 뜻이 되어 버린다. */}
                <div className="dash-stat-value dash-stat-value-o">
                  {!hasIndex
                    ? '—'
                    : `${Number.isInteger(frictionRatio) ? frictionRatio : frictionRatio.toFixed(1)}%`}
                </div>
              </div>
              <div>
                {/* 🔴 분모를 화면에 보여준다 — 공식에 쓰이는 수를 숨기면 지수를 검증할 수 없다. */}
                <div className="dash-stat-label">다듬은 메시지</div>
                <div className="dash-stat-value">{totalRefined}건</div>
              </div>
              <div>
                <div className="dash-stat-label">긍정 신호 합계</div>
                <div className="dash-stat-value dash-stat-value-g">{positiveTotal}건</div>
              </div>
              <div>
                <div className="dash-stat-label">마찰 신호 합계</div>
                <div className="dash-stat-value dash-stat-value-o">{frictionTotal}건</div>
              </div>
            </div>
            <div className="dash-hero-note">
              개인이 아닌 팀·조직 단위로만 집계돼요. 특정 인원의 이름이나 계정은 표시되지 않아요.
            </div>
          </div>
        </section>

        <section className="card">
          {/**
            * 🔴 **신호 필터** (2026-08-16). 끄면 막대에서만이 아니라 **지수 계산에서도** 빠진다 —
            *    화면에서만 숨기면 "표시된 수치로 계산했다"는 공식 설명과 어긋난다.
            *    실데이터일 때만 낸다(목업에서 걸러 봐야 의미가 없다).
            */}
          {/**
            * 🔴 **긍정과 마찰을 나눠 놓는다** (2026-08-16 사용자 요청 ⑥). 한 줄에 8개를 섞어
            *    늘어놓으면 어느 칩이 어느 쪽인지 **칩 색이 전부 같아서** 구분이 안 된다 —
            *    차트는 위/아래로 나뉘어 있는데 필터만 섞여 있으면 짝이 맞지 않는다.
            * 🔴 색만으로 구분하지 않는다 — 줄마다 **글자 라벨**을 둔다(색각 이상·흑백 출력).
            */}
          {live && (
            <div className="dash-filter-block">
              {[
                { key: 'positive', label: '긍정 신호', rows: rawScenario.positive },
                { key: 'friction', label: '마찰 신호', rows: rawScenario.friction },
              ].map((group) => (
                <div className="dash-filter-row" key={group.key}>
                  <span className={`dash-filter-label dash-filter-label-${group.key}`}>
                    <span className={`dash-swatch dash-swatch-${group.key}`} />
                    {group.label}
                  </span>
                  {group.rows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      aria-pressed={!hidden.has(row.id)}
                      className={
                        hidden.has(row.id)
                          ? `dash-filter-chip dash-filter-chip-${group.key}`
                          : `dash-filter-chip dash-filter-chip-${group.key} dash-filter-chip-on`
                      }
                      onClick={() =>
                        setHidden((current) => {
                          const next = new Set(current);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                    >
                      {row.label}
                    </button>
                  ))}
                </div>
              ))}
              {/* 🔴 끄면 지수에서도 빠진다는 사실을 화면이 말해야 한다 — 숨기기와 제외는 다르다. */}
              <p className="dash-filter-note">
                끈 신호는 차트뿐 아니라 <b>건강도·비율 계산에서도 빠져요.</b>
              </p>
            </div>
          )}
          <div className="dash-chart-head">
            <span className="dash-chart-title">긍정 신호 vs 마찰 신호</span>
            <div className="dash-chart-controls">
              <div className="dash-legend">
                <span className="dash-legend-item">
                  <span className="dash-swatch dash-swatch-positive" /> 긍정 신호
                </span>
                <span className="dash-legend-item">
                  <span className="dash-swatch dash-swatch-friction" /> 마찰 신호
                </span>
              </div>
              <div className="dash-segment" role="tablist" aria-label="차트 또는 표로 보기">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'chart'}
                  className={
                    view === 'chart'
                      ? 'dash-segment-btn dash-segment-btn-sm dash-segment-btn-active'
                      : 'dash-segment-btn dash-segment-btn-sm'
                  }
                  onClick={() => setView('chart')}
                >
                  차트
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'table'}
                  className={
                    view === 'table'
                      ? 'dash-segment-btn dash-segment-btn-sm dash-segment-btn-active'
                      : 'dash-segment-btn dash-segment-btn-sm'
                  }
                  onClick={() => setView('table')}
                >
                  표
                </button>
                {/* 🔴 실데이터일 때만 낸다 — 목업에는 날짜별 원자료가 없어 그릴 것이 없다. */}
                {live && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === 'trend'}
                    className={
                      view === 'trend'
                        ? 'dash-segment-btn dash-segment-btn-sm dash-segment-btn-active'
                        : 'dash-segment-btn dash-segment-btn-sm'
                    }
                    onClick={() => setView('trend')}
                  >
                    추이
                  </button>
                )}
              </div>
            </div>
          </div>

          {view === 'trend' && live ? (
            <TrendChart byDate={live.byDate} days={rangeDays} hidden={hidden} />
          ) : view === 'chart' ? (
            <MirrorChart positiveRows={positiveRows} frictionRows={frictionRows} />
          ) : (
            <DivergingTable rows={allRows} />
          )}
        </section>

        <footer className="dash-footer">
          <div className="dash-footer-zero">
            🔒 Zero Retention — 메시지 본문은 저장되지 않아요. 표시된 수치는 팀·조직 단위 집계입니다.
          </div>
          <div className="dash-footer-copy">© 사이(Sai) · Team Health Dashboard v1 (Mock)</div>
        </footer>
      </main>
    </div>
  );
}

/**
 * 나비형(mirror) 막대 — 중앙 세로선을 기준으로 긍정 신호는 오른쪽, 마찰 신호는 왼쪽으로
 * 자란다. 라벨은 항상 **바깥쪽**에 붙는다(막대 길이와 무관하게 항상 읽을 수 있는 자리).
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
            <div />
            <div className="dv-bar-col">
              <div className="dv-bar dv-bar-positive" style={{ width: `${row.pct}%` }} />
              <span className="dv-value dv-value-positive">{row.count}건</span>
            </div>
          </div>
        ))}
      </div>
      <div className="dv-divider" />
      <div className="dv-group">
        {frictionRows.map((row) => (
          <div className="dv-row dv-row-friction" key={row.id}>
            <div className="dv-bar-col">
              <span className="dv-value dv-value-friction">{row.count}건</span>
              <div className="dv-bar dv-bar-friction" style={{ width: `${row.pct}%` }} />
            </div>
            <div />
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
    <table className="dv-table">
      <thead>
        <tr>
          <th>구분</th>
          <th>항목</th>
          <th>설명</th>
          <th>건수</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <span
                className={
                  row.kind === 'positive'
                    ? 'dv-table-badge dv-table-badge-positive'
                    : 'dv-table-badge dv-table-badge-friction'
                }
              >
                {row.kind === 'positive' ? '긍정' : '마찰'}
              </span>
            </td>
            <td className="dv-table-label">{row.label}</td>
            <td className="dv-table-desc">{row.desc}</td>
            <td className={row.kind === 'positive' ? 'dv-table-count dash-stat-value-g' : 'dv-table-count dash-stat-value-o'}>
              {row.count}건
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
