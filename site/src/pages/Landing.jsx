import { useRef, useState } from 'react';
import { Link } from '../router.jsx';
import { useInView, useScrollTrack } from '../motion.js';
import HeroStage from './HeroStage.jsx';

/** 로고 바 하나가 섹션 너비로 뻗어 나가는 트랙. variant: a(그라파이트) · b(어긋난 그라파이트) · c(레드). */
function Track({ variant, label }) {
  const ref = useRef(null);
  useScrollTrack(ref);
  return (
    <div ref={ref} className={`track track-${variant}`} aria-hidden="true">
      <div className="container">
        <span className="track-label mono">{label}</span>
      </div>
      <span className="track-bar" />
    </div>
  );
}

/* ── 쓸 때 ─────────────────────────────────────────────── */

const SOURCE_KO = [
  { f: '금요일 오후 3시' },
  '까지 ',
  { f: 'v2.4' },
  ' ',
  { t: '배포' },
  ' 끝내야 해서요, 리뷰 오늘 안에 가능할까요?',
];

const URGENCY_OUTPUTS = {
  Critical: {
    en: ['Urgent: we have to finish the ', { f: 'v2.4' }, ' ', { t: 'deploy' }, ' by ', { f: 'Friday 3 PM' }, '. Please review this today.'],
    back: '긴급: 금요일 오후 3시까지 v2.4 배포를 끝내야 해요. 오늘 리뷰해 주세요.',
  },
  Normal: {
    en: ['We need to finish the ', { f: 'v2.4' }, ' ', { t: 'deploy' }, ' by ', { f: 'Friday 3 PM' }, '. Could you review this today?'],
    back: '금요일 오후 3시까지 v2.4 배포를 마쳐야 해요. 오늘 리뷰해 주실 수 있을까요?',
  },
  Low: {
    en: [
      'No pressure, but we are aiming to finish the ',
      { f: 'v2.4' },
      ' ',
      { t: 'deploy' },
      ' by ',
      { f: 'Friday 3 PM' },
      '. Would you be able to review this today?',
    ],
    back: '부담 갖지 않으셔도 되지만, 금요일 오후 3시까지 v2.4 배포를 마치려고 해요. 오늘 리뷰가 가능할까요?',
  },
};

function Rich({ parts }) {
  return parts.map((part, i) => {
    if (typeof part === 'string') return <span key={i}>{part}</span>;
    if (part.f) return <mark key={i} className="m-fact">{part.f}</mark>;
    return <mark key={i} className="m-term">{part.t}</mark>;
  });
}

function WriteDemo() {
  const [urgency, setUrgency] = useState('Normal');
  const out = URGENCY_OUTPUTS[urgency];
  return (
    <div className="demo-card">
      <div className="demo-row">
        <p className="demo-label mono">내가 쓴 문장</p>
        <p className="demo-source" lang="ko">
          <Rich parts={SOURCE_KO} />
        </p>
      </div>

      <div className="demo-row demo-row-control">
        <p className="demo-label mono" id="urgency-label">
          긴급도 <span className="demo-label-note">사이 판정 Normal · 직접 바꿀 수 있어요</span>
        </p>
        <div className="segmented" role="radiogroup" aria-labelledby="urgency-label">
          {Object.keys(URGENCY_OUTPUTS).map((key) => (
            <button key={key} type="button" role="radio" aria-checked={urgency === key} onClick={() => setUrgency(key)}>
              {key}
            </button>
          ))}
        </div>
      </div>

      <div className="demo-row demo-output" aria-live="polite">
        <p className="demo-label mono">다듬은 문장 · English</p>
        <p className="demo-en" lang="en" key={urgency}>
          <Rich parts={out.en} />
        </p>
        <p className="demo-back mono" lang="ko" key={`b-${urgency}`}>
          <span className="gloss-label">역번역</span> {out.back}
        </p>
      </div>
    </div>
  );
}

const CHECKS = [
  { head: '숫자 확인 필요', body: '원문의 숫자가 다듬은 문장에서 빠지거나 달라졌을 때' },
  { head: '이름 표기를 확인해 주세요', body: '사람 이름의 표기가 원문과 다르게 옮겨졌을 때' },
  { head: '용어집 확인 필요', body: '용어집에 등록한 말이 다듬은 문장에 없을 때' },
];

/* ── 받을 때 ───────────────────────────────────────────── */

const LEVELS = ['Low', 'Normal', 'High'];

function UrgencyGauge() {
  const ref = useRef(null);
  const seen = useInView(ref, { threshold: 0.6 });
  return (
    <div ref={ref} className={`gauge${seen ? ' is-in' : ''}`}>
      <div className="gauge-head">
        <span className="demo-label mono">체감 긴급도</span>
        <span className="gauge-value mono">표면 Low → 실제 Normal</span>
      </div>
      <div className="gauge-track" role="img" aria-label="체감 긴급도: 표면은 Low, 실제는 Normal">
        <span className="gauge-fill" />
        <span className="gauge-dot gauge-dot-surface" />
        <span className="gauge-dot gauge-dot-actual" />
      </div>
      <div className="gauge-scale mono" aria-hidden="true">
        {LEVELS.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  );
}

/* ── 보낼 때 ───────────────────────────────────────────── */

/**
 * 예시 시각(고정): 서울 UTC+9 · 베를린 UTC+1(11월 기준) — 8시간 차.
 * 상대의 업무 시간 밖(18:00~09:00)을 칠한다. 서울 시각 기준 하루(0~24시) 위에 두 줄을 겹친다.
 */
const NOW_SEOUL = 15 + 20 / 60;
const SEND_SEOUL = 17; // 베를린 09:00
const DIFF = 8;
const pct = (h) => `${(h / 24) * 100}%`;

function DualClock() {
  const [scheduled, setScheduled] = useState(false);
  const berlinHour = (h) => (((h - DIFF) % 24) + 24) % 24;
  // 베를린 18:00~09:00 = 서울 02:00~17:00
  const offStart = 2;
  const offEnd = 17;
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21];
  const markerAt = scheduled ? SEND_SEOUL : NOW_SEOUL;

  return (
    <div className="clock-card">
      <div className="clock" style={{ '--marker': (markerAt / 24) * 100 }}>
        <div className="clock-row">
          <div className="clock-city">
            <span className="clock-name">서울</span>
            <span className="clock-role mono">나</span>
          </div>
          <div className="clock-line">
            {ticks.map((h) => (
              <span key={h} className={`clock-tick mono${h === 0 ? ' clock-tick-first' : ''}${h % 6 ? ' clock-tick-minor' : ''}`} style={{ left: pct(h) }}>
                {String(h).padStart(2, '0')}
              </span>
            ))}
          </div>
        </div>
        <div className="clock-row">
          <div className="clock-city">
            <span className="clock-name">베를린</span>
            <span className="clock-role mono">상대</span>
          </div>
          <div className="clock-line">
            <span
              className="clock-off"
              style={{ left: pct(offStart), width: pct(offEnd - offStart) }}
              aria-hidden="true"
            />
            {ticks.map((h) => (
              <span key={h} className={`clock-tick mono${h === 0 ? ' clock-tick-first' : ''}${h % 6 ? ' clock-tick-minor' : ''}`} style={{ left: pct(h) }}>
                {String(berlinHour(h)).padStart(2, '0')}
              </span>
            ))}
          </div>
        </div>
        <div className="clock-marker-layer" aria-hidden="true">
          <span className={`clock-marker${scheduled ? ' is-scheduled' : ''}`}>
            <span className="clock-marker-label mono">{scheduled ? '예약 17:00 / 09:00' : '지금 15:20 / 07:20'}</span>
          </span>
        </div>
      </div>

      <p className="clock-legend mono">
        <span className="clock-legend-swatch" aria-hidden="true" /> 상대의 업무 시간 밖(18:00~09:00) · 예시 시각, 서울 UTC+9 · 베를린 UTC+1
      </p>

      <div className="clock-actions">
        <p className="clock-status" aria-live="polite">
          {scheduled
            ? '서울 화 17:00, 베를린 오전 9:00에 크롬 알림으로 다시 알려 드려요. 알림을 보고 직접 보내세요.'
            : '지금 베를린은 화 07:20, 업무 시작 전이에요.'}
        </p>
        <button
          type="button"
          className={scheduled ? 'btn btn-small' : 'btn btn-small btn-action'}
          onClick={() => setScheduled((s) => !s)}
        >
          {scheduled ? '예약 취소' : '상대 오전 9:00로 예약'}
        </button>
      </div>
    </div>
  );
}

/* ── 페이지 ────────────────────────────────────────────── */

export default function Landing() {
  return (
    <main id="main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="container hero-grid">
          <div className="hero-copy">
          <p className="hero-kicker mono rise" style={{ '--d': '60ms' }}>
            크롬 확장 프로그램 · 해외 동료와 주고받는 업무 메시지
          </p>
          <h1 id="hero-title" className="hero-title">
            <span className="rise" style={{ '--d': '120ms' }}>
              어긋난 문장을
            </span>{' '}
            <span className="rise" style={{ '--d': '220ms' }}>
              보내기 전에 맞춥니다
            </span>
          </h1>
          <p className="hero-lede rise" style={{ '--d': '320ms' }}>
            사이는 메시지를 쓰던 자리에서 일합니다. 보낼 글은 상대 언어와 긴급도에 맞게 다듬고, 받은 글은
            직역과 실제 의도를 나눠 보여 줍니다. 숫자·날짜·이름은 다시 쓰지 않고 원문과 대조합니다.
          </p>
          <div className="hero-cta rise" style={{ '--d': '420ms' }}>
            <p className="store-status">
              <span className="store-dot" aria-hidden="true" />
              Chrome 웹 스토어 출시 준비 중
            </p>
            <Link to="/settings?demo=1" className="btn">
              설정 화면 미리보기
            </Link>
          </div>
          </div>
          <HeroStage />
        </div>
      </section>

      <section id="write" className="feature" aria-labelledby="write-title">
        <Track variant="a" label="쓸 때 · 작성 교정" />
        <div className="container feature-grid">
          <div className="feature-text">
            <h2 id="write-title" className="section-title">
              긴급도를 고르면
              <br />
              문장의 무게가 바뀝니다
            </h2>
            <p className="section-lede">
              입력창의 글을 선택하고 사이 버튼을 누르면 상대 언어로 다듬은 문장이 나옵니다. 긴급도는 사이가
              먼저 판정하고, Critical · Normal · Low 중 직접 바꿀 수 있어요. 다듬은 문장 아래에는 상대에게
              어떻게 읽히는지 한국어로 되돌린 역번역이 붙습니다.
            </p>
            <div className="checks">
              <h3 className="checks-title">고쳐 쓰지 않고 알려만 줍니다</h3>
              <ul>
                {CHECKS.map((c) => (
                  <li key={c.head}>
                    <span className="check-head">{c.head}</span>
                    <span className="check-body">{c.body}</span>
                  </li>
                ))}
              </ul>
              <p className="checks-note">경고가 떠도 적용은 그대로 할 수 있어요. 고칠지는 직접 정합니다.</p>
            </div>
          </div>
          <WriteDemo />
        </div>
      </section>

      <section id="read" className="feature" aria-labelledby="read-title">
        <Track variant="b" label="받을 때 · 수신 해독" />
        <div className="container feature-grid feature-grid-flip">
          <div className="feature-text">
            <h2 id="read-title" className="section-title">
              직역과 실제 의도를
              <br />
              나눠서 보여 줍니다
            </h2>
            <p className="section-lede">
              받은 메시지를 선택하면 말 그대로의 뜻, 완곡하게 돌려 말한 실제 의도, 체감 긴급도, 내가 해야 할
              일을 따로 보여 줍니다. 해석은 사이의 제안이에요. 판단은 직접 합니다.
            </p>
          </div>
          <div className="demo-card">
            <div className="demo-row">
              <p className="demo-label mono">받은 메시지 · English</p>
              <p className="demo-en" lang="en">
                Thanks! I have a few minor comments — no rush, but could you take a look before{' '}
                <mark className="m-fact">Thursday&apos;s release</mark>?
              </p>
            </div>
            <div className="decode-split">
              <div className="decode-col">
                <p className="demo-label mono">직역</p>
                <p lang="ko">고마워요! 사소한 코멘트가 몇 개 있어요. 급하진 않지만 목요일 릴리스 전에 봐 주실래요?</p>
              </div>
              <div className="decode-col decode-col-actual">
                <p className="demo-label mono">실제 의도</p>
                <p lang="ko">
                  「급하지 않다」고 했지만 기한이 <mark className="m-fact">목요일 릴리스</mark> 전이에요. 그 전에 코멘트를
                  반영해 달라는 요청에 가까워요.
                </p>
              </div>
            </div>
            <UrgencyGauge />
            <div className="demo-row">
              <p className="demo-label mono">요구 행동</p>
              <ul className="todo">
                <li>코멘트 확인하고 수정하기</li>
                <li>목요일 릴리스 전에 다시 리뷰 요청하기</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="send" className="feature feature-quiet" aria-labelledby="send-title">
        <div className="container feature-grid">
          <div className="feature-text">
            <p className="eyebrow mono">보낼 때 · 시차</p>
            <h2 id="send-title" className="section-title">
              상대의 아침에
              <br />
              닿도록 미룹니다
            </h2>
            <p className="section-lede">
              상대가 업무 시간 밖이면 사이가 상대의 오전 9시에 보내도록 예약을 제안합니다. 사이는 메시지를
              대신 보내지 않아요. 그 시각이 되면 크롬 알림으로 다시 알려 드리고, 보내는 건 직접 합니다.
            </p>
            <p className="section-note">
              긴급도를 Low로 고른 메시지는 상대의 업무 시간 밖에 바로 넣지 않고 예약을 먼저 물어요.
            </p>
          </div>
          <DualClock />
        </div>
      </section>

      <section id="data" className="feature feature-data" aria-labelledby="data-title">
        <Track variant="c" label="남는 것과 남지 않는 것" />
        <div className="container">
          <div className="data-intro">
            <h2 id="data-title" className="section-title">
              레드는
              <br />
              바뀌지 않는 것입니다
            </h2>
            <p className="section-lede">
              로고 맨 아래 레드 바가 뜻하는 두 가지. 내 문장 속의 사실은 다시 쓰지 않고, 내 메시지 본문은
              사이 서버에 남지 않습니다.
            </p>
          </div>

          <div className="data-facts">
            <h3 className="data-h3">문장 속의 사실</h3>
            <p>
              숫자·날짜·사람 이름·용어집 단어는 원문과 대조만 합니다. 빠지거나 달라지면 「숫자 확인 필요」처럼
              알려 주고, 문장을 몰래 고치지 않아요.
            </p>
          </div>

          <div className="data-columns">
            <div className="data-col">
              <h3 className="data-h3">서버로 올라가는 것</h3>
              <p className="data-when mono">로그인하고 「지금 동기화」를 눌렀을 때만</p>
              <ul className="data-list">
                <li>
                  <b>온보딩 설정</b> — 내 언어, 주 협업 지역, 기본 톤
                </li>
                <li>
                  <b>학습 횟수</b> — 어떤 종류의 수정을 몇 번 했는지, 숫자만
                </li>
                <li>
                  <b>팀 협업 지표 횟수</b> — 팀에 속했을 때만, 누가 냈는지는 남지 않아요
                </li>
              </ul>
            </div>
            <div className="data-col data-col-local">
              <h3 className="data-h3">올라가지 않는 것</h3>
              <p className="data-when mono">이 기기의 크롬 확장 안에만</p>
              <ul className="data-list">
                <li>
                  <b>저장 문구</b> — 직접 저장한 문장
                </li>
                <li>
                  <b>예약</b> — 예약해 둔 메시지
                </li>
                <li>
                  <b>메시지 본문</b> — 쓰거나 받은 글 자체
                </li>
              </ul>
            </div>
          </div>

          <div className="data-note">
            <p>
              교정·해석을 하려면 선택한 문장을 AI 서비스로 보내야 합니다. 사이 서버는 그 문장을 데이터베이스나
              로그에 저장하지 않습니다. API 키·카드번호 같은 민감정보는 보내기 전에 이 기기에서 찾아 막거나
              가립니다.
            </p>
            <Link to="/privacy" className="data-link">
              개인정보처리방침에서 자세히 보기
            </Link>
          </div>
        </div>
      </section>

      <section id="start" className="feature feature-quiet" aria-labelledby="start-title">
        <div className="container">
          <p className="eyebrow mono">시작하기</p>
          <h2 id="start-title" className="section-title">
            세 단계면 됩니다
          </h2>
          <ol className="steps">
            <li className="step">
              <span className="step-n mono" aria-hidden="true">
                1
              </span>
              <h3 className="step-title">설치</h3>
              <p>Chrome 웹 스토어 출시를 준비하고 있어요. 공개되면 이 자리에 설치 링크를 둡니다.</p>
              <p className="store-status store-status-inline">
                <span className="store-dot" aria-hidden="true" />
                출시 준비 중
              </p>
            </li>
            <li className="step">
              <span className="step-n mono" aria-hidden="true">
                2
              </span>
              <h3 className="step-title">언어 고르기</h3>
              <p>
                툴바의 사이 아이콘이나 <kbd>Alt</kbd>+<kbd>S</kbd>로 사이드 패널을 열면 내 언어, 주 협업 지역,
                기본 톤 세 가지를 물어요.
              </p>
            </li>
            <li className="step">
              <span className="step-n mono" aria-hidden="true">
                3
              </span>
              <h3 className="step-title">글을 선택하고 사이 버튼</h3>
              <p>
                보낼 글이나 받은 글을 드래그하면 옆에 사이 버튼이 떠요. 누르거나 <kbd>Alt</kbd>+<kbd>D</kbd>를
                누르면 됩니다.
              </p>
            </li>
          </ol>
        </div>
      </section>
    </main>
  );
}
