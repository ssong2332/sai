import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../motion.js';

/**
 * 히어로 무대 — 로고의 세 바가 그대로 줄이 된다.
 *   바 A(위) = 들어온 문장 · 바 B(어긋난 아래) = 사이가 다시 세운 문장 + 역번역 한 줄 ·
 *   레드 바 C = 바뀌지 않은 것(원문의 사실).
 * 🔴 **미리 써 둔 예시 문장뿐이다.** API를 부르지 않는다. 실제 결과는 문장·설정에 따라 다르다.
 * 표시: `f` = 그대로 옮긴 사실(레드), `t` = 용어집이 지킨 말(초록).
 */
export const STAGE_EXAMPLES = [
  {
    id: 'refine',
    tab: '쓸 때',
    aMeta: '내가 쓴 문장 · 한국어',
    aLang: 'ko',
    a: [{ f: '금요일 오후 3시' }, '까지 ', { f: 'v2.4' }, ' ', { t: '배포' }, ' 끝내야 해서요, 리뷰 오늘 안에 가능할까요?'],
    bMeta: '사이가 다듬은 문장 · English · 긴급도 Normal',
    bLang: 'en',
    b: ['We need to finish the ', { f: 'v2.4' }, ' ', { t: 'deploy' }, ' by ', { f: 'Friday 3 PM' }, '. Could you review this today?'],
    glossLabel: '역번역',
    gloss: '금요일 오후 3시까지 v2.4 배포를 마쳐야 해요. 오늘 리뷰해 주실 수 있을까요?',
    kept: [
      { kind: 'f', text: '금요일 오후 3시 → Friday 3 PM' },
      { kind: 'f', text: 'v2.4' },
      { kind: 't', text: '용어집 배포 → deploy' },
    ],
  },
  {
    id: 'decode',
    tab: '받을 때',
    aMeta: '받은 메시지 · English',
    aLang: 'en',
    a: ['Thanks! I have a few minor comments — no rush, but could you take a look before ', { f: "Thursday's release" }, '?'],
    bMeta: '사이가 푼 실제 의도 · 한국어',
    bLang: 'ko',
    b: [{ f: '목요일 릴리스' }, ' 전에 코멘트를 반영해 달라는 요청이에요.'],
    glossLabel: '직역',
    gloss: '고마워요! 사소한 코멘트가 몇 개 있어요. 급하진 않지만 목요일 릴리스 전에 봐 주실래요?',
    kept: [
      { kind: 'f', text: "Thursday's release → 목요일 릴리스" },
      { kind: 'n', text: '체감 긴급도 표면 Low → 실제 Normal' },
    ],
  },
  {
    id: 'schedule',
    tab: '보낼 때',
    aMeta: '보낼 메시지 · 서울 화 15:20',
    aLang: 'en',
    a: ['Could you check the API doc before our sync on ', { f: 'Wednesday' }, '?'],
    bMeta: '사이의 제안 · 상대는 베를린',
    bLang: 'ko',
    b: ['베를린은 지금 화 07:20, 업무 시작 전이에요. 상대 오전 9:00에 보내도록 예약할까요?'],
    glossLabel: '알림',
    gloss: '예약하면 서울 화 17:00에 알려 드려요. 보내는 건 직접 합니다.',
    kept: [
      { kind: 'f', text: '문장은 그대로 — 바꾸는 건 보낼 시각뿐' },
    ],
  },
];

function Rich({ parts }) {
  return parts.map((part, i) => {
    if (typeof part === 'string') return <span key={i}>{part}</span>;
    if (part.f) {
      return (
        <mark key={i} className="m-fact">
          {part.f}
        </mark>
      );
    }
    return (
      <mark key={i} className="m-term">
        {part.t}
      </mark>
    );
  });
}

const CYCLE_MS = 7600;
const LEAVE_MS = 260;

export default function HeroStage() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [round, setRound] = useState(0); // 첫 등장만 로고 조립 지연을 준다
  const leaveTimer = useRef(null);

  const autoplay = !reduced && !paused && !hovering;

  const go = useCallback(
    (next) => {
      clearTimeout(leaveTimer.current);
      if (reduced) {
        setIndex(next);
        return;
      }
      setLeaving(true);
      leaveTimer.current = setTimeout(() => {
        setIndex(next);
        setRound((r) => r + 1);
        setLeaving(false);
      }, LEAVE_MS);
    },
    [reduced],
  );

  useEffect(() => {
    if (!autoplay) return undefined;
    const timer = setTimeout(() => go((index + 1) % STAGE_EXAMPLES.length), CYCLE_MS + (round === 0 ? 900 : 0));
    return () => clearTimeout(timer);
  }, [autoplay, index, go, round]);

  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const ex = STAGE_EXAMPLES[index];

  return (
    <figure
      className="stage"
      aria-labelledby="stage-caption"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHovering(false);
      }}
    >
      <div className="stage-head">
        <div className="stage-tabs" role="group" aria-label="예시 고르기">
          {STAGE_EXAMPLES.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className="stage-tab"
              aria-pressed={i === index}
              onClick={() => i !== index && go(i)}
            >
              {item.tab}
              {i === index && autoplay && (
                <span className="stage-tab-progress" key={`${index}-${round}`} style={{ '--cycle': `${CYCLE_MS}ms` }} />
              )}
            </button>
          ))}
        </div>
        {!reduced && (
          <button
            type="button"
            className="link-button stage-pause"
            aria-pressed={paused}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? '자동 넘김 켜기' : '자동 넘김 멈추기'}
          </button>
        )}
      </div>

      <div
        className={`stage-body${leaving ? ' is-leaving' : ''}${round === 0 ? ' is-first' : ''}`}
        key={`${ex.id}-${round}`}
        aria-live={autoplay ? 'off' : 'polite'}
      >
        <div className="lane lane-a">
          <p className="lane-meta mono">{ex.aMeta}</p>
          <p className="lane-text lane-text-a" lang={ex.aLang}>
            <Rich parts={ex.a} />
          </p>
          <span className="stage-bar stage-bar-a" aria-hidden="true" />
        </div>

        <div className="lane lane-b">
          <p className="lane-meta mono">{ex.bMeta}</p>
          <p className="lane-text lane-text-b" lang={ex.bLang}>
            <Rich parts={ex.b} />
          </p>
          <span className="stage-bar stage-bar-b" aria-hidden="true" />
          <p className="gloss mono" lang="ko">
            <span className="gloss-label">{ex.glossLabel}</span> {ex.gloss}
          </p>
        </div>

        <div className="lane lane-c">
          <span className="stage-bar stage-bar-c" aria-hidden="true" />
          <ul className="kept" aria-label="바뀌지 않은 것">
            {ex.kept.map((k) => (
              <li key={k.text} className={`kept-item kept-${k.kind} mono`}>
                {k.text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <figcaption id="stage-caption" className="stage-caption mono">
        미리 써 둔 예시입니다. 실제 결과는 문장과 설정에 따라 달라요.{' '}
        <span className="legend">
          <span className="legend-f">레드</span> 그대로 옮긴 사실 · <span className="legend-t">초록</span> 용어집이 지킨 말
        </span>
      </figcaption>
    </figure>
  );
}
