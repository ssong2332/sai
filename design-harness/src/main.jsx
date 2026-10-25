/**
 * 디자인 하네스 — 콘텐츠 팝업을 목업 props로 렌더한다 (개발 전용, 확장에 실리지 않는다).
 *
 * 사용: `npm --prefix design-harness run dev` → http://127.0.0.1:5199/
 *   ?theme=dark            다크 토큰
 *   ?scene=refine          한 장면만 (목록은 화면 상단)
 *   ?page=dark             호스트 페이지 배경을 어둡게(다크 사이트 위의 라이트 팝업 확인)
 *
 * 🔴 실제 콘텐츠 스크립트와 같은 조건을 흉내 낸다 — Shadow DOM 안에 `tokens.css` + `content.css`를
 *    문자열로 넣고(`src/content/index.jsx`와 같은 방식), 호스트에 `all:initial` 인라인을 준다.
 * 🔴 화면 검토용이다. 이 화면이 맞아도 실브라우저 unpacked 확인 없이 「동작한다」고 하지 않는다.
 */
import './chromeStub.js';
import { registerSaiFont } from '../../src/lib/saiFont.js';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import tokensCss from '../../src/styles/tokens.css?inline';
import motionCss from '../../src/styles/motion.css?inline';
import contentCss from '../../src/content/content.css?inline';
// v1 비교용 사본(시안 v2 이전 `HEAD` 그대로) — `?v=1`. 🔴 체감 긴급도 JSX는 v2라 그 부분만 v1과 다르다.
import tokensV1 from './v1/tokens.css?inline';
import contentV1 from './v1/content.css?inline';
import RefinePopup from '../../src/content/RefinePopup.jsx';
import DecodePopup, { ReplyPanel } from '../../src/content/DecodePopup.jsx';
import SensitiveWarning from '../../src/content/SensitiveWarning.jsx';
import VentingPrompt from '../../src/content/VentingPrompt.jsx';
import TicketPopup from '../../src/content/TicketPopup.jsx';
import SaiMark from '../../src/assets/SaiMark.jsx';
import { SnippetIcon, DecisionIcon } from '../../src/assets/SaiIcons.jsx';
import { mockRefine, mockDecode } from '../../src/content/refineClient.js';
import {
  SOURCE_TEXT,
  RECIPIENTS,
  TEAMS,
  refineOverrides,
  SCHEDULE_OFF,
  REPLY_RESULT,
  VENT_TEXT,
} from './fixtures.js';

// 실제 콘텐츠 스크립트(`src/content/index.jsx`)와 같은 방식 — 호스트 문서에 FontFace로 등록한다.
registerSaiFont();

const params = new URLSearchParams(location.search);
const THEME = params.get('theme') === 'dark' ? 'dark' : 'light';
const ONLY = params.get('scene');
const PAGE_DARK = params.get('page') === 'dark';
const V1 = params.get('v') === '1';

/** 하네스 전용 보정 — 고정 배치 레이어를 문서 흐름에 놓는다(위치 계산은 SaiOverlay 몫이라 여기선 무의미). */
const HARNESS_CSS = `
.sai-popup-layer, .sai-fab-wrap { position: relative !important; left: auto !important; top: auto !important; }
.sai-toast { position: relative !important; left: auto !important; bottom: auto !important; transform: none !important; display: inline-flex; }
`;

function ShadowFrame({ children, minHeight = 0 }) {
  const hostRef = useRef(null);
  const [mount, setMount] = useState(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || host.shadowRoot) return;
    host.style.cssText = 'all:initial;position:static;display:block';
    host.setAttribute('data-theme', THEME);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = V1
      ? `${tokensV1}\n${contentV1}\n${HARNESS_CSS}`
      : `${tokensCss}\n${motionCss}\n${contentCss}\n${HARNESS_CSS}`;
    shadow.appendChild(style);
    const point = document.createElement('div');
    shadow.appendChild(point);
    setMount(point);
  }, []);
  return (
    <div style={{ minHeight }}>
      <div ref={hostRef} />
      {mount && createPortal(children, mount)}
    </div>
  );
}

function useAsync(factory) {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let alive = true;
    factory().then((v) => alive && setValue(v));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

const noop = () => {};

function Fab({ hint = '', snippets = false }) {
  return (
    <div className="sai-fab-wrap">
      <button type="button" className="sai-fab" title="사이로 다듬기">
        <SaiMark size={26} />
      </button>
      <div className="sai-fab-actions">
        <div className="sai-fab-inner">
          <button type="button" className="sai-fab-action" aria-label="저장 문구" aria-expanded={snippets}>
            <SnippetIcon />
          </button>
          <button type="button" className="sai-fab-action sai-fab-action-green" aria-label="결정 요약">
            <DecisionIcon />
          </button>
        </div>
      </div>
      {hint && <span className="sai-fab-hint sai-fab-hint-loose">{hint}</span>}
      {snippets && (
        <div className="sai-fab-snippets" role="menu">
          <div className="sai-fab-snippet-mode">
            <span className="sai-label">뒤에 이어 붙이기</span>
            <button type="button" className="sai-switch sai-switch-on" role="switch" aria-checked="true">
              <span className="sai-switch-knob" />
            </button>
          </div>
          <button type="button" className="sai-fab-snippet" role="menuitem">
            Could you take a look when you have a moment? No rush before Thursday.
          </button>
          <button type="button" className="sai-fab-snippet" role="menuitem">
            Thanks for the quick turnaround — I&apos;ll merge once CI is green.
          </button>
        </div>
      )}
    </div>
  );
}

function RefineScene({ variant }) {
  const base = useAsync(() => mockRefine({ text: SOURCE_TEXT }));
  if (variant === 'loading') {
    return (
      <div className="sai-popup-layer">
        <RefinePopup loading result={null} recipients={RECIPIENTS} recipientId="r1" teams={TEAMS} onUrgencyChange={noop} onApply={noop} onClose={noop} />
      </div>
    );
  }
  if (!base) return null;
  const result =
    variant === 'fallback'
      ? { ...base, ...refineOverrides, mock: false, fallback: true, refined: SOURCE_TEXT, backTranslation: '', fallbackNotice: null }
      : { ...base, ...refineOverrides, mock: variant === 'mock' };
  return (
    <div className="sai-popup-layer">
      <RefinePopup
        result={result}
        loading={false}
        error=""
        sourceText={SOURCE_TEXT}
        recipients={RECIPIENTS}
        recipientId="r1"
        recipientLabel="Miguel"
        teams={TEAMS}
        teamId="personal"
        scheduleInfo={variant === 'fallback' ? null : SCHEDULE_OFF}
        threadContext={[{ text: 'Release candidate is cut — waiting on the review.' }, { text: 'Thanks! I will look tomorrow.' }]}
        onUrgencyChange={noop}
        onApply={noop}
        onClose={noop}
        onSchedule={noop}
        onSaveSnippet={noop}
        onRegenerate={noop}
        onRecipientChange={noop}
        onTeamChange={noop}
        onThreadContextToggle={noop}
      />
    </div>
  );
}

function DecodeScene({ variant }) {
  const result = useAsync(() => mockDecode({ text: 'Thanks for the update! Just a few minor comments.' }));
  if (variant === 'loading') {
    return (
      <div className="sai-popup-layer">
        <DecodePopup loading result={null} onClose={noop} />
      </div>
    );
  }
  if (!result) return null;
  // `urgencyGap`은 실제 경로에서 스키마가 계산한다(목업에는 없다) — 화면 확인용으로 채운다.
  const real = { ...result, mock: false, urgencyGap: result.surfaceUrgency !== result.actualUrgency };
  return (
    <div className="sai-popup-layer">
      <DecodePopup
        result={real}
        loading={false}
        error=""
        onClose={noop}
        sourceText="Thanks for the update! Just a few minor comments."
        onReply={noop}
        replyIntent={variant === 'side' ? 'clarify' : null}
        replySideBySide={variant === 'side'}
        onToast={noop}
        onToggleReplyAuto={noop}
      />
      {variant === 'side' && (
        <ReplyPanel
          standalone
          onClose={noop}
          result={REPLY_RESULT}
          loading={false}
          error=""
          sourceText="Thanks for the update! Just a few minor comments."
          sentAnswerText=""
          draftText={REPLY_RESULT.draft}
          onDraftTextChange={noop}
          onRefine={noop}
        />
      )}
      {variant === 'ask' && (
        <ReplyPanel standalone onClose={noop} askIntent="clarify" answers={{}} onAnswersChange={noop} onSubmit={noop} onSkip={noop} result={null} loading={false} error="" sourceText="" />
      )}
    </div>
  );
}

function VentScene({ ticket }) {
  const result = useAsync(() => mockRefine({ text: VENT_TEXT }));
  if (!result) return null;
  return (
    <div className="sai-popup-layer">
      {ticket ? (
        <TicketPopup result={result} onBack={noop} onApply={noop} onClose={noop} />
      ) : (
        <VentingPrompt result={result} onRefineOnly={noop} onConvert={noop} onClose={noop} />
      )}
    </div>
  );
}

const SCENES = [
  { id: 'fab', label: '플로팅 버튼', node: () => <Fab /> },
  { id: 'fab-snippets', label: '저장 문구 목록', node: () => <Fab snippets />, minHeight: 200 },
  { id: 'fab-hint', label: '버튼 안내', node: () => <Fab hint="먼저 문장을 선택해 주세요" /> },
  { id: 'refine-loading', label: '다듬기 — 로딩', node: () => <RefineScene variant="loading" /> },
  { id: 'refine', label: '다듬기 — 결과', node: () => <RefineScene variant="result" /> },
  { id: 'refine-mock', label: '다듬기 — 목업 표시', node: () => <RefineScene variant="mock" /> },
  { id: 'refine-fallback', label: '다듬기 — 실패(폴백)', node: () => <RefineScene variant="fallback" /> },
  { id: 'decode-loading', label: '뜻 풀기 — 로딩', node: () => <DecodeScene variant="loading" /> },
  { id: 'decode', label: '뜻 풀기 — 결과', node: () => <DecodeScene variant="result" /> },
  { id: 'decode-side', label: '뜻 풀기 + 회신 초안(옆 패널)', node: () => <DecodeScene variant="side" /> },
  { id: 'decode-ask', label: '회신 초안 — 사전 질문', node: () => <DecodeScene variant="ask" /> },
  {
    id: 'sensitive',
    label: '민감정보 경고',
    node: () => (
      <div className="sai-popup-layer">
        <SensitiveWarning
          summary="이메일 1건 · API 키 1건"
          maskedPreview={'Hi Miguel, the staging key is [REDACTED] — please rotate it after testing.\nPing me at [REDACTED].'}
          onSendMasked={noop}
          onCancel={noop}
        />
      </div>
    ),
  },
  { id: 'venting', label: '감정 표현 감지', node: () => <VentScene /> },
  { id: 'ticket', label: '티켓 변환', node: () => <VentScene ticket /> },
  {
    id: 'toast',
    label: '토스트',
    node: () => (
      <div className="sai-toast" role="status">
        <span className="sai-toast-text">입력창에 넣었어요</span>
        <button type="button" className="sai-toast-undo">되돌리기</button>
      </div>
    ),
  },
];

function App() {
  const list = ONLY ? SCENES.filter((s) => s.id === ONLY) : SCENES;
  const pageBg = PAGE_DARK ? '#1d2127' : THEME === 'dark' ? '#2a2e35' : '#e9ebee';
  return (
    <div style={{ background: pageBg, minHeight: '100vh', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      {!ONLY && (
        <p style={{ margin: '0 0 16px', fontSize: 12, color: PAGE_DARK || THEME === 'dark' ? '#c9ced6' : '#3c4450' }}>
          사이 디자인 하네스 · theme={THEME} · 장면: {SCENES.map((s) => s.id).join(', ')}
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' }}>
        {list.map((scene) => (
          <section key={scene.id} data-scene={scene.id} style={{ display: 'grid', gap: 8 }}>
            {!ONLY && (
              <h2 style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: PAGE_DARK || THEME === 'dark' ? '#aeb4bd' : '#5b6370' }}>
                {scene.label} · {scene.id}
              </h2>
            )}
            <ShadowFrame minHeight={scene.minHeight}>{scene.node()}</ShadowFrame>
          </section>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('app')).render(<App />);
