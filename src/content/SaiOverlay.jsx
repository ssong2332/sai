import { useCallback, useEffect, useRef, useState } from 'react';
import RefinePopup from './RefinePopup.jsx';
import VentingPrompt from './VentingPrompt.jsx';
import TicketPopup, { formatTicketText } from './TicketPopup.jsx';
import SensitiveWarning from './SensitiveWarning.jsx';
import DecodePopup, { ReplyPanel } from './DecodePopup.jsx';
import { buildAnswerList, answersToText } from '../core/reply/questions.js';
import SaiMark from '../assets/SaiMark.jsx';
import { SnippetIcon, DecisionIcon } from '../assets/SaiIcons.jsx';
import { requestRefine, requestDecode, requestDecisions, requestReply } from './refineClient.js';
// 🔴 화면(RefinePopup)과 **같은 판정**을 쓴다 — 두 벌이면 감춘 것과 다시 부르는 것이 어긋난다.
import { checkBackTranslation } from '../core/refine/backcheck.js';
// S30 대안 — 내가 쓴 원문으로 내 문체 통계를 쌓는다(수치만 저장, 본문은 저장하지 않는다).
import { applyText, APPLY_METHOD } from './applyText.js';
import { detectSensitive, redact, summarize } from './sensitiveGuard.js';
import { computeNextSendTime } from '../core/schedule/fairy.js';
import { recordEdit } from '../lib/profile.js';
import { categoryLabel } from '../core/profile/diff.js';
import { addSnippet, listSnippets, markSnippetUsed, MAX_SNIPPETS } from '../lib/snippets.js';
import { addReservation } from '../lib/reservations.js';
// 🔴 홈 「오늘의 사이」의 실카운트. 목업 상수를 대체한다 — 카운트만 저장한다(Spec 필수 5).
import { bumpUsage, USAGE_KINDS } from '../lib/usage.js';
// Spec §3 F-10/F-26 — 팀 건강도의 입력. 🔴 카운트만 쌓는다(본문·개인 식별자 없음).
import { recordFrictionEvent, FRICTION_EVENTS, NO_TEAM_BUCKET } from '../lib/friction.js';
// 🔴 대화 상대 **후보만** 뽑는다 — 등록은 사용자가 누를 때만(`detectPeople.js` 헤더).
import { detectSpeakerNames, matchRecipient } from './detectPeople.js';
import {
  collectThreadContext,
  collectDecisionThread,
  MIN_MESSAGE_CHARS as MIN_DECISION_CHARS_HINT,
} from './threadContext.js';
import { hasConsent as hasDecisionsConsent } from '../lib/decisions.js';
import { FEATURES } from '../config.js';
import { STORAGE_KEYS, getLocal, setLocal } from '../lib/storage.js';
import {
  listRecipients,
  updateRecipient,
  getSelectedRecipient,
  setSelectedRecipientId,
  addRecipient,
  PERSONAL_TEAM_ID,
} from '../lib/recipients.js';
// 🔴 로컬 저장소만 읽는다(네트워크 없음) — 팝업이 뜨는 순간 팀 목록을 기다리게 하지 않는다.
import { listTeams, getTeam } from '../lib/teamClient.js';

/**
 * 드래그 선택 → 플로팅 버튼 → 교정 팝업 (S05).
 *
 * 🔴 이 컴포넌트는 Shadow DOM 안에서 렌더된다. 위치는 전부 `position: fixed` + 뷰포트 좌표라
 *    호스트 페이지의 스크롤 컨테이너·transform에 끌려다니지 않는다.
 * 🔴 Zero Retention (Spec 필수 5): 선택한 원문을 `console`이나 storage에 쓰지 않는다.
 */

/** 너무 짧은 선택은 무시한다 — 단어 하나를 집을 때마다 버튼이 뜨면 방해만 된다. */
const MIN_SELECTION_LENGTH = 5;

const BUTTON_SIZE = 42; // .sai-fab 실제 크기와 맞춘다(클램프 계산용)
/** 플로팅 버튼의 실제 너비(로고 + 액션 버튼들) — 오른쪽 잘림 방지용 clamp에 쓴다.
 *  🔴 접힘 상태가 없어졌으므로(2026-08-14) 이 값이 **항상**의 폭이다. */
const FAB_EXPANDED_WIDTH = 130;
/**
 * 팝업 폭 — 🔴 CSS의 `clamp(360px, 40vw, 560px)`와 **같은 식**을 쓴다(`content.css`).
 *    이 값은 화면 밖으로 나가지 않게 좌표를 clamp하는 데만 쓰이므로, 실제 폭과 어긋나면
 *    오른쪽 끝에서 팝업이 잘리거나 쓸데없이 안쪽으로 밀린다.
 */
function popupWidth() {
  if (typeof window === 'undefined') return 520;
  return Math.min(560, Math.max(360, window.innerWidth * 0.4));
}
const EDGE_GAP = 12;

/**
 * ── 회신 초안 옆 패널 (S40 / 2026-08-14 사용자 요청) ──────────────────────
 *
 * 🔴 **넓을 때만 옆에 띄운다.** 좁은 창에서 두 패널을 가로로 놓으면 둘 다 읽을 수 없는 폭이 되고,
 *    남의 페이지 위에 뜨는 오버레이라 화면을 통째로 덮는다. 좁으면 지금처럼 아래로 이어 붙인다.
 * 🔴 아래 두 값은 **CSS와 같은 값**이어야 한다(`.sai-popup-narrow`의 430px, 레이어 gap 10px).
 *    어긋나면 화면 밖으로 나가지 않게 막는 clamp가 실제 폭과 달라져 오른쪽 끝이 잘린다.
 */
const DECODE_PANEL_WIDTH = 430;
const REPLY_PANEL_WIDTH = 430;
const PANEL_GAP = 10;
/** 두 패널 + 양쪽 여백이 다 들어가야 옆에 띄운다. */
const SIDE_BY_SIDE_MIN_WIDTH =
  DECODE_PANEL_WIDTH + PANEL_GAP + REPLY_PANEL_WIDTH + EDGE_GAP * 2;

/**
 * 팝업 단계.
 *   null      — 닫힘 (플로팅 버튼만)
 *   'refine'  — 작성 교정 팝업 (로딩 포함) — S05
 *   'venting' — 하소연 감지 제안 — S09 / Spec 필수 4
 *   'ticket'  — 티켓 변환 결과 — S09
 *   'decode'  — 수신 메시지 해독 — S10 / Spec 필수 10
 *
 * 🔴 'venting'은 서버가 `detectedIntent === 'venting'`을 준 경우에만 들어간다.
 *    여기서 감정을 다시 판정하지 않는다(오탐 방지 규칙의 단일 출처는 서버다).
 *
 * 🔴 S10 모드 판정 — **선택 영역이 편집 가능한지**로 작성/해독을 가른다. 내가 쓰는 글(입력창)은
 *    항상 편집 가능하고, 남이 보낸 메시지(페이지의 읽기 전용 텍스트)는 편집 불가능하다는 것이
 *    항상 성립하는 구분이라, 별도 버튼·모드 스위치 없이 드래그만으로 자연스럽게 갈린다.
 */
/**
 * 🔴 **확장을 재로드하면 이미 열려 있던 탭의 콘텐츠 스크립트는 고아가 된다.** 그 순간부터
 *    `chrome.runtime.sendMessage`가 "Extension context invalidated"로 죽고, 서버가 멀쩡해도
 *    모든 기능이 실패한다. 이때 **"잠시 후 다시 시도"는 틀린 조언이다** — 새로고침하기 전까지
 *    영원히 안 된다(2026-08-14 실제로 사용자를 여기서 헤매게 했다).
 *
 * 판별: 고아 컨텍스트에서는 `chrome.runtime.id`가 `undefined`가 된다.
 */
function isOrphanedContext() {
  try {
    return typeof chrome === 'undefined' || chrome.runtime?.id == null;
  } catch {
    return true;
  }
}

/** 실패 문구 — 원인에 따라 **할 수 있는 일**이 다르므로 문구도 달라야 한다. */
function failureMessage(action) {
  return isOrphanedContext()
    ? '확장이 업데이트됐어요 — 이 페이지를 새로고침(F5)해 주세요.'
    : `${action}에 실패했어요. 잠시 후 다시 시도해 주세요.`;
}

export default function SaiOverlay() {
  const [anchor, setAnchor] = useState(null); // 선택 영역의 뷰포트 사각형(DOMRect 형태)
  const [selectedText, setSelectedText] = useState('');
  /**
   * S20 후속 — 지금 앵커가 **선택**에서 온 것인지(true), 단순 **커서 포커스**에서 온 것인지(false).
   * 선택이 없으면 교정할 대상이 없으므로 확장 버튼에서 「다듬기」를 빼고 「저장 문구」만 준다.
   */
  const [hasSelection, setHasSelection] = useState(false);
  const [stage, setStage] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const open = stage !== null;

  const [toast, setToast] = useState('');
  /** S15 — 민감정보 감지 결과. 값은 담지 않는다(요약 문구와 마스킹본만). */
  const [guard, setGuard] = useState(null);

  const [decodeResult, setDecodeResult] = useState(null);
  const [decodeLoading, setDecodeLoading] = useState(false);
  const [decodeError, setDecodeError] = useState('');
  /**
   * S37 — 회신 초안. 🔴 `decodeSource`는 **해독에 실제로 보낸 문장**을 화면이 되읽기 위한
   *    사본이다(검증기가 "초안의 이 값이 원문에 있었나"를 대조하는 데 쓴다). 전송 대상은
   *    여전히 `sendTextRef` 하나뿐이며, 이 상태에서 나가는 요청은 없다.
   */
  const [decodeSource, setDecodeSource] = useState('');
  const [replyIntent, setReplyIntent] = useState(null);
  const [replyResult, setReplyResult] = useState(null);
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyError, setReplyError] = useState('');
  /**
   * S40 — 회신 초안 UI 상태를 **여기로 올렸다.** 예전엔 `DecodePopup` 안에 있었는데, 넓은 창에서
   * 초안이 **형제 패널**로 나가면서 방향 버튼(해독 팝업 안)과 질문·초안(옆 패널)이 서로 다른
   * 컴포넌트로 갈라졌다 — 공통 조상이 여기뿐이다.
   */
  const [replyAuto, setReplyAuto] = useState(false);
  const [replyAsk, setReplyAsk] = useState(null);
  const [replyAnswers, setReplyAnswers] = useState({});
  const [replySentAnswers, setReplySentAnswers] = useState('');
  /**
   * 🔴 초안은 **사용자가 편집한다**(v5) — 자리표시자를 모국어에서 채우는 자리다. 모델 응답
   *    (`replyResult.draft`)은 그대로 두고 편집본을 따로 들고 있어야, 다시 생성했을 때 무엇이
   *    모델의 문장이고 무엇이 사용자가 고친 문장인지 섞이지 않는다.
   */
  const [replyDraftText, setReplyDraftText] = useState('');
  /** 뷰포트 폭은 리사이즈로 바뀐다 — 옆/아래 판단이 실시간으로 따라가야 한다. */
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === 'undefined' ? 0 : window.innerWidth,
  );

  /**
   * S20 후속 — 스니펫 목록 열림 상태.
   * 🔴 **확장 자체는 CSS `:hover`가 전담한다.** 예전엔 React 상태(`fabOpen`)로도 확장 클래스를
   *    붙였는데, mouseleave가 유실되면(빠르게 벗어나거나 요소가 이동) **켜진 채로 굳었다**
   *    (2026-08-13 실측). 상태 없이 되는 일을 상태로 이중 관리한 것이 원인이라 아예 없앴다.
   */
  const [snippetOpen, setSnippetOpen] = useState(false);
  /**
   * 🔴 **커서가 버튼 위에 있는 동안에는 버튼을 움직이지 않는다.**
   *    버튼은 스크롤·리사이즈마다 선택 영역을 다시 읽어 위치를 갱신한다. 스트리밍·레이아웃
   *    이동이 잦은 페이지(ChatGPT 등)에서는 **누르려는 순간에도 버튼이 움직여** 빗나간다.
   *    (원래는 hover 확장이 끊기는 문제 때문에 넣었는데, 확장을 없앤 뒤에도 "누르려는 대상이
   *     도망가지 않는다"는 이유로 그대로 남길 값어치가 있다.)
   *
   * 🔴 **state가 아니라 ref다.** 상태로 만들면 `fabOpen`을 없앤 이유(2026-08-13: mouseleave
   *    유실 시 켜진 채로 굳음)를 그대로 되밟는다. ref는 렌더에 영향이 없고, 혹시 leave를
   *    놓쳐도 최악이 "다음 포인터 이동까지 위치 갱신이 늦다"라 스스로 회복된다.
   */
  const fabHoveredRef = useRef(false);
  const [fabSnippets, setFabSnippets] = useState([]);
  /**
   * 지금 고른 문장이 **이미 저장 문구로 담겨 있는지** — 채워진 북마크 아이콘의 조건이다
   * (디자인 파일 「이미 저장한 문구는 채워진 버전으로 바뀌어 상태를 알려줘요」).
   * 🔴 저장할 때와 **같은 정규화**(`trim`)를 쓴다 — 기준이 다르면 저장했는데도 빈 북마크가
   *    뜨거나 그 반대가 된다. `lib/snippets.js`가 `text.trim()`으로 저장한다.
   */
  const selectionAlreadySaved =
    selectedText.trim().length > 0 &&
    fabSnippets.some((entry) => entry.text?.trim() === selectedText.trim());
  /** 버튼 옆에 잠깐 뜨는 안내(선택 없음 등). 토스트보다 시선 가까이에 있다. */
  const [fabHint, setFabHint] = useState('');
  /** 팝업 안에서 보여주는 긴급도 변경 안내 (Spec 권장 2). */
  const [urgencyNotice, setUrgencyNotice] = useState('');
  /** S20 후속 — 저장 문구를 기존 내용 **대신** 넣을지, **뒤에** 붙일지 (2026-08-13 사용자 요청). */
  const [snippetMode, setSnippetMode] = useState('replace');

  /**
   * S21 / Spec 권장 8 — 직전 대화 맥락.
   * 🔴 **상태로 들고 있는 것은 화면 표시용 사본뿐이고, 저장소로는 절대 내려가지 않는다**
   *    (Spec 필수 5 — 남이 쓴 메시지 본문이다). 팝업이 닫히면 같이 사라진다.
   * 🔴 건수만 보여주고 끝내지 않는다 — 사이트별 선택자 없이 구조로 추정한 값이라 틀릴 수 있다.
   *    무엇을 골랐는지 펼쳐 볼 수 있어야 사용자가 "이건 대화가 아닌데"를 알아채고 끌 수 있다.
   */
  const [threadContext, setThreadContext] = useState([]);
  const [threadContextOn, setThreadContextOn] = useState(true);
  /**
   * 🔴 전송에 쓰는 것은 **ref**다. `runRefine`은 deps가 빈 `useCallback`이라 state를 읽으면
   *    팝업을 연 직후의 빈 배열이 그대로 굳는다(닫힌 클로저) — 맥락이 조용히 안 실리는 사고가
   *    난다. `sendTextRef`와 같은 이유·같은 방식이다.
   */
  const threadContextRef = useRef([]);

  useEffect(() => {
    getLocal(STORAGE_KEYS.SNIPPET_INSERT_MODE, 'replace').then(setSnippetMode);
    getLocal(STORAGE_KEYS.THREAD_CONTEXT, true).then(setThreadContextOn);

    // 사이드패널 설정에서 껐다 켰다 하면 페이지 쪽도 즉시 따라간다(스니펫과 같은 방식).
    if (typeof chrome === 'undefined' || !chrome?.storage?.onChanged) return undefined;
    const onChanged = (changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEYS.THREAD_CONTEXT]) return;
      setThreadContextOn(changes[STORAGE_KEYS.THREAD_CONTEXT].newValue !== false);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  /**
   * 맥락 참고를 끄고 켠다. 끄면 **그 자리에서 다시 교정한다** — 껐는데 화면에 남아 있는 결과가
   * 여전히 맥락을 반영한 것이면, 껐다는 표시가 거짓말이 된다.
   */
  const toggleThreadContext = async () => {
    const next = !threadContextOn;
    setThreadContextOn(next);
    await setLocal(STORAGE_KEYS.THREAD_CONTEXT, next);
    if (stage === 'refine' && result) {
      runRefine(result.urgencySource === 'user' ? result.urgency : null);
    }
  };

  const toggleSnippetMode = async () => {
    const next = snippetMode === 'replace' ? 'append' : 'replace';
    setSnippetMode(next);
    await setLocal(STORAGE_KEYS.SNIPPET_INSERT_MODE, next);
  };

  useEffect(() => {
    if (!fabHint) return undefined;
    const timer = setTimeout(() => setFabHint(''), 2600);
    return () => clearTimeout(timer);
  }, [fabHint]);

  /**
   * 🔴 목록을 **마운트 시 한 번** 읽어 둔다 — "저장된 문구가 있을 때만 커서 포커스로 버튼을
   *    띄운다"는 판단에 쓰이므로, 열 때 읽으면 이미 늦다. 목록을 열 때 한 번 더 새로 읽어
   *    사이드패널에서 지운 것이 반영되게 한다.
   */
  useEffect(() => {
    listSnippets().then(setFabSnippets);

    /**
     * 🔴 마운트 시 한 번만 읽으면 목록이 낡는다(2026-08-13 사용자 지적: "스니펫이 없는데도
     *    버튼이 뜬다", "연동이 느리다"). `chrome.storage.onChanged`는 **다른 컨텍스트의 변경을
     *    즉시** 알려준다 — 사이드패널에서 지우면 페이지 쪽도 곧바로 반영된다. 폴링보다 빠르고
     *    싸다. 확장 밖(하네스)에는 chrome이 없으므로 가드한다.
     */
    if (typeof chrome === 'undefined' || !chrome?.storage?.onChanged) return undefined;
    const onChanged = (changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEYS.SNIPPETS]) return;
      setFabSnippets(changes[STORAGE_KEYS.SNIPPETS].newValue ?? []);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    if (!snippetOpen) return undefined;
    listSnippets().then(setFabSnippets);

    /**
     * 🔴 `mouseleave`만으로는 부족하다(2026-08-13 사용자 3회 재보고). 포인터가 빠르게 빠져나가거나
     *    버튼이 스크롤로 이동하면 그 이벤트가 유실돼 목록이 남는다. **바깥을 누르거나 스크롤하면
     *    닫는다** — 이벤트 유실에 기대지 않는 경로를 하나 더 둔다.
     */
    const closeIfOutside = (event) => {
      if (event.composedPath?.().some((node) => node?.dataset?.saiRoot !== undefined)) return;
      setSnippetOpen(false);
    };
    const close = () => setSnippetOpen(false);
    document.addEventListener('pointerdown', closeIfOutside, true);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true);
      window.removeEventListener('scroll', close, true);
    };
  }, [snippetOpen]);

  /** S14 — 퇴근 요정 계산 결과. 팝업을 열 때마다 한 번 계산해 둔다(긴급도 변경과 무관하게 고정). */
  const [scheduleInfo, setScheduleInfo] = useState(null);

  /**
   * S17 — 수신자 목록과 현재 선택. 🔴 **수동 선택이 주 경로다**(Lessons #4) — DOM에서 수신자를
   * 자동 감지하지 않는다(사이트마다 마크업이 달라 범용 규칙이 성립하지 않는다).
   */
  const [recipients, setRecipients] = useState([]);
  const [recipient, setRecipient] = useState(null);
  /**
   * 🔴 등록되지 않은 대화 상대 **후보**. 화면이 「＋ Sarah 추가」를 낼 뿐, 저장은 사용자가
   *    누를 때만 일어난다 (Spec 필수 9 — 사용자가 직접 지정한 것만).
   */
  const [personSuggestions, setPersonSuggestions] = useState([]);

  /**
   * 팀 목록과 **활성 팀** (2026-08-19 ③).
   * 🔴 `listTeams`·`getTeam`은 `chrome.storage.local`만 읽는다 — 네트워크를 타지 않으므로
   *    팝업이 뜨는 속도에 영향이 없다.
   * 🔴 활성 팀이 필요한 이유: 수신자에 팀을 아직 안 정했을 때 **교정이 실제로 쓰는 것**이
   *    활성 팀이다(`refineClient`의 `teamId === null` 경로). 화면이 그것과 다른 값을 보이면
   *    「고른 것과 다른 용어가 실린다」가 된다.
   */
  const [teams, setTeams] = useState([]);
  const [activeTeamId, setActiveTeamId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, active] = await Promise.all([listTeams(), getTeam()]);
      if (cancelled) return;
      setTeams(list);
      setActiveTeamId(active?.teamId ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, selected] = await Promise.all([listRecipients(), getSelectedRecipient()]);
      if (cancelled) return;
      setRecipients(list);
      setRecipient(selected);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 교정을 건 시점의 대상 요소 — 적용 시 여기에 되돌려 쓴다. */
  const targetRef = useRef(null);
  /** S10 — 이번 선택이 작성('compose')인지 해독('decode')인지. 선택 시점에 정해진다. */
  const modeRef = useRef('compose');
  /**
   * 🔴 선택 Range의 **복제본**. 팝업을 클릭하는 순간 페이지 선택이 사라지므로, 지금 잡아두지
   *    않으면 contentEditable에 되돌려 쓸 위치를 잃는다 (S07 / Lessons #2).
   */
  const rangeRef = useRef(null);

  // ── 선택 감지 ────────────────────────────────────────────────────────
  useEffect(() => {
    const onSelectionSettled = (event) => {
      // 우리 UI 안에서의 클릭은 선택 해제로 치지 않는다(Shadow DOM 경계 밖에서 본 이벤트).
      if (event?.target?.closest?.('[data-sai-root]')) return;

      const picked = readSelection();

      if (!picked || picked.text.length < MIN_SELECTION_LENGTH) {
        // 🔴 선택이 없어도 **입력창에 커서가 있으면** 저장 문구를 꺼내 쓸 수 있게 버튼을 띄운다
        //    (2026-08-13 사용자 요청). 단 저장된 문구가 하나도 없으면 띄우지 않는다 — 모든
        //    사이트의 모든 입력창에서 쓸모없는 버튼이 뜨는 건 방해일 뿐이다.
        if (!open) {
          const active = document.activeElement;
          const editable =
            active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' ||
              active.isContentEditable)
              ? active
              : null;
          if (editable && fabSnippets.length > 0) {
            targetRef.current = editable;
            rangeRef.current = null;
            modeRef.current = 'compose';
            setSelectedText('');
            setHasSelection(false);
            // 🔴 커서 위치에 띄운다 — 캐럿을 못 구하면 입력창 사각형으로 폴백한다.
            setAnchor(toAnchorRect(caretRect(editable) ?? editable.getBoundingClientRect()));
            return;
          }
          setAnchor(null);
          setSelectedText('');
          setHasSelection(false);
        }
        return;
      }

      targetRef.current = picked.editable;
      rangeRef.current = picked.range;
      // 🔴 S10 — 편집 가능한 자리(내 입력창)가 아니면 남의 메시지로 보고 해독 모드로 보낸다.
      modeRef.current = picked.editable === null ? 'decode' : 'compose';
      setSelectedText(picked.text);
      setHasSelection(true);
      setSnippetOpen(false);
      setAnchor(toAnchorRect(picked.rect));
    };

    document.addEventListener('mouseup', onSelectionSettled);
    document.addEventListener('keyup', onSelectionSettled);
    // 커서만 놓아도(클릭·탭 이동) 버튼이 뜨게 한다 — focusin은 버블링되므로 document에서 받는다.
    document.addEventListener('focusin', onSelectionSettled);
    return () => {
      document.removeEventListener('mouseup', onSelectionSettled);
      document.removeEventListener('keyup', onSelectionSettled);
      document.removeEventListener('focusin', onSelectionSettled);
    };
  }, [open, fabSnippets.length]);

  /**
   * 스크롤·리사이즈에도 **닫지 않고 선택을 계속 따라간다** — 버튼이든 열린 팝업이든 동일하다
   * (2026-08-13 사용자 요청). 페이지가 움직이면 원본 Range/입력창의 `getBoundingClientRect()`를
   * 다시 읽어 anchor를 갱신한다 — Range는 DOM 노드에 붙어 있어 스크롤 후에도 뷰포트 기준 좌표를
   * 다시 계산해 준다. 노드가 아예 사라졌을 때만(rect가 0×0) 더 이상 따라갈 게 없으므로 닫는다.
   * `requestAnimationFrame`으로 묶어 스크롤 이벤트 폭주에도 렌더가 프레임당 1회로 제한된다.
   */
  useEffect(() => {
    if (!anchor) {
      // 🔴 버튼이 사라지면 `pointerleave`가 안 올 수 있다 — 여기서 반드시 되돌린다.
      //    안 그러면 ref가 true로 굳어 다음 선택에서도 위치 추적이 멈춘다.
      fabHoveredRef.current = false;
      return undefined;
    }

    let frame = null;
    const reposition = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        // 🔴 커서가 버튼 위면 갱신을 건너뛴다 — 움직이는 버튼은 hover를 끊는다(위 참조).
        //    닫는 판정도 함께 미룬다: 커서가 올라가 있는데 버튼이 사라지는 게 더 나쁘다.
        if (fabHoveredRef.current) return;
        const rect = currentSelectionRect(rangeRef.current, targetRef.current);
        if (!rect) {
          setAnchor(null);
          setStage(null);
          return;
        }
        setAnchor(toAnchorRect(rect));
      });
    };

    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      if (frame !== null) cancelAnimationFrame(frame);
    };
    // 🔴 anchor "존재 여부"에만 반응한다 — anchor 값 자체(매 스크롤마다 바뀜)에 반응하면
    //    스크롤 프레임마다 리스너를 떼고 다시 붙이게 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor !== null]);

  /**
   * S24 / Spec 부가 1 — 되돌리기 함수. 토스트가 사라지면 함께 버린다(뒤늦게 눌러 엉뚱한 시점의
   * 내용으로 되돌리는 일이 없게).
   */
  const undoRef = useRef(null);

  /**
   * S24 후속 — 팝업 끌어 옮기기 (2026-08-14 사용자 요청).
   * 🔴 새 선택으로 팝업이 다시 열리면 **0으로 되돌린다** — 옮겨 둔 오프셋이 남아 있으면 다음
   *    선택에서 엉뚱한 곳에 뜬다.
   */
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef(null);
  /**
   * 🔴 팝업의 **실제 높이**를 재서 화면 밖으로 못 나가게 자른다 (2026-08-14 재수정).
   *    1차 시도는 `innerHeight - 120`으로 잘랐는데, 팝업이 800px이면 680px이 화면 아래로
   *    빠져나가도 통과였다 — 사용자 화면에서 실제로 그렇게 됐다. 높이를 모르면 제대로 자를 수 없다.
   */
  const popupBoxRef = useRef(null);
  const [popupHeight, setPopupHeight] = useState(0);
  useEffect(() => {
    const node = popupBoxRef.current;
    if (!node) return undefined;
    const update = () => setPopupHeight(node.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [stage]);

  useEffect(() => {
    setDragOffset({ x: 0, y: 0 });
  }, [stage, selectedText]);

  /**
   * 🔴 `setPointerCapture`를 쓴다 — 커서가 팝업 밖(호스트 페이지의 iframe 등)으로 나가도
   *    move/up 이벤트를 계속 받는다. 안 그러면 빠르게 끌 때 중간에 놓쳐 팝업이 멈춘다.
   * 🔴 버튼·입력 요소에서 시작한 드래그는 무시한다 — 헤더의 닫기(X)를 누르려다 1px 움직이면
   *    클릭이 드래그로 먹히는 일을 막는다.
   */
  const onDragStart = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button, input, select, textarea, a')) return;
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: dragOffset.x,
      baseY: dragOffset.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onDragMove = (event) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    // 🔴 여기서는 그대로 누적하고, **최종 위치를 화면 안으로 clamp**한다(아래 popupStyle) —
    //    오프셋만 제한하면 기준 위치에 따라 여전히 화면 밖으로 나갈 수 있다.
    setDragOffset({
      x: drag.baseX + (event.clientX - drag.startX),
      y: drag.baseY + (event.clientY - drag.startY),
    });
  };

  const onDragEnd = (event) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  // 클립보드 폴백 안내는 읽을 시간을 준 뒤 사라진다.
  // 🔴 되돌리기가 가능한 토스트는 **5초** 유지한다 (Spec 부가 1 "5초간 원복").
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => {
      setToast('');
      undoRef.current = null;
    }, undoRef.current ? 5000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  /**
   * X 버튼·Esc — "이번 선택은 여기서 끝"이라는 뜻이다. `stage`만 지우면 `anchor`는 남아 있어
   * 토글 버튼이 다시 뜬다 — 방금 닫은 걸 또 열어야 할 것처럼 보여 불필요하다(2026-08-13 사용자
   * 지적). 그래서 앵커까지 같이 지운다 — 다시 보려면 텍스트를 새로 드래그하면 된다.
   */
  const closeOverlay = () => {
    setStage(null);
    setAnchor(null);
  };

  // Esc로 닫기 — 모든 페이지 위에 뜨는 UI라 탈출구가 반드시 있어야 한다.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeOverlay();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * @param {string|null} userUrgency 사용자 사전 선택 긴급도.
   * @param {boolean} routeIntent 첫 호출에서만 true — 하소연이면 제안 팝업으로 보낸다.
   *   긴급도만 다시 고른 경우까지 제안 팝업으로 되돌리면 사용자를 가둔다.
   */
  /**
   * 🔴 S15 — **전송이 승인된 텍스트의 단일 출처.** 모든 LLM 호출은 이 값만 쓴다.
   *    `selectedText`(원문)를 직접 보내는 경로를 남기면, 마스킹 후 긴급도를 바꾸는 순간
   *    원문이 그대로 나간다. 그 구멍을 만들지 않으려고 ref 하나로 좁혔다.
   */
  const sendTextRef = useRef('');

  const runRefine = useCallback(
    async (userUrgency, routeIntent = false) => {
      const text = sendTextRef.current;
      if (!text) return;
      setLoading(true);
      setError('');
      try {
        // S21 — 맥락은 ref에서 읽는다(위 주석 참조). 끈 상태면 `refineClient`가 빈 배열로 덮는다.
        const response = await requestRefine({
          text,
          userUrgency,
          threadContext: threadContextRef.current,
        });
        setResult(response);
        /**
         * 🔴 **폴백·목업은 세지 않는다** — 그러면 「오늘의 사이」가 "AI가 일한 횟수"가 아니라
         *    "버튼을 누른 횟수"가 되어, 목업 상수를 걷어낸 의미가 없어진다.
         */
        if (!response.fallback) {
          bumpUsage(USAGE_KINDS.REFINED);
          // 🔴 건강도 지수의 **분모**다(Spec §3 「정규화된 마찰」). 신호가 아니라 총량이다.
          recordFrictionEvent(FRICTION_EVENTS.REFINED, { teamId: frictionTeamId() });
          /**
           * Spec §3 — 팀 건강도 신호. 🔴 **폴백은 세지 않는다**(모델이 판정한 적 없는 것을
           *    마찰로 올리면 대시보드가 지어낸 수치를 보여준다).
           * 🔴 `misreadRisks[].quote`는 **원문의** 표현이다(`refine/prompt.js` 응답 계약) —
           *    즉 "교정 전 원문에 오해 소지가 있었다"는 사실이고, 교정문의 흠이 아니다.
           */
          if ((response.misreadRisks ?? []).length > 0) {
            recordFrictionEvent(FRICTION_EVENTS.MISREAD, { teamId: frictionTeamId() });
          }
          if (response.detectedIntent === 'venting') {
            recordFrictionEvent(FRICTION_EVENTS.VENTING, { teamId: frictionTeamId() });
          }
          /**
           * 🔴 **이미 판정한 결과를 세기만 한다** (2026-08-16 ⑨). 새 판정을 만들지 않으므로
           *    정확도는 각 기능에서 이미 검증된 것과 같다.
           * 🔴 `urgencyGap`은 「완곡한 표현이 실제 긴급도를 가렸다」는 뜻이다 — 이 제품이
           *    잡으려는 대표 실패(F-11)와 같은 축이라 팀 지표로서 의미가 크다.
           */
          if (response.urgency !== response.aiUrgency && response.urgencySource === 'ai') {
            recordFrictionEvent(FRICTION_EVENTS.URGENCY_GAP, { teamId: frictionTeamId() });
          }
          if ((response.missingElements ?? []).length > 0) {
            recordFrictionEvent(FRICTION_EVENTS.MISSING, { teamId: frictionTeamId() });
          }
        }
        // 🔴 「내 문체」 수집을 제거했다(2026-08-17) — 기능 자체를 지웠다. `App.jsx` 주석 참고.

        if (routeIntent && response.detectedIntent === 'venting' && response.ticket) {
          setStage('venting');
        }
      } catch (caught) {
        // 🔴 예외 메시지에 원문이 섞이지 않게 우리 문구로 덮는다.
        setError(failureMessage('교정'));
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const runDecode = useCallback(async () => {
    const text = sendTextRef.current;
    if (!text) return;
    setDecodeLoading(true);
    setDecodeError('');
    // 해독을 다시 돌리면 이전 회신 초안은 다른 메시지에 대한 답이 된다 — 반드시 함께 지운다.
    setDecodeSource(text);
    setReplyIntent(null);
    setReplyResult(null);
    setReplyError('');
    setReplyAsk(null);
    setReplyAnswers({});
    setReplySentAnswers('');
    try {
      const response = await requestDecode({ text, threadContext: threadContextRef.current });
      setDecodeResult(response);
      if (!response.fallback) bumpUsage(USAGE_KINDS.DECODED); // 교정과 같은 규칙 — 성공만 센다.
    } catch {
      // 🔴 예외 메시지에 원문이 섞이지 않게 우리 문구로 덮는다.
      setDecodeError(failureMessage('해독'));
      setDecodeResult(null);
    } finally {
      setDecodeLoading(false);
    }
  }, []);

  /**
   * S37 — 고른 방향으로 회신 초안 1개를 만든다.
   *
   * 🔴 원문은 `sendTextRef`에서 읽는다(마스킹된 문장). 해독이 본 것과 **같은 문장**에 대한
   *    회신이어야 하고, 마스킹을 우회하는 두 번째 전송 경로를 만들지 않기 위해서다.
   */
  const runReply = useCallback(async (intent, answers = []) => {
    const text = sendTextRef.current;
    if (!text) return;
    setReplyIntent(intent);
    setReplyLoading(true);
    setReplyError('');
    setReplyResult(null);
    try {
      const response = await requestReply({ text, intent, answers });
      setReplyResult(response);
      // 새 초안이 오면 편집본을 그것으로 초기화한다 — 이전 초안을 고치던 내용이 남으면 안 된다.
      setReplyDraftText(typeof response?.draft === 'string' ? response.draft : '');
    } catch {
      // 🔴 예외 메시지에 원문이 섞이지 않게 우리 문구로 덮는다.
      setReplyError(failureMessage('회신 초안'));
      setReplyResult(null);
    } finally {
      setReplyLoading(false);
    }
  }, []);

  /* ── S40: 회신 초안 UI 조작 ──────────────────────────────────────────── */

  useEffect(() => {
    let alive = true;
    getLocal(STORAGE_KEYS.REPLY_AUTO, false).then((value) => {
      if (alive) setReplyAuto(value === true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleReplyAuto = useCallback(() => {
    setReplyAuto((prev) => {
      const next = !prev;
      setLocal(STORAGE_KEYS.REPLY_AUTO, next);
      if (next) setReplyAsk(null); // 자동으로 바꾸면 열려 있던 질문 카드는 의미가 없다
      return next;
    });
  }, []);

  const pickReplyIntent = useCallback(
    (key) => {
      if (replyAuto) {
        setReplySentAnswers('');
        runReply(key, []);
        return;
      }
      // 같은 방향을 다시 누르면 질문 카드를 닫는다(답을 고치려고 여는 경로이기도 하다).
      setReplyAsk((prev) => (prev === key ? null : key));
      setReplyAnswers({});
    },
    [replyAuto, runReply],
  );

  const submitReply = useCallback(
    (withAnswers) => {
      if (!replyAsk) return;
      const list = withAnswers ? buildAnswerList(replyAsk, replyAnswers) : [];
      setReplySentAnswers(answersToText(list));
      runReply(replyAsk, list);
      setReplyAsk(null);
    },
    [replyAsk, replyAnswers, runReply],
  );

  /**
   * 🔴 옆 패널을 **열 내용이 있을 때만** 띄운다. 방향을 고르기 전에도 빈 패널을 띄우면 화면
   *    절반이 아무것도 없는 상자로 덮인다.
   */
  const replyPanelOpen =
    replyAsk !== null || replyLoading || replyError !== '' || replyResult !== null;
  const replySideBySide = viewportWidth >= SIDE_BY_SIDE_MIN_WIDTH && replyPanelOpen;


  /**
   * S14 — 상대가 지금 오프타임인지 계산한다. 작성 모드에서만 의미가 있다(해독 모드는 "언제
   * 보낼까"가 아니라 "무슨 뜻인가"를 묻는 기능이다).
   *
   * 🔴 S17로 목업(`MOCK_RECIPIENT`)이 걷혔다 — 이제 **사용자가 고른 실제 수신자**의 타임존을 쓴다.
   *    수신자가 하나도 없으면 계산할 근거가 없으므로 조용히 "예약 불필요"로 접는다(지어내지 않는다).
   */
  const runSchedule = useCallback(async (target) => {
    setScheduleInfo(null);
    if (!target) {
      setScheduleInfo({ needsSchedule: false, reason: null, sendAt: null, localParts: null });
      return;
    }
    try {
      const info = await computeNextSendTime({
        now: new Date(),
        timeZone: target.timeZone,
        countryCode: target.countryCode,
      });
      setScheduleInfo(info);
    } catch {
      // 🔴 스케줄 계산 실패가 교정 자체를 막으면 안 된다 — 조용히 "예약 불필요"로 접는다.
      setScheduleInfo({ needsSchedule: false, reason: null, sendAt: null, localParts: null, holidayLookupFailed: true });
    }
  }, []);

  /**
   * S20 / Spec 권장 10 — 스니펫 저장. 🔴 사용자가 버튼을 눌렀을 때만 실행된다(자동 저장 없음).
   *    결과를 반드시 알린다 — 저장했는지 아닌지 모르면 같은 문장을 계속 다시 누르게 된다.
   */
  const saveSnippet = async (text) => {
    const outcome = await addSnippet({ text });
    if (outcome.ok && outcome.reason === 'duplicate') {
      setToast('이미 저장된 문장이에요 — 목록 맨 위로 올렸어요');
    } else if (outcome.ok) {
      setToast('저장 문구에 담았어요 — 사이드패널에서 다시 쓸 수 있어요');
    } else if (outcome.reason === 'full') {
      setToast(`저장 문구가 가득 찼어요 (최대 ${MAX_SNIPPETS}개) — 사이드패널에서 정리해 주세요`);
    } else {
      setToast('저장할 문장이 없어요');
    }
  };

  /**
   * S20 / Spec 권장 3 — 역번역 재생성.
   * 🔴 `bypassCache`로 실제로 다시 부른다 — 캐시 히트로 같은 문장이 오면 재생성이 거짓말이 된다.
   */
  const [regenerating, setRegenerating] = useState(false);
  /**
   * 🔴 **역번역이 못 쓸 상태로 오면 한 번은 우리가 다시 부른다** (2026-08-16 사용자 지적 ①:
   *    "역번역 오류가 생각보다 자주 있네").
   *    감지(`core/refine/backcheck.js`)는 되지만 **매번 사용자가 「다시 만들기」를 눌러야** 했다.
   *    실패가 간헐적이라 대개 한 번 더 부르면 정상으로 온다 — 그 한 번을 사람이 하게 할 이유가 없다.
   * 🔴 **딱 한 번만** 한다. 실패가 계속되면 무한 재시도가 되고, 이 호출은 돈이 든다.
   *    두 번째부터는 안내 문구가 사용자에게 「다시 만들기」를 권한다(지금 동작 그대로).
   * 🔴 재시도한 사실을 **감추지 않는다** — 화면 문구로 알린다. 조용히 두 번 부르면 같은 입력에
   *    호출이 두 배로 드는 이유를 아무도 모른다.
   */
  const autoRetriedRef = useRef(false);

  useEffect(() => {
    if (!result || regenerating) return;

    /**
     * 🔴 **폴백도 한 번은 다시 부른다 — 단, `invalid`일 때만** (2026-08-16 사용자 승인 ⓑ).
     *    실확장에서 「AI 응답을 **해석하지 못해** 준비된 예시를 보여 드리고 있습니다」가 떴다.
     *    이건 네트워크 실패가 아니라 **모델이 응답했는데 JSON 계약을 못 맞춘 것**이고,
     *    같은 입력을 다시 부르면 살아나는 경우가 많다(모델 출력이 확률적이라 그렇다).
     * 🔴 **`quota`·`error`는 재시도하지 않는다.** 크레딧이 소진됐거나 서버에 못 닿는 상황은
     *    즉시 다시 불러도 같은 결과이고, 호출만 두 배로 태운다. 그때는 화면 안내가 사용자에게
     *    「다시 만들기」를 맡긴다.
     */
    const retryableFallback = result.fallback === true && result.fallbackReason === 'invalid';

    /**
     * 🔴 폴백에는 역번역이 아예 없다(`''`) — `checkBackTranslation`은 그걸 「실패」로 보지
     *    않는다(빈 값은 없음이지 오류가 아니다). 그래서 두 판정을 **따로** 본다.
     */
    const backBroken = !checkBackTranslation({
      backTranslation: result.backTranslation ?? '',
      refined: result.refined ?? '',
      sourceLanguage: result.sourceLanguage ?? null,
      targetLanguage: result.targetLanguage ?? null,
    }).usable;

    if (!backBroken && !retryableFallback) {
      // 정상으로 왔으면 다음 문장을 위해 기회를 되돌려 준다.
      autoRetriedRef.current = false;
      return;
    }
    // 🔴 **딱 한 번.** 재시도한 결과가 또 실패해도 여기서 멈춘다 — 호출은 돈이 든다.
    if (autoRetriedRef.current) return;
    autoRetriedRef.current = true;
    setToast(
      retryableFallback
        ? '교정 응답을 해석하지 못해 한 번 더 시도할게요'
        : '역번역이 이상해서 한 번 더 만들어 볼게요',
    );
    regenerateBackTranslation();
  }, [result, regenerating]);

  const regenerateBackTranslation = async () => {
    const text = sendTextRef.current;
    if (!text || regenerating) return;
    setRegenerating(true);
    try {
      /**
       * 🔴 **현재 긴급도를 그대로 넘긴다**(2026-08-13 사용자 지적): 넘기지 않으면 모델이 매번 다시
       *    판정해 「다시 만들기」를 누를 때마다 긴급도가 흔들린다. 사용자는 문장을 다시 만들어
       *    달라고 한 것이지 판정을 다시 해 달라고 한 게 아니다.
       */
      const response = await requestRefine({
        text,
        userUrgency: result?.urgency ?? null,
        bypassCache: true,
      });
      setResult(response);
    } catch {
      setToast('역번역을 다시 만들지 못했어요 — 잠시 후 다시 시도해 주세요');
    } finally {
      setRegenerating(false);
    }
  };

  /**
   * 🔴 스니펫을 **교정 없이 바로** 입력창에 넣는다 (2026-08-13 사용자 제안).
   *    이미 사용자가 승인해 저장해 둔 완성 문장이므로 LLM을 부를 이유가 없다 — 호출을 넣으면
   *    지연과 무료 할당량만 쓰고 결과는 오히려 사용자가 고른 문장에서 멀어진다.
   * 🔴 S13 학습에도 넣지 않는다: 이건 "AI 교정문을 사용자가 고친" 사건이 아니라 저장해 둔
   *    문장을 꺼내 쓴 것이라, 수정 패턴으로 해석하면 학습이 오염된다.
   */
  const insertSnippet = async (entry) => {
    setSnippetOpen(false);
    await markSnippetUsed(entry.id);
    await applyToTarget(entry.text, null, snippetMode);
  };

  /**
   * 🔴 **전송 전 관문의 단일 출처** (S41에서 `openPopup` 안에 있던 것을 꺼냈다).
   *    LLM으로 나가는 텍스트는 어느 경로에서 왔든 **여기 하나**를 통과한다 — 민감정보 검사(S15)
   *    → `sendTextRef` 확정 → 모드별 호출. 회신 초안을 다듬기로 넘기는 경로가 생기면서 입구가
   *    둘이 됐고, 검사를 복사해 두면 한쪽에만 빠뜨리는 사고가 난다(단축키 경로에서 같은 이유로
   *    이미 한 번 정리한 적이 있다 — `openPopupRef` 주석).
   */
  const beginSend = (text) => {
    const { findings, hasSensitive } = detectSensitive(text);
    if (hasSensitive) {
      setGuard({ summary: summarize(findings), maskedText: redact(text, findings) });
      setStage('guard');
      /**
       * 🔴 **막은 것은 긍정 신호다** (2026-08-16 ⑨). 사고가 났다는 뜻이 아니라 **사고를
       *    막았다는 뜻**이다 — 팀 입장에서 이 숫자가 크다는 것은 가드가 일하고 있다는 것이다.
       * 🔴 카운트만 올린다. 무엇이 걸렸는지는 어디에도 남기지 않는다(Spec 필수 5).
       */
      recordFrictionEvent(FRICTION_EVENTS.SENSITIVE_BLOCKED, { teamId: frictionTeamId() });
      // 🔴 팀 지표와 **따로** 센다 — 마찰 카운트는 업로드 후 로컬에서 지워져 홈에서 못 읽는다.
      bumpUsage(USAGE_KINDS.BLOCKED_SENSITIVE);
      return; // ← 네트워크 호출 없음
    }
    setGuard(null);
    sendTextRef.current = text;
    dispatch();
  };

  /** 검사를 통과한 텍스트를 현재 모드(작성/해독)에 맞는 호출로 보낸다. */
  const dispatch = () => {
    if (modeRef.current === 'decode') {
      setDecodeResult(null);
      setStage('decode');
      runDecode();
      return;
    }
    setStage('refine');
    runRefine(null, true);
    runSchedule(recipient);
  };

  /**
   * S41 — 회신 초안을 **다듬기로 넘긴다** (2026-08-14 사용자 제안).
   *
   * 🔴 이것이 개인화의 유일한 경로다. 회신 쪽에 용어집·수신자 가이드·캐주얼 톤·언어쌍을 다시
   *    구현하지 않는다 — 두 벌이 되면 한쪽만 고치는 사고가 난다. 초안은 모국어까지만 만들고,
   *    번역과 개인화는 이미 그 일을 하는 「다듬기」가 전부 맡는다.
   * 🔴 **민감정보 검사를 건너뛰지 않는다.** 초안에는 사용자가 사전 질문에 직접 넣은 값이 들어
   *    있을 수 있다(사유·일정 등). `beginSend`를 그대로 통과시킨다.
   * 🔴 모드를 `compose`로 되돌린다. 지금은 해독 모드라, 안 바꾸면 `dispatch`가 이 초안을 다시
   *    **해독**하러 보낸다 — 자기가 쓴 문장을 남의 메시지처럼 해석하게 된다.
   * 🔴 `useCallback`을 쓰지 않는다: 빈 의존성으로 감싸면 첫 렌더의 `dispatch`를 붙잡아
   *    **수신자가 낡는다**(예약 시각이 옛 타임존으로 계산된다).
   */
  const refineReplyDraft = (text) => {
    const trimmed = String(text ?? '').trim();
    if (trimmed === '') return;
    modeRef.current = 'compose';
    setReplyAsk(null);
    beginSend(trimmed);
  };

  /**
   * S17 — 수신자를 바꾸면 선택을 저장하고, **교정과 예약 계산을 둘 다 다시 돌린다** — 수신자가
   * 바뀌면 소통 태그(교정 톤)도 타임존(예약 시각)도 달라지므로 옛 결과를 그대로 두면 화면이
   * 거짓말을 하게 된다.
   */
  /**
   * 감지된 후보를 수신자로 등록한다 (2026-08-16).
   *
   * 🔴 **사용자가 누를 때만 저장된다.** 이름 말고는 아무것도 추측하지 않는다 — 타임존은
   *    **내 타임존**으로 두고, 언어·태그는 비운다. 상대의 지역·성향을 이름에서 유추하면
   *    그건 우리가 만들지 않기로 한 종류의 판단이다(필수 9 · 필수 2 3순위).
   * 🔴 등록 후 사이드패널에서 지역·언어를 정하라고 알린다 — 안 그러면 예약 시각이 내 기준으로
   *    계산되는 것을 모른 채 쓴다.
   */
  const addDetectedPerson = async (name) => {
    try {
      const created = await addRecipient({
        name,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      const list = await listRecipients();
      setRecipients(list);
      setRecipient(created);
      await setSelectedRecipientId(created.id);
      setPersonSuggestions([]);
      setToast(`${name} 님을 추가했어요 — 사이드패널에서 지역·언어를 정해 주세요`);
    } catch {
      setToast('추가하지 못했어요');
    }
  };

  /**
   * 다듬기 팝업 안에서 사람을 새로 등록한다 (2026-08-17 사용자 요청 ②).
   *
   * 🔴 **`addDetectedPerson`과 다른 함수다.** 그쪽은 본문에서 발견한 이름을 **한 번의 클릭**으로
   *    넣는 길이라 지역을 물을 자리가 없고, 그래서 **내 시간대·언어 미지정**으로 만든 뒤
   *    "사이드패널에서 정해 주세요"라고 안내한다. 이쪽은 사용자가 폼을 채우고 들어오므로
   *    시간대·국가코드·언어가 **처음부터 맞다.** 둘을 한 함수로 합치면 한쪽이 반드시 나빠진다.
   * 🔴 **던지는 것을 삼키지 않는다** — 폼이 오류를 자기 안에서 보여준다. 여기서 토스트로
   *    바꿔 버리면 팝업이 닫힌 뒤에야 실패를 알게 된다.
   * 🔴 추가한 사람을 **바로 선택**하고 교정을 다시 돌린다. 추가만 하고 그대로 두면 방금 만든
   *    설정이 이번 교정에 반영되지 않아 "왜 안 바뀌지"가 된다.
   */
  const addRecipientInline = async ({ name, timeZone, countryCode, language }) => {
    const created = await addRecipient({ name, timeZone, countryCode, language });
    const list = await listRecipients();
    setRecipients(list);
    setRecipient(created);
    await setSelectedRecipientId(created.id);
    setToast(`${created.name} 님을 추가했어요`);
    if (stage === 'refine') {
      runRefine(result?.urgencySource === 'user' ? result.urgency : null);
      runSchedule(created);
    }
    return created;
  };

  /**
   * 문체를 **이 수신자에게 기억시킨다** (2026-08-18 사용자 지적 ①).
   *
   * 🔴 예전에는 전역 한 칸에 저장해서 상대가 바뀌어도 값이 따라붙었다. 사람마다 다른 것이
   *    당연한 값이라 **그 사람 기록에 넣는다** — 다음에 같은 상대로 다듬으면 그대로 시작한다.
   * 🔴 아직 수신자를 안 골랐으면 저장할 곳이 없다. 그때는 이번 교정에만 적용하고 넘어간다 —
   *    없는 사람에게 저장하려다 오류를 내는 것보다 낫다.
   */
  const rememberRegister = async (next) => {
    if (!recipient?.id) return;
    await updateRecipient(recipient.id, { register: next });
    const list = await listRecipients();
    setRecipients(list);
    setRecipient(list.find((entry) => entry.id === recipient.id) ?? recipient);
  };

  /**
   * **이 마찰은 어느 팀 것인가** (2026-08-19 — 대시보드 기준 불일치 수정).
   *
   * 🔴 교정에 실리는 용어집과 **같은 기준**을 쓴다(`refineClient`의 팀 판정표). 두 기준이
   *    다르면 같은 한 번의 교정이 갈려서, 팀장이 보는 협업 상황이 실제와 어긋난다.
   * 🔴 「개인」이면 어느 팀에도 올리지 않는다 — 주인이 없는 카운트다.
   */
  const frictionTeamId = () => {
    const chosen = recipient?.teamId ?? activeTeamId ?? null;
    if (chosen === null || chosen === PERSONAL_TEAM_ID) return NO_TEAM_BUCKET;
    return chosen;
  };

  /**
   * **이 사람과는 어느 팀 일을 하는가** (2026-08-19 사용자 요청 ③) — 문체(`rememberRegister`)와
   * 같은 방식이다.
   *
   * 🔴 **정하는 자리를 여기(다듬기 패널) 하나로 둔다.** 프로필 편집에도 같은 칩이 있었는데
   *    **팀이 둘 이상일 때만** 그려져서, 팀이 하나인 사용자에게는 화면에 존재하지 않았다.
   *    문장을 쓰는 순간이 「이건 어느 팀 일인가」를 아는 순간이기도 하다.
   * 🔴 고른 값은 **그 사람 기록**에 남는다 — 다음에 같은 상대로 다듬으면 그대로 시작한다.
   * 🔴 수신자를 아직 안 골랐으면 저장할 곳이 없다. 이번 교정에만 적용하고 넘어간다.
   */
  const rememberTeam = async (next) => {
    if (!recipient?.id) return;
    await updateRecipient(recipient.id, { teamId: next });
    const list = await listRecipients();
    setRecipients(list);
    setRecipient(list.find((entry) => entry.id === recipient.id) ?? recipient);
  };

  const changeRecipient = async (id) => {
    const next = recipients.find((entry) => entry.id === id) ?? null;
    setRecipient(next);
    await setSelectedRecipientId(id);
    if (stage === 'refine') {
      runRefine(result?.urgencySource === 'user' ? result.urgency : null);
      runSchedule(next);
    }
  };

  /**
   * Spec 필수 6 — Low + 오프타임에서 "예약" 선택. 우리가 실제로 강제하는 것은 우리 자신의
   * 삽입 동작뿐이므로(RefinePopup 헤더 주석 참조), 텍스트를 넣지 않고 제안을 확인만 시킨다.
   */
  const acceptSchedule = async () => {
    if (!scheduleInfo?.localParts) return;
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][scheduleInfo.localParts.weekday];
    const hh = String(scheduleInfo.localParts.hour).padStart(2, '0');
    const label = `${weekday} ${hh}:00`;

    /**
     * 🔴 **우리가 대신 보내지 않는다 — 보낼 수 없다.** Slack은 앱 등록+OAuth+관리자 승인이
     *    필요하고, Teams Graph API엔 채팅 예약 전송이 없고, Gmail API에도 예약 전송이 없다
     *    (조사 근거는 `src/lib/reservations.js` 헤더). 그래서 "예약했다"가 아니라
     *    **"넣지 않고 적어 뒀다"**고 말하고, 사이드패널에서 다시 꺼내 볼 수 있게 한다.
     */
    const outcome = await addReservation({
      text: result?.refined ?? '',
      recipientName: recipient?.name ?? '상대',
      sendAtLabel: label,
      sendAtISO: scheduleInfo.sendAt ?? null,
    });

    // 🔴 목록이 가득 차 저장에 실패했으면 세지 않는다 — 화면에 없는 예약을 카운트가 주장하게 된다.
    if (outcome.ok) {
      bumpUsage(USAGE_KINDS.SCHEDULED);
      recordFrictionEvent(FRICTION_EVENTS.SCHEDULE, { teamId: frictionTeamId() }); // Spec §3 — 예약 제안을 받아들인 긍정 신호.
      bumpUsage(USAGE_KINDS.BLOCKED_OFF_HOURS);
    }

    setStage(null);
    setAnchor(null);
    setToast(
      outcome.ok
        ? `🌙 ${label}에 보내도록 적어 뒀어요 — 사이드패널에서 확인할 수 있어요`
        : '예약 목록이 가득 찼어요 — 사이드패널에서 정리해 주세요',
    );
  };

  /**
   * S25 / Spec 부가 7 — 결정 요약.
   *
   * 🔴 **동의를 LLM 호출보다 먼저 확인한다.** 동의가 없으면 요약을 만들지 않고 페이지만 연다 —
   *    "일단 만들어 보여주고 저장만 막기"로 하면, 동의 없이 남의 메시지를 뽑아내는 일이 이미
   *    벌어진 뒤다(`lib/decisions.js` 헤더의 조건 ④).
   * 🔴 결과는 `chrome.storage`가 아니라 **background 메모리**로 넘긴다 — 사용자가 「저장하기」를
   *    누르기 전에는 디스크에 남지 않는다.
   */
  const summarizeDecisionsFromPage = async () => {
    if (!(await hasDecisionsConsent())) {
      chrome.runtime?.sendMessage({ type: 'decisions:open' });
      setFabHint('결정 요약은 먼저 동의가 필요해요 — 새 탭에서 안내할게요');
      return;
    }

    const collected = collectDecisionThread(targetRef.current);
    /**
     * 🔴 **가리킨 것을 못 쓰면 그렇다고 말한다** — 다른 것으로 바꿔치기하지 않는다
     *    (2026-08-14 사용자 실측: `안녕하세요`를 선택했더니 페이지 전체 대화가 요약됐다).
     */
    if (collected.source === 'selection-too-short') {
      setFabHint(`선택한 부분이 너무 짧아요 — ${MIN_DECISION_CHARS_HINT}자 이상 드래그해 주세요`);
      return;
    }
    if (!collected.text) {
      setFabHint('요약할 대화를 드래그해 선택해 주세요');
      return;
    }

    setFabHint('결정을 정리하는 중…');
    try {
      const result = await requestDecisions({ text: collected.text });
      chrome.runtime?.sendMessage({
        type: 'decisions:openWithResult',
        pending: {
          decisions: result.decisions ?? [],
          truncated: result.truncated === true,
          fallbackNotice: result.fallbackNotice ?? null,
          // 🔴 호스트명만 — 전체 URL은 경로·쿼리에 스레드 ID가 붙는다.
          sourceLabel: location.hostname,
          // 🔴 **무엇을 읽었는지 화면이 말해야 한다** — 자동 수집은 틀릴 수 있고(Lessons #3·#4),
          //    사용자가 그 사실을 모르면 엉뚱한 표를 자기 대화의 결론으로 믿는다.
          source: collected.source,
          messageCount: collected.messageCount,
          redactedCount: collected.redactedCount,
        },
      });
      setFabHint('');
    } catch (error) {
      console.warn('[사이] 결정 요약 실패:', error?.name ?? 'unknown');
      setFabHint('결정 요약을 만들지 못했어요 — 잠시 후 다시 시도해 주세요');
    }
  };

  /**
   * 🔴 S15 / Spec 필수 11 — **여기가 유일한 진입점이고, LLM 호출보다 먼저 검사한다.**
   *    감지되면 어떤 호출도 부르지 않는다. "보내고 나서 가린다"는 성립하지 않는다.
   */
  const openPopup = () => {
    // 🔴 선택이 없으면 다듬을 대상이 없다 — 빈 팝업을 띄우는 대신 이유를 말한다
    //    (2026-08-13 사용자 요청). 커서만 놓아도 버튼이 뜨기 때문에 생기는 경로다.
    if (!selectedText) {
      // 🔴 페이지 하단 토스트는 호스트 페이지 배경에 묻혀 잘 안 보였다(2026-08-13 실측).
      //    버튼 옆에 붙여 **시선이 있는 자리**에서 알린다.
      setFabHint(`다듬을 문장을 드래그해 주세요 (${MIN_SELECTION_LENGTH}자 이상)`);
      return;
    }

    setResult(null);
    setError('');
    setUrgencyNotice('');

    /**
     * S21 / Spec 권장 8 — 직전 대화를 **지금** 모은다. 팝업이 열린 뒤에 모으면 팝업 자신이
     * 화면을 가려 앵커 위치 판단이 흔들린다.
     * 🔴 **해독 모드에서도 모은다** (2026-08-14 사용자 요청으로 변경). 예전에는 작성 모드에서만
     *    모았고 그 이유는 "앞뒤 대화를 끌어오면 원문 해석이 아니라 대화 요약이 된다"였다.
     *    그 우려는 지금도 유효하므로 **막는 위치를 옮겼다**: 맥락은 보내되, `decode/prompt.js`가
     *    맥락의 용도를 지시대명사 해소와 회신 방향 추천 **둘로 한정**하고 4축은 원문만으로
     *    판정하게 못박는다. 즉 제한은 사라진 게 아니라 프롬프트로 내려갔다.
     * 🔴 결과는 ref(전송용)와 state(표시용)에만 있고 저장소로 내려가지 않는다.
     */
    const collected = collectThreadContext(targetRef.current);
    threadContextRef.current = collected.messages;
    setThreadContext(collected.messages);

    /**
     * 🔴 수신자 목록을 **팝업을 열 때마다** 다시 읽는다(실측 2026-08-13): 마운트 시 한 번만 읽으면,
     *    사이드패널에서 태그·비공개를 바꿔도 이미 열려 있던 페이지의 팝업은 옛 값을 보여준다.
     *    실제 LLM payload는 `refineClient`가 저장소에서 매번 새로 읽으므로 전송 자체는 안전했지만,
     *    **화면이 "공개"라고 보여주는데 실제로는 비공개인** 불일치가 생겨 사용자를 오해시킨다.
     */
    (async () => {
      const [list, selected] = await Promise.all([listRecipients(), getSelectedRecipient()]);
      setRecipients(list);

      /**
       * 🔴 **대화 상대 자동 인식** (2026-08-16). 이미 모아 둔 대화에서 발화자 이름 후보를 뽑아
       *    ① 등록된 사람과 일치하면 **자동 선택**(고르는 수고만 줄인다 — 새 판단이 아니다)
       *    ② 등록 안 된 이름이면 **제안만** 한다(등록은 사용자가 누를 때).
       * 🔴 후보가 없으면 조용히 기존 선택을 유지한다 — 못 찾았다는 사실을 화면에 늘어놓지 않는다.
       */
      const names = detectSpeakerNames(collected.messages);
      const { matchedId, suggestions } = matchRecipient(names, list);
      setPersonSuggestions(suggestions ?? []);
      if (matchedId && matchedId !== selected?.id) {
        const matched = list.find((entry) => entry.id === matchedId) ?? selected;
        setRecipient(matched);
        await setSelectedRecipientId(matchedId);
      } else {
        setRecipient(selected);
      }
    })();

    beginSend(selectedText);
  };

  /**
   * S26 / Spec 부가 9 — 단축키(Alt+D)로도 팝업을 연다.
   * 🔴 마우스 경로(`openPopup`)와 **같은 함수**를 부른다 — 별도 경로를 만들면 민감정보 가드(S15)
   *    같은 검사를 한쪽에만 빠뜨리는 사고가 난다. 단축키는 입구만 하나 더 낸 것이다.
   * 🔴 `openPopup`은 매 렌더 새로 만들어지므로 ref로 최신 것을 가리킨다 — effect를 매번 재구독
   *    하지 않으면서도 닫힌 클로저를 피한다.
   */
  const openPopupRef = useRef(openPopup);
  openPopupRef.current = openPopup;

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome?.runtime?.onMessage) return undefined;
    const onMessage = (message) => {
      if (message?.type === 'refine-selection') {
        // 선택이 없으면 `openPopup`이 알아서 안내 문구를 띄운다(중복 판단하지 않는다).
        openPopupRef.current();
        return;
      }
      /**
       * 🔴 **저장 문구 열기** (2026-08-19 사용자 결정). 지금까지 이 목록은 **로고에 커서를 올려야**
       *    펼쳐지는 버튼 안에 있었다 — hover가 필요한 입구는 키보드만으로 닿을 수 없다.
       * 🔴 **해독 상황에서는 열지 않는다.** 남의 메시지를 읽는 중에 내 저장 문구를 넣을 자리가
       *    없다 — 화면에서도 그때는 이 버튼을 아예 안 낸다(같은 규칙을 여기서도 지킨다).
       * 🔴 **넣을 입력창이 없으면 이유를 말한다.** 조용히 아무 일도 안 일어나면 고장으로 읽힌다.
       */
      if (message?.type === 'open-snippets') {
        if (modeRef.current === 'decode' || !targetRef.current) {
          /**
           * 🔴 **힌트가 아니라 토스트다** (2026-08-19 자체 점검 수정). 처음에는 `setFabHint`를
           *    썼는데, 힌트는 **FAB 트리 안**에 그려지고 FAB 트리는 앵커가 있어야 렌더된다
           *    (`if (!anchor) return toastNode`). 정확히 이 실패 경로 — 아무것도 선택하지 않고
           *    입력창에 커서도 없는 상태 — 에서는 앵커가 없어서, **안내가 그릴 곳이 없어
           *    조용히 사라졌다.** "조용한 무반응은 고장으로 읽힌다"고 써 놓고 그 경우를 남겼던
           *    것이다. 토스트는 앵커와 무관하게 뜨고 4초 뒤 스스로 사라진다.
           */
          setToast('문장을 넣을 입력창을 먼저 눌러 주세요 — 그다음 Alt+X로 저장 문구를 열 수 있어요');
          return;
        }
        setSnippetOpen(true);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  /** 사용자가 마스킹본 전송을 선택했을 때만 호출한다 — 원문은 끝까지 나가지 않는다. */
  const sendMasked = () => {
    const masked = guard?.maskedText;
    if (!masked) return;
    sendTextRef.current = masked;
    dispatch();
  };

  /**
   * Spec 필수 1 — 사용자가 긴급도를 바꾸면 그 값으로 다시 교정한다(톤이 달라져야 한다).
   * 같은 값을 다시 누르면 아무것도 하지 않는다.
   */
  const changeUrgency = (urgency) => {
    if (result?.urgency === urgency) return;

    /**
     * S20 / Spec 권장 2 — 퇴근 요정 우회 경고.
     * 🔴 **막지 않고 경고만 한다.** Low + 오프타임이면 강제 예약이 걸리는데(필수 6), 긴급도를
     *    올리면 그 제약이 풀린다. 진짜 긴급해져서 올리는 경우가 있으므로 차단하면 안 되지만,
     *    제약이 풀린다는 사실을 모른 채 넘어가게 두면 안전장치가 있으나 마나가 된다.
     *    그래서 한 번만 알리고 그대로 진행한다.
     */
    if (result?.urgency === 'LOW' && urgency !== 'LOW' && scheduleInfo?.needsSchedule) {
      // 🔴 페이지 하단 토스트는 배경에 묻혀 잘 안 보인다(2026-08-13 사용자 지적).
      //    **팝업 안**에서 알린다 — 결정을 내리는 자리와 알림이 같은 화면에 있어야 한다.
      // 🔴 해요체로 통일 (S45 P6과 같은 건 — 템플릿 문자열이라 그때 sweep에서 빠졌다).
      setUrgencyNotice('긴급도를 올려 예약 제한이 풀렸어요 — 지금 바로 넣을 수 있어요');
      // Spec §3 — 안전장치를 우회한 순간이 마찰 신호다. 🔴 막지 않는다(기존 정책 그대로).
      recordFrictionEvent(FRICTION_EVENTS.FORCE_OFF_HOURS, { teamId: frictionTeamId() });
    }

    runRefine(urgency);
  };

  /**
   * 🔴 S07(심리스 교체) 소관의 **최소 구현**이다. `<textarea>`/`<input>`만 직접 치환한다.
   *    contentEditable(Gmail 등)은 Range/`insertText` 처리가 필요하고 서식·인용문을 깨뜨릴 수
   *    있어(Lessons #2) 여기서 건드리지 않는다. 클립보드 폴백도 S07 소관이다.
   */
  /**
   * 승인 문장을 입력창에 넣는다 (S07 / Spec 필수 5).
   * DOM 교체가 안 되면 클립보드로 폴백하고 **반드시 사용자에게 알린다** — 조용한 실패가 최악이다.
   */
  const applyToTarget = async (text, aiText = null, mode = 'replace') => {
    if (!text) return;

    // 🔴 S13 — 사용자가 AI 교정문을 고쳐서 적용했을 때만 학습한다. `recordEdit`은 분류 결과
    //    (카테고리 id + 편집 거리 수치)만 저장하고 두 문장은 저장하지 않는다 (Spec 필수 5).
    //    학습이 적용을 막으면 안 되므로 여기서 await하지 않고, 적용이 끝난 뒤에 결과만 읽는다.
    const learning =
      aiText && aiText !== text ? recordEdit(aiText, text).catch(() => null) : null;

    const outcome = await applyText({
      target: targetRef.current,
      range: rangeRef.current,
      text,
      mode,
    });

    /**
     * Spec §3 — 「명확한 요청으로 교정됨」 긍정 신호.
     *
     * 🔴 **교정 결과를 실제로 내보냈을 때만** 센다. 교정문을 보기만 하고 닫으면 상대에게는 원문도
     *    교정문도 가지 않았으므로 정리된 것이 없다.
     * 🔴 `aiText`가 있는 호출만 교정 경로다 — 하소연 티켓 적용(`applyToTarget(text)` 1인자)은
     *    교정문이 아니라 다른 문서라 여기 섞이면 안 된다.
     * 🔴 클립보드 폴백도 성공으로 본다 — 사용자에게는 문장이 손에 들어온 것이고, DOM 교체가
     *    막힌 사이트인지 여부는 협업 마찰과 아무 상관이 없다.
     */
    if (outcome.ok && aiText && (result?.misreadRisks ?? []).length > 0) {
      recordFrictionEvent(FRICTION_EVENTS.CLEAR, { teamId: frictionTeamId() });
    }

    if (outcome.ok && outcome.method === APPLY_METHOD.CLIPBOARD) {
      setStage(null);
      setAnchor(null);
      // 클립보드 안내가 학습 안내보다 우선이다 — 이걸 놓치면 문장을 못 넣는다.
      setToast('클립보드에 자동 복사되었습니다 (Ctrl+V)');
      return;
    }
    if (outcome.ok) {
      setStage(null);
      setAnchor(null);
      /**
       * S24 / Spec 부가 1 — 5초 원복. 🔴 되돌릴 수 있는 경로에서만 버튼을 준다
       *    (`applyText`가 `undo`를 실어 보낸 경우) — 못 하는 일을 버튼으로 내밀지 않는다.
       */
      undoRef.current = outcome.undo ?? null;
      // 🔴 학습 결과를 **반드시 알린다**(2026-08-13 사용자 실측): 고쳐서 적용해도 아무 반응이
      //    없어서 "되는 건지 안 되는 건지" 알 수 없었다. 분류표에 안 맞아 기록하지 않는 것은
      //    정상 동작이지만, 그걸 침묵으로 표현하면 고장과 구분되지 않는다.
      const learnedMessage = learning ? learnedToast(await learning) : null;
      setToast(learnedMessage ?? '입력창에 넣었어요');
      return;
    }

    setError('입력창에 넣지 못했어요. 문장을 직접 복사해 주세요.');
  };

  // 🔴 토스트는 앵커와 무관하게 뜬다 — 적용 직후 앵커를 지우므로, 앵커 가드 안에 두면
  //    클립보드 폴백 안내가 영원히 보이지 않는다 (Spec 필수 5의 안내가 사라지는 셈).
  const toastNode = toast ? (
    <div className="sai-toast" role="status">
      <span className="sai-toast-text">{toast}</span>
      {/* S24 / Spec 부가 1 — 5초 원복. 되돌릴 수 있는 경로일 때만 뜬다. */}
      {undoRef.current && (
        <button
          type="button"
          className="sai-toast-undo"
          onClick={() => {
            /**
             * 🔴 되돌리기는 **성공 여부를 확인하고 그대로 말한다** (2026-08-14 사용자 실측):
             *    ChatGPT(ProseMirror)에서 `execCommand('undo')`가 원문을 지우지 않고 뒤에
             *    덧붙여 되돌리기 전보다 더 망가졌다. 이제 `applyText`가 결과를 검증해 돌려주므로,
             *    실패했으면 "됐다"고 하지 않는다.
             */
            const restored = undoRef.current?.() !== false;
            undoRef.current = null;
            setToast(restored ? '되돌렸어요' : '되돌리지 못했어요 — 입력창을 직접 확인해 주세요');
          }}
        >
          되돌리기
        </button>
      )}
    </div>
  ) : null;

  if (!anchor) return toastNode;

  // 버튼은 선택 영역 "바로 옆"(오른쪽, 세로 중앙 정렬)에 둔다 — 아래쪽이 아니라 옆에 붙어야
  // 방금 고른 텍스트와 시각적으로 묶여 보인다(2026-08-13 사용자 요청).
  /**
   * 🔴 접혔을 때가 아니라 **펼쳤을 때 너비**로 클램프한다 — 오른쪽 끝에서 선택하면 확장된
   *    버튼이 화면 밖으로 잘린다(로고만 기준으로 잡으면 확장 순간에야 드러나는 결함이다).
   *    그래서 접힌 상태에서도 확장분만큼 여유를 두고 자리를 잡는다.
   */
  /** 🔴 아래 공간이 목록 높이(최대 260px)에 못 미치면 위로 뒤집는다 — 작업표시줄 근처에서 잘렸다. */
  const snippetsUpward = window.innerHeight - anchor.bottom < 280;

  /**
   * 🔴 **버튼을 앵커 "위"에 둔다** (2026-08-13 사용자 재확인: 입력창 오른쪽이 아니라 **위쪽**).
   *    오른쪽에 두면 입력창 안의 다른 버튼(전송·마이크 등)과 겹친다 — 실제로 ChatGPT 입력창에서
   *    「Think」 버튼을 가리는 걸 확인했다. 위쪽은 대개 비어 있어 충돌이 적다.
   *    위에 자리가 없으면 아래로 내린다(팝업과 같은 뒤집기 규칙).
   */
  /**
   * 🔴 두 경우를 다르게 둔다(2026-08-13 사용자 재확인):
   *    - **드래그(선택)**: 예전처럼 선택 영역 **오른쪽 옆**. 고른 텍스트와 시각적으로 묶인다.
   *    - **커서만(선택 없음)**: 입력창 **위쪽**. 오른쪽에 두면 입력창 안의 전송·마이크 버튼과
   *      겹친다(ChatGPT에서 「Think」를 가리는 걸 실측).
   */
  const FAB_GAP = 14;
  const buttonStyle = hasSelection
    ? {
        left: `${clamp(anchor.right + 6, EDGE_GAP, window.innerWidth - FAB_EXPANDED_WIDTH - EDGE_GAP)}px`,
        top: `${clamp(
          anchor.top + anchor.height / 2 - BUTTON_SIZE / 2,
          EDGE_GAP,
          window.innerHeight - BUTTON_SIZE - EDGE_GAP,
        )}px`,
      }
    : {
        left: `${clamp(anchor.left, EDGE_GAP, window.innerWidth - FAB_EXPANDED_WIDTH - EDGE_GAP)}px`,
        top: `${
          anchor.top - BUTTON_SIZE - FAB_GAP >= EDGE_GAP
            ? anchor.top - BUTTON_SIZE - FAB_GAP
            : clamp(anchor.bottom + FAB_GAP, EDGE_GAP, window.innerHeight - BUTTON_SIZE - EDGE_GAP)
        }px`,
      };

  /**
   * 🔴 S40 — 화면 밖 방지 clamp는 **레이어 전체 폭**을 기준으로 해야 한다. 옆 패널이 열리면
   *    레이어가 두 배 넓어지는데 예전 값(팝업 하나 폭)으로 자르면 오른쪽 패널이 통째로 화면
   *    밖으로 나간다. 기준 위치 자체는 선택 영역 근처로 두고(아래 `anchor.right - popupWidth()`),
   *    **넘칠 때만** 안으로 당긴다.
   */
  const layerWidth = replySideBySide
    ? DECODE_PANEL_WIDTH + PANEL_GAP + REPLY_PANEL_WIDTH
    : popupWidth();

  const popupLeft = clamp(
    anchor.right - popupWidth() + 40,
    EDGE_GAP,
    Math.max(EDGE_GAP, window.innerWidth - layerWidth - EDGE_GAP),
  );

  /**
   * 🔴 화면 아래쪽에서 선택하면 팝업이 뷰포트 밑으로 밀려 잘렸다(2026-08-13 사용자 실측).
   *    가로(어느 옆에 붙일지)와 세로(위/아래 어느 쪽으로 자라게 할지)를 **독립적으로** 정한다 —
   *    두 축을 하나의 if/else 사슬로 합쳤더니, 옆으로 붙이는 경우에 세로 안전장치(아래로 자라기)가
   *    같이 안 걸려서 짧은 창에서 몇십 px 잘리는 걸 실측으로 확인했다(2026-08-13). 그래서 분리했다.
   *
   *    가로: 기본은 버튼 근처(popupLeft) → **아래 공간이 부족하고 오른쪽에 실제로 패널이 들어갈
   *    폭이 있으면 오른쪽에 붙인다**(2026-08-13 사용자 요청 — 작은 창처럼 위아래 둘 다 좁을 때 유용).
   *
   *    세로: 아래 공간이 부족하고 위 공간이 더 크면 위로 자란다. 팝업 실제 높이는 내용에 따라
   *    달라 미리 알 수 없으므로, 위로 열 때는 `top` 대신 `bottom`을 써서 CSS가 아래에서 위로
   *    자라게 한다(높이를 몰라도 절대 안 잘린다 — `.sai-popup`의 `max-height`가 그 안에서 내부
   *    스크롤을 보장한다). 이 세로 규칙은 가로가 오른쪽이든 기본이든 **항상 같이 적용된다**.
   */
  const GAP = 10;
  // 🔴 240px는 원래 작성 교정 팝업(짧은 편) 기준이었다 — 해독 팝업(직역+실제 의도+체감 긴급도+
  //    요구 행동 4단, 실측 ~380px)엔 모자라서 "밑에 공간 없는데도 아래로 열려 눌리는" 문제가
  //    실사용에서 나왔다(2026-08-13). 실측된 해독 팝업 높이에 맞춰 올렸다.
  const MIN_SPACE_BELOW = 380;
  const MIN_SPACE_RIGHT = 260; // 이 밑으로는 옆에 붙여도 대부분 다시 clamp돼 "오른쪽" 느낌이 안 남
  const spaceBelow = window.innerHeight - anchor.bottom;
  const spaceAbove = anchor.top;
  const spaceRight = window.innerWidth - anchor.right;
  const needsFallback = spaceBelow < MIN_SPACE_BELOW;
  const openRight = needsFallback && spaceRight >= MIN_SPACE_RIGHT;
  const openUpward = needsFallback && spaceAbove > spaceBelow;

  const leftValue = openRight
    ? clamp(anchor.right + GAP, EDGE_GAP, window.innerWidth - layerWidth - EDGE_GAP)
    : popupLeft;
  // 오른쪽에 붙일 땐 선택 텍스트 위쪽과 나란히 맞춘다 — 아래로 붙일 때만 텍스트를 안 가리려고
  // 44px를 더 내린다. 오른쪽 배치는 이미 텍스트 옆이라 그 여유가 필요 없고, 세로 공간이 빠듯한
  // 경우(openRight가 켜지는 조건 자체)라 오히려 아까운 여백이 된다.
  const topBase = openRight ? anchor.top : anchor.bottom + 44;

  /**
   * S24 후속 — 사용자가 팝업을 끌어 옮긴 만큼의 오프셋 (2026-08-14 사용자 요청).
   * 🔴 앵커 계산을 **덮지 않고 더한다** — 스크롤 추적(anchor 갱신)은 그대로 두고 사용자가 옮긴
   *    상대 거리만 얹는다. 그래서 페이지를 스크롤해도 "내가 옮겨 둔 위치 관계"가 유지된다.
   * 🔴 위로 뒤집힌 배치(`bottom` 사용)에서는 아래로 끌면 `bottom`이 **줄어야** 하므로 부호를
   *    뒤집는다 — 안 그러면 마우스와 반대로 움직인다.
   */
  /**
   * 🔴 **끌어도 화면 밖으로는 못 나간다** (2026-08-14 사용자 지적: 반쯤 잘려 나갔다).
   *    옮기는 목적은 "가려진 내용을 보는 것"이지 치우는 게 아니다. 팝업이 화면을 벗어나면
   *    버튼을 못 눌러 되돌릴 방법이 없어지므로, **최종 좌표를 뷰포트 안으로 고정**한다.
   *    (오프셋만 제한하면 기준 위치에 따라 여전히 밖으로 나갈 수 있어 여기서 자른다.)
   */
  const draggedLeft = clamp(
    leftValue + dragOffset.x,
    EDGE_GAP,
    Math.max(EDGE_GAP, window.innerWidth - layerWidth - EDGE_GAP),
  );

  /**
   * 🔴 세로도 **실제 팝업 높이 기준**으로 자른다 — 높이를 모른 채 `innerHeight - 120`으로
   *    자르면 800px짜리 팝업이 680px만큼 화면 밖으로 나가도 통과한다(실제로 그렇게 됐다).
   *    아직 높이를 못 잰 첫 프레임에는 보수적으로 화면의 절반을 상한으로 쓴다.
   */
  const maxTop = popupHeight
    ? Math.max(EDGE_GAP, window.innerHeight - popupHeight - EDGE_GAP)
    : window.innerHeight / 2;

  const popupStyle = openUpward
    ? {
        left: `${draggedLeft}px`,
        bottom: `${clamp(
          clamp(window.innerHeight - anchor.top + GAP, EDGE_GAP, window.innerHeight - EDGE_GAP) - dragOffset.y,
          EDGE_GAP,
          maxTop,
        )}px`,
      }
    : {
        left: `${draggedLeft}px`,
        top: `${clamp(clamp(topBase, EDGE_GAP, maxTop) + dragOffset.y, EDGE_GAP, maxTop)}px`,
      };

  return (
    <>
      {!open && (
        /**
         * S20 후속 — 커서를 올리면 가로로 펼쳐지며 두 갈래를 보여준다(2026-08-13 사용자 제안).
         * 🔴 **스니펫 경로는 LLM을 부르지 않는다** — 이미 완성된 문장이라 교정을 거치면 지연과
         *    무료 할당량만 낭비된다. 이게 이 UI의 핵심 이점이다.
         * 🔴 hover가 없는 환경(터치)을 위해 **로고를 누르면 바로 교정**이 열린다 — 확장은
         *    보조 경로이지 유일한 경로가 아니다.
         */
        <div
          className="sai-fab-wrap"
          style={buttonStyle}
          // 🔴 커서가 올라와 있는 동안 위치 갱신을 멈춘다(`fabHoveredRef` 주석 참조).
          //    `pointerenter`는 마우스·펜·터치를 모두 덮고, 자식으로 옮겨 다녀도 재발화하지 않는다.
          onPointerEnter={() => {
            fabHoveredRef.current = true;
          }}
          onPointerLeave={() => {
            fabHoveredRef.current = false;
          }}
          onMouseLeave={() => {
            /**
             * 🔴 래퍼를 벗어나면 목록도 닫는다(2026-08-13 사용자 지적: 한 번 열면 계속 남아 있었다).
             *    예전에 목록으로 마우스를 옮기는 사이 닫히던 문제는 **버튼과 목록 사이 간격**
             *    때문이었으므로, 그 간격을 없애 같은 hover 영역으로 만들어 해결한다(CSS).
             */
            setSnippetOpen(false);
          }}
        >
        <button
          type="button"
          className="sai-fab"
          onClick={openPopup}
          title={modeRef.current === 'decode' ? '사이로 뜻 풀기' : '사이로 다듬기'}
        >
          <SaiMark size={26} />
        </button>

          {/**
           * 🔴 뜻 풀기(해독) 상황에서는 저장 문구 접근 자체를 뺀다(2026-08-13 사용자 요청) —
           *    저장 문구는 **내가 승인한 내 문장**을 다시 쓰는 기능이라(S20 헤더 주석 참조),
           *    남이 쓴 메시지를 드래그해 뜻을 풀어보는 자리에는 애초에 들어맞지 않는다.
           *    `modeRef`는 ref라 렌더를 트리거하진 않지만, 선택 감지 effect가 `setAnchor`보다
           *    먼저 동기적으로 값을 채워 두므로 이 렌더 시점엔 이미 최신값이다(위 `title` 분기와
           *    같은 근거).
           */}
          {/**
           * 🔴 **컨테이너 자체는 두 모드 모두에서 뜬다** (2026-08-14, S25에서 고침). 예전엔
           *    `modeRef.current !== 'decode'`로 통째로 감쌌는데, 그러면 **결정 요약이 가장 필요한
           *    자리에서 버튼이 사라진다** — 대화(남이 쓴 읽기 전용 텍스트)를 드래그하면 해독
           *    모드가 되기 때문이다. 모드 판정은 **버튼별로** 한다.
           */}
          {/* 🔴 보여줄 버튼이 하나도 없으면 컨테이너도 안 그린다 — 빈 알약이 붙어 있으면
              "뭔가 있는데 안 보이는" 것처럼 읽힌다. 결정 요약을 끈 뒤 해독 모드가 그렇다. */}
          {(modeRef.current !== 'decode' || FEATURES.decisionSummary) && (
          <div className="sai-fab-actions">
            <div className="sai-fab-inner">
              {/* 🔴 「다듬기」 버튼을 뺐다(2026-08-13 사용자 요청): **로고를 누르는 것이 곧 다듬기**라
                  같은 동작을 두 군데 두면 하나는 군더더기다. 확장은 저장 문구 전용 갈래가 된다. */}
              {modeRef.current !== 'decode' && (
                <button
                  type="button"
                  className={
                    selectionAlreadySaved ? 'sai-fab-action sai-fab-action-saved' : 'sai-fab-action'
                  }
                  onClick={() => setSnippetOpen((on) => !on)}
                  aria-expanded={snippetOpen}
                  /**
                   * 🔴 라벨을 **네이티브 `title`**로 단다 (2026-08-14 사용자 결정). 디자인 파일은
                   *    직접 그린 hover 툴팁을 전제하지만, 우리는 `:hover`가 실패하는 사례를
                   *    반복 확인했다 — 브라우저가 그리는 `title`은 우리 CSS와 무관하게 뜬다.
                   *    `aria-label`은 스크린리더용으로 따로 둔다(아이콘만 있으면 읽을 게 없다).
                   */
                  title="저장 문구 — 승인된 문장 다시 쓰기"
                  aria-label="저장 문구"
                >
                  {/* 이미 저장한 문장을 다시 선택하면 채워진 북마크로 알려준다. */}
                  <SnippetIcon filled={selectionAlreadySaved} />
                </button>
              )}
              {/**
               * S25 / Spec 부가 7 — 결정 요약. **두 모드 모두에서 보인다**: 대화를 드래그하는
               * 것이 이 기능의 주 경로이고, 그 순간은 해독 모드다. 선택이 있으면 그 구간을,
               * 없으면 자동 수집한 스레드를 읽는다(`collectDecisionThread`).
               *
               * 🔴 **지금은 꺼져 있다** — 이유와 다시 켜는 조건은 `src/config.js`의 `FEATURES`
               *    주석 참조(요약: 누락을 사용자가 알아챌 수 없는데 실측에서 3건 중 1건만 뽑았다).
               */}
              {FEATURES.decisionSummary && (
                <button
                  type="button"
                  className="sai-fab-action sai-fab-action-green"
                  onClick={summarizeDecisionsFromPage}
                  title="결정 요약 — 이 대화에서 무엇이 정해졌는지 표로 정리해요"
                  aria-label="결정 요약"
                >
                  <DecisionIcon />
                </button>
              )}
            </div>
          </div>
          )}

          {/* 🔴 안내는 액션 컨테이너 **밖**에 둔다 — 안에 두면 버튼이 하나도 없는 모드에서
              컨테이너와 함께 사라져, 알려야 할 것을 조용히 안 알리게 된다. */}
          {fabHint && <span className="sai-fab-hint sai-fab-hint-loose">{fabHint}</span>}

          {/* 🔴 스니펫을 고르면 **교정 없이 바로** 입력창에 넣는다(LLM 호출 0건). */}
          {modeRef.current !== 'decode' && snippetOpen && (
            <div
              className={
                snippetsUpward ? 'sai-fab-snippets sai-fab-snippets-up' : 'sai-fab-snippets'
              }
              role="menu"
            >
              {/* 🔴 넣는 방식을 사용자가 고르게 한다(2026-08-13 요청) — 쓰던 초안을 말없이
                  지우는 일이 없어야 한다. */}
              <div className="sai-fab-snippet-mode">
                <span className="sai-label">
                  {snippetMode === 'append' ? '뒤에 이어 붙이기' : '기존 내용 지우고 넣기'}
                </span>
                <button
                  type="button"
                  className={snippetMode === 'append' ? 'sai-switch sai-switch-on' : 'sai-switch'}
                  onClick={toggleSnippetMode}
                  role="switch"
                  aria-checked={snippetMode === 'append'}
                  aria-label="뒤에 이어 붙이기"
                >
                  <span className="sai-switch-knob" />
                </button>
              </div>

              {fabSnippets.length === 0 ? (
                <p className="sai-fab-snippet-empty">
                  저장한 문장이 없어요. 다듬기 결과에서 「＋ 저장 문구」로 담아두세요.
                </p>
              ) : (
                fabSnippets.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="sai-fab-snippet"
                    role="menuitem"
                    onClick={() => insertSnippet(entry)}
                    title={entry.text}
                  >
                    {entry.text.length > 60 ? `${entry.text.slice(0, 60)}…` : entry.text}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
      {open && (
        /**
         * S24 후속 — 팝업 상단을 잡고 끌면 옮겨진다 (2026-08-14 사용자 요청).
         * 🔴 드래그 핸들은 **헤더 영역(`.sai-popup-head`)만**이다. 본문 전체를 핸들로 만들면
         *    교정문을 드래그해 복사하는 것이 불가능해진다.
         * 🔴 끄는 동안은 `left/top` 보간 transition을 꺼야 커서를 따라 즉각 움직인다.
         */
        <div
          ref={popupBoxRef}
          className={dragStateRef.current ? 'sai-popup-layer sai-popup-dragging' : 'sai-popup-layer'}
          style={popupStyle}
          onPointerDown={(event) => {
            if (event.target.closest('.sai-popup-head')) onDragStart(event);
          }}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          {stage === 'guard' && guard && (
            <SensitiveWarning
              summary={guard.summary}
              maskedPreview={guard.maskedText}
              mode={modeRef.current}
              onSendMasked={sendMasked}
              onCancel={closeOverlay}
            />
          )}
          {stage === 'venting' && (
            <VentingPrompt
              result={result}
              onRefineOnly={() => setStage('refine')}
              onConvert={() => setStage('ticket')}
              onClose={closeOverlay}
            />
          )}
          {stage === 'ticket' && (
            <TicketPopup
              result={result}
              onBack={() => setStage('venting')}
              onApply={() => applyToTarget(formatTicketText(result.ticket))}
              onClose={closeOverlay}
            />
          )}
          {stage === 'refine' && (
            <RefinePopup
              result={result}
              loading={loading}
              error={error}
              onUrgencyChange={changeUrgency}
              onApply={(finalText) => applyToTarget(finalText ?? result?.refined, result?.refined)}
              onClose={closeOverlay}
              scheduleInfo={scheduleInfo}
              recipientLabel={recipient?.name ?? '상대'}
              recipients={recipients}
              recipientId={recipient?.id ?? null}
              personSuggestions={personSuggestions}
              onAddPerson={addDetectedPerson}
              onAddRecipient={addRecipientInline}
              onRegisterChange={rememberRegister}
              teams={teams}
              teamId={recipient?.teamId ?? activeTeamId ?? PERSONAL_TEAM_ID}
              onTeamChange={rememberTeam}
              onRecipientChange={changeRecipient}
              urgencyNotice={urgencyNotice}
              onToneChange={() =>
                runRefine(result?.urgencySource === 'user' ? result.urgency : null)
              }
              onSchedule={acceptSchedule}
              onSaveSnippet={saveSnippet}
              // 🔴 원문을 넘기는 이유는 하나뿐 — 원문에 있던 위험 이모지가 교정문에서
              //    사라졌을 때 그 사실을 알리기 위해서다(권장 4 안내). 화면 표시용이며
              //    저장·전송되지 않는다(전송 대상은 `sendTextRef` 하나로 좁혀져 있다).
              sourceText={selectedText}
              onRegenerate={regenerateBackTranslation}
              regenerating={regenerating}
              threadContext={threadContext}
              threadContextOn={threadContextOn}
              onThreadContextToggle={toggleThreadContext}
            />
          )}
          {stage === 'decode' && (
            <DecodePopup
              result={decodeResult}
              loading={decodeLoading}
              error={decodeError}
              onClose={closeOverlay}
              sourceText={decodeSource}
              onReply={pickReplyIntent}
              replyIntent={replyIntent}
              replyResult={replyResult}
              replyLoading={replyLoading}
              replyError={replyError}
              onToast={setToast}
              replySideBySide={replySideBySide}
              replyAsk={replyAsk}
              replyAnswers={replyAnswers}
              onReplyAnswersChange={setReplyAnswers}
              onReplySubmit={() => submitReply(true)}
              onReplySkip={() => submitReply(false)}
              replySentAnswers={replySentAnswers}
              replyDraftText={replyDraftText}
              onReplyDraftTextChange={setReplyDraftText}
              onReplyRefine={refineReplyDraft}
              replyAuto={replyAuto}
              onToggleReplyAuto={toggleReplyAuto}
            />
          )}
          {/**
           * S40 — 넓은 창에서는 회신 초안이 **형제 패널**로 나온다(2026-08-14 사용자 요청).
           * 🔴 레이어가 flex row라 여기 그대로 두면 해독 팝업 오른쪽에 나란히 붙는다. 위치·드래그
           *    계산은 레이어 하나에만 걸려 있으므로 두 패널이 **함께** 움직인다 — 따로 끌 수 있게
           *    만들면 서로 겹치거나 화면 밖으로 나가는 경우를 각각 막아야 한다.
           */}
          {stage === 'decode' && replySideBySide && (
            <ReplyPanel
              standalone
              onClose={() => {
                setReplyAsk(null);
                setReplyResult(null);
                setReplyError('');
              }}
              askIntent={replyAsk}
              answers={replyAnswers}
              onAnswersChange={setReplyAnswers}
              onSubmit={() => submitReply(true)}
              onSkip={() => submitReply(false)}
              result={replyResult}
              loading={replyLoading}
              error={replyError}
              sourceText={decodeSource}
              sentAnswerText={replySentAnswers}
              onToast={setToast}
              draftText={replyDraftText}
              onDraftTextChange={setReplyDraftText}
              onRefine={refineReplyDraft}
            />
          )}
        </div>
      )}
      {toastNode}
    </>
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * S13 학습 결과 안내 문구 (2026-08-13 추가).
 *
 * 🔴 **"기록 안 됨"도 반드시 말한다.** 판정표 A 어디에도 안 맞으면 기록하지 않는 것이 설계지만
 *    (추측으로 성향을 만들지 않기 위해), 사용자 입장에서는 고쳐서 적용했는데 아무 일도 안 일어난
 *    것으로 보인다 — 정상 동작과 고장을 구분할 수 없다. 그래서 두 경우 다 문구를 낸다.
 *
 * @returns {string|null} 학습 시도 자체가 실패(null)했으면 null — 없는 결과를 지어내지 않는다.
 */
function learnedToast(result) {
  if (!result) return null;
  if (result.categoryIds.length === 0) {
    return '이번 수정은 학습되지 않았어요 — 정해진 패턴(사과 줄이기·짧게 쓰기 등)에만 반영돼요';
  }
  const labels = result.categoryIds.map((id) => categoryLabel(id)).filter(Boolean);
  if (labels.length === 0) return null;
  return `수정을 학습했어요 — ${labels.join(' · ')}`;
}

/**
 * 🔴 **캐럿(커서) 좌표를 구한다** (2026-08-13 사용자 요청: 버튼을 커서 위에 띄우기).
 *    `<textarea>`/`<input>`은 캐럿 좌표를 주는 표준 API가 **없다.** 그래서 같은 글꼴·여백·크기를
 *    가진 보이지 않는 div를 만들어 캐럿 앞까지의 글자를 넣고, 그 끝의 위치를 재는 고전적인
 *    "미러 div" 기법을 쓴다. contentEditable은 Range가 좌표를 직접 주므로 그걸 쓴다.
 *
 * @returns {DOMRect|null} 실패하면 null — 호출자가 요소 사각형으로 폴백한다.
 */
function caretRect(element) {
  if (!element) return null;

  if (element.isContentEditable) {
    const selection = window.getSelection();
    if (selection?.rangeCount > 0 && element.contains(selection.getRangeAt(0).startContainer)) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width !== 0 || rect.height !== 0) return rect;
    }
    return null;
  }

  if (element.tagName !== 'TEXTAREA' && element.tagName !== 'INPUT') return null;

  try {
    const style = window.getComputedStyle(element);
    const mirror = document.createElement('div');
    // 화면에 보이지 않게 두되 레이아웃은 실제와 같아야 좌표가 맞는다.
    const copied = [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
      'textTransform', 'wordSpacing', 'paddingTop', 'paddingRight', 'paddingBottom',
      'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
      'borderLeftWidth', 'boxSizing',
    ];
    for (const key of copied) mirror.style[key] = style[key];
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflow = 'hidden';
    mirror.style.width = `${element.clientWidth}px`;

    const caretIndex = element.selectionStart ?? String(element.value).length;
    mirror.textContent = String(element.value).slice(0, caretIndex);

    const marker = document.createElement('span');
    marker.textContent = '​'; // 폭 0 문자 — 캐럿 자리를 표시만 한다
    mirror.appendChild(marker);

    document.body.appendChild(mirror);
    const elementRect = element.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    document.body.removeChild(mirror);

    // 미러는 문서 좌상단 기준이므로, 요소 위치로 옮기고 스크롤을 뺀다.
    const left = elementRect.left + (markerRect.left - mirrorRect.left) - element.scrollLeft;
    const top = elementRect.top + (markerRect.top - mirrorRect.top) - element.scrollTop;
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;

    return { left, right: left, top, bottom: top + lineHeight, height: lineHeight };
  } catch {
    return null;
  }
}

/** DOMRect → 렌더에 쓰는 일반 객체(직렬화 가능한 값만). */
function toAnchorRect(rect) {
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height };
}

/**
 * 여러 줄에 걸친 Range의 `getBoundingClientRect()`는 **모든 줄을 감싸는 큰 사각형**을 준다 —
 * 첫 줄이 마지막 줄보다 길면, 그 사각형의 오른쪽 끝은 첫 줄 기준이라 실제 드래그가 끝난
 * 위치(마지막 줄)에서 한참 떨어져 보인다(2026-08-13 사용자 실측 — "deepl은 마지막 커서 위치
 * 주변에서 뜨지만 사이는 좀 멀리 떨어져 있다"). `getClientRects()`는 줄마다 사각형을 따로 주고,
 * 문서 순서상 **마지막 원소가 마지막 줄**이라 여기서 그것만 골라 쓴다.
 * 🔴 알려진 한계: 사용자가 아래→위로(역방향) 드래그하면 "마지막 줄"이 아니라 "첫 줄"이 골라진다
 *    (문서 순서 기준이라 드래그 방향을 모른다). 위→아래 드래그가 압도적으로 흔해 이 범위로 좁혔다.
 */
function endLineRect(range) {
  const rects = range.getClientRects();
  return rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
}

/**
 * 지금 이 순간의 선택 위치를 다시 읽는다 — 스크롤 추적용.
 * 🔴 Range 우선이다: contentEditable·일반 페이지 텍스트는 항상 range가 있고, textarea/input만
 *    range가 없다(`readSelection()`의 두 경로와 대응). 노드가 사라졌으면(rect 0×0) null.
 */
function currentSelectionRect(range, target) {
  if (range) {
    const rect = endLineRect(range);
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }
  if (target) return target.getBoundingClientRect();
  return null;
}

/**
 * 현재 선택을 읽는다. **두 경로가 다르고, 순서가 중요하다.**
 *
 * 🔴 `<textarea>`/`<input>` 내부 선택은 `window.getSelection()`에 **잡히지 않는다**
 *    (실측 2026-08-13, 하네스에서 확인). 메신저 입력창이 대부분 이 형태라, 폼 필드는
 *    `selectionStart/End`로 따로 읽어야 한다 — 여기까지는 원래 알고 있던 문제.
 *
 * 🔴 **거꾸로 된 실패도 있다**(실측 2026-08-13, S10 하네스에서 발견): `document.activeElement`를
 *    먼저 확인하면, 포커스만 남아있고 **선택 영역은 비어 있는** 입력창이 있을 때 그 즉시 null을
 *    반환해 버려서 `window.getSelection()`은 아예 확인하지 않는다. 실제 메신저는 입력창을 한 번
 *    클릭한 뒤 포커스가 안 풀린 채로 다른 메시지를 드래그하는 경우가 흔한데, 그러면 해독
 *    모드(S10)가 영원히 뜨지 않는다. 그래서 **`window.getSelection()`을 먼저 보고, 거기 실제
 *    선택이 없을 때만** 포커스된 폼 필드로 넘어간다.
 *
 * @returns {{text: string, rect: DOMRect, editable: Element|null}|null}
 */
function readSelection() {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';

  if (text && selection.rangeCount > 0) {
    const liveRange = selection.getRangeAt(0);
    const boundingRect = liveRange.getBoundingClientRect();
    if (boundingRect.width !== 0 || boundingRect.height !== 0) {
      const node = selection.anchorNode;
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const editable = element?.closest?.('textarea, input, [contenteditable="true"]') ?? null;
      // 🔴 반드시 **복제**한다. 살아있는 Range를 그대로 들고 있으면 팝업 클릭으로 선택이 바뀌는
      //    순간 함께 변형돼, 적용 시점에 엉뚱한 위치를 가리킨다 (S07).
      // 앵커는 전체 바운딩 박스가 아니라 **마지막 줄**로 잡는다(endLineRect 주석 참조) — 그래야
      // 버튼·팝업이 실제 드래그가 끝난 자리 가까이에 뜬다.
      return { text, rect: endLineRect(liveRange), editable, range: liveRange.cloneRange() };
    }
  }

  // window.getSelection()이 비어 있을 때만 폼 필드를 본다 — textarea/input 선택은 여기서만 잡힌다.
  const active = document.activeElement;
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
    const { selectionStart, selectionEnd, value } = active;
    if (selectionStart == null || selectionStart === selectionEnd) return null;
    const fieldText = String(value).slice(selectionStart, selectionEnd).trim();
    if (!fieldText) return null;
    // 폼 필드 안의 캐럿 좌표는 표준 API로 얻을 수 없다 — 필드 자체의 사각형을 앵커로 쓴다.
    // 폼 필드는 selectionStart/End로 다시 찾을 수 있어 Range가 필요 없다.
    return { text: fieldText, rect: active.getBoundingClientRect(), editable: active, range: null };
  }

  return null;
}
