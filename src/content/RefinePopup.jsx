import { useEffect, useMemo, useRef, useState } from 'react';
import SaiMark from '../assets/SaiMark.jsx';
import { useLoadingMessages } from './useLoadingMessages.js';
import { tagLabel, PERSONAL_TEAM_ID } from '../lib/recipients.js';
// 🔴 데이터만 가져온다(배열 하나) — 사이드패널의 RegionPicker를 콘텐츠 스크립트로 끌어오지 않는다.
import { REGIONS } from '../lib/regions.js';
import { checkNamesPreserved, nameWarningText } from '../core/refine/names.js';
import {
  checkBackTranslation,
  backFailMessage,
  isExplanationReadable,
} from '../core/refine/backcheck.js';
import {
  swapRiskyEmoji,
  findRiskySpans,
  findDroppedRiskyEmoji,
  RISK_LABELS,
} from '../core/emoji/index.js';
// S19 / Spec 권장 4 후반부 — 밈·신조어 해설.
import { memeGlossary, findMemeSpans } from '../core/meme/index.js';
// 2026-08-14 제안 ③ — 서버가 이미 보내던 근거 필드를 화면에 낸다(새 호출 없음).
import { buildReasoning } from '../core/refine/reasoning.js';
// 2026-08-14 제안 ② (A안) — 기한·영향 누락 경고.
import { verifyMissingElements } from '../core/refine/missing.js';
// S41 — 자리표시자 판정은 회신 초안과 **같은 함수**를 쓴다. 두 벌이면 대괄호 규칙이 갈린다.
import { collectPlaceholders } from '../core/reply/verify.js';
import { getLocal, setLocal, STORAGE_KEYS } from '../lib/storage.js';
import { listPersonalGlossary } from '../lib/glossary.js';
// S26 / Spec 부가 5·8
import DualClock from './DualClock.jsx';
import { recordFeedback, FEEDBACK_KINDS } from '../lib/feedback.js';
import { awardPoints, POINT_REASONS } from '../lib/points.js';

/** 로딩 중 순환 문구 — 실제로 이 호출이 함께 판정하는 축을 그대로 나열한다(과장 없음). */
const REFINE_LOADING_MESSAGES = [
  '문장을 분석하고 있어요…',
  '긴급도를 판단하고 있어요…',
  '용어집을 확인하고 있어요…',
  '역번역을 준비하고 있어요…',
];

/**
 * In-page 작성 교정 팝업 (S05 / Spec 필수 1) — [DS] 프로토타입 "작성 교정 팝업" 이식.
 *
 * 이 컴포넌트가 **책임지는 것**(S05):
 *   - 긴급도 사전 선택 세그먼트 (Critical/Normal/Low/자동)
 *   - AI 판정 결과와 **근거**를 함께 표시하고 사용자가 언제든 바꿀 수 있게 하기 (필수 1)
 *   - 판정 실패 시 Normal 기본값 + 실패 사실 명시 (필수 1)
 *
 * 이 컴포넌트가 **표시만 하는 것**(로직 소유는 다른 태스크):
 *   - 역번역 토글 → S06 · 용어 적용 표시 → S12 · 수신자 태그 → S17
 *   - 스니펫 저장 → S20 · 적용(심리스 교체) → S07
 *   각 지점에 어느 태스크 소관인지 주석으로 남겼다. 여기서 그 로직을 완성하지 않는다.
 *
 * 퇴근 요정(S14 / Spec 필수 6)은 이 컴포넌트가 **계산은 안 하고 표시만** 한다 — 계산은
 * `src/core/schedule/fairy.js`가 하고 `SaiOverlay`가 결과를 `scheduleInfo`로 내려준다.
 * 🔴 **"즉시 전송 완전 제한"의 실제 의미(한계 명시)**: 이 확장은 호스트 페이지(Slack·Gmail 등)의
 *    진짜 전송 버튼을 제어할 수 없다(모든 사이트의 전송 로직을 알 방법이 없다 — Lessons #3와
 *    같은 계열). 그래서 우리가 실제로 강제할 수 있는 유일한 지점은 **우리 자신의 삽입 동작**이다:
 *    Low + 퇴근시간대면 "적용하기"가 곧바로 문구를 넣지 않고 먼저 예약 확인을 요구한다.
 *    사용자가 호스트 페이지에서 직접 타이핑해 보내는 것까지는 막을 수 없다 — 숨기지 않는다.
 */

const URGENCY_OPTIONS = [
  { id: 'CRITICAL', label: 'Critical' },
  { id: 'NORMAL', label: 'Normal' },
  { id: 'LOW', label: 'Low' },
];

/** UI 표기 ↔ 계약 어휘 매핑. 계약은 대문자(c1.ts 이식), 화면은 Title Case. */
function urgencyLabel(value) {
  return URGENCY_OPTIONS.find((option) => option.id === value)?.label ?? value;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** "금 09:00" 형태 — 프로토타입 표기와 동일. */
function formatScheduleLabel(localParts) {
  const weekday = WEEKDAY_KO[localParts.weekday];
  const hh = String(localParts.hour).padStart(2, '0');
  const mm = String(localParts.minute).padStart(2, '0');
  return `${weekday} ${hh}:${mm}`;
}

const REASON_LABEL = {
  'off-hours': '퇴근 시간대',
  weekend: '주말',
  holiday: '공휴일',
};

/**
 * 받침에 맞는 서술격 조사를 고른다 — 「주말**이에요**」 / 「퇴근 시간대**예요**」.
 *
 * 🔴 2026-08-15 실확장 스크린샷에서 「Sarah는 지금 **주말예요**」가 그대로 노출됐다.
 *    템플릿이 `{라벨}예요` 하나로 고정돼 있었고 '퇴근 시간대'가 우연히 맞아 눈에 안 띄었을 뿐,
 *    '주말'·'공휴일'은 셋 중 둘이다(받침 있는 낱말).
 * 🔴 한글 음절의 받침 유무는 유니코드로 계산된다 — 낱말 목록을 만들어 두면 라벨을 늘릴 때마다
 *    같은 실수가 반복된다. `(코드 - 0xAC00) % 28 !== 0`이면 받침이 있다.
 */
function copulaFor(word) {
  const last = String(word ?? '').trim().slice(-1);
  const code = last.charCodeAt(0);
  const isHangulSyllable = code >= 0xac00 && code <= 0xd7a3;
  if (!isHangulSyllable) return '예요'; // 한글이 아니면 판정 근거가 없다 — 기존 동작을 유지한다.
  return (code - 0xac00) % 28 === 0 ? '예요' : '이에요';
}

/**
 * 압축 모드로 바뀌는 팝업 폭 (2026-08-14 사용자 결정: 440px 미만).
 * 팝업 폭은 `clamp(360px, 40vw, 560px)`이므로 브라우저 창이 약 1100px 미만일 때 전환된다.
 */
const COMPACT_WIDTH = 440;

/**
 * 팝업이 압축 모드여야 하는지 — **실제 폭을 재서** 판단한다 (2026-08-14).
 * 🔴 `window.innerWidth`로 계산하지 않는다: 폭 식(`clamp`)이 CSS에 있어 JS가 다시 계산하면
 *    두 곳이 갈릴 수 있다. 그려진 결과를 재는 쪽이 어긋날 여지가 없다.
 */
function useCompact(ref) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => setCompact(node.offsetWidth < COMPACT_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return compact;
}

/**
 * 문체 수위 — 하나의 눈금, 세 칸 (S16 / Spec 필수 8, 2026-08-18).
 * 🔴 세 칸 중 하나만 켜지므로 「캐주얼이면서 격식」 같은 모순 상태가 **존재할 수 없다.**
 * 🔴 순서는 «가벼움 → 격식»이다. 눈금이므로 순서가 뒤섞이면 무엇이 중간인지 알 수 없다.
 */
const REGISTER_ITEMS = [
  { id: 'casual', label: '가볍게', title: '업무 안전 검수를 통과한 가벼운 표현만 씁니다' },
  { id: null, label: '기본', title: '적당히 공손하되 메일 격식은 아닌 업무 메시지 문체' },
  { id: 'formal', label: '격식', title: '고객사·협력사·첫 연락에 맞는 공식적인 문체' },
];

export default function RefinePopup({
  result,
  loading,
  error,
  onUrgencyChange,
  onApply,
  onClose,
  scheduleInfo = null,
  recipientLabel = '상대',
  recipients = [],
  recipientId = null,
  personSuggestions = [],
  onAddPerson,
  onAddRecipient,
  onRegisterChange,
  teams = [],
  teamId = null,
  onTeamChange,
  onRecipientChange,
  onToneChange,
  onSchedule,
  onSaveSnippet,
  onRegenerate,
  regenerating = false,
  urgencyNotice = '',
  threadContext = [],
  threadContextOn = true,
  onThreadContextToggle,
  sourceText = '',
}) {
  const popupRef = useRef(null);
  /** 좁을 때 ☰ 드롭다운 열림 상태. */
  const [menuOpen, setMenuOpen] = useState(false);
  /** 🔴 좁은 폭에서는 필수 기능만 남긴다 (2026-08-14 사용자 요청). 기준은 팝업 폭 440px. */
  const compact = useCompact(popupRef);

  const recipient = recipients.find((entry) => entry.id === recipientId) ?? null;
  const [backOn, setBackOn] = useState(true);

  /**
   * 🔴 **여기서도 사람을 추가한다** (2026-08-17 사용자 요청 ②). 예전에는 드롭다운에 **이미
   *    등록된 사람만** 있었다 — 새 상대에게 처음 쓰는 순간, 즉 이 기능이 가장 필요한 순간에
   *    사이드패널로 나갔다가 돌아와야 했고, 그 사이 선택 영역이 사라졌다.
   * 🔴 **지역 하나로 시간대·국가코드·언어가 함께 정해진다**(`lib/regions.js`). 이름만 받고
   *    언어를 비워 두면 **온보딩 기본 언어로 조용히 번역돼** 엉뚱한 언어가 나간다 —
   *    「그냥 추가」가 가장 위험한 선택지다.
   * 🔴 태그·GitHub·팀은 여기서 받지 않는다. 교정 한 번을 하려고 폼을 채우게 하면 안 쓰인다 —
   *    나머지는 사이드패널에서 언제든 채울 수 있다.
   */
  const ADD_NEW = '__sai_add_new__';
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRegionId, setNewRegionId] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');

  const closeAdd = () => {
    setAdding(false);
    setNewName('');
    setNewRegionId('');
    setAddError('');
  };

  const submitAdd = async () => {
    const name = newName.trim();
    const region = REGIONS.find((entry) => entry.id === newRegionId) ?? null;
    if (name === '' || !region) {
      setAddError('이름과 지역을 모두 채워 주세요');
      return;
    }
    setAddBusy(true);
    setAddError('');
    try {
      await onAddRecipient?.({
        name,
        timeZone: region.timeZone,
        countryCode: region.countryCode,
        language: region.language,
      });
      closeAdd();
    } catch (caught) {
      // 🔴 실패를 폼 안에서 말한다 — 폼이 닫히면 무엇이 틀렸는지 볼 자리가 없다.
      setAddError(caught?.message ?? '추가하지 못했어요');
    } finally {
      setAddBusy(false);
    }
  };
  const loadingText = useLoadingMessages(loading, REFINE_LOADING_MESSAGES);

  /**
   * S13 — 사용자가 교정문을 직접 고칠 수 있다. 이 편집분이 Diff 학습의 **유일한 데이터 소스**다
   * (Spec 필수 2 2순위). `null`이면 "아직 안 고침" = AI 원본 그대로.
   * 🔴 교정 결과가 바뀌면(긴급도 변경 등) 편집분을 버린다 — 옛 교정문에 대한 수정을 새 교정문에
   *    덮어씌우면 사용자가 쓰지도 않은 문장이 입력창에 들어간다.
   */
  const [edited, setEdited] = useState(null);
  useEffect(() => {
    setEdited(null);
  }, [result?.refined]);

  /**
   * S19 / Spec 권장 4 — 위험한 이모지를 **즉시 교체**하고 무엇을 바꿨는지 아래에 안내한다.
   * 🔴 교체본이 화면·적용의 기준이 된다(교체해 놓고 원본을 넣으면 안내가 거짓말이 된다).
   * 🔴 사용자가 직접 고친 뒤에는 건드리지 않는다 — 사용자가 일부러 넣은 이모지를 계속 지우면
   *    "왜 자꾸 사라지지"가 된다. 자동 교체는 AI 결과에 한 번만 적용한다.
   */
  const swapped = useMemo(() => swapRiskyEmoji(result?.refined ?? ''), [result?.refined]);

  /**
   * S19 후속 — **범례(설명) 표시** on/off (2026-08-13 사용자 요청).
   *
   * 🔴 처음에 이걸 "강조 자체를 끄는" 토글로 만들었다가 사용자에게 정정당했다: 요청은 **초록
   *    배경·노란 물결이 무슨 뜻인지 알려주는 설명**을 접을 수 있게 해 달라는 것이었다. 강조는
   *    안전망이라 항상 켜져 있어야 하고, 익숙해지면 군더더기가 되는 것은 **설명 쪽**이다.
   */
  /**
   * 🔴 기본값 **꺼짐**(2026-08-14): 초기 화면은 번역에 꼭 필요한 것만 보여준다. 설명은 색이
   *    무슨 뜻인지 **처음 배울 때** 필요한 것이라 항상 펼쳐 둘 이유가 없다 — 메뉴바에서 한 번
   *    켜면 저장되어 계속 유지된다. 🔴 **강조(색·물결) 자체는 이 토글과 무관하게 항상 켜져 있다**
   *    — 안전망이라 끌 수 없다.
   */
  const [hintsOn, setHintsOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getLocal(STORAGE_KEYS.HIGHLIGHT_HINTS, false).then((stored) => {
      if (!cancelled) setHintsOn(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleHints = () => {
    const next = !hintsOn;
    setHintsOn(next);
    setLocal(STORAGE_KEYS.HIGHLIGHT_HINTS, next);
  };

  /**
   * S19 후속 — 역번역에 나오는 **용어에 원래 뜻을 괄호로 병기**한다(2026-08-13 사용자 요청).
   * 역번역은 한국어인데 용어집이 적용된 자리는 영어(예: `rollout`)로 남아, 그것만 읽으면
   * 무슨 말인지 모른다. `rollout(배포)`처럼 보여준다.
   * 🔴 사용자가 등록한 용어집에서만 뜻을 가져온다 — 없는 뜻을 지어내지 않는다.
   */
  const [glossaryMeanings, setGlossaryMeanings] = useState({});
  useEffect(() => {
    let cancelled = false;
    listPersonalGlossary().then((entries) => {
      if (cancelled) return;
      const map = {};
      for (const entry of entries) {
        if (entry.targetText && entry.sourceText) map[entry.targetText] = entry.sourceText;
      }
      setGlossaryMeanings(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 범례에 무엇을 보여줄지 — 실제로 표시된 것만 설명한다(없는 색을 설명하면 더 헷갈린다). */
  const riskCount = useMemo(() => findRiskySpans(swapped.text).length, [swapped.text]);
  const glossaryCount = result?.appliedGlossary?.length ?? 0;

  /**
   * 2026-08-14 제안 ③ — 「왜 이렇게 바꿨나」.
   * 🔴 `buildReasoning`이 **원문·교정문과 대조해 통과한 것만** 준다 — 모델이 지어낸 "이걸
   *    지켰다"는 화면에 오르지 않는다. 자세한 판정표는 `core/refine/reasoning.js` 헤더 참조.
   */
  const reasoning = useMemo(() => buildReasoning(result, sourceText), [result, sourceText]);

  /**
   * 2026-08-14 제안 ② (A안) — 핵심 업무 정보 누락 경고. 기한·영향 2종.
   * 🔴 `verifyMissingElements`가 **세 관문**(인용 대조·자기모순·독립 재검)을 통과한 것만 준다 —
   *    감사 인사에 "기한이 없습니다"가 한 번 뜨면 이 기능은 그날로 죽는다. `core/refine/missing.js` 참조.
   */
  const missing = useMemo(() => verifyMissingElements(result, sourceText), [result, sourceText]);

  /**
   * S41 후속 — 교정문에 남은 대괄호 빈칸. 🔴 **교정문에서 센다.** 회신 초안이 넘겨준 것이든
   * 사용자가 직접 쓴 것이든 위험은 같고, 「다시 만들기」로 재생성해도 같은 검사가 걸린다.
   */
  const leftoverPlaceholders = useMemo(
    () => collectPlaceholders(result?.refined ?? ''),
    [result?.refined],
  );

  /**
   * 🔴 **이름·호칭이 바뀌었는지 코드가 확인한다** (2026-08-16 사용자 요청 — `core/refine/names.js`).
   *    실측: 「싱싱」이 중국어에서 `上晦先生/女士`(없는 한자 이름 + 성별 미상 호칭)가 되고,
   *    독일어에서는 통째로 사라졌다. 프롬프트에 금지 규칙이 이미 있는데 모델이 안 지켰다.
   * 🔴 **고쳐 쓰지 않고 알리기만 한다** — 우리가 맞다는 근거가 없고, 치환하면 어색한 자리에 박힌다.
   */
  /**
   * 🔴 **역번역이 진짜 역번역인지 확인한다** (2026-08-16 사용자 승인 ⓑ).
   *    실측: 한국어→중국어에서 역번역이 **중국어로** 왔고 교정문과 글자까지 같았다. 그걸 그대로
   *    보여 주면 「상대에게 이렇게 읽혀요」가 **확인 불가능한 문장**이 된다.
   *    프롬프트로 4번 시도해 실패했고(간헐적이라 더더욱) 여기서 결과를 보고 판정한다.
   */
  const backCheck = useMemo(
    () =>
      checkBackTranslation({
        backTranslation: result?.backTranslation ?? '',
        refined: result?.refined ?? '',
        sourceLanguage: result?.sourceLanguage ?? null,
        targetLanguage: result?.targetLanguage ?? null,
      }),
    [result?.backTranslation, result?.refined, result?.sourceLanguage, result?.targetLanguage],
  );

  const nameDrift = useMemo(
    () =>
      checkNamesPreserved({
        sourceText,
        refined: result?.refined ?? '',
        names: recipient?.name ? [recipient.name] : [],
      }).dropped,
    [sourceText, result?.refined, recipient?.name],
  );

  /**
   * 🔴 원문에 있었지만 교정문엔 남지 않은 위험 이모지 (2026-08-14 실측 후 추가).
   *    모델이 번역하면서 이모지를 스스로 떨어뜨리면 `swapped.replacements`는 비어 있어
   *    아무 안내도 안 뜬다 — 사용자에겐 "내가 쓴 👍가 왜 없지"만 남는다. 우리가 바꾼 게
   *    아니어도 **없어졌다는 사실과 이유는 알린다**(권장 4의 "안내" 취지).
   */
  const droppedEmoji = useMemo(
    () => findDroppedRiskyEmoji(sourceText, result?.refined ?? ''),
    [sourceText, result?.refined],
  );

  const finalText = edited ?? swapped.text;
  const isEdited = edited !== null && edited !== swapped.text;

  /**
   * S24 / Spec 부가 2 — Critical 메시지에 `[🚨 URGENT]` 태그.
   * 🔴 **사용자 문장을 실제로 바꾸는** 동작이라 조용히 하지 않는다 — Critical일 때 스위치를
   *    항상 보여주고, 붙는다는 사실을 문구로 명시한다.
   * 🔴 태그는 **적용할 때만** 붙는다. 저장 문구에는 넣지 않는다 — 저장 문구는 재사용이 목적이라
   *    특정 메시지의 긴급도가 박제되면 다음에 쓸 때 거짓말이 된다.
   */
  /**
   * 🔴 **Critical이면 기본값 켜짐, 끌 수는 있다** (2026-08-14 사용자 정정).
   *    긴급도 판정은 우리 모델이 한 추정이고 실제 관계·맥락은 사용자가 안다 — 판정이 과했을 때
   *    사용자 문장에 `[🚨 URGENT]`가 강제로 박히면 그게 더 큰 사고다. 기본값으로 안전한 쪽을
   *    고르되 결정권은 사용자에게 남긴다. Critical이 아니면 애초에 붙지 않으므로 스위치도 없다.
   * 🔴 **결과가 바뀌면 기본값(켜짐)으로 되돌린다** — 옛 문장에 대해 끈 선택이 새 문장의
   *    선택인 것처럼 남아 있으면 안 된다.
   */
  const isCritical = result?.urgency === 'CRITICAL';
  const [urgentOn, setUrgentOn] = useState(true);
  useEffect(() => {
    setUrgentOn(true);
  }, [result]);

  const URGENT_PREFIX = '[🚨 URGENT] ';
  const urgentApplied = isCritical && urgentOn;
  const textToApply =
    urgentApplied && !finalText.startsWith(URGENT_PREFIX)
      ? `${URGENT_PREFIX}${finalText}`
      : finalText;


  // Spec 필수 3 — 역번역 토글 상태는 chrome.storage.local에 남는다. (로직 완성은 S06)
  useEffect(() => {
    let cancelled = false;
    getLocal(STORAGE_KEYS.BACK_TRANSLATION, true).then((stored) => {
      if (!cancelled) setBackOn(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleBack = () => {
    const next = !backOn;
    setBackOn(next);
    setLocal(STORAGE_KEYS.BACK_TRANSLATION, next);
  };

  /**
   * 「왜 이렇게 바꿨나」 (2026-08-14 사용자 제안 ③).
   * 🔴 기본 **꺼짐** — 대화 참고 목록을 접은 것과 같은 이유다(팝업 세로 공간). 근거가 있다는
   *    사실은 꺼진 줄의 「근거 N」이 항상 보여주므로 존재 자체가 숨지는 않는다.
   */
  const [reasonOn, setReasonOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getLocal(STORAGE_KEYS.REFINE_REASONING, false).then((stored) => {
      if (!cancelled) setReasonOn(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleReason = () => {
    const next = !reasonOn;
    setReasonOn(next);
    setLocal(STORAGE_KEYS.REFINE_REASONING, next);
  };

  /**
   * S21 후속 — 참고 여부(`threadContextOn`, 서버 전송 게이트)와 **다른 축**의 스위치
   * (2026-08-13 사용자 요청): 참고는 계속 쓰면서 화면에 원문 미리보기만 가리고 싶을 수 있다.
   * 🔴 꺼도 서버로는 그대로 나간다 — **표시만** 가린다. 그래서 pill 스위치가 아니라 「직접
   *    고치기」와 같은 텍스트 링크로 만들어 "이건 동작을 끄는 게 아니라 화면만 바꾼다"를
   *    형태로도 구분했다.
   */
  /**
   * S26 / Spec 부가 5 — 의도 검증 피드백.
   * 🔴 교정 결과가 바뀌면 초기화한다 — 새 결과에 대해서는 다시 물어야 하고, 옛 결과에 준 평가가
   *    새 결과의 평가인 것처럼 남아 있으면 안 된다.
   */
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [feedbackAward, setFeedbackAward] = useState('');
  useEffect(() => {
    setFeedbackGiven(false);
    setFeedbackAward('');
  }, [result?.refined]);

  /**
   * 🔴 **👎는 "학습"하지 않는다 — 지금 당장 다시 만든다** (2026-08-13 사용자 판단으로 설계 변경).
   *    집계 수치만으로는 무엇이 잘못됐는지 알 수 없어 학습 입력이 될 수 없고, 그런데도 "평가하면
   *    반영된다"는 기대를 주면 거짓말이 된다. 실제 학습 신호는 S13이 이미 갖고 있다 —
   *    사용자가 교정문을 **직접 고쳐서** 적용하면 그 diff가 분류돼 프로필에 쌓인다(`recordEdit`).
   *    그래서 👎의 정직한 응답은 "배웠어요"가 아니라 **재생성**이다.
   */
  const sendFeedback = async (kind) => {
    // 낙관적 처리 — 저장 실패로 UI가 멈추면 1초 피드백이 아니게 된다.
    setFeedbackGiven(true);
    const outcome = await recordFeedback(kind);
    if (!outcome.ok) return;
    // Spec §1 — "1초 피드백 참여 시 포인트 획득".
    const award = await awardPoints(POINT_REASONS.FEEDBACK);
    if (award.ok) setFeedbackAward(` +${award.amount}P`);
    // 👎면 곧바로 다시 만든다. 새 결과가 오면 위 effect가 피드백 상태를 초기화한다.
    if (kind === FEEDBACK_KINDS.DOWN) onRegenerate?.();
  };

  /**
   * 🔴 기본값을 **접힘**으로 바꿨다(2026-08-14 실측): 목록이 펼쳐진 상태가 팝업에서 가장 큰
   *    블록(140px, 전체 931px 중)이라 노트북 화면에서 스크롤바를 만드는 주범이었다. Spec 권장 8이
   *    요구하는 것은 "N개 참고함" **노출**이고 목록은 우리가 더한 투명성 장치이므로, 한 번의
   *    클릭 뒤로 물리되 셰브런으로 항상 보이게 둔다. **설정은 저장되므로 한 번 펼치면 유지된다.**
   */
  const [previewOn, setPreviewOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getLocal(STORAGE_KEYS.THREAD_CONTEXT_PREVIEW, false).then((stored) => {
      if (!cancelled) setPreviewOn(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePreview = () => {
    const next = !previewOn;
    setPreviewOn(next);
    setLocal(STORAGE_KEYS.THREAD_CONTEXT_PREVIEW, next);
  };

  /**
   * S16 / Spec 필수 8 — 캐주얼 톤. 🔴 기본은 **꺼짐**이다: 업무 메시지에 가벼운 표현을 사용자가
   * 원하지도 않았는데 끼워 넣지 않는다. 켜면 Work-Safe Filter를 통과한 검수 표현만 후보로 실린다.
   * 🔴 토글 함수(`toggleCasual`)는 아래에 있지만 **상태는 여기 있어야 한다** — 밈 해설(바로 아래)과
   *    범례(`toggleSections`)가 이 값을 읽는데, 선언이 그보다 뒤에 있으면 TDZ에 걸린다.
   */
  /**
   * 🔴 **3단 하나로 합쳤다** (2026-08-18). 예전에는 캐주얼(여기)과 격식(수신자 프로필)이
   *    **같은 축을 두 자리**에서 정해서, 둘 다 켜지면 누가 이기는지 화면에 드러나지 않았다.
   * 🔴 초기 위치는 **이 수신자에 정해 둔 값**이다 — 고객사를 「격식」으로 등록해 두면 매번
   *    고르지 않아도 그 자리에서 시작한다. 이번 메시지만 바꾸고 싶으면 여기서 바꾼다.
   */
  const [register, setRegister] = useState(null);
  /**
   * 🔴 **평소에는 한 칸만 보인다** (2026-08-18 사용자 요청). 헤더에 긴급도 3칸이 이미 있어서
   *    문체까지 3칸을 늘 펴 두면 좁은 팝업에서 줄이 밀린다. 지금 상태만 보여 주고, 누르면 편다.
   */
  const [registerOpen, setRegisterOpen] = useState(false);
  const casualOn = register === 'casual';
  /**
   * 🔴 **문체는 «그 사람»의 것이다** (2026-08-18 사용자 지적 ①). 예전에는 전역 저장값을 먼저
   *    봐서, 한 번 고르면 상대가 바뀌어도 그 값이 따라붙었다. 이제 수신자가 바뀌면 그 사람에게
   *    저장된 값으로 갈아탄다. 저장은 `onRegisterChange`가 수신자 기록에 한다.
   */
  useEffect(() => {
    setRegister(recipient?.register ?? null);
    setRegisterOpen(false);
  }, [recipient?.id, recipient?.register]);

  /**
   * S19 / Spec 권장 4 후반부 — 밈·신조어 해설.
   *
   * 🔴 **캐주얼 톤과 무관하게 항상 동작하되, 폭이 다르다**(2026-08-14 사용자 결정):
   *    톤을 켜면 검수 표현 **전체**를, 끄면 **직역으로 뜻을 알 수 없는 표현만**(`explainAlways`)
   *    대조한다. 톤을 껐다고 모델이 관용 표현을 안 쓰는 게 아니라서 "꺼져 있으면 아무것도 안 함"은
   *    막으려는 사고(모르는 표현을 그대로 보냄)를 그대로 남긴다.
   * 🔴 **교정문에만 붙인다.** 역번역은 한국어라 대조할 게 없고, 실제로 나가는 문장은 교정문이다.
   *
   * 🔴 **`casualOn`을 그대로 쓴다 — 같은 키를 읽는 상태를 따로 만들지 않는다.** 처음에 여기서
   *    `CASUAL_TONE`을 다시 읽는 state를 하나 더 뒀다가, 헤더 토글이 그쪽만 갱신해서 **캐주얼을
   *    켜도 밈 목록이 안 넓어지는** 버그를 만들었다(2026-08-14 사용자 스크린샷으로 발견 — 켠
   *    상태인데 `no worries if not`이 안 잡혔다). 저장소 키 하나에 화면 상태도 하나다.
   */
  const memeSpans = useMemo(
    () => findMemeSpans(swapped.text, memeGlossary(casualOn)),
    [swapped.text, casualOn],
  );

  /**
   * 지금 마우스(또는 키보드 포커스)가 올라간 밈. 뜻은 **교정문 바로 아래 한 줄**에 띄운다.
   * 🔴 떠 있는 말풍선을 쓰지 않은 이유: `.sai-popup`이 `overflow-y: auto`(스크롤 영역)라
   *    그 안에 절대 배치한 말풍선은 팝업 위·아래 끝에서 잘린다. 고정된 자리에 띄우면 잘릴 일이
   *    없고, 키보드 포커스로도 같은 줄이 뜬다 — hover 단독 경로를 만들지 않는다(Lessons #15 계열).
   */
  const [hoveredMeme, setHoveredMeme] = useState(null);
  // 결과가 바뀌면 이전 문장의 해설이 남지 않게 지운다.
  useEffect(() => setHoveredMeme(null), [swapped.text]);

  /**
   * 토글 섹션 서술 — 렌더는 아래 한 곳에서 한다.
   * 🔴 `visible`이 false면 아예 목록에서 빠진다 — 끌 것이 없는데 스위치만 있으면 "왜 안 되지"를
   *    만든다(예: 강조할 게 하나도 없으면 「설명」을 보여줄 이유가 없다).
   */
  const toggleSections = [
    {
      id: 'hints',
      visible:
        glossaryCount > 0 ||
        riskCount > 0 ||
        memeSpans.length > 0 ||
        swapped.replacements.length > 0 ||
        droppedEmoji.length > 0,
      on: hintsOn,
      onToggle: toggleHints,
      switchLabel: '설명 표시',
      labelOn: '설명 — 색 표시와 바뀐 이모지',
      labelOff: '설명',
      body: (
        <div className="sai-legend-body">
          {glossaryCount > 0 && (
            <span className="sai-legend-item">
              <mark className="sai-glossary">용어</mark> 용어사전 {glossaryCount}개 적용됨
            </span>
          )}
          {riskCount > 0 && (
            <span className="sai-legend-item">
              <mark className="sai-risk">표현</mark> 오해 소지 {riskCount}곳 — 올려보면 이유가 떠요
            </span>
          )}
          {/* S19 — 점선이 무슨 뜻인지. 뜻 자체는 교정문 아래 해설 줄이 보여준다. */}
          {memeSpans.length > 0 && (
            <span className="sai-legend-item">
              <mark className="sai-meme">표현</mark> 관용·신조어 {memeSpans.length}곳 — 아래 줄에
              뜻이 떠요
            </span>
          )}
          {swapped.replacements.map((rule) => (
            <span key={rule.from} className="sai-legend-item">
              <b>{rule.from}</b>
              {rule.to ? (
                <>
                  {' → '}
                  <b>{rule.to}</b>
                </>
              ) : (
                ' 삭제'
              )}{' '}
              · {rule.reason}
            </span>
          ))}
          {/* 🔴 우리가 바꾼 게 아니라 **모델이 번역하며 뺀** 경우다 — 문구를 그렇게 구분해
              쓴다("바꿨어요"가 아니라 "빠졌어요"). */}
          {droppedEmoji.map((rule) => (
            <span key={`dropped-${rule.from}`} className="sai-legend-item">
              <b>{rule.from}</b> 빠짐 · {rule.reason}
            </span>
          ))}
        </div>
      ),
    },
    /**
     * 「왜 이렇게 바꿨나」 (2026-08-14 사용자 제안 ③ / Manyfast F-4.1 계열).
     *
     * 🔴 **새 API 호출이 없다.** `refinedReason`·`preserved`·`misreadRisks`·
     *    `unregisteredHonorifics`는 `/v1/refine` 응답에 원래부터 실려 왔는데 렌더되는 곳이
     *    한 군데도 없었다(2026-08-14 확인) — 매 호출 토큰을 내고 버리던 것을 꺼내 보이는 것뿐이다.
     * 🔴 **자리는 역번역 위**다. "무엇으로 바뀌었나"(역번역)보다 "왜 바뀌었나"가 먼저 온다 —
     *    교정문 바로 아래에서 이어 읽히는 순서다.
     * 🔴 대조를 통과한 항목이 하나도 없으면 스위치 자체가 사라진다(`visible`) — 눌러도 빈
     *    상자만 나오는 스위치를 남기지 않는다.
     */
    {
      id: 'why',
      visible: reasoning.total > 0,
      on: reasonOn,
      onToggle: toggleReason,
      switchLabel: '변경 이유 표시',
      /**
       * 🔴 **꺼졌을 때 개수를 쓰지 않는다**(2026-08-14 사용자 지적: 「근거 2」·「근거 1」·「근거 4」가
       *    번갈아 떴다). 두 가지가 잘못이었다:
       *    ① **무엇의 개수인지 알 수 없다** — 형제 토글(설명·역번역·대화 참고)은 전부 개수 없는
       *       명사인데 여기만 숫자가 붙어 다른 종류의 정보처럼 보였다.
       *    ② **매번 값이 바뀐다** — 같은 스위치의 이름이 문장마다 달라지면 고장으로 읽힌다.
       *       개수는 펼치면 바로 보이므로 접힌 줄이 대신 말할 이유가 없다.
       * 🔴 형제들과 같은 규칙을 쓴다: 꺼짐 = 짧은 명사, 켜짐 = 명사 + 「—」 설명.
       */
      labelOn: '변경 이유 — 왜 이렇게 바꿨나',
      labelOff: '변경 이유',
      body: (
        <div className="sai-why-body">
          {/* 🔴 「변경 이유」도 같은 검사를 받는다 — 설명 필드는 한 호출에서 **다 같이** 흘렀다. */}
          {reasoning.reason &&
            isExplanationReadable(
              reasoning.reason,
              result?.sourceLanguage,
              result?.targetLanguage,
            ) && <p className="sai-why-reason">{reasoning.reason}</p>}

          {/* 🔴 "지켜냈다"는 **원문 → 교정문 대응**을 같이 보여줘야 확인이 된다. 라벨만 있으면
              사용자는 우리 말을 믿는 수밖에 없다. */}
          {reasoning.preserved.length > 0 && (
            <ul className="sai-why-list">
              {reasoning.preserved.map((item) => (
                <li key={`${item.kind}-${item.sourceText}`} className="sai-why-item">
                  <span className="sai-why-tag">{item.label} 유지</span>
                  <span className="sai-why-pair">
                    <b>{item.sourceText}</b> → <b>{item.refinedText}</b>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* 🔴 인용·오해·근거 3요소를 다 보여준다 — 스키마가 셋 다 있는 항목만 통과시키는 것도
              같은 이유다(`schema.js`). 근거 없는 경고는 사용자를 겁만 준다. */}
          {reasoning.risks.length > 0 && (
            <ul className="sai-why-list">
              {reasoning.risks.map((risk) => (
                <li key={risk.quote} className="sai-why-item sai-why-item-risk">
                  <span className="sai-why-tag sai-why-tag-risk">오해 소지</span>
                  <span className="sai-why-pair">
                    <b>{risk.quote}</b> — {risk.misreading}
                    <span className="sai-why-evidence"> · 근거: {risk.evidence}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Spec 필수 7 계열 — 용어집에 없는 경어는 **번역이 흔들릴 수 있다**는 사실만 알린다.
              🔴 "잘못됐다"고 말하지 않는다. 우리가 아는 건 등록이 안 됐다는 것뿐이다. */}
          {reasoning.honorifics.length > 0 && (
            <p className="sai-why-honorifics">
              용어집에 없는 호칭 {reasoning.honorifics.map((word) => `「${word}」`).join(' ')} — 등록해
              두면 다음부터 같은 번역이 나와요
            </p>
          )}
        </div>
      ),
    },
    {
      // Spec 필수 3 — 역번역 상시 노출 + 토글.
      id: 'back',
      visible: true,
      on: backOn,
      onToggle: toggleBack,
      switchLabel: '역번역 표시',
      labelOn: '역번역 — 상대에게 이렇게 읽혀요',
      labelOff: '역번역',
      // 🔴 역번역에도 같은 이모지 교체·강조를 적용한다 — 교정문만 바꾸고 역번역을 그대로 두면
      //    "상대에게 이렇게 읽혀요"가 실제로 나갈 문장과 달라진다.
      body: backCheck.usable ? (
        <p className="sai-back-text">
          <Highlighted
            text={swapRiskyEmoji(result?.backTranslation ?? '').text}
            phrases={result?.appliedGlossary ?? []}
            meanings={glossaryMeanings}
            risks={false}
          />
        </p>
      ) : (
        /**
         * 🔴 **틀린 역번역을 보여 주느니 실패를 말한다** (ⓑ). 상대 언어로 온 문장을 「이렇게
         *    읽혀요」라고 두면 사용자는 확인했다고 믿고 보낸다 — 안 보여 주는 것보다 나쁘다.
         * 🔴 교정문은 멀쩡하므로 **교정 자체를 막지는 않는다.** 확인 수단 하나가 빠졌을 뿐이다.
         */
        <p className="sai-back-text sai-back-failed">{backFailMessage(backCheck.reason)}</p>
      ),
    },
    {
      // S21 / Spec 권장 8 — 스레드 직전 대화 맥락.
      id: 'thread',
      visible: threadContext.length > 0,
      /**
       * 🔴 스위치는 **참고 여부**(서버로 보낼지), 셰브런은 **내용 보기**다 — 두 축이 다르다.
       *    스위치를 "펼침"에 묶으면 참고를 끌 방법이 사라진다(Spec 권장 8이 "끄기 가능"을 요구).
       */
      on: threadContextOn,
      onToggle: onThreadContextToggle,
      switchLabel: '직전 대화 참고',
      labelOn: '대화 참고',
      labelOff: '대화 참고',
      /**
       * 🔴 **스위치를 켜도 한 줄에 남는다** (2026-08-16 사용자 지적 ③).
       *    다른 항목은 「켜짐 = 내용 표시」라 켜지면 세로 카드로 올라가는 게 맞다. 그런데 이
       *    항목만 축이 **둘**이다 — 스위치는 「서버로 보낼지」, 셰브런은 「내용을 볼지」.
       *    그래서 참고를 켰다는 이유로 카드가 되면, **보고 싶지도 않은 목록이 매번 펼쳐지고**
       *    그걸 접으려면 참고 자체를 꺼야 했다(권장 8의 "끄기 가능"과 충돌).
       * 🔴 이제 카드가 되는 조건은 **셰브런을 눌렀을 때뿐**이다.
       */
      rowAlways: true,
      expanded: previewOn,
      extra: (
        <button
          type="button"
          className={previewOn ? 'sai-thread-chevron sai-thread-chevron-open' : 'sai-thread-chevron'}
          onClick={togglePreview}
          aria-expanded={previewOn}
          aria-label={previewOn ? '내용 숨기기' : '내용 보기'}
        >
          ›
        </button>
      ),
      body: previewOn ? (
        <ul className="sai-thread-list">
          {threadContext.map((message, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={index} className="sai-thread-item" title={message.text}>
              {truncate(message.text, 96)}
            </li>
          ))}
        </ul>
      ) : null,
    },
    /**
     * URGENT 태그 — 다른 셋과 **같은 목록**에 있다(2026-08-14 사용자 요청: 끄면 다른 메뉴처럼).
     * 🔴 다만 켜졌을 때만 위쪽 강조 박스가 대신 그린다(`standalone`) — 문장을 실제로 바꾸는
     *    설정이라 켜진 동안 회색 박스에 섞이면 무게가 안 보인다. 꺼져 있으면 바꾸는 게 없으니
     *    다른 꺼진 토글들과 한 줄에 합류한다.
     */
    {
      id: 'urgent',
      visible: isCritical,
      on: urgentOn,
      onToggle: () => setUrgentOn((on) => !on),
      switchLabel: 'URGENT 태그',
      /**
       * 🔴 **접힌 줄에서는 「URGENT」만 쓴다** (2026-08-16 — 한 줄에 넣기 위해).
       *    다섯 항목이 520px에 안 들어가 이 항목만 다음 줄로 넘어갔다. 실제로 붙는 태그가
       *    `[🚨 URGENT]`라 **「태그」라는 낱말은 정보가 아니다** — 줄일 수 있는 유일한 라벨이었다.
       * 🔴 `switchLabel`(스크린리더용)과 펼침 라벨은 그대로 둔다 — 화면 폭 때문에 줄인 것이지
       *    이름이 바뀐 게 아니다.
       */
      labelOn: 'URGENT 태그',
      labelOff: 'URGENT',
      standalone: true,
      body: null,
    },
  ].filter((section) => section.visible);


  /**
   * 🔴 톤이 바뀌면 결과도 다시 만든다 — 옛 결과를 그대로 두면 버튼이 거짓말을 한다.
   * 🔴 **이 사람에게 기억시킨다.** 다음에 같은 상대로 다듬으면 이 값에서 시작한다.
   *    수신자가 없으면(아직 안 고름) 저장할 곳이 없으므로 이번 교정에만 적용된다.
   */
  const chooseRegister = async (next) => {
    if (next === register) return;
    setRegister(next);
    await onRegisterChange?.(next);
    onToneChange?.();
  };

  return (
    <div
      ref={popupRef}
      className={[
        'sai-popup',
        compact ? 'sai-popup-compact' : '',
        // 🔴 메뉴가 열린 동안은 팝업의 세로 잘림을 풀어 드롭다운이 온전히 보이게 한다
        //    (2026-08-14 사용자 지적: 표시 항목을 고르면 스크롤이 생겼다).
        compact && menuOpen ? 'sai-popup-menu-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="dialog"
      aria-label="사이 교정"
    >
      <div className="sai-popup-head">
        <span className="sai-brand">
          <SaiMark size={compact ? 22 : 28} />
          {/* 🔴 「사/이」 줄바꿈이 문제였는데 이름을 통째로 뺐던 건 과했다(2026-08-14 사용자 지적:
              "서비스 이름은 어디갔어?"). 이름은 **항상 남기고** `white-space: nowrap`으로 쪼개짐만
              막는다. 좁을 때는 「다듬기」 배지만 뺀다 — 배지는 이름과 달리 없어도 알 수 있다. */}
          <span className="sai-brand-name">S·AI</span>
          {!compact && <span className="sai-badge">다듬기</span>}
        </span>

        {/* Spec 필수 1 — 사용자가 긴급도를 **사전에** 고를 수 있다. 미선택이면 AI 판정이 기본값.
            🔴 좁을 때는 세그먼트(3버튼) 대신 **드롭다운**으로 바꾼다(2026-08-14 요청) — 세 버튼이
               헤더 폭을 다 먹어 로고까지 밀어냈다. 기능은 같고 자리만 줄인다. */}
        {compact ? (
          <select
            className="sai-urgency-select"
            value={result?.urgency ?? 'NORMAL'}
            onChange={(event) => onUrgencyChange(event.target.value)}
            aria-label="긴급도"
          >
            {URGENCY_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="sai-segment" role="group" aria-label="긴급도">
            {URGENCY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  result?.urgency === option.id ? 'sai-seg-item sai-seg-active' : 'sai-seg-item'
                }
                aria-pressed={result?.urgency === option.id}
                onClick={() => onUrgencyChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </span>
        )}

        {/**
          * 문체 수위 — 하나의 눈금, 세 칸 (S16 / Spec 필수 8, 2026-08-18 3단 통합).
          * 🔴 세 칸 중 하나만 켜지므로 「캐주얼이면서 격식」 같은 모순 상태가 **존재할 수 없다.**
          */}
        {REGISTER_ITEMS.filter((item) => registerOpen || item.id === register).map((item) => (
          <button
            key={item.label}
            type="button"
            className={register === item.id ? 'sai-seg-item sai-seg-active' : 'sai-seg-item'}
            aria-pressed={register === item.id}
            aria-expanded={registerOpen}
            onClick={() => {
              // 🔴 접혀 있을 때의 클릭은 «선택»이 아니라 «펼치기»다 — 이미 그 값이기 때문이다.
              if (!registerOpen) {
                setRegisterOpen(true);
                return;
              }
              setRegisterOpen(false);
              chooseRegister(item.id);
            }}
            title={registerOpen ? item.title : '문체 바꾸기 — ' + item.title}
          >
            {item.label}
          </button>
        ))}

        <button type="button" className="sai-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>

      {/* S17 / Spec 필수 9 · audit 2 — 수신자 **수동 선택이 주 경로**다(Lessons #4: DOM 자동
          감지는 사이트마다 마크업이 달라 범용 규칙이 성립하지 않는다).
          🔴 숫자 점수는 어떤 형태로도 표시하지 않는다(G1/G2) — 서술형 태그만. */}
      {/**
        * 🔴 **감지된 후보를 등록 제안으로만 낸다** (2026-08-16). 자동 등록은 하지 않는다 —
        *    제3자 정보를 동의 없이 수집하는 일이고, 필수 9의 「사용자가 직접 지정한 것만」과
        *    충돌한다. 이미 등록된 사람이면 위 드롭다운이 **자동 선택**돼 있고 이 줄은 안 뜬다.
        */}
      {personSuggestions.length > 0 && (
        <div className="sai-person-suggest">
          <span className="sai-person-suggest-text">
            {/* 🔴 후보가 여럿이면 **여럿을 보여준다** — 하나만 내밀면 엉뚱한 사람이 제안된다. */}
            {personSuggestions.length === 1
              ? '이 사람이 대화 상대인가요?'
              : '대화 상대를 골라 주세요'}
          </span>
          {personSuggestions.map((name) => (
            <button
              key={name}
              type="button"
              className="sai-person-add"
              onClick={() => onAddPerson?.(name)}
            >
              ＋ {name}
            </button>
          ))}
        </div>
      )}

      {/**
       * 🔴 **등록된 사람이 없어도 이 줄을 낸다** (2026-08-17). 예전에는 `recipients.length > 0`
       *    조건이라 **한 명도 없으면 통째로 숨었다** — 처음 쓰는 사람에게 「받는 사람을 추가하는
       *    자리」가 화면에 아예 없었다는 뜻이다.
       */}
      {(recipients.length > 0 || onAddRecipient) && (
        <div className="sai-recipient">
          <label className="sai-label" htmlFor="sai-recipient-select">
            받는 사람
          </label>
          <select
            id="sai-recipient-select"
            className="sai-select"
            value={adding ? ADD_NEW : (recipientId ?? '')}
            onChange={(event) => {
              const value = event.target.value;
              if (value === ADD_NEW) {
                setAdding(true);
                setAddError('');
                return;
              }
              setAdding(false);
              onRecipientChange?.(value);
            }}
          >
            {recipients.length === 0 && (
              <option value="" disabled>
                아직 없어요
              </option>
            )}
            {recipients.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
            {onAddRecipient && <option value={ADD_NEW}>＋ 새 사람 추가…</option>}
          </select>
          {/**
           * 🔴 **어느 팀 일인가** (2026-08-19 사용자 요청 ③). 고른 팀의 **용어집**이 이 교정에
           *    실린다. 「개인」이면 팀 용어를 싣지 않는다 — 사이는 팀 없이도 쓰는 제품이라
           *    **팀에 속하지 않은 상태가 선택지에 있어야 한다.**
           * 🔴 고른 값은 **이 사람에게 기억된다**(`onTeamChange` → 수신자 기록). 다음에 같은
           *    상대로 다듬으면 그대로 시작한다 — 문체(격식)와 같은 방식이다.
           * 🔴 **팀이 하나도 없으면 그리지 않는다** — 고를 것이 「개인」뿐인 드롭다운은 잡음이다.
           *    (예전 프로필 화면의 팀 칩은 반대로 「둘 이상일 때만」이라, 팀이 하나인 사용자에게는
           *    설정할 자리가 아예 없었다.)
           */}
          {teams.length > 0 && (
            <select
              className="sai-select sai-team-select"
              value={teamId ?? PERSONAL_TEAM_ID}
              aria-label="이 문장이 속한 팀"
              title="고른 팀의 용어집이 교정에 실려요"
              onChange={(event) => {
                onTeamChange?.(event.target.value);
                onToneChange?.();
              }}
            >
              <option value={PERSONAL_TEAM_ID}>개인 (팀 용어 안 씀)</option>
              {teams.map((team) => (
                <option key={team.teamId} value={team.teamId}>
                  {team.name}
                </option>
              ))}
            </select>
          )}
          {/**
           * 좁을 때 — **☰ 버튼 하나**로 접는다 (2026-08-14 사용자 요청).
           * 🔴 드롭다운은 **스위치 목록일 뿐**이고, 켠 항목의 내용은 팝업 본문 아래에 펼쳐진다
           *    (사용자 결정). 드롭다운 안에서 본문까지 읽게 하면 좁은 화면에서 두 번 스크롤된다.
           */}
          {toggleSections.length > 0 && compact && (
            <div className="sai-compact-menu">
              <button
                type="button"
                className={menuOpen ? 'sai-menu-button sai-menu-button-open' : 'sai-menu-button'}
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-label="표시 항목 메뉴"
              >
                <span className="sai-menu-icon" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                표시 항목
                {/* 켜진 개수를 보여줘 닫아 둔 채로도 상태를 안다. */}
                <span className="sai-menu-count">
                  {toggleSections.filter((section) => section.on).length}
                </span>
              </button>

              {menuOpen && (
                <div className="sai-menu-dropdown" role="menu">
                  {toggleSections.map((section) => (
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={section.on}
                      key={section.id}
                      className="sai-menu-row"
                      onClick={section.onToggle}
                    >
                      <span className="sai-menu-row-label">{section.labelOff}</span>
                      <ToggleSwitch
                        on={section.on}
                        onClick={section.onToggle}
                        label={section.switchLabel}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* S26 / Spec 부가 8 — 듀얼 시계. 수신자를 고른 자리 바로 옆이라 "지금 상대는 몇 시"가
              선택과 같은 시야에 들어온다. */}
          <DualClock
            theirTimeZone={recipient?.timeZone}
            theirName={recipient?.name ?? '상대'}
            // 요정 배너가 이미 「퇴근 시간대」를 말하고 있으면 배지는 접는다(중복 제거).
            hideOffBadge={!!scheduleInfo?.needsSchedule}
          />
          {recipient && (
            <span className="sai-recipient-tags">
              {recipient.private ? (
                // 필수 9 — 본인이 비공개로 둔 태그는 교정에 쓰지 않는다는 사실을 숨기지 않는다.
                <span className="sai-recipient-private">비공개 — 교정에 반영 안 함</span>
              ) : (
                (recipient.tagIds ?? [])
                  .map((id) => tagLabel(id))
                  .filter(Boolean)
                  .map((label) => (
                    <span key={label} className="sai-recipient-tag">
                      {label}
                    </span>
                  ))
              )}
            </span>
          )}
        </div>
      )}

      {/**
       * 새 사람 추가 폼 — 드롭다운에서 「＋ 새 사람 추가…」를 고르면 열린다.
       *
       * 🔴 **`.sai-recipient` 줄 밖에 둔다.** 그 줄은 좁아지면 ☰ 메뉴·듀얼 시계와 한 줄에
       *    겹치는 자리라, 입력칸을 그 안에 넣으면 좁은 폭에서 서로 밀어낸다.
       * 🔴 **묻는 것은 두 개뿐이다** — 이름과 지역. 지역 하나가 시간대·국가코드·언어를 한꺼번에
       *    정한다(`lib/regions.js`). 태그·GitHub·팀은 사이드패널에서 채운다.
       */}
      {adding && (
        <div className="sai-add-recipient">
          {/* 🔴 예시 이름은 사이드패널(팀원 초대 폼)과 같은 「홍길동」으로 맞춘다 — 화면마다 다른
              예시를 쓰면 등록해 둔 실제 인물 이름으로 오해할 수 있다. */}
          <input
            className="sai-add-input"
            placeholder="이름 (예: 홍길동)"
            value={newName}
            autoFocus
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitAdd();
              if (event.key === 'Escape') closeAdd();
            }}
          />
          <select
            className="sai-select sai-add-region"
            value={newRegionId}
            onChange={(event) => setNewRegionId(event.target.value)}
          >
            <option value="">지역을 고르세요</option>
            {REGIONS.map((region) => (
              <option key={region.id} value={region.id}>
                {region.label}
              </option>
            ))}
          </select>
          <div className="sai-add-actions">
            {/* 🔴 팝업의 기존 버튼 클래스를 그대로 쓴다 — 새 이름을 만들면 스타일이 갈린다. */}
            <button
              type="button"
              className="sai-button sai-button-primary"
              onClick={submitAdd}
              disabled={addBusy}
            >
              {addBusy ? '추가하는 중…' : '추가하고 이 사람으로'}
            </button>
            <button
              type="button"
              className="sai-button sai-button-quiet"
              onClick={closeAdd}
              disabled={addBusy}
            >
              취소
            </button>
          </div>
          {/* 🔴 지역이 언어까지 정한다는 사실을 말한다 — 안 말하면 왜 언어를 안 묻는지 알 수 없다. */}
          <p className="sai-add-hint">
            {addError !== '' ? (
              <span className="sai-add-error">{addError}</span>
            ) : (
              '지역을 고르면 시간대와 쓸 언어가 함께 정해져요. 나머지는 사이드패널에서 바꿀 수 있어요.'
            )}
          </p>
        </div>
      )}

      {/* Spec 권장 2 — 퇴근 요정 우회 경고. 🔴 페이지 하단 토스트가 아니라 **팝업 안**에 둔다:
          결정을 내리는 자리와 알림이 같은 화면에 있어야 확인 절차가 성립한다. */}
      {urgencyNotice && <div className="sai-urgency-notice">⚠️ {urgencyNotice}</div>}

      {/* Spec 필수 1 — AI 판정 결과와 근거를 항상 보여주고, 직접 고른 경우에도 AI 판정을 병기한다. */}
      <div className="sai-ainote">
        {loading && (
          // 로고와 로딩 모션이 같은 형태를 쓴다(임포트 원본 설계 의도) + 순환 문구로 반복감을 줄인다.
          <span className="sai-loading">
            {loadingText}
          </span>
        )}
        {!loading && error && <span className="sai-error">{error}</span>}
        {!loading && !error && result && <UrgencyNote result={result} />}
      </div>

      {!loading && !error && result && (
        <>
          {/* S13 — 편집 전에는 하이라이트가 보이는 읽기 뷰(권장 5의 초록 표시를 잃지 않으려고),
              "고치기"를 누른 뒤에는 편집 가능한 textarea로 바뀐다. */}
          {edited === null ? (
            <>
            <div className="sai-refined">
              {/* 용어 적용 하이라이트(초록)는 권장 5 — 표시만, 규칙 소유는 S12. */}
              {/* 🔴 강조는 **항상** 켜져 있다 — 안전망이라 사용자가 끌 대상이 아니다.
                  토글이 접는 것은 아래 범례(설명)뿐이다. */}
              <Highlighted
                text={swapped.text}
                phrases={result.appliedGlossary}
                memes={memeSpans}
                onMemeHover={setHoveredMeme}
              />
              {/**
               * 🔴 링크 하나가 **전용 행 27.2px**(패널의 4.9%)을 쓰고 있었다(2026-08-14 실측).
               *    `float: right`로 교정문 마지막 줄 오른쪽에 얹는다 — 마지막 줄에 자리가
               *    있으면 행을 통째로 회수하고, 없으면 예전처럼 아래로 내려간다. 어느 쪽이든
               *    지금보다 나빠지지 않는다.
               */}
              <button
                type="button"
                className="sai-link sai-link-inline"
                onClick={() => setEdited(swapped.text)}
              >
                ✎ 직접 고치기
              </button>
            </div>
            {/**
              * S19 / Spec 권장 4 후반부 — 밈 해설 줄.
              * 🔴 **밈이 하나도 없으면 아예 렌더하지 않는다** — 설명할 게 없는데 빈 줄이 남으면
              *    세로 공간만 먹는다(2026-08-14에 27.2px짜리 전용 행을 회수한 것과 같은 기준).
              * 🔴 밈이 있으면 **올리기 전에도 같은 높이로** 자리를 잡는다 — 올릴 때마다 아래
              *    내용이 밀려 내려가면 읽는 자리가 흔들린다.
              */}
            {memeSpans.length > 0 && (
              <p className="sai-meme-strip" aria-live="polite">
                {hoveredMeme ? (
                  <>
                    <b className="sai-meme-strip-term">{hoveredMeme.body}</b> — {hoveredMeme.meaning}
                  </>
                ) : (
                  <span className="sai-meme-strip-idle">
                    점선 표현 {memeSpans.length}개 — 올려보면 뜻이 떠요
                  </span>
                )}
              </p>
            )}
            </>
          ) : (
            <textarea
              className="sai-refined sai-refined-edit"
              value={edited}
              onChange={(event) => setEdited(event.target.value)}
              aria-label="교정문 직접 수정"
            />
          )}

          {/* S19 / Spec 권장 4 — 이모지를 바꿨으면 **반드시 무엇을 바꿨는지 알린다**.
              조용히 바꾸면 사용자가 쓴 것을 우리가 임의로 고친 게 된다. */}
          {/* 🔴 편집 중일 때만 남는 행이다 — 읽기 뷰의 「직접 고치기」는 교정문 안으로
              들어갔다(위 참조). textarea 안에는 얹을 자리가 없어 여기는 그대로 둔다. */}
          {edited !== null && (
            <div className="sai-meta-row">
              <button type="button" className="sai-link" onClick={() => setEdited(null)}>
                ↩ AI 교정문으로 되돌리기
              </button>
              {isEdited && <span className="sai-meta-green">수정한 내용이 학습에 반영돼요</span>}
            </div>
          )}

          {/**
           * 2026-08-14 제안 ② (A안) — 핵심 업무 정보 누락 경고.
           *
           * 🔴 **토글 뒤에 숨기지 않는다.** 이건 설명이 아니라 **보내기 전에 고칠 것**이다 —
           *    「적용하기」를 누르기 전에 눈에 들어와야 의미가 있다. 세 관문을 통과해야 뜨므로
           *    빈도 자체가 낮다(감사·공유·보고에는 아예 안 뜬다).
           * 🔴 **막지 않는다.** 경고만 하고 「적용하기」는 그대로 눌린다 — 기한을 일부러 안 쓰는
           *    경우(상대에게 정하게 하려고)가 실제로 있고, 우리 판정이 그걸 알 방법은 없다.
           * 🔴 자리는 **교정문 바로 아래**다. 위쪽 긴급도 알림 옆에 두면 "우리가 판정한 것"과
           *    "네가 빠뜨린 것"이 한 덩어리로 읽힌다 — 성격이 다른 두 정보다.
           */}
          {/**
           * S41 후속 — **채우지 않은 빈칸 경고** (2026-08-14 사용자 지적).
           *
           * 🔴 **여기가 진짜 위험 지점이다.** 회신 초안 패널에서 「빈칸을 채우고 넘기라」고
           *    안내하지만, 넘기고 나면 다듬기 팝업에는 아무 표시가 없고 **「적용하기」가 바로
           *    옆에 있다**. 실제로 `[일시]`가 남은 채 교정문까지 온 것을 실확장에서 확인했다.
           * 🔴 **교정문에서 직접 센다** — 회신 초안에서 왔는지 사용자가 직접 썼는지 묻지 않는다.
           *    출처를 따지면 「다시 만들기」로 재생성한 경우 같은 경로를 빠뜨린다.
           * 🔴 **막지 않는다.** 대괄호를 일부러 남겨 메신저에서 채우는 사용법이 있다 —
           *    누락 경고와 같은 원칙이다.
           */}
          {leftoverPlaceholders.length > 0 && (
            <div className="sai-missing sai-blank" role="status">
              <span className="sai-missing-head sai-blank-head">아직 채우지 않은 빈칸이 있어요</span>
              <p className="sai-blank-text">
                {leftoverPlaceholders.join(' · ')} — 이대로 보내면 대괄호가 그대로 전달돼요.
              </p>
            </div>
          )}

          {/* 🔴 빈칸 경고와 같은 자리·같은 무게 — 둘 다 「이대로 보내면 안 되는 것」이다. */}
          {nameDrift.length > 0 && (
            <div className="sai-blank" role="status">
              <span className="sai-missing-head sai-blank-head">이름 표기를 확인해 주세요</span>
              <p className="sai-blank-text">{nameWarningText(nameDrift)}</p>
            </div>
          )}

          {missing.length > 0 && (
            <div className="sai-missing" role="status">
              <span className="sai-missing-head">보내기 전에 확인해 보세요</span>
              <ul className="sai-missing-list">
                {missing.map((item) => (
                  <li key={item.element} className="sai-missing-item">
                    <span className="sai-missing-tag">{item.label} 없음</span>
                    <span className="sai-missing-text">
                      {item.suggestion || `${item.label}을(를) 함께 적어 주세요`}
                      <span className="sai-missing-quote"> · 「{item.requestQuote}」</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/**
           * 🔴 **폴백 안내를 화면에 낸다** (2026-08-16 사용자 지적 ② — 실확장에서 발견).
           *
           * 증상: 영어로 보내는데 **교정문이 한국어 원문 그대로** 나왔다. 원인은 API 실패 →
           * `buildFallbackResponse()`가 `refined: seed?.refined ?? text`, 즉 **원문을 그대로**
           * 돌려준 것이다. 그 자체는 설계대로다(없는 번역을 지어내지 않는다).
           *
           * 🔴 **진짜 결함은 그 다음이었다: 팝업이 `fallbackNotice`를 렌더하는 곳이 없었다.**
           *    `result.mock`만 보고 있었고, `fallback`/`fallbackNotice`는 응답에 실려 오는데
           *    화면이 통째로 버렸다. 그래서 사용자에게는 **번역이 안 된 원문이 교정 결과처럼**
           *    보였다 — `fallback.js` 헤더가 "가장 나쁜 실패"라고 못 박아 둔 바로 그 상태다
           *    ("폴백 응답을 실제 AI 결과로 오인시키지 않는다 … 클라이언트는 이를 반드시 노출한다").
           * 🔴 자리는 **교정문 바로 아래**다. 토글 줄 아래에 두면 문장을 다 읽은 뒤에야 보인다.
           */}
          {result.fallback && (
            <div className="sai-fallback" role="alert">
              <span className="sai-fallback-head">교정하지 못했어요</span>
              <p className="sai-fallback-text">
                {result.fallbackNotice ??
                  'AI 응답을 받지 못해 원문을 그대로 표시하고 있어요. 실제 교정 결과가 아닙니다.'}
              </p>
            </div>
          )}

          {result.mock && (
            <div className="sai-meta-row">
              <span className="sai-meta-warn">목업 응답 — 실제 교정 결과 아님</span>
            </div>
          )}

          {/**
           * 토글 섹션들 — 설명 / 역번역 / 대화 참고 / URGENT 태그.
           *
           * 🔴 **켠 것은 세로로 쌓고, 끈 것은 그 아래 가로 한 줄로 모은다**(2026-08-14 사용자 요청).
           *    예전엔 "전부 꺼야만" 한 줄이 됐는데, 그러면 하나만 켜도 나머지 스위치들이 각자
           *    한 줄씩 차지해 빈 공간이 쌓였다. 이제 꺼진 것끼리 한 줄에 모여 자리를 거의 안 쓴다.
           * 🔴 네 섹션을 **하나의 서술 배열**로 관리한다 — 예전엔 각자 JSX로 흩어져 있어
           *    "켜짐/꺼짐 분류"를 할 수가 없었다. 모양·동작을 한곳에서 맞추기도 쉬워진다.
           */}
          {/* 🔴 URGENT는 **켜져 있을 때만** 최상단 강조 박스 — 문장을 실제로 바꾸는 설정이라
              다른 정보 패널과 같은 회색 박스에 섞이면 무게가 안 보인다. 끄면 바꾸는 게 없으니
              아래 꺼진 토글 줄로 내려간다(`toggleSections`의 `urgent` 항목). */}
          {isCritical && urgentOn && (
            <div className="sai-urgent-tag">
              <span className="sai-urgent-tag-chip">{URGENT_PREFIX.trim()}</span>
              <span className="sai-urgent-tag-note">
                {compact ? '앞에 붙어요' : 'Critical이라 적용할 때 문장 앞에 붙어요'}
              </span>
              <ToggleSwitch
                on
                onClick={() => setUrgentOn((on) => !on)}
                label="URGENT 태그"
              />
            </div>
          )}

          {/**
           * 🔴 **넓을 때는 메뉴바를 쓰지 않는다**(2026-08-14 사용자 지적: "전체 너비에 준하는
           *    상황에서는 필요 없다"). 켠 것은 세로 카드, 끈 것은 아래 한 줄 — 이전 방식 그대로다.
           *    좁을 때만 ☰ 하나로 접어 자리를 아낀다.
           */}
          {toggleSections.length > 0 && !compact && (
            <div className="sai-toggles">
              {toggleSections
                /**
                 * `standalone`은 켜졌을 때 위 강조 박스가 이미 그렸다 — 여기서 또 그리지 않는다.
                 * 🔴 `rowAlways`는 **펼쳤을 때만** 카드가 된다(③) — 스위치 상태와 무관하다.
                 */
                .filter((section) =>
                  section.rowAlways
                    ? section.expanded
                    : section.on && !section.standalone,
                )
                .map((section) => (
                  <div className="sai-back" key={section.id}>
                    <div className="sai-back-head">
                      <span className="sai-label">{section.labelOn}</span>
                      {section.extra}
                      {/* 🔴 `rowAlways`는 **펼침 ≠ 켜짐**이다 — 참고를 끈 채 내용만 볼 수 있으므로
                          스위치를 `true`로 고정하면 화면이 거짓말을 한다(③). */}
                      <ToggleSwitch
                        on={section.rowAlways ? section.on : true}
                        onClick={section.onToggle}
                        label={section.switchLabel}
                      />
                    </div>
                    {section.body}
                  </div>
                ))}

              {/* 🔴 `rowAlways`는 펼치지 않은 동안 **켜져 있어도** 이 줄에 있다(③). */}
              {toggleSections.some((section) =>
                section.rowAlways ? !section.expanded : !section.on,
              ) && (
                <div className="sai-toggles-row">
                  {toggleSections
                    .filter((section) =>
                      section.rowAlways ? !section.expanded : !section.on,
                    )
                    .map((section) => (
                      <div className="sai-back sai-back-off" key={section.id}>
                        <div className="sai-back-head">
                          <span className="sai-label">{section.labelOff}</span>
                          {/* 🔴 셰브런도 이 줄에 있어야 한다 — 없으면 펼칠 방법이 사라진다. */}
                          {section.rowAlways && section.extra}
                          <ToggleSwitch
                            /* 🔴 켜짐/꺼짐을 **실제 상태**로 그린다. 예전에는 이 줄에 꺼진 것만
                               왔으므로 `false` 고정이었는데, 이제 켜진 항목도 여기 온다. */
                            on={section.rowAlways ? section.on : false}
                            onClick={section.onToggle}
                            label={section.switchLabel}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* 좁을 때 켠 항목의 내용 — 본문 아래에 쌓인다(위 주석 참조). */}
          {compact &&
            toggleSections
              .filter((section) => section.on && section.body)
              .map((section) => (
                <div className="sai-panel" key={section.id}>
                  <span className="sai-label">{section.labelOn}</span>
                  {section.body}
                </div>
              ))}

          {/* Spec 필수 6 — 퇴근시간·주말·공휴일이면 예약 제안. Low는 강제(아래 푸터에서 분기). */}
          {scheduleInfo?.needsSchedule && (
            <div className="sai-fairy">
              🌙 {recipientLabel}는 지금 {REASON_LABEL[scheduleInfo.reason]}
              {copulaFor(REASON_LABEL[scheduleInfo.reason])} — 현지{' '}
              <b>{formatScheduleLabel(scheduleInfo.localParts)}</b>에 보내는 걸 추천해요.
              {scheduleInfo.holidayLookupFailed && (
                <span className="sai-fairy-note"> (공휴일 정보를 불러오지 못해 주말 기준으로만 계산했어요)</span>
              )}
            </div>
          )}
        </>
      )}

      <div className="sai-popup-foot">
        {/* Spec 필수 5 — 사용자에게 Zero Retention을 명시한다. 버튼과 같은 줄에 두면 464px에서
            줄바꿈이 생겨 버튼 글자가 세로로 쪼개진다(실측) — 그래서 윗줄로 뺐다. */}
        <span className="sai-foot-note">
          Zero Retention — 본문은 저장되지 않아요
          {/* S26 / Spec 부가 5 — 의도 검증 피드백(👍/👎) + 포인트. 🔴 저장되는 것은 집계 수치
              두 개뿐이고, "무엇이 별로였는지" 같은 자유 서술은 받지 않는다(`lib/feedback.js`).
              🔴 한 결과에 한 번만 받는다 — 연타로 포인트를 쌓는 경로를 만들지 않는다. */}
          {result && !loading && !error && (
            <span className="sai-feedback">
              {feedbackGiven ? (
                <span className="sai-feedback-done">의견 고마워요{feedbackAward}</span>
              ) : (
                <>
                  <button
                    type="button"
                    className="sai-feedback-btn"
                    onClick={() => sendFeedback(FEEDBACK_KINDS.UP)}
                    title="의도대로 나왔어요"
                    aria-label="의도대로 나왔어요"
                  >
                    👍
                  </button>
                  <button
                    type="button"
                    className="sai-feedback-btn"
                    onClick={() => sendFeedback(FEEDBACK_KINDS.DOWN)}
                    disabled={regenerating}
                    title="의도와 달라요 — 바로 다시 만들어요"
                    aria-label="의도와 달라요 — 바로 다시 만들어요"
                  >
                    👎
                  </button>
                </>
              )}
            </span>
          )}
        </span>
        {/* S20 / Spec 권장 10 F-16 — 스니펫 저장은 **적용하기 옆**에 둔다(2026-08-13 사용자 요청):
            "이 문장을 어떻게 할까"를 정하는 자리라 두 행동이 같은 줄에 있어야 고르기 쉽다.
            🔴 사용자가 직접 누를 때만 저장된다(자동 저장 금지) — Zero Retention 단서 ①. */}
        <span className="sai-foot-actions">
          {/* 🔴 "역번역 재생성"이라는 이름이 실제 동작과 달랐다(2026-08-13 사용자 지적).
              Spec §6-3이 단일 통합 호출을 요구해서 역번역만 따로 만들 수 없고, 이 버튼은
              **교정 전체를 다시 돌린다** — 교정문도 바뀔 수 있다. 이름을 동작에 맞추고
              위치도 "이 문장을 어떻게 할까" 줄로 옮겼다. */}
          <button
            type="button"
            className="sai-button sai-button-quiet"
            onClick={onRegenerate}
            disabled={regenerating || loading || !!error || !result}
            title="같은 원문으로 교정을 다시 만듭니다 (교정문과 역번역이 함께 바뀝니다)"
          >
            {regenerating ? '다시 만드는 중…' : '↻ 다시 만들기'}
          </button>

          <button
            type="button"
            className="sai-button sai-button-quiet"
            onClick={() => onSaveSnippet?.(finalText)}
            disabled={loading || !!error || !result}
          >
            ＋ 저장 문구
          </button>

          {isForcedSchedule(result, scheduleInfo) ? (
            /* 🔴 Spec 필수 6 — Low + 오프타임에서는 **즉시 넣기 경로를 없앤다**(2026-08-13 사용자
               지시). 예전에는 「그래도 지금 넣기」를 나란히 뒀는데, 그러면 제한이 아니라 권유가
               된다. 지금 보내려면 **긴급도를 직접 올려야** 하고, 그 순간 확인 문구가 뜬다. */
            <button type="button" className="sai-button sai-button-primary" onClick={onSchedule}>
              🌙 {formatScheduleLabel(scheduleInfo.localParts)} 예약
            </button>
          ) : (
            <>
              {/**
                * 🔴 **오프타임이면 Normal·Critical에서도 예약을 «고를 수» 있게 한다**
                *    (2026-08-20 사용자 요청 ②).
                *
                *    예전에는 배너가 "지금 퇴근 시간대예요 — 목 09:00에 보내는 걸 추천해요"라고
                *    말해 놓고, 버튼은 **「적용하기」 하나뿐**이었다. 추천을 따르려면 화면을 닫고
                *    긴급도를 Low로 바꿔야 했다 — **권하는 행동에 이르는 길이 화면에 없었다.**
                * 🔴 **강제가 아니라 선택이다.** Low의 강제 예약(위 분기)과 다르다 — 여기서는
                *    「적용하기」가 그대로 살아 있고 예약은 그 옆에 선다. Spec 필수 6의 제한은
                *    **Low에만** 걸리므로 그 경계를 넘지 않는다.
                * 🔴 **주 버튼은 「적용하기」로 둔다.** 긴급도를 Normal·Critical로 판단한 문장에서
                *    예약을 주 동작으로 만들면, 급한 메시지를 미루도록 떠미는 화면이 된다.
                */}
              {scheduleInfo?.needsSchedule && (
                <button
                  type="button"
                  className="sai-button sai-button-quiet"
                  onClick={onSchedule}
                  disabled={loading || !!error || !result}
                  title={`${formatScheduleLabel(scheduleInfo.localParts)}에 알림을 받도록 적어 둬요`}
                >
                  🌙 {formatScheduleLabel(scheduleInfo.localParts)} 예약
                </button>
              )}
              <button
                type="button"
                className="sai-button sai-button-primary"
                onClick={() => onApply(textToApply)}
                disabled={loading || !!error || !result}
              >
                적용하기
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * Spec 필수 6 — "비긴급(Low) 모드 선택 시 퇴근 시간대에는 즉시 전송을 완전 제한(강제 예약)".
 * 🔴 우리가 실제로 강제하는 것은 **우리 자신의 삽입 버튼뿐**이다(위 헤더 주석 참조).
 */
/** 네 토글이 **똑같이 생기고 똑같이 동작하도록** 한곳에서 만든다 (2026-08-14 구조 정리). */
function ToggleSwitch({ on, onClick, label }) {
  return (
    <button
      type="button"
      className={on ? 'sai-switch sai-switch-on' : 'sai-switch'}
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <span className="sai-switch-knob" />
    </button>
  );
}

/** 미리보기용 자르기. 🔴 자른 문자열은 화면에만 쓰고, 전송되는 것은 원래 본문이다. */
function truncate(text, limit) {
  const value = String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function isForcedSchedule(result, scheduleInfo) {
  return result?.urgency === 'LOW' && scheduleInfo?.needsSchedule === true;
}

/** Spec 필수 1 — 판정 출처별 문구. 실패한 경우 그 사실을 숨기지 않는다. */
function UrgencyNote({ result }) {
  if (result.urgencyFallback) {
    return <span className="sai-error">{result.urgencyNotice}</span>;
  }
  /**
   * 🔴 **근거가 상대 언어로 오면 쓰지 않는다** (2026-08-16 실확장에서 발견 — ⓑ의 형제 결함).
   *    스크린샷: `직접 선택함 — AI 판정은 Critical · Der Rollout muss unbedingt heute erfolgen…`
   *    모델이 그 호출에서 설명 필드를 통째로 독일어로 썼는데, 역번역만 감췄더니 **이 줄에는
   *    그대로 남아 있었다.** 판정값(Critical)은 멀쩡하므로 **근거만 버리고 판정은 남긴다** —
   *    화면에서 지울 것은 읽을 수 없는 문장뿐이다.
   */
  const reason = isExplanationReadable(
    result.urgencyReason,
    result.sourceLanguage,
    result.targetLanguage,
  )
    ? result.urgencyReason
    : '';
  /**
   * 🔴 **`aiUrgency`가 없을 수 있다** (2026-08-14 사용자 지적: 문장이 끊긴 것처럼 나왔다).
   *    `urgencyLabel(null)`은 `null`을 돌려주고 React는 그걸 아무것도 아닌 것으로 그린다 —
   *    화면에는 「직접 선택함 — AI 판정은」에서 뚝 끊긴 문장만 남았다. 값이 없을 때는
   *    **문장을 바꿔서** 없다는 사실을 말한다. 비어 있는 자리를 남기지 않는다.
   *    실제로 비는 경로: ① 응답의 `urgency`가 규격 밖 → `schema.js`가 `aiUrgency: null`
   *    ② API 실패로 로컬 폴백 → `fallback.js`가 `aiUrgency: null`(사용자 선택은 존중).
   */
  if (result.urgencySource === 'user') {
    const aiLabel = result.aiUrgency ? urgencyLabel(result.aiUrgency) : null;
    if (!aiLabel) {
      return (
        <>
          직접 선택함 — AI 판정은 받지 못했어요
          {reason && <span className="sai-reason"> · {reason}</span>}
        </>
      );
    }
    return (
      <>
        직접 선택함 — AI 판정은 <b>{aiLabel}</b>
        {reason && <span className="sai-reason"> · {reason}</span>}
      </>
    );
  }
  /**
   * 🔴 **판정값을 다시 쓰지 않는다** (2026-08-14 실측: 한 화면에 「Critical」이 3번 나왔다).
   *    바로 위 세그먼트가 선택 상태로 이미 판정을 보여주고 있고 — 그 세그먼트는 항상 보이는
   *    것으로 확정됐다 — 여기서 반복하면 새 정보 없이 한 줄을 먹는다. 이 줄이 유일하게
   *    가진 정보는 **근거**다. 근거가 없을 때만 판정값을 대신 적어 빈 줄이 되지 않게 한다.
   */
  // 🔴 근거를 버렸으면 **판정값을 대신 적는다** — 빈 줄을 남기지 않는다(위 주석과 같은 규칙).
  if (!reason) {
    return (
      <>
        AI 판정: <b>{urgencyLabel(result.urgency)}</b> — 탭해서 변경
      </>
    );
  }
  return (
    <>
      AI 판정 근거 <span className="sai-reason">· {reason}</span>
    </>
  );
}

/**
 * 용어 사전이 적용된 구절을 초록으로 표시한다 (Spec 권장 5).
 * 정규식을 만들지 않고 인덱스 탐색으로 자른다 — 사용자 데이터가 정규식으로 해석되면 안 된다.
 */
/**
 * @param {boolean} [props.risks] 노란 밑줄(권장 6)을 그을지. 기본 true.
 *   🔴 **역번역에는 긋지 않는다**(2026-08-14 판단): ① 역번역은 **상대에게 나가는 문장이 아니다**
 *      — 실제로 나가는 것은 교정문이고 역번역은 그걸 내가 확인하려고 되돌린 것이다 ② 같은 위험을
 *      교정문과 역번역에서 **두 번** 말하게 된다 ③ 역번역의 목적은 "의미가 어긋났는지" 확인이지
 *      위험 재점검이 아니다. 용어집 초록(뜻 병기)은 역번역에서도 유지한다 — 그건 `rollout(배포)`
 *      처럼 **읽는 데 필요한 정보**라 목적에 맞는다.
 * @param {{start,end,body,meaning}[]} [props.memes] 밈 구간(권장 4 후반부). `text`와 **같은 문자열**을
 *   기준으로 계산된 것이어야 한다 — 다른 문자열로 잰 인덱스를 넘기면 엉뚱한 데를 자른다.
 * @param {(meme: {body: string, meaning: string}|null) => void} [props.onMemeHover]
 *   마우스·포커스가 밈에 올라갔을 때(벗어나면 null). 뜻은 호출부가 **고정된 자리**에 띄운다.
 */
function Highlighted({
  text,
  phrases,
  meanings = null,
  risks = true,
  memes = [],
  onMemeHover = null,
}) {
  const targets = phrases.map((entry) => entry.appliedText).filter(Boolean);

  // 🔴 세 하이라이트를 **한 번에** 계산한다(S19). 초록(권장 5)을 먼저 칠하고 그 결과 문자열을
  //    다시 훑어 노란 밑줄(권장 6)을 그으면 인덱스가 어긋난다 — 원문 기준 구간을 모아서 한 번에
  //    자르는 편이 어긋날 여지가 없다. 밈 점선(권장 4)도 같은 배열에 넣는다.
  const spans = [];

  // 초록 — 용어집 적용 구간(정규식을 만들지 않고 인덱스 탐색: 사용자 데이터가 패턴으로 해석되면 안 된다).
  for (const phrase of targets) {
    let from = 0;
    while (from <= text.length) {
      const index = text.indexOf(phrase, from);
      if (index === -1) break;
      spans.push({ start: index, end: index + phrase.length, kind: 'glossary' });
      from = index + phrase.length;
    }
  }

  // 노랑 — 위험 표현 구간 (Spec 권장 6 F-18, 판정표 D). 역번역에서는 끈다(위 주석 참조).
  if (risks) {
    for (const risk of findRiskySpans(text)) {
      spans.push({ start: risk.start, end: risk.end, kind: 'risk', riskKind: risk.kind });
    }
  }

  // 회색 점선 — 밈·신조어 (Spec 권장 4 후반부). 구간 계산은 코어(`findMemeSpans`)가 이미 했다.
  for (const meme of memes) {
    spans.push({
      start: meme.start,
      end: meme.end,
      kind: 'meme',
      meaning: meme.meaning,
    });
  }

  if (spans.length === 0) return text;

  /**
   * 겹치면 먼저 시작한 것만 남긴다 — 초록 안에 노랑을 겹쳐 그리면 마크업이 깨진다.
   * 🔴 같은 자리에서 부딪히면 **안전망이 이긴다**: 용어집(초록) > 위험(노랑) > 밈(점선).
   *    앞의 둘은 잘못 보내는 것을 막는 표시이고 밈은 읽기 도움이라, 하나만 보여야 한다면
   *    막는 쪽이 남아야 한다. (길이 우선보다 이 순서를 먼저 본다.)
   */
  const KIND_PRIORITY = { glossary: 0, risk: 1, meme: 2 };
  spans.sort(
    (a, b) =>
      a.start - b.start ||
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      b.end - a.end,
  );
  const kept = [];
  for (const span of spans) {
    const last = kept[kept.length - 1];
    if (last && span.start < last.end) continue;
    kept.push(span);
  }

  const parts = [];
  let cursor = 0;
  kept.forEach((span, index) => {
    if (span.start > cursor) parts.push(text.slice(cursor, span.start));
    const body = text.slice(span.start, span.end);
    if (span.kind === 'glossary') {
      parts.push(
        <mark key={`gl-${index}`} className="sai-glossary">
          {body}
          {/* 역번역에서만 뜻을 병기한다 — 등록된 용어에 한해서. */}
          {meanings?.[body] ? <span className="sai-glossary-gloss">({meanings[body]})</span> : null}
        </mark>,
      );
    } else if (span.kind === 'risk') {
      parts.push(
        <mark key={`rk-${index}`} className="sai-risk" title={RISK_LABELS[span.riskKind]}>
          {body}
        </mark>,
      );
    } else {
      /**
       * 🔴 `tabIndex={0}` — 마우스가 유일한 경로가 되면 안 된다. 키보드 포커스로도 같은 해설이 뜬다.
       * 🔴 **`title`을 붙이지 않는다**(2026-08-14 사용자 지적으로 제거). 브라우저 기본 툴팁으로도
       *    볼 수 있게 하려고 넣었는데, 실확장에서 **아래 해설 줄과 커서 옆 툴팁에 같은 문장이 동시에**
       *    떴다. 접근 경로를 늘린 게 아니라 **같은 정보를 두 번 말한** 것이다 — 경로가 여럿이어야
       *    한다는 원칙은 *다른 방법으로 닿을 수 있어야* 한다는 뜻이지 *동시에 두 번 보여준다*는
       *    뜻이 아니다. 위험 표현(`.sai-risk`)이 `title`을 쓰는 것은 그쪽엔 해설 줄이 없어서다.
       */
      const meme = { body, meaning: span.meaning };
      parts.push(
        <mark
          key={`mm-${index}`}
          className="sai-meme"
          tabIndex={0}
          onMouseEnter={() => onMemeHover?.(meme)}
          onMouseLeave={() => onMemeHover?.(null)}
          onFocus={() => onMemeHover?.(meme)}
          onBlur={() => onMemeHover?.(null)}
        >
          {body}
        </mark>,
      );
    }
    cursor = span.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));

  return parts;
}
