import { useEffect, useRef, useState } from 'react';
import { Link } from '../router.jsx';
import { prefersReducedMotion, useCountUp, useInView, useReducedMotion, useScrollFrame } from '../motion.js';
import { bandPercent, pickScene } from '../liveClock.js';
import SaiMark from '../components/SaiMark.jsx';
import Segmented from '../components/Segmented.jsx';

/**
 * 소개 페이지 — 시안 A2(docs/design/reference-a2.html)를 옮긴 것.
 * 🔴 예시 문장·시각은 미리 써 둔 것이다(실제 교정 결과가 아니다). 통계·후기·스토어 링크를 넣지 않는다.
 * 🔴 움직임은 transform·opacity만. 스크롤 핸들러는 motion.js의 rAF 묶음 하나를 쓴다.
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Chrome 웹 스토어 설치 링크(2026-10-31 사용자 결정 — 미등록 항목을 소개 사이트에 공개, 「베타 체험」).
 * 🔴 짧은 형태(ID만) — 스토어가 이름 붙은 주소로 넘긴다. 근거·한도 안내는 `docs/BetaInvite.md`.
 */
const STORE_URL = 'https://chromewebstore.google.com/detail/gdipbmakeghjecpenebjlfhgcajbikkg';

/* ── 작은 부품 ─────────────────────────────────────────── */

/** f: 바뀌지 않는 사실(빨강) · t: 용어집 단어(초록) · b: 굵게 */
function Rich({ parts }) {
  return parts.map((part, i) => {
    if (typeof part === 'string') return <span key={i}>{part}</span>;
    if (part.f) return <span key={i} className="fact">{part.f}</span>;
    if (part.t) return <span key={i} className="term">{part.t}</span>;
    return <b key={i}>{part.b}</b>;
  });
}

function Reveal({ as: Tag = 'div', className = '', delay = 0, children, ...rest }) {
  const ref = useRef(null);
  const seen = useInView(ref, { threshold: 0.2 });
  return (
    <Tag ref={ref} className={`reveal${delay ? ` d${delay}` : ''}${seen ? ' in' : ''} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}

function PopHead({ tag = '다듬기', decode = false }) {
  return (
    <div className="pop-h">
      <SaiMark size={26} title="" />
      <b>사이</b>
      <span className={`tag${decode ? ' dec' : ''}`}>{tag}</span>
      <span className="x" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </span>
    </div>
  );
}

/** 두 막대 — 기다리는 동안 오가고(busy), 끝나면 맞물린다(done). */
function Bars({ state }) {
  return (
    <div className={`bars${state ? ` ${state}` : ''}`} aria-hidden="true">
      <i />
      <i />
    </div>
  );
}

function Who() {
  return (
    <div className="who">
      <span className="av" aria-hidden="true">
        M
      </span>
      <b>Miguel</b>
      <span className="t num">상대 11:35</span>
    </div>
  );
}

/**
 * 숫자 굴리기 — 자리마다 0~9 띠가 한 바퀴 돌고 멈춘다(transform만).
 * 화면 읽기 프로그램에는 `text`가 그대로 읽힌다.
 */
function Roll({ text, run, delay = 0, step = 70 }) {
  let n = 0;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span className="roll" aria-hidden="true">
        {[...text].map((ch, i) => {
          if (!/\d/.test(ch)) {
            return (
              <span key={i} className="roll-sep">
                {ch}
              </span>
            );
          }
          const d = Number(ch);
          const wait = delay + n++ * step;
          return (
            <span key={i} className="roll-col">
              <span
                className="roll-strip"
                style={{ transform: `translateY(${run ? -(10 + d) * 5 : 0}%)`, transitionDelay: `${wait}ms` }}
              >
                {Array.from({ length: 20 }, (_, k) => (
                  <span key={k}>{k % 10}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </>
  );
}

/* ── 히어로 ────────────────────────────────────────────── */

const HERO_WORDS = [
  { w: '보내기', d: 0.05 },
  { w: '전에,', d: 0.13, br: true },
  { w: '한 번 더', d: 0.24, cls: 'thin' },
  { w: '맞춥니다.', d: 0.36, cls: 'hl' },
];

const LIFT_RESULT = ['We need to finish the ', { f: 'v2.4' }, ' ', { t: 'deploy' }, ' by ', { f: 'Friday 3 PM' }, '. Could you review this today?'];

function Hero() {
  const lift = useRef(null);
  const reduced = useReducedMotion();
  useScrollFrame(() => {
    const el = lift.current;
    if (!el) return;
    const vh = window.innerHeight || 800;
    const top = el.getBoundingClientRect().top;
    el.style.setProperty('--p', clamp01((vh - top) / (vh * 0.9)).toFixed(3));
  }, !reduced);

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap">
        <span className="eyebrow">
          <b aria-hidden="true" />
          해외 동료와 일하는 개발자를 위한 Chrome 확장
        </span>
        <h1 id="hero-title" className="h1">
          <span className="sr-only">보내기 전에, 한 번 더 맞춥니다.</span>
          <span aria-hidden="true">
            {HERO_WORDS.map((x) => (
              <span key={x.w}>
                <span className={`w${x.cls ? ` ${x.cls}` : ''}`} style={{ animationDelay: `${x.d}s` }}>
                  {x.w}
                </span>
                {x.br ? <br /> : ' '}
              </span>
            ))}
          </span>
        </h1>
        <p className="lede">
          한국어로 쓰면 상대 언어와 긴급도에 맞게 다듬고, 받은 글은 숨은 의도까지 풀어 줘요. 숫자·날짜·이름은 다시
          쓰지 않고, 그대로인지 확인만 해요.
        </p>
        <div className="ctas">
          <a href={STORE_URL} className="btn primary press" target="_blank" rel="noopener noreferrer">
            <span className="soon-dot" aria-hidden="true" />
            Chrome에 추가 · 베타 체험하기
          </a>
          <a href="#write" className="btn ghost press">
            어떻게 동작하나요
          </a>
        </div>
      </div>

      <div className="lift" ref={lift} aria-hidden="true">
        <div className="device">
          <div className="page">
            <div className="chrome">
              <i />
              <i />
              <i />
              <span>업무 메신저 · #release</span>
            </div>
            <div className="doc">
              <div className="thread">
                <div className="bubble">
                  <b>Miguel</b> · 11:20
                  <br />
                  Hey! Any update on the release?
                </div>
                <div className="bubble me">곧 공유할게요!</div>
                <div className="compose">
                  <mark>금요일 오후 3시까지 v2.4 배포 끝내야 해서요, 리뷰 오늘 안에 가능할까요?</mark>
                </div>
              </div>
              <div className="pop">
                <PopHead />
                <Bars state="done" />
                <div className="result" lang="en">
                  <Rich parts={LIFT_RESULT} />
                </div>
                <div className="foot">
                  <span className="btn">다시</span>
                  <span className="btn primary">적용하기</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 쓸 때 — 스크롤로 장면이 바뀐다 ───────────────────── */

const STEPS = [
  { t: '지켜야 할 것부터 찾아요', s: '마감 시각·버전 번호는 빨강, 용어집 단어는 초록' },
  { t: '긴급도에 맞게 다듬어요', s: 'Critical·Normal·Low에 따라 문장의 무게가 달라져요' },
  { t: '그대로 옮겼는지 대조해요', s: '빠진 숫자나 바뀐 이름이 있으면 알려만 줘요' },
];
const STATUS = ['문장을 읽고 있어요', '지켜야 할 것 3개를 찾았어요', '긴급도 Normal로 다듬는 중이에요', '다 됐어요 — 숫자·날짜 그대로예요'];
/** 데스크톱: 섹션 진행도(0~1) 경계 · 단계를 눌렀을 때 옮겨 갈 진행도 */
const STAGE_AT = [0.12, 0.4, 0.7];
const STAGE_GO = [0.26, 0.55, 0.86];
/** 모바일(고정 없음): 팝업 윗변이 화면 높이의 몇 % 위치에 오면 그 단계인가 */
const MOBILE_AT = [0.85, 0.62, 0.4];
const MOBILE_GO = [0.74, 0.5, 0.26];

function isStacked() {
  return window.matchMedia?.('(max-width: 960px)').matches;
}

function StoryWrite() {
  const reduced = useReducedMotion();
  const track = useRef(null);
  const pop = useRef(null);
  const [stage, setStage] = useState(() => (prefersReducedMotion() ? 3 : 0));

  useScrollFrame(() => {
    const el = track.current;
    const p = pop.current;
    if (!el || !p) return;
    const vh = window.innerHeight || 800;
    let next;
    if (isStacked()) {
      const r = p.getBoundingClientRect().top / vh;
      next = r > MOBILE_AT[0] ? 0 : r > MOBILE_AT[1] ? 1 : r > MOBILE_AT[2] ? 2 : 3;
    } else {
      const total = el.offsetHeight - vh;
      const sp = clamp01(-el.getBoundingClientRect().top / (total || 1));
      next = sp < STAGE_AT[0] ? 0 : sp < STAGE_AT[1] ? 1 : sp < STAGE_AT[2] ? 2 : 3;
    }
    setStage((prev) => (prev === next ? prev : next));
  }, !reduced);

  useEffect(() => {
    if (reduced) setStage(3);
  }, [reduced]);

  const go = (i) => {
    const el = track.current;
    if (!el) return;
    const vh = window.innerHeight || 800;
    let y;
    if (isStacked()) {
      y = window.scrollY + pop.current.getBoundingClientRect().top - MOBILE_GO[i] * vh;
    } else {
      const top = window.scrollY + el.getBoundingClientRect().top;
      y = top + STAGE_GO[i] * (el.offsetHeight - vh);
    }
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  const active = Math.max(1, stage);
  const bars = stage === 2 ? 'busy' : stage === 3 ? 'done' : '';

  return (
    <section className={`story${reduced ? ' static' : ''}`} id="write" data-stage={stage} aria-labelledby="write-title">
      <div className="story-track" ref={track}>
        <div className="stick">
          <div className="wrap grid">
            <div className="story-copy">
              <p className="kick">쓸 때</p>
              <h2 className="h2" id="write-title">
                한국어로 쓰면,
                <br />
                <span className="thin">상대 말투로</span> 보내요
              </h2>
              <ol className="steps">
                {STEPS.map((s, i) => {
                  const on = reduced || active === i + 1;
                  const body = (
                    <>
                      <b className="num">{i + 1}</b>
                      <span className="step-text">
                        <strong>{s.t}</strong>
                        <span>{s.s}</span>
                      </span>
                    </>
                  );
                  return (
                    <li key={s.t}>
                      {reduced ? (
                        <div className="step on">{body}</div>
                      ) : (
                        <button
                          type="button"
                          className={`step${on ? ' on' : ''}`}
                          aria-current={on ? 'step' : undefined}
                          onClick={() => go(i)}
                        >
                          {body}
                          <span className="step-meter" aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="pop story-pop" ref={pop}>
              <PopHead />
              <Who />
              <p className="cap">내가 쓴 문장</p>
              <p className="orig">
                <span className="fact">금요일 오후 3시</span>까지 <span className="fact">v2.4</span>{' '}
                <span className="term">배포</span> 끝내야 해서요, 리뷰 오늘 안에 가능할까요?
              </p>
              <Bars state={bars} />
              <p className="status">
                <span className={`status-dot s${stage}`} aria-hidden="true" />
                <span key={stage} className="status-text">
                  {STATUS[stage]}
                </span>
              </p>
              <div className="refined-cell">
                <div className="skeleton" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="refined">
                <p className="result" lang="en">
                  <Rich parts={LIFT_RESULT} />
                </p>
                <div className="chips">
                  <span className="chip f">
                    <i />
                    Friday 3 PM 그대로
                  </span>
                  <span className="chip f">
                    <i />
                    v2.4 그대로
                  </span>
                  <span className="chip k">
                    <i />
                    배포 → deploy
                  </span>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 받을 때 ───────────────────────────────────────────── */

const REPLY_DIRS = [
  { id: 'ok', label: '진행 확인' },
  { id: 'schedule', label: '일정 조율' },
  { id: 'detail', label: '세부 코멘트 요청', rec: true },
];

function Gauge({ surface, actual, surfaceLabel, actualLabel, on }) {
  return (
    <div className={`gauge${on ? ' in' : ''}`}>
      <p className="cap">체감 긴급도</p>
      <div className="g-row" style={{ '--v': `${surface}%` }}>
        <span>표면</span>
        <div className="track">
          <div className="fill" />
        </div>
        <span className="lvl">{surfaceLabel}</span>
      </div>
      <div className="g-row actual" style={{ '--v': `${actual}%` }}>
        <span>실제</span>
        <div className="track">
          <div className="fill" />
        </div>
        <span className="lvl">{actualLabel}</span>
      </div>
    </div>
  );
}

function ReadSection() {
  const ref = useRef(null);
  const on = useInView(ref, { threshold: 0.35 });
  const [dir, setDir] = useState('detail');
  return (
    <section className={`read${on ? ' in' : ''}`} id="read" ref={ref} aria-labelledby="read-title">
      <div className="wrap grid">
        <Reveal>
          <p className="kick dusk">받을 때</p>
          <h2 className="quote" id="read-title">
            「
            <s className="strike">
              <span>사소한</span>
            </s>{' '}
            코멘트」는
            <br />
            사소하지 않을 수 있어요
          </h2>
          <p className="read-lede">
            직역만으로는 놓치는 완곡한 표현을 짚어 주고, 표면 긴급도와 실제 긴급도를 나란히 보여 줘요.
          </p>
        </Reveal>
        <Reveal className="pop" delay={2}>
          <PopHead tag="뜻 풀기" decode />
          <div>
            <p className="cap">직역</p>
            <p className="literal">
              업데이트 고마워요! 사소한 코멘트가 몇 개 있어요 — 시간 될 때 전체 접근 방식을 다시 볼 수도 있겠네요.
            </p>
          </div>
          <div className="intent">
            <p className="cap">실제 의도</p>
            <p>접근 방식을 전면 재검토하자는 요청일 가능성이 높아요.</p>
          </div>
          <Gauge surface={26} actual={86} surfaceLabel="Low" actualLabel="High" on={on} />
          <div>
            <p className="cap" id="dirs-label">
              어떻게 답할까요
            </p>
            <div className="dirs" role="group" aria-labelledby="dirs-label">
              {REPLY_DIRS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`press${dir === d.id ? ' sel' : ''}`}
                  aria-pressed={dir === d.id}
                  onClick={() => setDir(d.id)}
                >
                  {d.label}
                  {d.rec && <span className="rec-tag"> · 추천</span>}
                </button>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── 보낼 때 — 유일하게 어두운 장면 ───────────────────── */

/** 시간대를 모를 때의 고정 예시: 서울 19:35(UTC+9) = 샌프란시스코 03:35(PDT, UTC−7) — 16시간 차.
 *  띠 위 핀은 각자 현지 시각, 보내기 점은 Dana의 09:00(37.5%) = 서울 다음 날 01:00. */
const FIXED_SCENE = {
  mode: 'schedule',
  gap: '16시간',
  me: { city: '서울', time: '19:35', minutes: 19 * 60 + 35, state: '저녁' },
  them: { city: '샌프란시스코', time: '03:35', minutes: 3 * 60 + 35, state: '자는 시간' },
  send: { minutes: 9 * 60, theirLabel: '오전 9:00', myLabel: '서울 새벽 1:00' },
};

/** 방문자의 지금 시각으로 장면을 고른다(`liveClock.js` 판정표) — 1분마다 다시. 🔴 시간대는 어디에도 보내지 않는다. */
function useLiveScene() {
  const read = () => {
    try {
      return pickScene(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone) ?? FIXED_SCENE;
    } catch {
      return FIXED_SCENE;
    }
  };
  const [scene, setScene] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setScene(read()), 60_000);
    return () => clearInterval(id);
  }, []);
  return scene;
}

function NightSection() {
  const scene = useLiveScene();
  const { me, them, send } = scene;
  const schedule = scene.mode === 'schedule';
  const ref = useRef(null);
  const bandRef = useRef(null);
  const clocksRef = useRef(null);
  const on = useInView(ref, { threshold: 0.2 });
  const clocksOn = useInView(clocksRef, { threshold: 0.5 });
  const bandOn = useInView(bandRef, { threshold: 0.4 });
  return (
    <section className={`night${bandOn ? ' in' : ''}`} id="send" ref={ref} aria-labelledby="send-title">
      <div className="wrap">
        <Reveal>
          <p className="kick">보낼 때</p>
          <h2 className="h2" id="send-title">
            상대는 지금
            <br />
            <span className="thin">{schedule ? '퇴근했을지도 몰라요' : '한창 일하는 중이에요'}</span>
          </h2>
        </Reveal>
        <div className="clocks" ref={clocksRef}>
          <Reveal className="clock me" delay={1}>
            <p className="city">나 · {me.city}</p>
            <p className="time num">
              <Roll text={me.time} run={clocksOn && on} />
            </p>
            <span className="state">{me.state}</span>
          </Reveal>
          <Reveal className="mid" delay={2}>
            <span aria-hidden="true">⟷</span> {scene.gap}
          </Reveal>
          <Reveal className="clock them" delay={3}>
            <p className="city">Dana · {them.city}</p>
            <p className="time num">
              <Roll text={them.time} run={clocksOn && on} delay={180} />
            </p>
            <span className="state">{them.state}</span>
          </Reveal>
        </div>
        <div className="band-wrap" ref={bandRef}>
          <div
            className="band"
            role="img"
            aria-label={`하루 24시간 띠: Dana는 ${them.time}, 나는 ${me.time}. ${
              schedule ? `Dana의 ${send.theirLabel}가 보내기 좋은 때예요.` : 'Dana는 지금 업무 시간이에요.'
            }`}
          >
            <span className="pin-rail" style={{ '--x': bandOn ? bandPercent(them.minutes) : '0%' }}>
              <span className="pin them">Dana {them.time}</span>
            </span>
            <span className="pin-rail me" style={{ '--x': bandOn ? bandPercent(me.minutes) : '0%' }}>
              <span className="pin me">나 {me.time}</span>
            </span>
            <span className="send-rail" style={{ '--x': bandPercent(send.minutes) }}>
              <span className="send" />
            </span>
          </div>
          <div className="band-cap num" aria-hidden="true">
            <span>00시</span>
            <span>06시</span>
            <span>12시</span>
            <span>18시</span>
            <span>24시</span>
          </div>
        </div>
        <Reveal className="sendcard">
          <span className="send-mini" aria-hidden="true" />
          <span>
            {schedule ? (
              <>
                <b>Dana의 {send.theirLabel}</b>({send.myLabel})에 알림으로 다시 알려 드려요 — 보내기는 직접 해요
              </>
            ) : (
              <>
                <b>Dana는 업무 시간이에요</b> — 지금 보내도 돼요
              </>
            )}
          </span>
        </Reveal>
      </div>
    </section>
  );
}

/* ── 남는 것과 남지 않는 것 ───────────────────────────── */

const KEPT = ['온보딩 설정', '학습 횟수 (숫자만)', '팀 지표 횟수 (숫자만)'];
const NOT_KEPT = ['메시지 본문 · 다듬은 문장', '저장 문구 (이 컴퓨터에만)', '예약 알림 (이 컴퓨터에만)'];

function Check() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M5 11.5l4 4 8-9" fill="none" stroke="var(--kept)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Cross() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M6 6l10 10" fill="none" stroke="var(--seam)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M16 6L6 16" fill="none" stroke="var(--seam)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function KeepSection() {
  const ref = useRef(null);
  const on = useInView(ref, { threshold: 0.3 });
  return (
    <section className="keep" id="keep" aria-labelledby="keep-title">
      <div className="wrap">
        <Reveal>
          <p className="kick kept">남는 것과 남지 않는 것</p>
          <h2 className="h2" id="keep-title">
            메시지 본문은
            <br />
            <span className="thin">어디에도 남기지 않아요</span>
          </h2>
        </Reveal>
        <div className={`cols${on ? ' in' : ''}`} ref={ref}>
          <Reveal className="col" delay={1}>
            <h3>
              <i className="dot kept" aria-hidden="true" />
              계정에 올라가는 것
            </h3>
            <p className="col-when">로그인하고 동기화할 때만</p>
            <ul>
              {KEPT.map((t, i) => (
                <li key={t} style={{ '--i': i }}>
                  <Check />
                  <span className="sr-only">올라감: </span>
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal className="col" delay={2}>
            <h3>
              <i className="dot seam" aria-hidden="true" />
              올라가지 않는 것
            </h3>
            <p className="col-when">사이 서버·데이터베이스에 남지 않아요</p>
            <ul>
              {NOT_KEPT.map((t, i) => (
                <li key={t} style={{ '--i': i + 3 }}>
                  <Cross />
                  <span className="sr-only">올라가지 않음: </span>
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
        <Reveal as="p" className="note">
          교정 요청은 AI 서비스로 보내 처리하고, 결과를 돌려받은 뒤 서버에는 남기지 않아요.{' '}
          <Link to="/privacy" className="note-link">
            개인정보처리방침 보기
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

/* ── 확장 안에서 — 눌러 보는 부품 ─────────────────────── */

const URGENCY = [
  { id: 'critical', label: 'Critical' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Low' },
];
const OUT = {
  critical: {
    en: [{ b: '[URGENT]' }, ' We must ship ', { f: 'v2.4' }, ' by ', { f: 'Friday 3 PM' }, ' — please review the ', { t: 'deploy' }, ' PR today.'],
    ko: '[긴급] 금요일 오후 3시까지 v2.4를 반드시 내보내야 해요 — 오늘 배포 PR 리뷰 부탁드려요.',
  },
  normal: {
    en: LIFT_RESULT,
    ko: '금요일 오후 3시까지 v2.4 배포를 마쳐야 해요. 오늘 리뷰해 주실 수 있을까요?',
  },
  low: {
    en: ['When you have a moment today, could you take a look? We’re aiming to wrap up the ', { f: 'v2.4' }, ' ', { t: 'deploy' }, ' by ', { f: 'Friday 3 PM' }, '.'],
    ko: '오늘 시간 되실 때 한번 봐 주실 수 있을까요? 금요일 오후 3시까지 v2.4 배포를 마무리하려고 해요.',
  },
};

function UrgencyPopup() {
  const [picked, setPicked] = useState('normal');
  const [shown, setShown] = useState('normal');
  const [busy, setBusy] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pick = (u) => {
    if (u === picked) return;
    setPicked(u);
    clearTimeout(timer.current);
    if (prefersReducedMotion()) {
      setShown(u);
      return;
    }
    setBusy(true);
    timer.current = setTimeout(() => {
      setShown(u);
      setBusy(false);
    }, 650);
  };

  return (
    <Reveal className="pop" delay={1}>
      <PopHead />
      <Segmented options={URGENCY} value={picked} onChange={pick} mode="pressed" label="긴급도" />
      <Who />
      <Bars state={busy ? 'busy' : 'done'} />
      <div className={`result${busy ? ' changing' : ''}`} lang="en" aria-live="polite" aria-busy={busy}>
        <span className="swap">
          <Rich parts={OUT[shown].en} />
        </span>
      </div>
      <p className={`back${busy ? ' changing' : ''}`}>
        <span className="back-l">역번역</span> {OUT[shown].ko}
      </p>
      <div className="foot">
        <span className="btn">다시</span>
        <span className="btn primary">적용하기</span>
      </div>
    </Reveal>
  );
}

function DecodePopup() {
  return (
    <Reveal className="pop" delay={2}>
      <PopHead tag="뜻 풀기" decode />
      <div className="intent">
        <p className="cap">실제 의도</p>
        <p>오늘 안에 답이 필요하다는 뜻이에요.</p>
      </div>
      <p className="quote-sm" lang="en">
        &ldquo;No rush, but it&rsquo;d be great to have this before tomorrow&rsquo;s sync.&rdquo;
      </p>
      <Gauge surface={20} actual={62} surfaceLabel="Low" actualLabel="Normal" on />
      <div className="chips">
        <span className="chip c">
          <i />
          &ldquo;No rush&rdquo;는 예의 표현
        </span>
        <span className="chip f">
          <i />
          기한: 내일 회의 전
        </span>
      </div>
    </Reveal>
  );
}

const TABS = [
  { id: 'home', label: '홈' },
  { id: 'team', label: '팀' },
  { id: 'archive', label: '보관함' },
  { id: 'profile', label: '프로필' },
];
const TODAY = [
  { n: '4', l: '다듬기' },
  { n: '2', l: '뜻 풀기' },
  { n: '1', l: '예약 알림' },
];

function Count({ n, run, delay }) {
  const v = useCountUp(Number(n), run, 900 + delay);
  return (
    <b className="num">
      <span className="sr-only">{n}</span>
      <span aria-hidden="true">{v}</span>
    </b>
  );
}

function SidePanel() {
  const ref = useRef(null);
  const on = useInView(ref, { threshold: 0.5 });
  const [tab, setTab] = useState('home');
  const [back, setBack] = useState(true);
  const [why, setWhy] = useState(false);
  return (
    <Reveal className="panel" delay={3}>
      <div className="ptop">
        <SaiMark size={26} live title="" />
        사이
        <span className="sp" />
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
        </svg>
      </div>
      <Segmented options={TABS} value={tab} onChange={setTab} mode="pressed" label="사이드 패널 탭" className="ptabs" />
      <div className="pbody" ref={ref}>
        {tab === 'home' && (
          <HomeBody on={on} back={back} setBack={setBack} why={why} setWhy={setWhy} />
        )}
        {tab !== 'home' &&
          TAB_CARDS[tab].map((card) => (
            <div className="pcard" key={card.title}>
              <h4>
                {card.title} {card.meta && <small>{card.meta}</small>}
              </h4>
              {card.chips && (
                <div className="pchips">
                  {card.chips.map((c, i) => (
                    <span key={c} className={i === 0 ? 'on' : undefined}>
                      {c}
                    </span>
                  ))}
                </div>
              )}
              {card.rows?.map(([a, b]) => (
                <div className="slot" key={a}>
                  <span>{a}</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          ))}
      </div>
    </Reveal>
  );
}

/** 탭마다 실제 사이드 패널의 카드 순서를 따른다(`src/sidepanel/App.jsx` — 팀·보관함·프로필 탭). 예시 데이터. */
const TAB_CARDS = {
  team: [
    { title: '팀 관리', meta: '플랫폼팀 · 3명', rows: [['나', '팀장'], ['Miguel', '팀원'], ['Aiko', '팀원']] },
    { title: '팀 용어집', meta: '모두에게 같이 적용', rows: [['배포', 'deploy'], ['검수', 'QA review']] },
    { title: '초대 코드', rows: [['SAI-7K2Q', '7일 동안 유효']] },
  ],
  archive: [
    { title: '내 용어집', rows: [['릴리스', 'release'], ['v2.4', '원문 유지']] },
    { title: '스니펫', rows: [['Could you review this today?', '복사']] },
    { title: '예약 알림', meta: '1건', rows: [['Miguel에게 보내기', '상대 내일 09:00']] },
  ],
  profile: [
    { title: '1순위 — 내 상황', chips: ['코드 리뷰', '장애 대응', '일정 조율', '진행 보고'] },
    { title: '2순위 — AI가 학습한 내 수정 패턴', rows: [['문장을 더 짧게', '5번 고침'], ['요청은 질문형으로', '3번 고침']] },
    { title: '내가 대화하는 사람들', rows: [['Miguel', '직접적 표현 선호'], ['Aiko', '오전 응답 빠름']] },
  ],
};

function HomeBody({ on, back, setBack, why, setWhy }) {
  return (
    <>
        <div className="pcard">
          <h4>
            오늘의 사이 <small>오늘 0시부터</small>
          </h4>
          <div className="stat3">
            {TODAY.map((t, i) => (
              <div key={t.l}>
                <Count n={t.n} run={on} delay={i * 120} />
                <span>{t.l}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="pcard">
          <h4>
            회의하기 좋은 시간 <small>Miguel</small>
          </h4>
          <div className="slot best">
            <span className="num">내일 17:00</span>
            <span className="num">상대 09:00</span>
          </div>
          <div className="slot">
            <span className="num">내일 18:00</span>
            <span className="num">상대 10:00</span>
          </div>
        </div>
        <div className="pcard">
          <h4>보기 설정</h4>
          <div className="toggle">
            <span id="demo-back">역번역 보기</span>
            <button
              type="button"
              className="sw"
              role="switch"
              aria-checked={back}
              aria-labelledby="demo-back"
              onClick={() => setBack((v) => !v)}
            />
          </div>
          <div className="toggle">
            <span id="demo-why">변경 이유 보기</span>
            <button
              type="button"
              className="sw"
              role="switch"
              aria-checked={why}
              aria-labelledby="demo-why"
              onClick={() => setWhy((v) => !v)}
            />
          </div>
        </div>
    </>
  );
}

function Showcase() {
  return (
    <section className="showcase" id="ext" aria-labelledby="ext-title">
      <div className="wrap">
        <Reveal>
          <p className="kick ink">확장 안에서는</p>
          <h2 className="h2" id="ext-title">
            눌러 보세요<span className="thin"> — 실제 팝업과 같은 부품이에요</span>
          </h2>
        </Reveal>
        <div className="show-grid">
          <UrgencyPopup />
          <DecodePopup />
          <SidePanel />
        </div>
      </div>
    </section>
  );
}

/* ── 시작하기 ─────────────────────────────────────────── */

function Start() {
  return (
    <section className="start" id="start" aria-labelledby="start-title">
      <div className="wrap">
        <Reveal>
          <p className="kick ink">시작하기</p>
          <h2 className="h2" id="start-title">
            세 단계면 <span className="thin">됩니다</span>
          </h2>
        </Reveal>
        <ol className="start-grid">
          <Reveal as="li" className="start-card" delay={1}>
            <b className="num" aria-hidden="true">
              1
            </b>
            <h3>설치</h3>
            <p>Chrome 웹 스토어에서 추가하세요. 지금은 베타라 하루에 쓸 수 있는 횟수에 한도가 있어요.</p>
            <a href={STORE_URL} className="soon-pill press" target="_blank" rel="noopener noreferrer">
              <span className="soon-dot" aria-hidden="true" />
              베타 체험하기
            </a>
          </Reveal>
          <Reveal as="li" className="start-card" delay={2}>
            <b className="num" aria-hidden="true">
              2
            </b>
            <h3>언어 고르기</h3>
            <p>
              툴바의 사이 아이콘이나 <kbd>Alt</kbd>+<kbd>S</kbd>로 사이드 패널을 열면 내 언어, 주 협업 지역, 기본 톤 세
              가지를 물어요.
            </p>
          </Reveal>
          <Reveal as="li" className="start-card" delay={3}>
            <b className="num" aria-hidden="true">
              3
            </b>
            <h3>글을 선택하고 사이 버튼</h3>
            <p>
              보낼 글이나 받은 글을 드래그하면 옆에 사이 버튼이 떠요. 누르거나 <kbd>Alt</kbd>+<kbd>D</kbd>를 누르면 됩니다.
            </p>
          </Reveal>
        </ol>
        <Reveal className="start-cta">
          <Link to="/settings?demo=1" className="btn primary press">
            설정 화면 미리보기
          </Link>
          <span className="start-cta-note">예시 데이터로 열려요. 아무것도 저장되지 않아요.</span>
        </Reveal>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <main id="main" className="landing">
      <Hero />
      <StoryWrite />
      <ReadSection />
      <NightSection />
      <KeepSection />
      <Showcase />
      <Start />
    </main>
  );
}
