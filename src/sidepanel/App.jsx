import { useEffect, useMemo, useRef, useState } from 'react';
import SaiMark from '../assets/SaiMark.jsx';
// 🔴 외부 서비스는 각자의 공식 로고로 보여준다 — 우리 팔레트로 바꾸면 알아보지 못한다.
import { GoogleMark, GitHubMark } from '../assets/ServiceMarks.jsx';
import { DASHBOARD_URL } from '../config.js';
import { getLocal, setLocal, STORAGE_KEYS } from '../lib/storage.js';
import {
  listPersonalGlossary,
  addPersonalGlossaryEntry,
  GLOSSARY_LANGUAGES,
  updatePersonalGlossaryEntry,
  removePersonalGlossaryEntry,
  dedupePersonalGlossary,
} from '../lib/glossary.js';
import {
  getProfile,
  setProfile,
  getLearnedCounts,
  removeLearnedPattern,
  clearLearnedPatterns,
  SITUATION_TEMPLATES,
  COLLAB_STYLES,
} from '../lib/profile.js';
import { categoryLabel, LEARNING_THRESHOLD } from '../core/profile/diff.js';
// S23 / Spec 권장 12 · §1 Token Economy
import { findMeetingSlots, balanceSlots, SLOT_KINDS, LOOKAHEAD_DAYS } from '../core/meeting/overlap.js';
import { buildMeetingDraft, calendarLinks, MEETING_KINDS } from '../core/meeting/draft.js';
// 🔴 직접 입력한 시각을 상대 시각으로 바꾸는 데 쓴다 — 추천 계산과 **같은 함수**여야
//    두 화면이 다른 시각을 말하는 일이 없다.
import { getLocalParts, isWeekend } from '../core/schedule/fairy.js';
import { excludeBusySlots, busyNotice } from '../core/meeting/freebusy.js';
import {
  fetchBusyIntervals,
  isCalendarLinked,
  unlinkCalendar,
  calendarErrorMessage,
} from '../lib/calendarClient.js';
import { getPoints, awardPoints, POINT_REASONS } from '../lib/points.js';
import {
  listRecipients,
  updateRecipient,
  removeRecipient,
  addRecipient,
  RECIPIENT_TAGS,
  tagLabel,
  RECIPIENT_LANGUAGES,
  LANGUAGE_LABELS,
  PERSONAL_TEAM_ID,
} from '../lib/recipients.js';
// S30 대안 — 내 문체 리포트.
// S31 — 구글 로그인 + 설정 동기화.
import {
  signIn,
  signOut,
  getSession,
  isAuthConfigured,
  authErrorMessage,
} from '../lib/authClient.js';
import { syncNow, syncErrorMessage } from '../lib/syncClient.js';
// S22 / Spec audit 3 — GitHub 공개 활동에서 소통 태그 제안.
import { analyzePublicActivity } from '../core/github/index.js';
import {
  regionByTimeZone,
  regionCityLabel,
  resolveLanguageOnRegionChange,
} from '../lib/regions.js';
import RegionPicker from './RegionPicker.jsx';
import {
  startDeviceFlow,
  pollForToken,
  storeToken,
  clearToken,
  getStoredToken,
  fetchPublicEvents,
  fetchUserProfile,
  errorMessage,
} from '../lib/githubClient.js';
import {
  getOnboarding,
  saveOnboarding,
  setMyLanguage,
  resetOnboarding,
  onboardingLabels,
  MY_LANGUAGES,
  PARTNER_REGIONS,
  DEFAULT_TONES,
} from '../lib/onboarding.js';
// 🔴 예전 버전이 심어 둔 데모 용어·수신자 청소 (2026-08-15).
import { removeLegacySeeds } from '../lib/seedCleanup.js';
// 🔴 외부 도구 용어집 붙여넣기 가져오기 (2026-08-16).
import { parseGlossaryText, MAX_IMPORT_ROWS } from '../lib/glossaryImport.js';
// 🔴 팀에서 나를 알아보게 하는 이름·직급 (2026-08-16).
import { getIdentity, setIdentity, isIdentitySet, MAX_IDENTITY_FIELD } from '../lib/identity.js';
import { listSnippets, markSnippetUsed, removeSnippet } from '../lib/snippets.js';
import { listReservations, removeReservation } from '../lib/reservations.js';
// 🔴 「오늘의 사이」는 실카운트다 — 목업 상수(`TODAY_STATS`)는 제거했다(2026-08-15 사용자 지적).
import { getTodayUsage } from '../lib/usage.js';
// Spec §3 — 팀 용어집 · 팀 참가 · 마찰 카운트 업로드.
import {
  getTeam,
  listTeams,
  setActiveTeam,
  createTeam,
  joinTeam,
  leaveTeam,
  listTeamGlossary,
  saveTeamGlossaryEntry,
  removeTeamGlossaryEntry,
  uploadFriction,
  fetchAllTeamsFriction,
  refreshAllMemberships,
  listTeamMembers,
  setMemberDashboardAccess,
  removeTeamMember,
  transferOwnership,
  regenerateInvite,
  renameTeam,
  teamErrorMessage,
} from '../lib/teamClient.js';
import { POINTS } from './mockData.js';

/**
 * 사이드 패널 — [DS] 프로토타입 `Sai Prototype.dc.html`의 사이드 패널 이식.
 *
 * 탭 구성은 **4탭**이다 (2026-08-12 사용자 확정). Spec §1이 요구하는 6가지 내용은 전부 살아 있고
 * 배치만 다르다: 온보딩·B2B 배너 → 홈 안 · 학습내역 → 프로필 안.
 * 352px 폭에 탭 6개를 넣으면 잘리거나 2줄로 갈라진다.
 */
/**
 * 🔴 탭 **5개**. 설정은 탭이 아니라 **헤더의 톱니 버튼**으로 뺐다(2026-08-13 사용자 요청) —
 *    6탭은 352px에서 여유가 17px밖에 없어(실측) 라벨을 조금만 늘려도 잘린다.
 *    자주 쓰지 않는 설정을 상시 탭으로 두는 것도 자리 낭비다.
 */
/**
 * 사이드패널 메뉴.
 *
 * 🔴 **2026-08-14 사용자 결정으로 5개 → 3개로 줄였다.** 이전에는 용어집·저장 문구·예약이 각각
 *    탭이었는데, 셋 다 **가끔 들어가 정리하는 목록**이라 항상 보이는 탭을 차지할 이유가 없었다.
 *    「보관함」 하나로 묶고 안에서 접었다 편다 — 자주 쓰는 홈·프로필이 앞으로 나온다.
 * 🔴 설정은 탭이 아니라 **헤더의 기어 아이콘**이다(기존 그대로). 탭에 넣으면 다시 5개가 된다.
 * 🔴 더 줄이지 않는 이유: 홈(쓰기)·보관함(정리)·프로필(나와 상대)은 **목적이 다르다.** 목적이
 *    다른 것을 한 화면에 합치면 스크롤만 길어진다.
 */
/**
 * 🔴 **팀을 독립 탭으로 뺐다** (2026-08-16 사용자 요청). 팀 관리·용어집·권한이 전부
 *    「보관함 → 용어집 → 팀」 3단계 안에 묻혀 있었다 — 팀장이 매일 쓰는 관리 화면을
 *    용어집 하위에 두는 것은 정보 구조가 뒤집힌 것이다.
 * 🔴 4탭은 352px에 들어간다(옛 5탭은 여유가 17px밖에 없었다 — 라벨 「팀」이 1글자라
 *    3탭 대비 폭 증가가 가장 작다).
 */
const TABS = [
  { id: 'home', label: '홈' },
  { id: 'team', label: '팀' },
  { id: 'archive', label: '보관함' },
  { id: 'profile', label: '프로필' },
];

/**
 * 🔴 **팀 용어집은 용어집 안에 있다** (2026-08-16 사용자 결정). 한때 「팀」 탭으로 옮겼다가
 *    되돌렸다 — 용어는 개인·팀·연동이 **같은 성격의 목록**이고 우선순위(개인 > 팀 > 기본)로
 *    묶여 있어서, 팀 것만 다른 탭에 두면 우선순위를 한 화면에서 볼 수 없다.
 *    「팀」 탭은 **소속·권한 관리**만 맡는다.
 */

/** 용어집 출처 탭 — 우선순위 개인 > 팀/연동 > 기본 AI (Spec 필수 7). */
const GLOSSARY_SCOPES = [
  { id: 'personal', label: '개인' },
  { id: 'team', label: '팀' },
  { id: 'linked', label: '연동' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [theme, setTheme] = useState('light');
  const [glossaryScope, setGlossaryScope] = useState('personal');
  // S13 — 실제 저장된 학습 횟수/프로필. 목업 상수는 더 이상 쓰지 않는다.
  const [learned, setLearned] = useState([]);
  const [profile, setProfileState] = useState({ situationId: null, collabStyleId: null });
  /** S17 — 수신자 목록 (Spec 필수 9). */
  const [recipients, setRecipients] = useState([]);
  /** S11 — 3초 퀵 온보딩 (Spec 권장 9). */
  const [onboarding, setOnboarding] = useState(null);
  /** S20 — 스니펫 (Spec 권장 10). */
  const [snippets, setSnippets] = useState([]);
  /** S14 후속 — 예약 기록 (Spec 필수 6). */
  const [reservations, setReservations] = useState([]);

  /**
   * 설정 탭 (2026-08-13 사용자 요청) — 개인 설정을 한자리에 모은다.
   * 🔴 팝업에도 같은 토글이 있다. **저장소가 단일 출처**라 어느 쪽에서 바꾸든 즉시 반영된다
   *    (팝업은 `chrome.storage.onChanged`를 구독한다) — 두 화면이 서로 다른 값을 말하지 않는다.
   */
  const [backOn, setBackOn] = useState(true);
  const [hintsOn, setHintsOn] = useState(true);
  const [snippetMode, setSnippetMode] = useState('replace');
  /** S21 / Spec 권장 8 — 직전 대화 맥락 참고. 기본 켜짐. */
  const [threadOn, setThreadOn] = useState(true);
  /** 설정은 탭이 아니라 헤더 톱니로 여는 오버레이다. */
  const [reasonOn, setReasonOn] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    getLocal(STORAGE_KEYS.BACK_TRANSLATION, true).then(setBackOn);
    getLocal(STORAGE_KEYS.HIGHLIGHT_HINTS, true).then(setHintsOn);
    getLocal(STORAGE_KEYS.SNIPPET_INSERT_MODE, 'replace').then(setSnippetMode);
    getLocal(STORAGE_KEYS.THREAD_CONTEXT, true).then(setThreadOn);
    /**
     * 🔴 **「변경 이유」가 설정에서 빠져 있었다** (2026-08-16 사용자 지적 ①).
     *    팝업의 다른 스위치들과 **똑같이 `chrome.storage`에 저장되는데**(`sai.refineReasoning`)
     *    설정 화면에만 없었다 — 즉 기능은 기억되는데 **바꿀 자리가 팝업 한 곳뿐**이었다.
     *    빠뜨린 것이지 의도가 아니다.
     */
    getLocal(STORAGE_KEYS.REFINE_REASONING, false).then(setReasonOn);
  }, [settingsOpen]);

  const toggleBackTranslation = async () => {
    const next = !backOn;
    setBackOn(next);
    await setLocal(STORAGE_KEYS.BACK_TRANSLATION, next);
  };

  const toggleHints = async () => {
    const next = !hintsOn;
    setHintsOn(next);
    await setLocal(STORAGE_KEYS.HIGHLIGHT_HINTS, next);
  };

  const toggleReason = async () => {
    const next = !reasonOn;
    setReasonOn(next);
    await setLocal(STORAGE_KEYS.REFINE_REASONING, next);
  };

  const toggleThread = async () => {
    const next = !threadOn;
    setThreadOn(next);
    await setLocal(STORAGE_KEYS.THREAD_CONTEXT, next);
  };

  const toggleSnippetMode = async () => {
    const next = snippetMode === 'replace' ? 'append' : 'replace';
    setSnippetMode(next);
    await setLocal(STORAGE_KEYS.SNIPPET_INSERT_MODE, next);
  };
  const [toast, setToast] = useState('');

  // 저장된 테마를 복원한다. 저장값이 없으면 OS 설정을 따른다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getLocal(STORAGE_KEYS.THEME, null);
      if (cancelled) return;
      const prefersDark =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      setTheme(stored ?? (prefersDark ? 'dark' : 'light'));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // S11 — 저장된 온보딩을 복원한다. 없으면 `completedAt`이 비어 질문 화면이 뜬다.
  useEffect(() => {
    getOnboarding().then(setOnboarding);
  }, []);

  /**
   * 🔴 **저장 문구·예약이 사이드패널에 영영 안 나타나던 원인** (2026-08-16 사용자 지적 ⑥).
   *
   * 이 두 effect는 `activeTab !== 'snippets'` / `!== 'schedule'`을 보고 있었는데,
   * **`TABS`에 그런 id가 없다** — 지금 탭은 `home · team · archive · profile`이고
   * 저장 문구와 예약은 둘 다 **보관함(`archive`)** 안에 있다. 탭이 개편되면서 id는 바뀌었는데
   * 이 가드가 옛 이름에 남아, 조건이 **한 번도 참이 되지 않았다.** 그래서 `listSnippets()`가
   * 아예 호출되지 않았고 화면은 초기값 `[]` 그대로 「0건」이었다 — 저장은 실제로 되고 있었다.
   *
   * 🔴 조용히 실패하는 종류다: 오류도 없고, 빌드도 통과하고, `no-undef`도 못 잡는다
   *    (문자열 오타이지 식별자가 아니다). 그래서 **`TABS`의 id와 대조하는 계약 테스트**를
   *    함께 넣었다(`test/tabs.unit.test.js`) — 다음에 탭 이름이 바뀌면 그쪽이 먼저 깨진다.
   */
  useEffect(() => {
    if (activeTab !== 'archive') return;
    // 열 때마다 다시 읽는다 — 페이지 팝업에서 방금 저장한 것이 바로 보여야 한다.
    listSnippets().then(setSnippets);
    listReservations().then(setReservations);
  }, [activeTab]);

  const deleteReservation = async (id) => {
    await removeReservation(id);
    setReservations(await listReservations());
    setToast('예약 기록을 삭제했어요');
  };

  /**
   * 🔴 사이드패널은 호스트 페이지 입력창에 직접 쓸 수 없다 — 클립보드 복사가 우리가 실제로 할 수
   *    있는 재사용이고, 문구도 그렇게 쓴다(Spec 권장 10의 "원클릭 재사용"의 실제 범위).
   */
  const useSnippet = async (snippet) => {
    try {
      await navigator.clipboard.writeText(snippet.text);
      await markSnippetUsed(snippet.id);
      setSnippets(await listSnippets());
      setToast('복사했어요 — 입력창에 붙여넣기(Ctrl+V) 하세요');
    } catch {
      setToast('복사하지 못했어요 — 문장을 직접 선택해 복사해 주세요');
    }
  };

  const deleteSnippet = async (id) => {
    await removeSnippet(id);
    setSnippets(await listSnippets());
    setToast('저장 문구를 삭제했어요');
  };

  const submitOnboarding = async (answers) => {
    setOnboarding(await saveOnboarding(answers));
    setToast('설정을 저장했어요');
  };

  const restartOnboarding = async () => {
    await resetOnboarding();
    setOnboarding(await getOnboarding());
  };

  /**
   * 🔴 **내 언어를 프로필에서도 고칠 수 있게 한다** (2026-08-20 사용자 결정 ⓨ).
   *    지금까지 이 값을 바꾸는 길은 홈의 **「3초 온보딩 다시 하기」뿐**이었다 — 언어 하나를
   *    바꾸려고 설정을 통째로 지우고 처음부터 다시 답해야 했다.
   * 🔴 저장 위치는 그대로다(`sai.onboarding`) — 화면만 하나 더 열었다.
   */
  const changeMyLanguage = async (language) => {
    setOnboarding(await setMyLanguage(language));
    setToast('내 언어를 바꿨어요');
  };

  // 토스트는 2.2초 뒤 사라진다 (프로토타입 showToast와 같은 시간).
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setLocal(STORAGE_KEYS.THEME, next);
  };

  /**
   * S13 — 저장된 카테고리별 횟수를 화면용 목록으로 바꾼다.
   * 🔴 문장(`label`)은 여기서 id로부터 조립한다 — 저장된 적이 없는 표시 문자열이다 (Spec 필수 5).
   */
  const refreshLearned = async () => {
    const counts = await getLearnedCounts();
    const items = Object.entries(counts)
      .map(([id, count]) => ({ id, count, text: categoryLabel(id) }))
      .filter((item) => item.text !== null) // 모르는 id는 문장을 지어내지 않고 감춘다
      .sort((a, b) => b.count - a.count);
    setLearned(items);
  };

  /**
   * 🔴 마운트 시 한 번만 읽으면 목록이 낡는다(실측 2026-08-13): 사이드패널을 열어둔 채 페이지에서
   *    교정문을 고쳐 적용하면 학습은 쌓이는데 화면은 그대로였다. 프로필 탭을 열 때마다 다시 읽는다.
   *    남은 한계: **프로필 탭을 이미 보고 있는 동안** 쌓인 건 탭을 다시 눌러야 반영된다.
   */
  useEffect(() => {
    if (activeTab !== 'profile') return;
    refreshLearned();
    getProfile().then(setProfileState);
    listRecipients().then(setRecipients);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  /**
   * 🔴 예전에 자동으로 심어졌던 데모 데이터(용어 4개·수신자 2명)를 지운다 (2026-08-15).
   *    코드에서 시드를 없애는 것만으로는 **이미 설치해 쓰던 사람의 저장소에 그대로 남는다** —
   *    그리고 그 값들은 교정 결과를 실제로 바꾼다(용어 치환·수신자 태그·타임존).
   * 🔴 사용자가 손댄 것은 지우지 않는다(`seedCleanup.js`의 내용 대조).
   */
  useEffect(() => {
    // 🔴 덮어쓰기 규칙 이전에 쌓인 중복을 한 번 정리한다(2026-08-16).
    dedupePersonalGlossary().then((n) => {
      if (n > 0) setToast(`중복된 용어 ${n}개를 정리했어요`);
    });
    removeLegacySeeds().then((removed) => {
      if (removed.glossary + removed.recipients === 0) return;
      listRecipients().then(setRecipients);
      setToast('예시로 들어 있던 용어·수신자를 정리했어요');
    });
  }, []);

  /* S17 — 수신자 소통 가이드 (Spec 필수 9: 열람·수정·비공개 권리). */
  const toggleRecipientTag = async (id, tagId) => {
    const target = recipients.find((entry) => entry.id === id);
    if (!target) return;
    const has = (target.tagIds ?? []).includes(tagId);
    const tagIds = has
      ? target.tagIds.filter((value) => value !== tagId)
      : [...(target.tagIds ?? []), tagId];
    await updateRecipient(id, { tagIds });
    setRecipients(await listRecipients());
  };

  /* 🔴 `toggleRecipientPrivate`는 비공개 버튼과 함께 지웠다(2026-08-19 사용자 결정 ①).
     저장 계층(`recipients.js`의 `private` 필드·프롬프트 제외 분기)은 그대로 살아 있다. */

  const deleteRecipient = async (id) => {
    await removeRecipient(id);
    setRecipients(await listRecipients());
    setToast('수신자를 삭제했어요');
  };

  const createRecipient = async (input) => {
    try {
      await addRecipient(input);
      setRecipients(await listRecipients());
      setToast('수신자를 추가했어요');
    } catch (caught) {
      setToast(caught.message);
    }
  };

  /**
   * 등록된 수신자를 고친다 (2026-08-16 사용자 요청 ③).
   * 🔴 **태그·비공개는 건드리지 않는다** — 폼이 다루는 필드만 넘긴다. `{...draft}`를 통째로
   *    보내면 폼에 없는 `tagIds`가 `undefined`로 덮여 **붙여 둔 태그가 전부 사라진다.**
   * 🔴 실패는 던져 올린다 — 폼이 자기 안에서 사유를 보여 준다(토스트는 폼을 닫은 뒤라야 보인다).
   */
  const editRecipient = async (id, draft) => {
    await updateRecipient(id, {
      name: draft.name,
      timeZone: draft.timeZone,
      countryCode: draft.countryCode,
      language: draft.language,
      // 🔴 화이트리스트라 여기 없으면 **화면에서 골라도 저장되지 않는다** (2026-08-18 추가).
      register: draft.register,
      teamId: draft.teamId,
      githubLogin: draft.githubLogin,
      // 🔴 폼이 태그를 들고 시작하므로 **그대로 넘긴다** — 넘기지 않으면 폼에서 고른 제안이 사라진다.
      tagIds: draft.tagIds,
    });
    setRecipients(await listRecipients());
    setToast('수신자 정보를 바꿨어요');
  };

  const deleteLearned = async (id) => {
    await removeLearnedPattern(id);
    await refreshLearned();
    setToast('학습 내역 1건을 삭제했어요');
  };

  const clearLearned = async () => {
    await clearLearnedPatterns();
    await refreshLearned();
    setToast('학습 내역을 모두 삭제했어요');
  };

  const changeProfile = async (patch) => {
    setProfileState(await setProfile(patch));
    /**
     * 🔴 **같은 축이 두 곳에 저장돼 어긋나 있었다** (2026-08-20 ⓨ 작업 중 확인).
     *    「선호하는 말투」는 `sai.profile.collabStyleId`, 온보딩의 「기본 톤」은
     *    `sai.onboarding.tone`인데 **id가 같다**(direct·warm·brief). 온보딩 → 프로필 방향은
     *    `saveOnboarding()`이 맞춰 주지만 **반대 방향이 없었다** — 프로필에서 말투를 바꾸면
     *    홈의 접힌 요약 「설정 완료 ✓ 한국어 · 직접적으로」가 **옛 값을 계속 보여줬다.**
     * 🔴 **아직 온보딩을 안 끝냈으면 건드리지 않는다** — 여기서 `saveOnboarding`을 부르면
     *    `completedAt`이 찍혀 첫 설정 화면이 사라진다.
     */
    if (patch?.collabStyleId !== undefined && onboarding?.completedAt) {
      setOnboarding(await saveOnboarding({ ...onboarding, tone: patch.collabStyleId }));
    }
    setToast('프로필을 저장했어요');
  };

  return (
    <div className="panel">
      <header className="panel-header">
        <SaiMark size={34} className="brand-mark" />
        {/**
          * 🔴 **워드마크는 `S·AI`다** (2026-08-19 사용자 결정).
          *    가운뎃점이 발음을 만든다 — 소리 내면 **사이**이고, 동시에 `S + AI`로 읽힌다.
          *    한국어를 모르는 사람에게 **점 하나로 이름의 뜻이 설명된다.**
          * 🔴 **보여주는 이름과 식별자를 나눈다** — 화면·발표는 `S·AI`, 확장 이름·파일·URL은
          *    `SAI`(점은 검색이 안 되고 경로에서 깨진다).
          * 🔴 본문 한국어 문장 속의 「사이」는 그대로 둔다(예: "오늘의 사이", "사이가 대신
          *    보내지는 않아요") — 그건 워드마크가 아니라 **문장**이고, 바꾸면 어색해진다.
          */}
        <span className="brand-block">
          <span className="brand-name">S·AI</span>
          {/* 🔴 사이드패널에만 둔다 — 팝업은 남의 페이지 위 좁은 오버레이라 한 줄이 늘면
              본문이 밀린다(사용자 결정). */}
          <span className="brand-tagline">Bridging People, Time, and Space</span>
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={() => setSettingsOpen(true)}
          title="설정"
          aria-label="설정 열기"
        >
          <GearIcon />
        </button>
      </header>

      <nav className="panel-tabs" aria-label="사이 메뉴">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'tab tab-active' : 'tab'}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/**
        * 🔴 **`key={activeTab}`로 탭마다 통째로 새로 그린다** (2026-08-16 사용자 지적 ①②).
        *    증상: 팀을 바꿀 때마다 「협업 대시보드」 카드가 하나씩 늘고, **다른 탭으로 옮겨도
        *    사라지지 않았다.** 소스에도 번들에도 이 카드를 그리는 자리는 **한 곳뿐**이라
        *    (`TeamPanel` 안 1건) 코드로는 재현되지 않는다 — 즉 React가 지워야 할 DOM을 실제로
        *    지우지 못하고 있다는 뜻이다.
        * 🔴 원인을 못 찾았더라도 **탭이 바뀌면 이전 탭의 DOM이 남을 수 없게** 만들 수는 있다.
        *    key가 바뀌면 React는 갱신이 아니라 **교체**를 하므로, 누적된 노드가 있어도 이 지점에서
        *    끊긴다. 근본 원인 규명이 아니라 **차단**이다 — 콘솔 오류를 받아 원인을 계속 좁힌다.
        */}
      <main className="panel-body" key={activeTab}>
        {activeTab === 'home' && (
          <HomeTab
            onboarding={onboarding}
            onSaveOnboarding={submitOnboarding}
            onResetOnboarding={restartOnboarding}
            onToast={setToast}
          />
        )}
        {settingsOpen && (
          <SettingsTab
            onClose={() => setSettingsOpen(false)}
            theme={theme}
            onToggleTheme={toggleTheme}
            backOn={backOn}
            onToggleBack={toggleBackTranslation}
            hintsOn={hintsOn}
            onToggleHints={toggleHints}
            reasonOn={reasonOn}
            onToggleReason={toggleReason}
            snippetMode={snippetMode}
            onToggleSnippetMode={toggleSnippetMode}
            threadOn={threadOn}
            onToggleThread={toggleThread}
            onNotice={setToast}
          />
        )}
        {activeTab === 'team' && <TeamTab onToast={setToast} />}
        {activeTab === 'archive' && (
          <ArchiveTab
            glossaryScope={glossaryScope}
            onGlossaryScopeChange={setGlossaryScope}
            snippets={snippets}
            onUseSnippet={useSnippet}
            onDeleteSnippet={deleteSnippet}
            reservations={reservations}
            onDeleteReservation={deleteReservation}
            onToast={setToast}
          />
        )}
        {activeTab === 'profile' && (
          <ProfileTab
            items={learned}
            onDelete={deleteLearned}
            onClear={clearLearned}
            profile={profile}
            onProfileChange={changeProfile}
            onboarding={onboarding}
            onChangeMyLanguage={changeMyLanguage}
            recipients={recipients}
            onToggleTag={toggleRecipientTag}
            onDeleteRecipient={deleteRecipient}
            onCreateRecipient={createRecipient}
            onUpdateRecipient={editRecipient}
            onNotice={setToast}
          />
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ── 3초 퀵 온보딩 (S11 / Spec 권장 9 F-15) ────────────────────────────── */

/**
 * 최초 오픈 시 3문항, 이후에는 결과 요약 + "다시 하기".
 *
 * 🔴 "3초"가 설계 제약이다 — 한 화면에 세 줄, 각 줄은 탭 한 번. 단계를 나누거나 저장 버튼을
 *    따로 두면 3초가 아니게 된다. 그래서 세 문항을 다 고르는 즉시 자동 저장한다.
 * 🔴 "주 협업 지역"은 **소통 언어**를 정하는 질문이다(라벨에 언어를 병기한다) — 국민성을 묻는
 *    질문이 아니며, 그 값은 언어 기본값 외의 어디로도 나가지 않는다(`lib/onboarding.js` 헤더).
 */
function OnboardingCard({ onboarding, onSave, onReset }) {
  /** 🔴 완료 카드는 기본으로 접혀 있다(④) — 펼치면 「다시 하기」가 나온다. */
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState({
    language: onboarding?.language ?? null,
    partnerRegion: onboarding?.partnerRegion ?? null,
    tone: onboarding?.tone ?? null,
  });

  // 저장된 값이 바뀌면(다시 하기 등) 초안도 맞춘다.
  useEffect(() => {
    setDraft({
      language: onboarding?.language ?? null,
      partnerRegion: onboarding?.partnerRegion ?? null,
      tone: onboarding?.tone ?? null,
    });
  }, [onboarding?.language, onboarding?.partnerRegion, onboarding?.tone, onboarding?.completedAt]);

  const done = !!onboarding?.completedAt;

  if (done) {
    const labels = onboardingLabels(onboarding);
    return (
      <section className="card card-accent">
        {/**
          * 🔴 **끝난 설정은 접어 둔다** (2026-08-16 사용자 요청 ④). 온보딩은 **한 번 하는 일**인데
          *    완료 카드가 홈 맨 위를 계속 차지하면서 매일 같은 문장을 보여 줬다.
          * 🔴 **지우지는 않는다** — 지금 설정이 무엇인지 확인하고 다시 하는 경로가 필요하다.
          *    한 줄로 줄이고 눌러야 펴지게 한다.
          */}
        <button
          type="button"
          className="onboard-done"
          onClick={() => setShowDone((v) => !v)}
          aria-expanded={showDone}
        >
          <span className="card-label">설정 완료 ✓</span>
          <span className="meta">
            {labels.language ?? '미설정'} · {labels.tone ?? '미설정'}
          </span>
        </button>
        {showDone && (
          <button type="button" className="link-button" onClick={onReset}>
            3초 온보딩 다시 하기
          </button>
        )}
      </section>
    );
  }

  const pick = (key, value) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    // 두 문항이 다 채워지는 순간 저장한다 — 별도 저장 버튼 없이 "3초"를 지킨다.
    if (next.language && next.tone) onSave(next);
  };

  return (
    <section className="card card-accent">
      <h2 className="card-title">3초만 설정할게요</h2>

      <p className="field-label">내 언어</p>
      <div className="tag-row">
        {MY_LANGUAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={draft.language === item.id ? 'chip chip-on' : 'chip'}
            aria-pressed={draft.language === item.id}
            onClick={() => pick('language', item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/**
        * 🔴 **「주로 협업하는 곳」을 없앴다** (2026-08-16 사용자 지적). 이름을 「주로 쓰는 상대
        *    언어」로 바꿔도 **값이 하나**라는 문제는 그대로다 — 여러 나라와 일하면 어느 쪽으로도
        *    틀린다. 언어는 사람마다 다르므로 **수신자마다** 정한다(프로필 → 내가 대화하는 사람들).
        */}
      <p className="field-label">기본 톤</p>
      <div className="tag-row">
        {DEFAULT_TONES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={draft.tone === item.id ? 'chip chip-on' : 'chip'}
            aria-pressed={draft.tone === item.id}
            onClick={() => pick('tone', item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="hint">
        상대에게 쓸 언어는 <b>사람마다</b> 정해요 — 프로필 탭의 「내가 대화하는 사람들」에서요.
      </p>
    </section>
  );
}

/**
 * 톱니 아이콘 — 이모지(⚙️) 대신 SVG를 쓴다.
 * 🔴 이모지는 OS·폰트마다 크기와 색이 제각각이고 작게 그려져 알아보기 어렵다. SVG는
 *    `currentColor`를 따라가므로 라이트/다크 어디서나 또렷하고, hover 색 변화도 함께 먹는다.
 */
function GearIcon({ size = 17 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9.1a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
    </svg>
  );
}

/**
 * 휴지통 아이콘 — 이모지(🗑) 대신 SVG (2026-08-19 사용자 요청 ③).
 *
 * 🔴 이모지 휴지통은 OS·폰트마다 **컬러 그림**으로 그려져 옆의 「편집」 글자와 톤이 어긋났고,
 *    작은 크기에서 뭉개져 무슨 그림인지 알아보기 어려웠다. 톱니(`GearIcon`)를 SVG로 바꾼
 *    것과 같은 이유다 — `currentColor`를 따라가니 라이트/다크·hover 색이 자연히 맞는다.
 * 🔴 **삭제 색은 여기서 칠하지 않는다.** 버튼(`.icon-button`)이 색을 정하고 아이콘은 따라간다 —
 *    아이콘이 색을 박아 두면 hover·비활성 상태에서 혼자 튄다.
 */
function TrashIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
      <path d="M6 6.5 6.8 19a2 2 0 0 0 2 1.9h6.4a2 2 0 0 0 2-1.9L18 6.5" />
      <path d="M10 10.5v6" />
      <path d="M14 10.5v6" />
    </svg>
  );
}

/* ── 설정 (2026-08-13 사용자 요청) ─────────────────────────────────────── */

/**
 * 개인 설정 모음.
 * 🔴 팝업에도 같은 토글이 있지만 **저장소가 단일 출처**라 값이 갈리지 않는다.
 * 🔴 각 항목에 "무엇이 달라지는지" 한 줄을 붙인다 — 스위치만 있으면 뭘 켜는지 알 수 없다.
 */
/**
 * S31 — 계정 카드 (로그인 · 동기화).
 *
 * 🔴 **동기화되는 것과 안 되는 것을 화면에 명시한다.** "동기화됨"만 쓰면 사용자는 저장 문구·
 *    예약까지 올라간 줄 안다. 실제로 올라가는 것은 온보딩 설정과 학습 **횟수**뿐이고, 본문은
 *    어떤 단계에서도 올라가지 않는다 (Spec 필수 5 · `docs/WebSplit.md`).
 * 🔴 **자동 동기화를 하지 않는다.** 사용자가 누를 때만 올린다 — 남의 서버로 무엇이 언제 나가는지
 *    본인이 알아야 한다.
 */
function AccountCard({ onNotice }) {
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    getSession().then(setSession);
  }, []);

  const configured = isAuthConfigured();

  const doSignIn = async () => {
    setBusy(true);
    setNote('');
    try {
      setSession(await signIn());
      onNotice?.('로그인했어요');
    } catch (error) {
      setNote(authErrorMessage(error?.reason, error?.detail));
    } finally {
      setBusy(false);
    }
  };

  const doSignOut = async () => {
    await signOut();
    setSession(null);
    setNote('');
    onNotice?.('로그아웃했어요 — 이 기기의 설정은 그대로예요');
  };

  const doSync = async () => {
    setBusy(true);
    setNote('');
    try {
      const result = await syncNow();
      setNote(`동기화했어요 — 학습 항목 ${result.learnedKinds}개`);
    } catch (error) {
      setNote(syncErrorMessage(error?.reason, error?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-label">연결된 서비스</h3>

      {/**
       * 🔴 **구글과 깃허브를 같은 「로그인 방법」처럼 보이게 하지 않는다** (2026-08-15).
       *    구글은 이 제품의 **계정 로그인**(동기화·팀)이고, 깃허브는 로그인이 아니라 **공개
       *    데이터 조회 한도를 올리는 선택적 연결**이다. 나란히 두되 각각이 무엇인지 쓴다 —
       *    깃허브로 로그인되는 줄 알면 거짓말이 된다.
       */}
      {!configured ? (
        <p className="meta">로그인 설정이 아직 없어요.</p>
      ) : (
        <div className="service-row">
          <span className="service-mark">
            <GoogleMark />
          </span>
          <span className="service-main">
            <span className="service-name">구글 계정</span>
            <span className="meta">
              {session ? session.email : '로그인하면 다른 기기에서도 같은 설정을 쓸 수 있어요'}
            </span>
          </span>
          <button
            type="button"
            className={session ? 'chip' : 'chip chip-on'}
            disabled={busy}
            onClick={session ? doSignOut : doSignIn}
          >
            {busy ? '…' : session ? '로그아웃' : '로그인'}
          </button>
        </div>
      )}

      {/**
       * 🔴 **GitHub 연결 줄을 화면에서 뺐다** (2026-08-19 사용자 결정 ⓐ).
       *
       *    **값어치가 계산상 거의 없다.** 이 연결이 하는 일은 GitHub API 한도를
       *    시간당 60 → 5,000으로 올리는 것뿐인데, 한 사람 조회에 약 4회를 쓰므로
       *    **연결 없이도 시간당 15명**을 등록할 수 있다. 동료 몇 명을 한 번 등록하는
       *    실제 사용과 한참 떨어져 있다. 값어치가 생기는 경우는 IP를 공유하는 망에서
       *    남이 이미 한도를 쓴 때뿐이고, 그때도 한 시간이면 풀린다.
       *
       *    **비용은 실재했다.** 설정에 **로그인처럼 보이는 줄**이 생기고, 그래서
       *    「로그인이 아니에요」라는 해명 문장이 따라붙는다 — 화면에서 가장 값싼 종류의 설명이다.
       *
       *    🔴 **태그 제안(분석)은 그대로 동작한다.** 공개 데이터는 토큰 없이 읽히고
       *    (`githubClient.js`의 `fetchUserProfile`·`fetchPublicEvents`는 토큰이 없으면
       *    그냥 익명으로 부른다), 사람 등록 폼의 「불러오기」도 변함이 없다.
       *
       *    🔴 **코드는 남긴다** — `GitHubLinkRow`·Device Flow·`getStoredToken`은 그대로다.
       *    한도에 막히는 사용자가 생기면 **이 한 줄만 되살리면** 된다.
       *    🔴 이미 연결해 둔 사람의 토큰도 그대로 쓰인다(저장물을 지우지 않는다) — 화면에서
       *    끊을 자리만 사라진 것이므로, 되살릴 때 그 상태가 그대로 보인다.
       */}

      {session && (
        <button type="button" className="button" disabled={busy} onClick={doSync}>
          지금 동기화
        </button>
      )}

      {/**
       * 🔴 **세 문단을 한 줄로 줄였다** (2026-08-19 사용자 요청 ③ — "불필요한 설명 지워").
       *    사실은 하나도 버리지 않았다 — 무엇이 나가고 무엇이 안 나가는지는 **이 카드가 있는
       *    이유**이고 Zero Retention(Spec 필수 5)의 화면 쪽 약속이다. 줄인 것은 **문단 수**다.
       *    설정 화면에서 문단 셋이 연달아 있으면 아무도 읽지 않는다.
       */}
      <p className="meta">
        올라가는 것: 온보딩 설정 · 학습 <b>횟수</b>
        {' · '}팀에 속했다면 협업 지표 <b>횟수</b>(누가 냈는지는 안 남아요)
        <br />
        올라가지 <b>않는</b> 것: 저장 문구 · 예약 · <b>메시지 본문</b> — 이 기기에만 있어요
      </p>

      {note && <p className="meta">{note}</p>}
    </div>
  );
}

/**
 * 설정 한 줄 — 라벨 + 스위치, **설명은 접혀 있다** (2026-08-16 사용자 요청 ⑤).
 *
 * 🔴 설명 문단이 항상 펼쳐져 있으니 토글 6개가 **여섯 문단**이 되어, 무엇을 켜고 끌 수 있는지
 *    한눈에 보이지 않았다. 대부분의 설명은 **한 번 읽으면 다시 볼 일이 없다.**
 * 🔴 **없애지는 않는다.** 「직전 대화 참고」처럼 무엇이 전송되는지 알려야 하는 설명이 있어,
 *    지우면 사용자가 모르고 켜 둔다 — 접되 **언제든 펼 수 있게** 둔다.
 * 🔴 스위치와 설명 버튼은 **다른 조작**이다. 설명을 펴려다 설정이 바뀌면 안 되므로 버튼을 나눈다.
 */
function SettingRow({ row }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <div className="card-head card-head-bare">
        {/**
          * 🔴 **라벨과 `?`를 한 덩어리로 묶는다** (2026-08-16 사용자 지적: "물음표 간격 왜 이래").
          *    `.card-head`는 `justify-content: space-between`이라 **자식 수만큼 균등 분배**한다.
          *    자식이 둘일 때(라벨·스위치)는 양 끝으로 붙지만, `?`를 넣어 셋이 되자 가운데로
          *    밀려나 **어느 쪽에도 속하지 않는 것처럼** 보였다.
          *    `?`는 라벨에 대한 설명이므로 라벨과 같은 덩어리여야 한다 — 묶으면 자식이 다시
          *    둘이 되어 원래 배치로 돌아온다.
          */}
        <span className="setting-name">
          <h3 className="card-label">{row.label}</h3>
          <button
            type="button"
            className={open ? 'setting-why setting-why-open' : 'setting-why'}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${row.label} 설명 ${open ? '접기' : '펴기'}`}
          >
            ?
          </button>
        </span>
        <button
          type="button"
          className={row.on ? 'sai-switch sai-switch-on' : 'sai-switch'}
          onClick={row.onToggle}
          role="switch"
          aria-checked={row.on}
          aria-label={row.label}
        >
          <span className="sai-switch-knob" />
        </button>
      </div>
      {open && <p className="meta">{row.hint}</p>}
    </div>
  );
}

function SettingsTab({
  onClose,
  theme,
  onToggleTheme,
  backOn,
  onToggleBack,
  hintsOn,
  onToggleHints,
  reasonOn,
  onToggleReason,
  snippetMode,
  onToggleSnippetMode,
  threadOn,
  onToggleThread,
  onNotice,
}) {
  /**
   * 🔴 **기준을 「메시지가 바뀌는가」로 바꿨다** (2026-08-16 사용자 질문 ①②).
   *    ① 「색 표시 설명」이 「보기」에 있는 게 맞냐 — **맞지 않았다.** 그 토글은 앱 외관이 아니라
   *       **교정 결과를 어떻게 읽을지**를 정한다. 같은 이유로 「역번역 보기」도 「교정 결과」에
   *       있으면 안 됐다 — 그것도 나가는 문장을 바꾸지 않는다.
   *    ② 「교정 결과를 설정에서 정하는 게 맞냐」 — **여기 있는 건 기본값이고, 이번 한 번은
   *       팝업에서 바꾼다.** 그 사실을 화면이 말하지 않아서 같은 스위치가 두 곳에 있는 것처럼
   *       보였다. 그룹 이름과 설명에 명시한다.
   *    그래서 세 갈래가 된다: **메시지가 바뀜 / 교정을 보는 방법 / 앱 자체**.
   * 🔴 **성격별로 묶는다** (2026-08-16 사용자 지적 ⑩: "정리정돈이 안되어 있는데").
   *    토글 6개가 평평하게 나열돼 **어느 것이 교정 결과를 바꾸고 어느 것이 화면만 바꾸는지**
   *    구분되지 않았다. 「캐주얼 톤」(문장이 바뀐다)과 「다크 모드」(보기만 바뀐다)가 같은
   *    무게로 보이는 것이 문제였다.
   * 🔴 순서도 그 기준이다 — **결과를 바꾸는 것이 위**다. 무엇을 켜고 끄는지 잘못 알면
   *    손해가 큰 쪽을 먼저 읽게 한다.
   * 🔴 토글을 지우거나 기본값을 바꾸지 않았다 — 묶음과 순서만 바꿨다.
   */
  const rows = [
    {
      id: 'theme',
      group: '앱',
      label: '다크 모드',
      hint: '사이드패널과 페이지 팝업에 함께 적용돼요.',
      on: theme === 'dark',
      onToggle: onToggleTheme,
    },
    {
      id: 'back',
      group: '교정을 보는 방법',
      label: '역번역 보기',
      hint: '상대에게 어떻게 읽히는지 되돌려 보여줘요.',
      on: backOn,
      onToggle: onToggleBack,
    },
    /**
     * 🔴 **「캐주얼 톤」 스위치를 여기서 없앴다** (2026-08-18). 문체가 3단 하나의 눈금이 되면서
     *    이 스위치는 **같은 축의 세 번째 자리**가 됐다 — 팝업(이 메시지) · 수신자(기본 위치) ·
     *    설정(전역)이 서로 다른 값을 가리키면 어느 것이 이기는지 화면에 드러나지 않는다.
     *    그 상태를 없애려고 3단으로 합친 것이므로, 여기 남겨 두면 합친 의미가 사라진다.
     */
    {
      id: 'reason',
      group: '교정을 보는 방법',
      label: '변경 이유 보기',
      hint: '무엇을 왜 바꿨는지, 원문의 기한·숫자가 그대로 남았는지 대조해서 보여줘요.',
      on: reasonOn,
      onToggle: onToggleReason,
    },
    {
      id: 'hints',
      group: '교정을 보는 방법',
      label: '색 표시 설명',
      hint: '초록·노란 표시가 무슨 뜻인지 알려줘요. 표시 자체는 항상 켜져 있어요.',
      on: hintsOn,
      onToggle: onToggleHints,
    },
    {
      id: 'thread',
      group: '메시지가 바뀌는 설정',
      label: '직전 대화 참고',
      // 🔴 "무엇이 나가는지"를 분명히 쓴다 — 남이 쓴 메시지가 함께 전송되는 설정이라
      //    사용자가 모르고 켜둔 채로 두면 안 된다. 저장하지 않는다는 것도 같이 말한다.
      hint: '같은 화면의 직전 메시지 최대 5개를 함께 보내 문맥에 맞게 다듬어요. 팝업에서 무엇을 참고했는지 볼 수 있고, 그 내용은 저장하지 않아요.',
      on: threadOn,
      onToggle: onToggleThread,
    },
    /**
     * 🔴 **「앱」에서 빼냈다** (2026-08-19 사용자 요청 ⑤ — "연관되지 않은 것끼리 묶여 있으면 수정").
     *    이 스위치는 **입력창에 문장을 어떻게 넣을지**를 정한다. 같은 그룹에 있던 「다크 모드」는
     *    앱의 겉모습이라, 「무엇이 화면에 그려지는가」와 「무엇이 입력창에 써지는가」가 한
     *    묶음에 있었다. 삽입 방식을 찾는 사람이 「앱」을 열어 볼 이유가 없다.
     */
    {
      id: 'snippet',
      group: '문장을 넣을 때',
      label: '저장 문구를 뒤에 이어 붙이기',
      hint: '끄면 입력창의 기존 내용을 지우고 넣어요.',
      on: snippetMode === 'append',
      onToggle: onToggleSnippetMode,
    },
  ];

  return (
    <div className="settings-sheet" role="dialog" aria-label="설정">
      <div className="card-head card-head-bare">
        <h2 className="card-title">설정</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="설정 닫기">
          ✕
        </button>
      </div>
      {/**
       * 🔴 **연결이 맨 위다** (2026-08-15 검토). 로그인 상태는 다른 설정의 **전제**다 —
       *    팀·동기화가 되는지, 대시보드가 열리는지가 여기서 갈린다. 토글 6개 아래에 묻어 두면
       *    "로그인이 필요해요"를 본 사용자가 어디로 가야 할지 모른다.
       */}
      <AccountCard onNotice={onNotice} />

      {/* 🔴 「여기서 바꾼 설정은 팝업에도 적용돼요」를 지웠다 (2026-08-19 ③) — 바로 아래
          그룹 설명이 같은 말을 더 정확하게 한다("이번 한 번만 바꾸려면 교정 팝업에서…"). */}
      {[
        {
          id: '메시지가 바뀌는 설정',
          // 🔴 **여기는 기본값이라는 사실**을 쓴다(②) — 팝업에도 같은 스위치가 있어 혼란스러웠다.
          note: '상대에게 나가는 문장이 달라져요. 이번 한 번만 바꾸려면 교정 팝업에서 끄고 켤 수 있어요.',
        },
        /**
         * 🔴 **순서 기준은 「결과에 미치는 영향」이다** (2026-08-16 확정 · 2026-08-19 보강).
         *    ① 나가는 문장이 달라짐 → ② 입력창에 들어가는 방식 → ③ 내가 보는 방식 → ④ 겉모습.
         *    잘못 알았을 때 손해가 큰 순서다.
         */
        {
          id: '문장을 넣을 때',
          note: '다듬은 문장·저장 문구를 입력창에 넣는 방식이에요.',
        },
        { id: '교정을 보는 방법', note: '나가는 문장은 그대로예요. 내가 확인하는 방식만 달라져요.' },
        { id: '앱', note: null },
      ].map(({ id: group, note }) => (
        <div key={group} className="settings-group">
          <h3 className="group-title">{group}</h3>
          {note && <p className="meta">{note}</p>}
          {rows
            .filter((row) => row.group === group)
            .map((row) => (
              <SettingRow key={row.id} row={row} />
            ))}
        </div>
      ))}

      <ShortcutCard />
    </div>
  );
}

/* ── 홈 — 온보딩 결과 · 오늘의 카운트 · 포인트 · B2B 배너 ────────────── */

/**
 * 예약 탭 (S14 후속 / Spec 필수 6).
 *
 * 🔴 **우리가 대신 보내지 않는다** — 보낼 수 없다(`src/lib/reservations.js` 헤더의 조사 결론:
 *    Slack은 앱 등록+OAuth+관리자 승인, Teams·Gmail API는 예약 전송 자체가 없다).
 *    그래서 "예약됨"이 아니라 **"보내기로 적어 둠"**이라고 쓴다. 과장하면 사용자가 보냈다고
 *    믿고 실제로는 안 보내는 사고가 난다.
 */
function ScheduleTab({ items, onDelete }) {
  return (
    <>
      <p className="hint">
        시간이 되면 알림을 보내드려요. <b>사이가 대신 보내지는 않아요</b> — 알림을 받으면 문장을
        복사해 직접 보내주세요.
      </p>
      {items.length === 0 ? (
        <p className="empty">
          아직 예약이 없어요. 비긴급 메시지를 상대의 퇴근 시간대에 쓰면 예약을 제안해요.
        </p>
      ) : (
        items.map((item) => (
          <div key={item.id} className="card">
            <div className="card-head card-head-bare">
              <span className="meta">
                🌙 {item.recipientName} · {item.sendAtLabel}
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => onDelete(item.id)}
                aria-label="예약 삭제"
              >
                🗑
              </button>
            </div>
            <p className="snippet-text">{item.text}</p>
          </div>
        ))
      )}
    </>
  );
}

/* ── 단축키 (S26 / Spec 부가 9) ───────────────────────────────────────── */

/**
 * 🔴 **확장은 자기 단축키를 바꿀 수 없다** — 크롬이 쓰기 API를 주지 않는다(다른 확장·브라우저
 *    단축키를 가로챌 수 있어서). `chrome.commands`는 읽기 전용(`getAll`)이고, 변경은 오직
 *    `chrome://extensions/shortcuts`에서 사용자가 직접 한다. 우리가 할 수 있는 건 ①실제 할당값을
 *    **정확히 보여주기** ②그 페이지를 열어주기까지다.
 * 🔴 매니페스트의 제안값(`Alt+S`/`Alt+D`)을 화면에 하드코딩하지 않는다(2026-08-13 사용자 지적):
 *    다른 프로그램과 충돌하면 크롬이 **조용히 미할당**으로 두는데, 그때 화면만 "Alt+D"라고
 *    말하면 "눌러도 안 되는데 왜 안 되지"가 된다. 실제 값을 읽어 미할당이면 그렇게 표시한다.
 * 🔴 `chrome://` 주소는 `<a href>`로 못 연다(차단됨) — `chrome.tabs.create`로 열어야 한다.
 */
/**
 * 🔴 크롬이 **예약 명령(`_execute_action`)의 description을 돌려주지 않는다** — 매니페스트에
 *    「사이드 패널 열기」라고 적어 두었는데도 `getAll()` 결과는 빈 문자열이라, 폴백이 원시 ID인
 *    `_execute_action`을 그대로 화면에 뿌렸다(2026-08-15 실확장 스크린샷).
 *    사용자가 알 수 없는 내부 이름이므로 우리가 아는 명령은 우리 라벨로 덮는다.
 */
const COMMAND_LABELS = {
  _execute_action: '사이드 패널 열기',
  'refine-selection': '선택한 문장 다듬기 / 뜻 풀기',
};

function ShortcutCard() {
  const [commands, setCommands] = useState(null); // null = 조회 전/불가

  useEffect(() => {
    chrome.commands?.getAll?.().then(setCommands).catch(() => setCommands([]));
  }, []);

  return (
    <div className="card">
      <div className="card-head card-head-bare">
        <h3 className="card-label">단축키</h3>
        <button
          type="button"
          className="link-button"
          onClick={() => chrome.tabs?.create({ url: 'chrome://extensions/shortcuts' })}
        >
          바꾸기 →
        </button>
      </div>
      {commands === null ? (
        <p className="meta">단축키를 불러오는 중…</p>
      ) : (
        <>
          <div className="shortcut-list">
            {commands.map((command) => (
              <div key={command.name} className="shortcut-row">
                <span className="shortcut-desc">
                  {COMMAND_LABELS[command.name] || command.description || command.name}
                </span>
                {command.shortcut ? (
                  <kbd className="shortcut-key">{command.shortcut}</kbd>
                ) : (
                  // 🔴 빈 값을 숨기지 않는다 — 미할당이라는 사실이 곧 사용자가 알아야 할 정보다.
                  <span className="shortcut-none">지정 안 됨</span>
                )}
              </div>
            ))}
          </div>
          <p className="meta">
            다른 프로그램과 겹치면 크롬이 비워둬요. 「바꾸기」에서 직접 지정할 수 있어요.
          </p>
        </>
      )}
    </div>
  );
}

/* ── 회의 시간 추천 (S23 / Spec 권장 12) ──────────────────────────────── */

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** `2026-08-17` + weekday → `8/17(월)`. */
function formatDay(dateKey, weekday) {
  const [, month, day] = dateKey.split('-');
  return `${Number(month)}/${Number(day)}(${WEEKDAY_KO[weekday]})`;
}

function formatHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

const SLOT_NOTE = {
  [SLOT_KINDS.COMFORTABLE]: { label: '양쪽 다 업무시간', tone: 'green' },
  [SLOT_KINDS.THEY_YIELD]: { label: '상대가 업무시간 밖', tone: 'mut' },
  [SLOT_KINDS.I_YIELD]: { label: '내가 업무시간 밖 — 양보', tone: 'orange' },
};

/**
 * 🔴 **"상대가 비어 있는 시간"이라고 말하지 않는다** — 캘린더 연동이 아직 없으므로 우리가 아는
 *    것은 업무시간 겹침뿐이다(`src/core/meeting/overlap.js` 헤더). 화면 문구가 실제로 아는 것보다
 *    더 말하면 그 순간 거짓말이 된다.
 * 🔴 수신자 목록은 S17이 이미 관리한다 — 여기서 새로 만들지 않고 그대로 읽어 쓴다.
 */
function MeetingCard({ onAwarded, onToast }) {
  const [recipients, setRecipients] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    listRecipients().then((list) => {
      setRecipients(list);
      setSelectedId((current) => current ?? list[0]?.id ?? null);
    });
  }, []);

  const target = recipients.find((r) => r.id === selectedId) ?? null;

  // 내 타임존은 브라우저에서 그대로 읽는다 — 사용자에게 또 물을 이유가 없다.
  const myTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  /**
   * S23 — 캘린더 빈 시간 (Spec 권장 12).
   *
   * 🔴 **`busy`가 `null`인 것과 `[]`인 것은 다르다.** null = 확인하지 않음, [] = 확인했고 안 바쁨.
   *    섞으면 화면이 "확인했다"고 거짓말한다(`freebusy.js`의 `checked` 참조).
   * 🔴 **상한(limit)을 캘린더 필터 *뒤*가 아니라 *앞*에 두면 안 된다.** 5개로 자른 뒤 그중 4개가
   *    내 일정과 겹치면 1개만 남는다. 그래서 넉넉히 뽑아 필터한 뒤 자른다.
   */
  const [calendarLinked, setCalendarLinked] = useState(false);
  const [busy, setBusy] = useState(null);
  const [calendarNote, setCalendarNote] = useState('');

  // 🔴 `interactive: false` — 패널을 열자마자 구글 동의 창이 튀어나오지 않게 한다.
  useEffect(() => {
    isCalendarLinked().then(setCalendarLinked);
  }, []);

  const loadCalendar = async () => {
    setCalendarNote('');
    try {
      const now = new Date();
      const intervals = await fetchBusyIntervals({
        timeMin: now,
        timeMax: new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000),
        interactive: true,
      });
      setBusy(intervals);
      setCalendarLinked(true);
    } catch (error) {
      // 🔴 실패하면 `busy`를 건드리지 않는다 — 빈 배열로 두면 "확인했는데 안 바쁨"이 된다.
      setCalendarNote(calendarErrorMessage(error?.reason, error?.detail));
    }
  };

  const dropCalendar = async () => {
    await unlinkCalendar();
    setBusy(null);
    setCalendarLinked(false);
    setCalendarNote('');
  };

  /**
   * 🔴 **요일 고르기 / 자동** (2026-08-16 사용자 요청 ⑥). 빈 배열 = 자동(평일 전부).
   *    자동이 기본이다 — 대부분은 "언제가 되나"를 묻지 "화요일만 보여 줘"를 묻지 않는다.
   */
  const [pickedDays, setPickedDays] = useState([]);
  /** 고른 슬롯 — 여기서 초안·캘린더가 열린다(⑦⑧). 하나만 열어 둔다. */
  const [chosen, setChosen] = useState(null);
  const [meetKind, setMeetKind] = useState('video');
  /** 직접 시간 입력(⑤) — `2026-08-18T14:00` 형태. 기본은 접혀 있다(①). */
  const [manualAt, setManualAt] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  /** 🔴 초안을 쓸 언어 = **내 언어**(온보딩). 모르면 한국어 — 이 제품의 사용자 언어다. */
  const [myLanguage, setMyLanguage] = useState('ko');
  useEffect(() => {
    getOnboarding().then((value) => setMyLanguage(value?.language ?? 'ko'));
  }, []);

  const { slots, hasComfortable, busyResult } = useMemo(() => {
    if (!open || !target) return { slots: [], hasComfortable: false, busyResult: null };
    const found = findMeetingSlots({
      myTimeZone,
      theirTimeZone: target.timeZone,
      limit: 30,
      weekdays: pickedDays.length > 0 ? pickedDays : null,
    });
    const filtered = excludeBusySlots(found.slots, busy);
    return {
      /**
       * 🔴 **자르는 일은 균형을 맞추는 쪽이 한다** (2026-08-16 사용자 지적 ⑤).
       *    예전에는 여기서 `.slice(0, 5)`로 잘랐다 — 정렬이 등급 순이라 앞 5개가 **전부
       *    `they-yield`**가 되어, 상대만 새벽인 시간 다섯 개가 나왔다(실제로 그렇게 보였다).
       *    `balanceSlots`는 두 양보 방향을 번갈아 채운 뒤 자른다.
       */
      slots: balanceSlots(filtered.slots, 5),
      hasComfortable: filtered.slots.some((slot) => slot.kind === SLOT_KINDS.COMFORTABLE),
      busyResult: filtered,
    };
  }, [open, target, myTimeZone, busy, pickedDays]);

  /**
   * 🔴 **내가 시간을 정할 수도 있어야 한다** (2026-08-16 사용자 요청 ⑤). 추천이 마음에 안 들거나
   *    이미 잡힌 시간을 확인하고 싶을 때가 있다. 내 시각을 넣으면 **상대 시각**을 돌려주고,
   *    상대가 업무시간 밖이면 그 사실을 말한다 — 조용히 통과시키면 이 제품의 존재 이유가 없다.
   */
  const manualSlot = useMemo(() => {
    if (!manualAt || !target) return null;
    const at = new Date(manualAt);
    if (Number.isNaN(at.getTime())) return null;
    const mine = getLocalParts(at, myTimeZone);
    const theirs = getLocalParts(at, target.timeZone);
    const mineOk = mine.hour >= 9 && mine.hour < 18 && !isWeekend(mine.weekday);
    const theirsOk = theirs.hour >= 9 && theirs.hour < 18 && !isWeekend(theirs.weekday);
    return {
      startUtcISO: at.toISOString(),
      mine: { hour: mine.hour, minute: mine.minute, dateKey: mine.dateKey, weekday: mine.weekday },
      theirs: {
        hour: theirs.hour,
        minute: theirs.minute,
        dateKey: theirs.dateKey,
        weekday: theirs.weekday,
      },
      // 🔴 직접 넣은 시간에는 양보 포인트를 주지 않는다 — 추천을 받아들인 것이 아니다.
      kind: mineOk && theirsOk ? SLOT_KINDS.COMFORTABLE : theirsOk ? SLOT_KINDS.I_YIELD : SLOT_KINDS.THEY_YIELD,
      yieldPoints: 0,
      mineOk,
      theirsOk,
    };
  }, [manualAt, target, myTimeZone]);

  /**
   * 🔴 **초안을 한 번만 만든다.** 예전에는 미리보기·복사 버튼이 각자 `buildMeetingDraft()`를
   *    호출해서, 둘이 어긋날 수 있는 구조였다(복사한 게 화면과 다를 수 있다).
   * 🔴 언어는 **내 언어**다 — 온보딩 값, 없으면 한국어.
   */
  const draftText = useMemo(
    () =>
      chosen
        ? buildMeetingDraft({
            slot: chosen,
            language: myLanguage,
            kind: meetKind,
            theirName: target?.name ?? '',
          })
        : '',
    [chosen, myLanguage, meetKind, target],
  );

  /**
   * 🔴 편집 가능한 사본. 슬롯·형태·언어가 바뀌면 **템플릿으로 되돌린다** — 옛 시각이 적힌
   *    문장을 그대로 들고 있으면 안 된다.
   */
  const [draftEdit, setDraftEdit] = useState('');
  useEffect(() => {
    setDraftEdit(draftText);
  }, [draftText]);

  const calLinks = useMemo(
    () =>
      chosen
        ? calendarLinks({
            slot: chosen,
            title: `${target?.name ?? '상대'}와 ${
              MEETING_KINDS.find((k) => k.id === meetKind)?.label ?? '회의'
            }`,
          })
        : { google: '', outlook: '' },
    [chosen, target, meetKind],
  );

  /**
   * 🔴 **클릭만으로는 포인트를 주지 않는다** (2026-08-16 사용자 지적 ②).
   *
   * 예전에는 양보 슬롯을 **누르는 순간** +50P였다. 목록을 훑어보려고 눌러도 적립되고, 같은 칸을
   * 다시 눌러도 또 적립됐다 — **누르기만 하면 무한히 늘어나는 잔액**이었고, 그러면 Spec §1의
   * 「양보에 대한 보상」이라는 의미가 통째로 사라진다(보상이 아니라 클릭 카운터가 된다).
   *
   * 두 가지를 함께 건다:
   *   ① **행위 조건** — 초안을 **복사**했을 때만 지급한다. 복사는 "이 시간으로 상대에게 제안한다"는
   *      실제 행동이고, 우리가 관측할 수 있는 가장 가까운 신호다.
   *      🔴 "실제로 보냈는가"는 알 수 없다(우리는 상대 서비스를 보지 않는다) — 알 수 없는 것을
   *         아는 척하지 않고, 관측 가능한 지점까지만 인정한다.
   *   ② **중복 방지** — 슬롯(시각)당 한 번. `startUtcISO`가 자연 키다.
   */
  const [awarded, setAwarded] = useState(() => new Set());

  const pick = (slot) => {
    setChosen(slot);
  };

  /** 초안을 복사한 뒤에만 불린다. 조건에 안 맞으면 조용히 아무 일도 하지 않는다. */
  const awardIfYielded = async (slot) => {
    if (!slot || slot.yieldPoints <= 0) return;
    if (awarded.has(slot.startUtcISO)) return;
    const result = await awardPoints(POINT_REASONS.MEETING_YIELD);
    if (!result.ok) return;
    setAwarded((current) => new Set(current).add(slot.startUtcISO));
    onAwarded?.();
    onToast?.(`양보한 시간으로 초안을 만드셨어요 — +${result.amount}P`);
  };

  return (
    <section className="card">
      {/**
        * 🔴 **머리줄 전체가 버튼이다** (2026-08-16 사용자 요청 ⑤). 「열기」 링크만 누를 수 있으면
        *    표적이 글자 두 자뿐이라 자주 빗나간다 — 카드를 눌렀는데 아무 일도 안 일어나면 고장으로
        *    읽힌다. 제목까지 통째로 눌리는 편이 손이 덜 간다.
        * 🔴 「열기/접기」 글자는 **남긴다** — 표적이 넓어져도 지금 상태와 다음 동작은 보여야 한다.
        */}
      <button
        type="button"
        className="card-head card-head-button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="card-head-row">
          <h2 className="card-label">🕒 회의 시간 추천</h2>
          <span className="link-button">{open ? '접기' : '열기'}</span>
        </span>
        {/**
          * 🔴 **설명 줄까지 버튼 안에 넣는다** (2026-08-19 사용자 지적 ③). 예전에는 이 문장이
          *    버튼 «바깥»에 있어서, 접힌 카드에서 **가장 넓은 부분을 눌렀을 때 아무 일도
          *    일어나지 않았다** — 카드 전체가 눌리는 줄 알고 누르니 고장으로 읽힌다.
          * 🔴 펼친 뒤에는 내지 않는다 — 그때는 실제 결과가 그 자리를 쓴다.
          */}
        {!open && (
          <span className="card-text">양쪽 업무시간이 겹치는 시간을 찾아드려요.</span>
        )}
      </button>

      {!open ? null : recipients.length === 0 ? (
        <p className="empty">수신자를 먼저 등록해 주세요 — 프로필 탭에서 추가할 수 있어요.</p>
      ) : (
        <>
          <select
            className="slot-select"
            value={selectedId ?? ''}
            onChange={(event) => setSelectedId(event.target.value)}
            aria-label="상대 선택"
          >
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.timeZone}
              </option>
            ))}
          </select>

          {/* 🔴 우리가 아는 범위를 정확히 밝힌다. 캘린더를 연결해도 **내 것만** 본다. */}
          {/**
            * 🔴 **설명을 한 줄로 줄였다** (2026-08-16 사용자 지적 ①: "좀 복잡해").
            *    예전에는 안내 2줄 + 요일 설명 1줄 + 겹침 경고 1줄 = **후보를 보기 전에 네 줄**을
            *    읽어야 했다. 남긴 것은 ⓐ 우리가 아는 범위(업무시간 겹침) ⓑ 캘린더 연결 스위치뿐이고,
            *    나머지는 **상태가 기본값이 아닐 때만** 나온다.
            */}
          <p className="meta">
            업무시간(09~18시) 겹침 기준 ·{' '}
            <button
              type="button"
              className="link-button link-inline"
              onClick={calendarLinked && busy ? dropCalendar : loadCalendar}
            >
              {calendarLinked && busy ? '내 일정 다시 포함' : '내 일정 빼고 보기'}
            </button>
            {busyResult ? ` · ${busyNotice(busyResult)}` : ''}
          </p>
          {calendarNote && <p className="meta">{calendarNote}</p>}

          {/**
            * 🔴 **직접 시간을 넣으면 추천을 감춘다** (2026-08-16 사용자 요청 ④).
            *    둘이 같이 떠 있으면 "지금 내가 보는 시간이 추천인가 내가 넣은 것인가"가 흐려지고,
            *    아래 초안이 **어느 쪽 시각으로 만들어졌는지** 화면만 봐서는 알 수 없다.
            *    고르는 방식은 한 번에 하나여야 한다.
            */}
          {!manualOpen && (
          <>
          {/**
            * 🔴 **요일을 미리 좁힐 수 있다** (2026-08-16 ⑥). 아무것도 안 고르면 **자동** —
            *    평일 전부를 보고 겹치는 시간을 앞에 둔다. 「자동」을 별도 버튼으로 두는 대신
            *    "아무것도 안 고른 상태 = 자동"으로 했다. 상태가 둘이면 어긋날 자리가 생긴다.
            */}
          <div className="tag-row">
            <button
              type="button"
              className={pickedDays.length === 0 ? 'chip chip-on' : 'chip'}
              aria-pressed={pickedDays.length === 0}
              onClick={() => setPickedDays([])}
            >
              자동
            </button>
            {[1, 2, 3, 4, 5].map((day) => (
              <button
                key={day}
                type="button"
                className={pickedDays.includes(day) ? 'chip chip-on' : 'chip'}
                aria-pressed={pickedDays.includes(day)}
                onClick={() =>
                  setPickedDays((current) =>
                    current.includes(day)
                      ? current.filter((d) => d !== day)
                      : [...current, day].sort(),
                  )
                }
              >
                {WEEKDAY_KO[day]}
              </button>
            ))}
          </div>
          {/* 🔴 기본값(자동)일 때는 설명을 내지 않는다 — 기본 상태를 설명하는 줄이 가장 자주 읽힌다. */}
          {pickedDays.length > 0 && (
            <p className="meta">
              {pickedDays.map((d) => WEEKDAY_KO[d]).join('·')}요일만 봐요 (내 요일 기준).
            </p>
          )}

          {slots.length === 0 ? (
            <p className="empty">
              {pickedDays.length === 0
                ? '앞으로 5일 안에는 겹치는 시간을 찾지 못했어요.'
                : '고른 요일에는 후보가 없어요 — 요일을 늘리거나 「자동」으로 보세요.'}
            </p>
          ) : (
            <>
              {!hasComfortable && (
                // 🔴 **없다고 분명히 말한다** (2026-08-16 ⑥) — 목록만 보여 주면 아래 후보들이
                //    "괜찮은 시간"으로 읽힌다. 실제로는 누군가의 새벽이다.
                <p className="meta">
                  <b>양쪽 업무시간이 겹치는 시간이 없어요.</b> 아래는 한쪽이 업무시간 밖인
                  시간이라, 누군가는 양보해야 해요.
                </p>
              )}
              <div className="slot-list">
                {slots.map((slot) => {
                  const note = SLOT_NOTE[slot.kind];
                  return (
                    <button
                      type="button"
                      key={slot.startUtcISO}
                      className="slot"
                      onClick={() => pick(slot)}
                    >
                      <span className="slot-times">
                        <b>
                          나 {formatDay(slot.mine.dateKey, slot.mine.weekday)}{' '}
                          {formatHour(slot.mine.hour)}
                        </b>
                        <span className="slot-sub">
                          상대 {formatDay(slot.theirs.dateKey, slot.theirs.weekday)}{' '}
                          {formatHour(slot.theirs.hour)}
                        </span>
                      </span>
                      <span className={`slot-note slot-note-${note.tone}`}>
                        {note.label}
                        {slot.yieldPoints > 0 && <b> +{slot.yieldPoints}P</b>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          </>
          )}

          {/**
            * 🔴 **직접 시간 입력은 접어 둔다** (2026-08-16 ①). 필요한 사람은 적은데 입력칸은
            *    항상 자리를 먹었다 — 기본 화면에는 링크 한 줄만 둔다.
            */}
          <button
            type="button"
            className="link-button"
            onClick={() => setManualOpen((v) => !v)}
          >
            {manualOpen ? '← 추천 시간 다시 보기' : '직접 정한 시간이 있어요 →'}
          </button>
          {manualOpen && (
            <input
              type="datetime-local"
              className="form-input"
              value={manualAt}
              onChange={(event) => setManualAt(event.target.value)}
              aria-label="내 시각으로 회의 시간 입력"
            />
          )}
          {manualOpen && manualSlot && (
            <div className="slot-manual">
              <p className="card-text">
                상대는 <b>{formatDay(manualSlot.theirs.dateKey, manualSlot.theirs.weekday)}{' '}
                {formatHour(manualSlot.theirs.hour)}</b>이에요.
              </p>
              {/* 🔴 업무시간 밖이면 **반드시 말한다** — 조용히 넘기면 이 제품이 할 일을 안 한 것이다. */}
              {!manualSlot.theirsOk && (
                <p className="meta">
                  ⚠️ 상대의 업무시간(09~18시) 밖이거나 주말이에요. 그래도 보내려면 이유를 함께
                  적어 주세요.
                </p>
              )}
              {!manualSlot.mineOk && (
                <p className="meta">⚠️ 내 업무시간 밖이에요.</p>
              )}
              <button type="button" className="button" onClick={() => setChosen(manualSlot)}>
                이 시간으로 초안 만들기
              </button>
            </div>
          )}

          {/**
            * 🔴 **고른 시간 → 초안 · 캘린더** (2026-08-16 ⑦⑧).
            *    예전에는 시간을 눌러도 토스트 한 줄이 전부였다 — "정했어요"라고만 하고 정작
            *    상대에게 보낼 문장은 사용자가 처음부터 써야 했다.
            * 🔴 초안은 **모델을 부르지 않고** 템플릿으로 만든다(`core/meeting/draft.js`) —
            *    빠르고, 공짜고, 없는 안건을 지어내지 않는다. 안건은 대괄호로 비워 둔다.
            */}
          {chosen && (
            <div className="slot-chosen">
              <p className="card-text">
                <b>
                  나 {formatDay(chosen.mine.dateKey, chosen.mine.weekday)}{' '}
                  {formatHour(chosen.mine.hour)}
                </b>{' '}
                · 상대 {formatDay(chosen.theirs.dateKey, chosen.theirs.weekday)}{' '}
                {formatHour(chosen.theirs.hour)}
              </p>

              <div className="tag-row">
                {MEETING_KINDS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={meetKind === item.id ? 'chip chip-on' : 'chip'}
                    aria-pressed={meetKind === item.id}
                    onClick={() => setMeetKind(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/**
                * 🔴 **초안은 내 언어로 만든다** (2026-08-16 사용자 요청 ②).
                *    예전에는 상대 언어(독일어 등)로 바로 만들었는데, 그 문장은 **교정을 거치지
                *    않은 문장**이다 — 용어집·톤·수신자 태그·민감정보 가드가 하나도 안 걸린다.
                *    같은 제품 안에 품질이 다른 두 번역 경로가 생기는 것이 문제였다.
                *    이제 내 언어로 만들고 **「다듬기」에 넣어** 상대 언어로 보낸다.
                * 🔴 만들어질 문장을 **먼저 보여준다** — 복사하고 나서 확인하면 늦다.
                */}
              {/**
                * 🔴 **초안을 고칠 수 있어야 한다** (2026-08-16 사용자 요청 ③). 자리표시자([안건])를
                *    채우는 일은 **여기서** 하는 게 자연스럽다 — 복사한 뒤 다른 창에서 고치게 하면
                *    빈칸 경고를 보고도 고칠 자리가 없다.
                * 🔴 슬롯·회의 형태를 바꾸면 **다시 생성된다**(아래 useEffect) — 손으로 고친 내용이
                *    남아 있으면 시각이 옛것인 초안을 보내게 된다.
                */}
              <textarea
                className="slot-draft slot-draft-edit"
                value={draftEdit}
                rows={7}
                onChange={(event) => setDraftEdit(event.target.value)}
                aria-label="회의 초안"
              />
              <p className="meta">
                대괄호([ ])는 채우거나 지워 주세요. 복사해서 <b>입력창에 붙여넣고 다듬기</b>를
                누르면 {target?.language ? LANGUAGE_LABELS[target.language] : '상대 언어'}로
                바꿔 드려요 — 용어집도 그때 적용돼요.
              </p>

              <div className="tag-row">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(draftEdit);
                    onToast?.('초안을 복사했어요 — 입력창에 붙여넣고 다듬기를 눌러 주세요');
                    // 🔴 포인트는 **여기서만** 지급된다(②) — 클릭이 아니라 실제로 쓴 시점이다.
                    await awardIfYielded(chosen);
                  }}
                >
                  초안 복사
                </button>
                {/**
                  * 🔴 **캘린더 쓰기 권한을 새로 받지 않는다** (⑧ — `draft.js` 헤더).
                  *    구글/아웃룩의 「일정 만들기」 화면을 값만 채워 열고, 저장은 사용자가 그쪽에서
                  *    직접 누른다. 우리가 남의 달력에 조용히 쓰는 권한을 갖지 않는다.
                  * 🔴 두 버튼을 나란히 두지 않고 **한 줄 링크**로 줄였다(①) — 주 동작은 초안 복사다.
                  */}
                <button
                  type="button"
                  className="link-button link-inline"
                  onClick={() => window.open(calLinks.google, '_blank', 'noopener')}
                >
                  구글 캘린더
                </button>
                <button
                  type="button"
                  className="link-button link-inline"
                  onClick={() => window.open(calLinks.outlook, '_blank', 'noopener')}
                >
                  아웃룩
                </button>
                <button type="button" className="button button-quiet" onClick={() => setChosen(null)}>
                  닫기
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * B2B 대시보드 진입 (Spec §3).
 *
 * 🔴 **대시보드는 별도 웹페이지라 로그인이 없다.** Firestore를 직접 읽으려면 그 페이지에도
 *    구글 인증을 붙여야 하는데, 규칙상 팀원만 읽을 수 있으므로 인증 없는 페이지에 데이터를
 *    열어 주는 순간 **팀 id만 알면 남의 조직 지표가 공개된다.** 그래서 **읽기는 확장이 하고**
 *    (이미 팀원 자격이 있다) 집계 결과만 페이지로 넘긴다.
 * 🔴 값은 **URL 프래그먼트(`#`)**로 넘긴다 — 쿼리스트링과 달리 서버로 전송되지 않아 호스팅
 *    로그에 남지 않는다. 넘기는 것은 정수 합계뿐이고 개인 식별자는 애초에 존재하지 않는다
 *    (`friction.js` 설계 — 마찰 문서에 uid를 남기지 않는다).
 * 🔴 팀이 없으면 **데모로 연다** — 그리고 그렇다고 화면에 쓴다. 목업을 실데이터처럼 보이게
 *    하지 않는 것이 이 프로젝트에서 반복된 교훈이다(S33·S45).
 */
function TeamDashboardCard({ team, onToast }) {
  const [busy, setBusy] = useState(false);

  /**
   * 🔴 **팀은 부모(`TeamPanel`)가 준다** (2026-08-16). 예전에는 이 카드가 스스로 `getTeam()`을
   *    읽어서, 「팀」 탭에서 팀을 바꿔도 **옛 팀**을 들고 있었다 — 「132 대시보드」를 눌렀는데
   *    다른 팀이 열렸다. 이제 고르는 곳과 여는 곳이 같은 화면이라 상태가 갈릴 자리가 없다.
   */
  const canView = team?.role === 'owner' || team?.canViewDashboard === true;
  if (!canView) return null;

  const open = async () => {
    setBusy(true);
    try {
      /**
       * 🔴 **볼 수 있는 팀을 전부 실어 보낸다** — 대시보드는 로그인이 없어 스스로 팀을 바꿔
       *    읽을 수 없다. 웹페이지의 드롭다운이 이 배열로 전환한다.
       * 🔴 **지표가 0건인 팀도 넣는다.** 빼면 그 팀을 고른 사용자에게 다른 팀 지표가 열린다
       *    (실측으로 겪었다) — 빈 팀은 빈 팀으로 보여준다.
       */
      const reports = await fetchAllTeamsFriction({ days: 30 });
      if (reports.length === 0) {
        onToast('아직 지표를 볼 수 있는 팀이 없어요 — 데모 데이터로 열게요');
        window.open(DASHBOARD_URL, '_blank', 'noopener');
        return;
      }
      // 🔴 지금 보고 있는 팀을 **맨 앞**에 둔다 — 열었을 때 고른 팀이 나와야 한다.
      const ordered = [
        ...reports.filter((item) => item.teamId === team.teamId),
        ...reports.filter((item) => item.teamId !== team.teamId),
      ];
      const payload = btoa(
        // 🔴 `encodeURIComponent`를 거쳐야 한글 팀 이름이 `btoa`에서 깨지지 않는다.
        unescape(encodeURIComponent(JSON.stringify({ teams: ordered }))),
      );
      window.open(`${DASHBOARD_URL}#sai=${payload}`, '_blank', 'noopener');
    } catch {
      onToast('팀 지표를 불러오지 못했어요 — 데모 데이터로 열게요');
      window.open(DASHBOARD_URL, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-dashed">
      <h2 className="card-label card-label-green">{team.name} — 협업 대시보드</h2>
      <p className="card-text">팀에 쌓인 협업 건강도와 마찰 리포트를 봅니다.</p>
      {/* 🔴 사이드패널(chrome-extension:// 오리진)에서 별도 웹페이지를 열려면 새 탭으로 나가야
          한다 — 리더에게 공유할 독립 URL이어야 한다(Spec §1). */}
      <button type="button" className="button button-green" disabled={busy} onClick={open}>
        {busy ? '불러오는 중…' : '대시보드 열기 →'}
      </button>
    </section>
  );
}

function HomeTab({ onboarding, onSaveOnboarding, onResetOnboarding, onToast }) {
  /**
   * S23 — 실제 적립 잔액. 🔴 목업(`POINTS.balance`)이 아니라 `chrome.storage.local`의 실제 값이다.
   *    설명 문구(`POINTS.detail`/`usage`)는 Spec §1의 정책 안내라 그대로 둔다.
   */
  const [points, setPointsState] = useState({ balance: 0, history: [] });
  const refreshPoints = () => getPoints().then(setPointsState);
  useEffect(() => {
    refreshPoints();
  }, []);

  /**
   * 🔴 「오늘의 사이」 — **실제 카운트**다(`src/lib/usage.js`).
   *    2026-08-15까지는 `mockData.js`의 14·6·3이 그대로 보였고, 같은 패널의 보관함은 실제
   *    「예약 발송 0」을 보여줬다 — 한 화면에서 3과 0이 동시에 보이는 상태였다.
   */
  const [usage, setUsage] = useState({ refined: 0, decoded: 0, scheduled: 0 });
  useEffect(() => {
    getTodayUsage().then(setUsage);

    /**
     * 🔴 **패널을 열어 둔 채로 교정해도 숫자가 따라온다** (2026-08-19 사용자 확인 요청 ②).
     *
     *    카운트를 올리는 쪽은 **페이지 안의 콘텐츠 스크립트**(`content/SaiOverlay.jsx`)이고,
     *    읽는 쪽은 **사이드패널**이다 — 서로 다른 컨텍스트라 값을 올려도 패널은 모른다.
     *    예전에는 마운트할 때 한 번만 읽어서, 홈을 띄워 둔 채 문장을 다듬으면 **0이 계속 0으로
     *    남아 있었다.** 탭을 옮겼다 오면(패널 본문이 다시 마운트된다) 그때야 반영됐다.
     *    「오늘의 사이」는 방금 한 일이 바로 보여야 하는 카드라 이건 고장으로 읽힌다.
     *
     * 🔴 `chrome.storage.onChanged`는 **다른 컨텍스트의 변경도 알려 준다** — 그래서 폴링이
     *    필요 없다. 다른 키의 변경에는 반응하지 않는다(카운트 카드가 남의 저장에 흔들리면 안 된다).
     */
    if (typeof chrome === 'undefined' || !chrome?.storage?.onChanged) return undefined;
    const onChanged = (changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEYS.USAGE_TODAY]) return;
      getTodayUsage().then(setUsage);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  /**
   * Spec §3 — 쌓인 마찰 카운트를 올린다.
   *
   * 🔴 **패널을 열 때 한 번**만 시도한다. 교정할 때마다 올리면 사용자가 문장을 다듬는 동안
   *    네트워크 요청이 계속 나가고, 실패 처리도 교정 흐름에 섞인다.
   * 🔴 **팀이 없으면 아무 일도 일어나지 않는다**(`uploadFriction`이 즉시 0을 준다) — 개인
   *    사용자의 카운트는 어디에도 올라가지 않는다.
   * 🔴 실패해도 조용하다. 카운트는 로컬에 남아 다음 기회에 다시 올라간다 — 사용자가 할 수 있는
   *    일이 없는 실패를 알림으로 띄우지 않는다.
   */
  useEffect(() => {
    uploadFriction().catch(() => {});
  }, []);


  return (
    <>
      <OnboardingCard
        onboarding={onboarding}
        onSave={onSaveOnboarding}
        onReset={onResetOnboarding}
      />

      <section className="card">
        <h2 className="card-label">오늘의 사이</h2>
        <div className="stat-row">
          {[
            { id: 'refined', label: '교정', value: usage.refined, accent: 'orange' },
            { id: 'decoded', label: '해독', value: usage.decoded, accent: 'green' },
            { id: 'scheduled', label: '예약 발송', value: usage.scheduled, accent: 'ink' },
          ].map((stat) => (
            <div key={stat.id} className="stat">
              <span className={`stat-value stat-${stat.accent}`}>{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
        {/* 🔴 0일 때 이유를 말한다 — 숫자 세 개만 0으로 있으면 고장으로 읽힌다. */}
        {usage.refined + usage.decoded + usage.scheduled === 0 && (
          <p className="meta">오늘은 아직 없어요. 문장을 다듬거나 뜻을 풀면 여기에 쌓여요.</p>
        )}

        {/**
          * 🔴 **「오늘 막은 것」 한 줄** (2026-08-17 사용자 승인 — 제안 중 이것만 채택).
          *    위 세 숫자는 「무엇을 했는가」이고, 이 줄은 **「무엇을 안 일어나게 했는가」**다.
          *    제품의 값어치가 실제로 있는 쪽은 후자인데 지금까지 **내 화면에는 한 번도 안 보였다**
          *    (팀 대시보드로만 올라갔다 — 개인 사용자는 영영 못 본다).
          * 🔴 **새 판정이 없다.** 민감정보 가드와 퇴근 요정이 이미 내리고 있는 판정을 셀 뿐이다.
          * 🔴 **0이면 줄 자체를 내지 않는다.** 「0건 막음」은 정보가 아니라 잡음이고, 매일 보이면
          *    "이 기능이 고장났나"로 읽힌다.
          */}
        {usage.blockedSensitive + usage.blockedOffHours > 0 && (
          <p className="card-text blocked-line">
            🛡 오늘 막은 것 ·{' '}
            {[
              usage.blockedSensitive > 0 && `민감정보 ${usage.blockedSensitive}건`,
              usage.blockedOffHours > 0 && `오프타임 전송 ${usage.blockedOffHours}건`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </section>

      {/* S23 / Spec 권장 12 — 상시 노출 회의 시간 추천. */}
      <MeetingCard onAwarded={refreshPoints} onToast={onToast} />

      <section className="card">
        <div className="card-head">
          <h2 className="card-label">내 포인트</h2>
          <span className="points">🪙 {points.balance}P</span>
        </div>
        <p className="card-text">
          {POINTS.detail}
          <br />
          {POINTS.usage}
        </p>
      </section>

      {/**
        * 🔴 **팀 대시보드는 「팀」 탭으로 옮겼다** (2026-08-16). 홈에 두면 팀을 「팀」 탭에서
        *    고르고 대시보드는 홈에서 여는 구조가 되어, **어느 팀을 보는 중인지 화면이 갈린다** —
        *    실제로 「132」를 고르고 열었더니 다른 팀이 나오는 사고가 났다. 고르는 곳과 여는 곳을
        *    같은 화면에 둔다.
        */}
    </>
  );
}

/* ── 용어집 (Spec 필수 7) ──────────────────────────────────────────────── */

/** 새 항목 입력 폼의 초기값. */
const EMPTY_DRAFT = { sourceText: '', targetText: '', keepSource: false, language: null };

/**
 * 팀 관리 — 팀원 목록 + 대시보드 열람 권한 (팀장 전용, Spec §3).
 *
 * 🔴 **팀장만 이 카드를 본다.** 팀원 명단은 인적 정보라 권한을 주는 사람에게만 필요하고,
 *    팀원 전체에게 열면 관리 기능이 아니라 사내 주소록이 된다. 서버도 같은 판정을 한다
 *    (`functions/teams.js`의 `requireOwner`) — 화면만 숨기면 방어가 아니다.
 * 🔴 **기본은 「못 봄」이다.** 대시보드는 팀 전체의 마찰이 보이는 화면이라, 참가하면 자동으로
 *    열리는 쪽이 아니라 팀장이 열어 주는 쪽이 기본이어야 한다.
 */
function TeamMembersCard({ team, onToast, onChanged }) {
  const [members, setMembers] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(null); // {uid, kind:'kick'|'transfer'}
  const [freshCode, setFreshCode] = useState('');
  const [nameDraft, setNameDraft] = useState('');

  const load = async () => {
    try {
      setMembers(await listTeamMembers());
      setNote('');
    } catch (error) {
      setNote(teamErrorMessage(error?.reason, error?.detail));
      setMembers([]);
    }
  };

  useEffect(() => {
    if (open && members === null) load();
  }, [open]);

  const toggle = async (person) => {
    setBusy(person.uid);
    try {
      await setMemberDashboardAccess(person.uid, !person.canViewDashboard);
      await load();
      onToast(
        person.canViewDashboard
          ? '대시보드 열람을 껐어요'
          : '대시보드를 볼 수 있게 했어요',
      );
    } catch (error) {
      setNote(teamErrorMessage(error?.reason, error?.detail));
    } finally {
      setBusy('');
    }
  };

  /**
   * 되돌릴 수 없는 조작 두 가지.
   * 🔴 **확인 단계를 반드시 거친다.** 내보내기는 그 사람이 초대 코드 없이 못 돌아오고,
   *    이양은 **내가 팀장이 아니게 되어** 되돌릴 권한 자체가 사라진다.
   */
  const runDangerous = async (person, kind) => {
    setBusy(person.uid);
    setConfirming(null);
    try {
      if (kind === 'kick') {
        await removeTeamMember(person.uid);
        onToast('팀원을 내보냈어요');
        await load();
      } else {
        await transferOwnership(person.uid);
        onToast('팀장을 넘겼어요 — 이제 팀원이에요');
        await onChanged?.();
      }
    } catch (error) {
      setNote(teamErrorMessage(error?.reason, error?.detail));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card">
      <div className="card-head card-head-bare">
        <h3 className="card-label">팀 관리</h3>
        <button type="button" className="link-button" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '팀원 보기'}
        </button>
      </div>
      <p className="meta">팀장만 보이는 영역이에요. 대시보드를 볼 사람을 여기서 정해요.</p>

      {/* 팀 이름 바꾸기 — 값이 바뀌었을 때만 저장 버튼을 낸다. */}
      <div className="github-suggest-form">
        <input
          className="form-input"
          placeholder="팀 이름"
          maxLength={40}
          value={nameDraft || team.name}
          onChange={(event) => setNameDraft(event.target.value)}
        />
        <button
          type="button"
          className="button"
          disabled={nameDraft.trim() === '' || nameDraft === team.name}
          onClick={async () => {
            try {
              await renameTeam(nameDraft);
              setNameDraft('');
              onToast('팀 이름을 바꿨어요');
              await onChanged?.();
            } catch (error) {
              setNote(teamErrorMessage(error?.reason, error?.detail));
            }
          }}
        >
          이름 변경
        </button>
      </div>

      {/**
        * 🔴 초대 코드 재발급 — **유출됐을 때 복구 경로가 이것뿐이다.** 옛 코드는 즉시 무효가
        *    되므로, 아직 안 들어온 사람에게 새 코드를 다시 줘야 한다는 사실을 함께 쓴다.
        */}
      {freshCode ? (
        <div className="card card-accent">
          <p className="card-label">새 초대 코드</p>
          <p className="github-code">{freshCode}</p>
          <p className="meta">
            <b>옛 코드는 이제 안 통해요.</b> 아직 안 들어온 사람에게는 이 코드를 다시 알려 주세요.
            저장하지 않으니 지금 복사해 두세요.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                navigator.clipboard?.writeText(freshCode);
                onToast('새 초대 코드를 복사했어요');
              }}
            >
              복사
            </button>
            <button type="button" className="button button-quiet" onClick={() => setFreshCode('')}>
              닫기
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="link-button"
          onClick={async () => {
            try {
              setFreshCode(await regenerateInvite());
            } catch (error) {
              setNote(teamErrorMessage(error?.reason, error?.detail));
            }
          }}
        >
          초대 코드 새로 발급
        </button>
      )}

      {open && (
        <>
          {members === null ? (
            <p className="meta">불러오는 중…</p>
          ) : members.length === 0 ? (
            <p className="meta">아직 팀원이 없어요. 초대 코드를 전달해 보세요.</p>
          ) : (
            members.map((person) => (
              <div key={person.uid} className="member-block">
                <div className="member-row">
                <div className="member-main">
                  {/**
                   * 🔴 **사람을 알아볼 수 있게 쓴다** (2026-08-16). 예전에는 이메일이 없으면
                   *    「계정 Gp8M3A…」로 떠서 팀장이 권한 줄 대상을 고를 수 없었다.
                   *    스스로 밝힌 이름 → 이메일 → 계정 앞자리 순으로 있는 것을 쓴다.
                   */}
                  <span className="member-name">
                    {person.displayName || person.email || `계정 ${person.uid.slice(0, 6)}…`}
                  </span>
                  <span className="member-role">
                    {[
                      person.jobTitle,
                      person.role === 'owner' ? '팀장' : '팀원',
                      person.isMe ? '나' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                {person.role === 'owner' ? (
                  // 🔴 팀장 자신은 끌 수 없다 — 끄면 되돌릴 화면이 그 대시보드 안에 있다.
                  <span className="chip chip-outline">항상 열람</span>
                ) : (
                  /**
                   * 🔴 **켜짐/꺼짐 문구가 달라야 한다** (2026-08-16 사용자 지적). 예전에는 양쪽 다
                   *    「대시보드 열람」이라 **지금 상태인지 누르면 될 일인지** 구분되지 않았다.
                   *    현재 상태를 쓰고, 누르면 어떻게 되는지는 `title`로 보완한다.
                   */
                  <button
                    type="button"
                    className={person.canViewDashboard ? 'chip chip-on' : 'chip'}
                    aria-pressed={person.canViewDashboard}
                    disabled={busy === person.uid}
                    title={
                      person.canViewDashboard
                        ? '눌러서 대시보드 열람을 막습니다'
                        : '눌러서 대시보드를 볼 수 있게 합니다'
                    }
                    onClick={() => toggle(person)}
                  >
                    {busy === person.uid
                      ? '…'
                      : person.canViewDashboard
                        ? '대시보드 열람 중'
                        : '대시보드 못 봄'}
                  </button>
                )}
                </div>
                {/**
                  * 🔴 되돌릴 수 없는 두 조작은 **확인을 거친다.** 내보내면 그 사람은 초대 코드
                  *    없이 못 돌아오고, 이양하면 **내가 팀장이 아니게 되어** 되돌릴 권한 자체가
                  *    사라진다. 팀장 본인 행에는 아예 그리지 않는다(서버도 막는다).
                  */}
                {person.role !== 'owner' && (
                  confirming?.uid === person.uid ? (
                    <div className="member-confirm" role="alertdialog">
                      <p className="meta">
                        {confirming.kind === 'kick'
                          ? '내보내면 초대 코드 없이는 다시 못 들어와요. 이미 쌓인 팀 지표는 그대로 남아요(팀 단위 합계라 개인 몫만 뺄 수 없어요).'
                          : '팀장을 넘기면 나는 팀원이 돼요. 되돌리려면 새 팀장이 다시 넘겨줘야 해요.'}
                      </p>
                      <div className="tag-row">
                        <button type="button" className="chip" onClick={() => setConfirming(null)}>
                          취소
                        </button>
                        <button
                          type="button"
                          className="chip chip-orange"
                          onClick={() => runDangerous(person, confirming.kind)}
                        >
                          {confirming.kind === 'kick' ? '내보내기' : '팀장 넘기기'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="member-actions">
                      <button
                        type="button"
                        className="link-button link-inline"
                        onClick={() => setConfirming({ uid: person.uid, kind: 'transfer' })}
                      >
                        팀장 넘기기
                      </button>
                      <button
                        type="button"
                        className="link-button link-inline"
                        onClick={() => setConfirming({ uid: person.uid, kind: 'kick' })}
                      >
                        내보내기
                      </button>
                    </div>
                  )
                )}
              </div>
            ))
          )}
          {note && <p className="meta">{note}</p>}
        </>
      )}
    </div>
  );
}

/**
 * 팀 탭 — 소속 팀 전환 · 만들기/참가 · 관리 · 팀 용어집 (2026-08-16).
 *
 * 🔴 **여러 팀에 속할 수 있다.** 팀마다 용어집·지표·권한이 따로라, 화면 맨 위에서 지금 보는
 *    팀을 고르고 그 아래 모든 내용이 그 팀을 따른다. 팀이 하나면 선택 줄을 그리지 않는다 —
 *    고를 것이 없는 선택지는 자리만 차지한다.
 * 🔴 **이름·직급은 여기서 묻지 않는다.** 팀마다 다시 입력하게 하면 같은 값을 반복해 치고
 *    팀마다 이름이 갈린다. 프로필에 한 번 설정해 두고(`identity.js`) 생성·참가 때 실어 보낸다 —
 *    비어 있으면 안내만 하고 막지는 않는다.
 */
function TeamTab({ onToast }) {
  const [teams, setTeams] = useState(null);
  const [active, setActive] = useState(null);
  const [identity, setIdentityState] = useState({ displayName: '', jobTitle: '' });
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    const list = await listTeams();
    setTeams(list);
    setActive(await getTeam());
  };

  useEffect(() => {
    /**
     * 🔴 **먼저 로컬로 그리고, 그다음 서버에 물어 고친다** (2026-08-16 사용자 지적 ⑦).
     *    로컬 값은 참가 시점의 스냅샷이라 **팀장을 넘겨받아도 계속 팀원으로 보였다.**
     *    네트워크를 기다렸다 그리면 오프라인에서 팀 화면이 통째로 비므로 순서가 이 방향이어야 한다.
     */
    reload()
      .then(() => refreshAllMemberships())
      .then((result) => {
        if (result?.changed) return reload();
        return null;
      })
      .catch(() => {});
    getIdentity().then(setIdentityState);
  }, []);

  if (teams === null) return <p className="empty">불러오는 중…</p>;

  const showForm = teams.length === 0 || adding;

  return (
    <>
      {/**
        * 🔴 **드롭다운이다** (2026-08-16 사용자 요청). 세그먼트로 늘어놓으면 팀이 늘수록
        *    352px 폭에서 **위로 쌓이고** 팀 이름이 잘린다 — 3~4개만 돼도 화면 절반을 먹는다.
        *    드롭다운은 팀 수와 무관하게 한 줄이다.
        */}
      {teams.length > 1 && (
        <label className="team-picker">
          <span className="team-picker-label">팀</span>
          <select
            className="form-input"
            value={active?.teamId ?? ''}
            onChange={async (event) => {
              await setActiveTeam(event.target.value);
              await reload();
            }}
          >
            {teams.map((team) => (
              <option key={team.teamId} value={team.teamId}>
                {team.name}
                {team.role === 'owner' ? ' (팀장)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {!isIdentitySet(identity) && (
        // 🔴 막지 않고 권한다 — 익명으로 참여하고 싶을 수도 있다. 다만 팀장이 못 알아본다는
        //    사실은 **들어가기 전에** 알려야 한다.
        <p className="hint">
          프로필 탭에서 <b>내 이름·직급</b>을 정해 두면 팀장이 팀원 목록에서 알아볼 수 있어요.
        </p>
      )}

      {/**
        * 🔴 **key를 여기 하나로 모았다** (2026-08-16 ①②). 예전에는 `TeamPanel` **안의** 카드
        *    둘에 각각 `key={teamId}`가 붙어 있었다 — 팀을 바꿀 때마다 형제 두 개가 따로 교체되는
        *    구조라, 교체가 한 번이라도 어긋나면 옛 카드가 남을 자리가 둘이었다. 팀이 바뀌면
        *    **패널 하나가 통째로** 바뀌는 편이 상태가 갈릴 자리가 없다.
        */}
      {active && (
        <TeamPanel key={active.teamId} team={active} onToast={onToast} onChanged={reload} />
      )}

      {/* 🔴 팀 추가는 **독립 버튼**으로 맨 아래에 둔다 (2026-08-16 사용자 요청) — 팀 카드 안
          링크로 두면 "지금 팀에 대한 동작"으로 읽힌다. 팀이 없을 때는 폼이 바로 열려 있다. */}
      {!showForm && (
        <button type="button" className="button button-dashed" onClick={() => setAdding(true)}>
          ＋ 다른 팀 만들기 / 참가
        </button>
      )}

      {showForm && (
        <TeamJoinForm
          identity={identity}
          hasTeams={teams.length > 0}
          onCancel={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await reload();
          }}
          onToast={onToast}
        />
      )}
    </>
  );
}

/**
 * 팀 만들기 / 초대 코드로 참가.
 * 🔴 초대 코드는 만든 직후 **한 번만** 보여준다 — 저장하지 않으므로 여기서 복사하지 않으면
 *    다시 볼 수 없다. 로컬에 남기면 이 기기를 쓰는 누구나 팀에 들어갈 수 있는 열쇠가 된다.
 */
function TeamJoinForm({ identity, hasTeams, onCancel, onDone, onToast }) {
  const [codeDraft, setCodeDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [freshCode, setFreshCode] = useState('');

  const run = async (fn) => {
    setBusy(true);
    setNote('');
    try {
      await fn();
    } catch (error) {
      setNote(teamErrorMessage(error?.reason, error?.detail));
    } finally {
      setBusy(false);
    }
  };

  if (freshCode) {
    return (
      <div className="card card-accent">
        <p className="card-label">초대 코드</p>
        <p className="github-code">{freshCode}</p>
        <p className="meta">
          <b>지금 복사해 두세요</b> — 보안을 위해 저장하지 않아서 이 화면을 벗어나면 다시 볼 수
          없어요.
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              navigator.clipboard?.writeText(freshCode);
              onToast('초대 코드를 복사했어요');
            }}
          >
            복사
          </button>
          <button type="button" className="button button-primary" onClick={() => { setFreshCode(''); onDone(); }}>
            완료
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head card-head-bare">
        <h3 className="card-label">{hasTeams ? '팀 추가' : '팀 시작하기'}</h3>
        {hasTeams && (
          <button type="button" className="link-button" onClick={onCancel}>
            취소
          </button>
        )}
      </div>
      <p className="meta">
        팀에 들어가면 <b>팀 용어집</b>을 함께 쓰고, 협업 지표가 팀 대시보드에 쌓여요. 로그인이
        필요해요.
      </p>

      <div className="github-suggest-form">
        <input
          className="form-input"
          placeholder="초대 코드 6자리"
          value={codeDraft}
          maxLength={6}
          onChange={(event) => setCodeDraft(event.target.value)}
        />
        <button
          type="button"
          className="button button-primary"
          disabled={busy || codeDraft.trim().length !== 6}
          onClick={() =>
            run(async () => {
              const joined = await joinTeam(codeDraft, identity);
              setCodeDraft('');
              onToast(`「${joined.name}」에 참가했어요`);
              onDone();
            })
          }
        >
          {busy ? '…' : '참가'}
        </button>
      </div>

      <div className="github-suggest-form">
        <input
          className="form-input"
          placeholder="새 팀 이름"
          value={nameDraft}
          maxLength={40}
          onChange={(event) => setNameDraft(event.target.value)}
        />
        <button
          type="button"
          className="button"
          disabled={busy || nameDraft.trim() === ''}
          onClick={() =>
            run(async () => {
              const made = await createTeam(nameDraft, identity);
              setNameDraft('');
              setFreshCode(made.inviteCode);
            })
          }
        >
          만들기
        </button>
      </div>

      {note && <p className="meta">{note}</p>}
    </div>
  );
}

/**
 * 팀 하나의 화면 — 소속 정보 · 관리(팀장) · 팀 용어집.
 *
 * 🔴 **개인 용어집과 저장소가 다르다.** 개인은 `chrome.storage.local`(기기 안), 팀은 Firestore다.
 *    같은 화면에 나란히 있지만 팀 것은 **팀원 모두에게 보인다** — 그 사실을 화면에 쓴다.
 * 🔴 **초대 코드는 만든 직후 한 번만 보여준다.** 저장하지 않으므로 패널을 닫으면 사라진다.
 *    로컬에 남기면 이 기기를 쓰는 누구나 팀에 들어갈 수 있는 열쇠가 된다 — 그래서 화면에
 *    "지금 복사해 두라"고 분명히 말한다.
 */
/**
 * 내 이름·직급 (Spec §3 팀 · 2026-08-16).
 *
 * 🔴 **이 값은 팀에만 나간다.** 교정 프롬프트·마찰 지표 어디에도 실리지 않는다 — 마찰 문서는
 *    여전히 개인 식별자를 갖지 않는다(필수 9).
 * 🔴 **비워 둘 수 있다.** 익명으로 참여하고 싶을 수도 있어 강제하지 않고, 대신 팀장이 못
 *    알아본다는 사실만 팀 탭에서 알린다.
 * 🔴 이미 들어간 팀에는 **다음 참가·재참가 때** 반영된다 — 지금 소속된 팀의 표시가 바로
 *    바뀌지는 않는다는 것을 화면에 쓴다(안 쓰면 "고쳤는데 왜 그대로"가 된다).
 */
// 🔴 `bare` — 프로필 탭에서는 카드가 아니라 「나」 카드 **안의 구획**으로 그린다(⑤).
/**
 * 🔴 **「팀에서 보이는 내 이름」 → 「내 정보」로 넓혔다** (2026-08-20 사용자 결정 ⓨ).
 *
 *    문제: 사용자에게는 전부 「내 정보」인데, 저장 위치가 다르다는 이유로 **화면이 갈라져
 *    있었다.** 이름·역할은 프로필 탭, 내 언어는 **홈의 온보딩 카드**, 지역은 아무 데도 없었다.
 *    그중 내 언어는 더 나빴다 — 완료 후에는 「3초 온보딩 **다시 하기**」로 설정을 통째로 지워야만
 *    바꿀 수 있었다. 언어 하나 고치려고 처음부터 다시 답하는 길밖에 없었다.
 *
 * 🔴 **저장 구조는 하나도 바꾸지 않았다.** 이름·역할은 `sai.identity`, 언어는 `sai.onboarding`
 *    그대로다 — 읽고 쓰는 **화면만** 한곳으로 모았다. 홈의 온보딩 카드도 그대로 둔다(첫 설정 경로).
 *
 * 🔴 **「팀에만 전달돼요」를 카드 전체 설명으로 두지 않는다.** 그 말은 이름·역할에만 참이다.
 *    내 언어는 **교정 요청의 `sourceLanguage`로 나가고**, 지역은 퇴근 시각·회의 시간 계산에
 *    쓰인다 — 카드가 넓어졌는데 문구를 그대로 두면 **화면이 거짓말을 한다.**
 *
 * 🔴 **내 지역 줄을 뺐다** (2026-08-20 사용자 요청 ①). 잠깐 넣었다가 바로 지운다 —
 *    **읽기 전용 한 줄이 세 줄(제목·값·설명)을 먹는데**, 바꿀 수도 없는 값이라 사용자가 할 일이
 *    없었다. 계산은 그대로 브라우저 타임존으로 한다(`DualClock`·`SaiOverlay`·회의 추천).
 *    필요해지면 「퇴근 요정」처럼 **그 값을 쓰는 화면 옆에** 붙이는 게 맞다.
 * 🔴 **제목(`내 정보`)은 여기서 그리지 않는다** — 접기 버튼과 한 줄에 놓여야 해서 `ProfileTab`이
 *    카드 머리에 그린다. 여기서도 그리면 제목이 두 번 나온다.
 */
function IdentityCard({ onNotice, bare = false, myLanguage = null, onChangeMyLanguage, onSaved }) {
  const [draft, setDraft] = useState({ displayName: '', jobTitle: '' });
  const [saved, setSaved] = useState({ displayName: '', jobTitle: '' });

  useEffect(() => {
    getIdentity().then((value) => {
      setDraft(value);
      setSaved(value);
    });
  }, []);

  const dirty = draft.displayName !== saved.displayName || draft.jobTitle !== saved.jobTitle;

  return (
    <section className={bare ? 'profile-block' : 'card'}>
      <p className="field-label">이름 · 역할</p>
      <input
        className="form-input"
        placeholder="이름 (예: 홍길동)"
        value={draft.displayName}
        maxLength={MAX_IDENTITY_FIELD}
        onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
      />
      <input
        className="form-input"
        placeholder="직급·역할 (선택 — 예: 백엔드 리드)"
        value={draft.jobTitle}
        maxLength={MAX_IDENTITY_FIELD}
        onChange={(event) => setDraft({ ...draft, jobTitle: event.target.value })}
      />

      {dirty && (
        <button
          type="button"
          className="button button-primary"
          onClick={async () => {
            const next = await setIdentity(draft);
            setSaved(next);
            // 🔴 접힘 요약이 옛 이름을 보여주지 않게 부모에게도 알린다.
            onSaved?.(next);
            onNotice?.('저장했어요 — 다음에 팀에 참가할 때 반영돼요');
          }}
        >
          저장
        </button>
      )}
      <p className="meta">
        이 두 가지만 <b>팀 목록</b>에 보여요. 교정 문장에는 쓰이지 않아요.
      </p>

      {/**
        * 🔴 **끄는 선택지를 두지 않는다** — 내 언어는 비울 수 없는 값이다(비우면 교정이
        *    `ko`로 되돌아간다 · `languagePairFrom`). 고른 것을 다시 눌러도 해제되지 않는다.
        */}
      <p className="field-label">내 언어</p>
      <div className="tag-row">
        {MY_LANGUAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={myLanguage === item.id ? 'chip chip-on' : 'chip'}
            aria-pressed={myLanguage === item.id}
            onClick={() => onChangeMyLanguage?.(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="meta">
        내가 쓰는 언어예요. <b>상대에게 쓸</b> 언어는 아래 「내가 대화하는 사람들」에서 사람마다 정해요.
      </p>
    </section>
  );
}

/**
 * 용어집 → 「팀」 — 지금 보고 있는 팀의 공용 용어 (2026-08-16).
 * 🔴 팀에 속하지 않으면 **팀 탭으로 안내**만 한다. 여기서 팀 참가까지 받으면 같은 흐름이 두
 *    곳에 생긴다(팀 관리는 「팀」 탭이 단일 출처다).
 */
function TeamGlossaryScope({ onToast }) {
  const [team, setTeam] = useState(undefined);
  const [teams, setTeams] = useState([]);
  const [entries, setEntries] = useState(null);
  const [editing, setEditing] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');

  const load = async () => setEntries(await listTeamGlossary());

  useEffect(() => {
    (async () => {
      setTeams(await listTeams());
      const found = await getTeam();
      setTeam(found);
      if (found) await load();
    })();
  }, []);

  const run = async (fn) => {
    setNote('');
    try {
      await fn();
    } catch (error) {
      setNote(teamErrorMessage(error?.reason, error?.detail));
    }
  };

  /**
   * 선택한 용어를 개인 용어집으로 복사하거나 옮긴다.
   * 🔴 **복사와 이동을 나눈다** — 팀 용어를 나만 다르게 쓰고 싶을 때(복사)와 팀에서 뺄 때(이동)는
   *    다른 의도다. 하나로 합치면 어느 쪽인지 모른 채 팀 것이 사라진다.
   * 🔴 **하나가 실패해도 멈추지 않는다** — 나머지는 옮겨져야 한다.
   */
  const moveOrCopy = async (remove) => {
    const targets = (entries ?? []).filter((item) => picked.has(item.id));
    let done = 0;
    for (const item of targets) {
      try {
        await addPersonalGlossaryEntry({
          sourceText: item.sourceText,
          targetText: item.targetText ?? '',
          keepSource: !!item.keepSource,
        });
        if (remove) await removeTeamGlossaryEntry(item.id);
        done += 1;
      } catch {
        /* 건너뛴다 */
      }
    }
    setPicked(new Set());
    if (remove) await load();
    onToast(
      remove
        ? `${done}개를 개인 용어집으로 옮겼어요`
        : `${done}개를 개인 용어집에 복사했어요 — 개인 것이 우선 적용돼요`,
    );
  };

  /**
   * 선택한 팀 용어 일괄 삭제 (2026-08-19 사용자 요청 ② — 개인과 같은 조작을 팀에도).
   *
   * 🔴 **팀 것은 남의 것이기도 하다.** 개인 용어집보다 확인 문구를 더 분명히 한다 — 지우면
   *    팀원 모두의 화면에서 사라진다.
   * 🔴 **하나가 실패해도 멈추지 않는다** — 지운 개수를 사실대로 말한다(`moveOrCopy`와 같은 규칙).
   */
  const deletePicked = async () => {
    const ids = [...picked];
    if (ids.length === 0) return;
    // eslint-disable-next-line no-alert
    if (!globalThis.confirm(`팀 용어 ${ids.length}개를 삭제할까요? 팀원 모두에게서 사라져요.`)) {
      return;
    }
    let done = 0;
    for (const id of ids) {
      try {
        await removeTeamGlossaryEntry(id);
        done += 1;
      } catch {
        /* 건너뛴다 — 아래에서 실제 개수를 말한다 */
      }
    }
    setPicked(new Set());
    await load();
    onToast(
      done === ids.length ? `팀 용어 ${done}개를 삭제했어요` : `${done}개만 삭제했어요`,
    );
  };

  if (team === undefined) return <p className="empty">불러오는 중…</p>;
  if (!team) {
    return <p className="empty">팀에 들어가면 여기에 팀 공용 용어가 보여요. 「팀」 탭에서 시작할 수 있어요.</p>;
  }

  return (
    <>
      {/* 🔴 팀이 둘 이상이면 **여기서도 고를 수 있어야 한다**(2026-08-16) — 팀 탭에 가서
          바꾸고 돌아오게 하면 같은 화면을 두 번 오간다. */}
      {teams.length > 1 && (
        <label className="team-picker">
          <span className="team-picker-label">팀</span>
          <select
            className="form-input"
            value={team.teamId}
            onChange={async (event) => {
              await setActiveTeam(event.target.value);
              const next = await getTeam();
              setTeam(next);
              setEntries(null);
              await load();
            }}
          >
            {teams.map((item) => (
              <option key={item.teamId} value={item.teamId}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="hint">
        <b>{team.name}</b>의 공용 용어예요. 팀원 모두에게 보이고 모두가 고칠 수 있어요.
      </p>
      {!adding && picked.size > 0 && (
        <div className="glossary-bulk">
          <span className="meta">{picked.size}개 선택됨</span>
          <button
            type="button"
            className="chip chip-orange"
            onClick={() => run(() => moveOrCopy(false))}
          >
            개인으로 복사
          </button>
          <button
            type="button"
            className="chip chip-orange"
            onClick={() => run(() => moveOrCopy(true))}
          >
            개인으로 이동
          </button>
          {/* 🔴 삭제만 색을 달리한다 — 옆 버튼과 같아 보이면 오조작한다(개인 용어집과 같은 규칙). */}
          <button type="button" className="chip chip-danger" onClick={() => run(deletePicked)}>
            선택 삭제
          </button>
          <button type="button" className="chip" onClick={() => setPicked(new Set())}>
            선택 해제
          </button>
        </div>
      )}

      {/**
        * 🔴 **전체 선택을 팀에도 넣는다** (2026-08-19 사용자 지적 ②). 개인 탭에는 있는데
        *    팀에만 없어서, 같은 화면의 같은 목록인데 **탭을 바꾸면 조작이 달라졌다.**
        * 🔴 «토글»이다 — 이미 전부 골라져 있으면 누르면 전부 풀린다(개인과 같은 동작).
        */}
      {!adding && entries !== null && entries.length > 0 && (
        <label className="glossary-all">
          <input
            type="checkbox"
            checked={picked.size === entries.length}
            onChange={(event) =>
              setPicked(event.target.checked ? new Set(entries.map((e) => e.id)) : new Set())
            }
          />
          <span>전체 선택 ({entries.length}개)</span>
        </label>
      )}

      {/* 🔴 추가하는 동안에는 목록을 감춘다 — 개인 용어집과 같은 규칙(2026-08-19). */}
      {/* 🔴 목록은 자체 스크롤 상자 안에 둔다 — 「＋ 팀 용어 추가」가 늘 보이게(개인과 같은 규칙). */}
      <div className="glossary-list">
      {adding ? null : entries === null ? (
        <p className="empty">불러오는 중…</p>
      ) : entries.length === 0 ? (
        <p className="empty">팀 용어가 없어요. 아래에서 추가해 보세요.</p>
      ) : (
        entries.map((entry) =>
          editing === entry.id ? (
            <GlossaryForm
              key={entry.id}
              draft={draft}
              onChange={setDraft}
              onSubmit={() =>
                run(async () => {
                  await saveTeamGlossaryEntry({ ...draft, id: entry.id });
                  setEditing(null);
                  await load();
                  onToast('팀 용어를 수정했어요');
                })
              }
              onCancel={() => setEditing(null)}
              error={note}
              submitLabel="저장"
            />
          ) : (
            <div key={entry.id} className="card">
              <div className="card-row">
                {/* 🔴 여러 개를 한 번에 옮기려면 체크가 필요하다(2026-08-16 사용자 요청) —
                    한 줄씩 누르면 수십 개를 옮길 때 실수한다. */}
                <input
                  type="checkbox"
                  className="glossary-check"
                  aria-label={`선택: ${entry.sourceText}`}
                  checked={picked.has(entry.id)}
                  onChange={() =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (next.has(entry.id)) next.delete(entry.id);
                      else next.add(entry.id);
                      return next;
                    })
                  }
                />
                <div className="card-row-main">
                  <div className="term-from">{entry.sourceText}</div>
                  {!entry.keepSource && <div className="term-to">→ {entry.targetText}</div>}
                </div>
                {entry.keepSource && <span className="chip chip-outline">원문 유지</span>}
              {entry.language && (
                <span className="chip chip-outline">{LANGUAGE_LABELS[entry.language]}일 때만</span>
              )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`팀 용어 수정: ${entry.sourceText}`}
                  onClick={() => {
                    setDraft({
                      sourceText: entry.sourceText,
                      targetText: entry.targetText ?? '',
                      keepSource: !!entry.keepSource,
                    });
                    setEditing(entry.id);
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`팀 용어 삭제: ${entry.sourceText}`}
                  onClick={() =>
                    run(async () => {
                      await removeTeamGlossaryEntry(entry.id);
                      await load();
                      onToast('팀 용어를 삭제했어요');
                    })
                  }
                >
                  🗑
                </button>
              </div>
            </div>
          ),
        )
      )}
      </div>

      {adding ? (
        <GlossaryForm
          title="새 팀 용어 추가"
          draft={draft}
          onChange={setDraft}
          onSubmit={() =>
            run(async () => {
              await saveTeamGlossaryEntry(draft);
              setDraft(EMPTY_DRAFT);
              setAdding(false);
              await load();
              onToast('팀 용어를 추가했어요');
            })
          }
          onCancel={() => {
            setAdding(false);
            setDraft(EMPTY_DRAFT);
          }}
          error={note}
          submitLabel="팀에 추가"
        />
      ) : (
        <button type="button" className="button button-dashed" onClick={() => setAdding(true)}>
          ＋ 팀 용어 추가
        </button>
      )}
      {note && !adding && <p className="meta">{note}</p>}
    </>
  );
}

/**
 * 용어집 → 「연동」 — 외부 도구에서 붙여넣기로 가져오기 (2026-08-16 사용자 결정 ⓐ).
 *
 * 🔴 **왜 붙여넣기인가**: 지금 권한으로 가능한 방법은 붙여넣기(권한 0)와 GitHub 레포 파일뿐이고,
 *    붙여넣기는 **도구를 가리지 않는다** — Notion·Google Sheets·Excel·Confluence가 전부
 *    CSV/TSV로 내보낸다. 연동 하나를 붙이는 것보다 넓게 덮는다(`lib/glossaryImport.js` 헤더).
 * 🔴 **미리보기를 반드시 거친다.** 붙여넣기는 사고가 나기 쉬운 입력이라(문서를 통째로 복사),
 *    몇 개가 들어가고 몇 줄이 건너뛰어졌는지 보여준 뒤에만 저장한다.
 */
function LinkedGlossaryScope({ onToast }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  /**
   * 🔴 **어디로 넣을지 고른다** (2026-08-16 사용자 지적). 예전에는 무조건 개인 용어집으로
   *    들어갔는데, 팀에서 함께 쓰려고 노션 표를 만든 사람에게는 **정반대**다.
   *    팀에 속했을 때만 선택지를 낸다 — 없는 곳을 고르게 하지 않는다.
   */
  const [teams, setTeams] = useState([]);
  const [target, setTarget] = useState('personal');

  useEffect(() => {
    listTeams().then(setTeams);
  }, []);

  const parse = () => setPreview(parseGlossaryText(text));

  return (
    <>
      <p className="hint">
        Notion · Google Sheets · Excel에서 <b>두 칸(원문 · 번역어)</b>을 복사해 붙여넣으세요.
        번역어를 비우면 <b>원문 유지</b>로 등록돼요.
      </p>

      <textarea
        className="form-input"
        rows={5}
        placeholder={'배포\trollout\n기획서\tproduct spec'}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setPreview(null);
        }}
      />

      {preview === null ? (
        <button
          type="button"
          className="button button-primary"
          disabled={text.trim() === ''}
          onClick={parse}
        >
          확인하기
        </button>
      ) : (
        <>
          {teams.length > 0 && (
            <label className="team-picker">
              <span className="team-picker-label">넣을 곳</span>
              <select
                className="form-input"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="personal">개인 용어집 (나만)</option>
                {teams.map((item) => (
                  <option key={item.teamId} value={item.teamId}>
                    {item.name} 팀 용어집 (팀원 모두)
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="meta">
            <b>{preview.entries.length}개</b>를 가져와요
            {preview.skipped > 0 && ` · ${preview.skipped}줄은 형태가 맞지 않아 건너뛰어요`}
            {preview.truncated && ` · ${MAX_IMPORT_ROWS}개까지만 받아요`}
          </p>
          {/* 🔴 앞 5개만 보여준다 — 전부 그리면 미리보기가 목록이 되어 확인 대신 스크롤이 된다. */}
          {preview.entries.slice(0, 5).map((entry) => (
            <div key={entry.sourceText} className="card card-row">
              <div className="card-row-main">
                <div className="term-from">{entry.sourceText}</div>
                {!entry.keepSource && <div className="term-to">→ {entry.targetText}</div>}
              </div>
              {entry.keepSource && <span className="chip chip-outline">원문 유지</span>}
              {entry.language && (
                <span className="chip chip-outline">{LANGUAGE_LABELS[entry.language]}일 때만</span>
              )}
            </div>
          ))}
          {preview.entries.length > 5 && (
            <p className="meta">… 외 {preview.entries.length - 5}개</p>
          )}

          <div className="form-actions">
            <button type="button" className="button button-quiet" onClick={() => setPreview(null)}>
              다시
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || preview.entries.length === 0}
              onClick={async () => {
                setBusy(true);
                const teamTarget = teams.find((item) => item.teamId === target) ?? null;
                if (teamTarget) await setActiveTeam(teamTarget.teamId);
                let added = 0;
                for (const entry of preview.entries) {
                  // 🔴 실패한 항목에서 멈추지 않는다 — 한 줄이 규칙에 안 맞아도 나머지는 들어가야 한다.
                  try {
                    if (teamTarget) await saveTeamGlossaryEntry(entry);
                    else await addPersonalGlossaryEntry(entry);
                    added += 1;
                  } catch {
                    /* 건너뛴다 */
                  }
                }
                setBusy(false);
                setText('');
                setPreview(null);
                // 🔴 **어디로 들어갔는지** 분명히 말한다 — 팀에 넣었는데 개인이라고 하면 사고다.
                onToast(
                  teamTarget
                    ? `「${teamTarget.name}」 팀 용어집에 ${added}개를 추가했어요`
                    : `개인 용어집에 ${added}개를 추가했어요`,
                );
              }}
            >
              {busy ? '가져오는 중…' : '가져오기'}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * 팀 하나의 소속 정보 + 관리(팀장). 2026-08-16.
 *
 * 🔴 **용어집은 여기 없다.** 팀 용어는 「보관함 → 용어집 → 팀」이 맡는다 — 개인·팀·연동이
 *    같은 성격의 목록이고 우선순위(개인 > 팀 > 기본)로 묶여 있어서, 팀 것만 떼면 우선순위를
 *    한 화면에서 볼 수 없다. 이 탭은 **소속·권한**만 다룬다.
 */
function TeamPanel({ team, onToast, onChanged }) {
  const [note, setNote] = useState('');

  return (
    <>
      <div className="card">
        <div className="card-head card-head-bare">
          <h3 className="card-label">
            {team.name}
            <span className="meta"> · {team.role === 'owner' ? '팀장' : '팀원'}</span>
          </h3>
          <button
            type="button"
            className="link-button"
            onClick={async () => {
              setNote('');
              try {
                await leaveTeam(team.teamId);
                onToast('이 기기에서 팀 연결을 끊었어요');
                await onChanged();
              } catch (error) {
                setNote(teamErrorMessage(error?.reason, error?.detail));
              }
            }}
          >
            연결 끊기
          </button>
        </div>
        {/* 🔴 "탈퇴"가 아니라 "이 기기에서 연결 끊기"다 — 서버의 팀원 기록은 남는다. */}
        <p className="meta">
          이 기기에서만 연결을 끊어요. 다시 들어오려면 초대 코드가 또 필요해요.
        </p>
        <p className="meta">
          팀 공용 용어는 <b>보관함 → 용어집 → 팀</b>에서 관리해요.
        </p>
        {note && <p className="meta">{note}</p>}
      </div>

      {/* 🔴 대시보드는 **고르는 곳과 같은 화면**에 있어야 한다(위 주석).
          🔴 key는 붙이지 않는다 — 팀이 바뀌면 부모(`TeamPanel`)째로 교체된다(호출부 주석). */}
      <TeamDashboardCard team={team} onToast={onToast} />

      {/* 🔴 팀장에게만 보이는 관리 영역. 팀원에게는 존재 자체를 노출하지 않는다 — 눌러도
          403이 나는 버튼은 "권한 없음"이 아니라 고장으로 읽힌다. */}
      {team.role === 'owner' && (
        <TeamMembersCard team={team} onToast={onToast} onChanged={onChanged} />
      )}
    </>
  );
}

function GlossaryTab({ scope, onScopeChange, onToast }) {
  const [entries, setEntries] = useState(null); // null = 로딩 중
  // 🔴 팀에 속하지 않으면 「팀으로 복사/이동」을 아예 그리지 않는다 — 갈 곳이 없다.
  const [personalTeams, setPersonalTeams] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [bulkTeam, setBulkTeam] = useState('');
  useEffect(() => {
    listTeams().then((list) => {
      setPersonalTeams(list);
      setBulkTeam(list[0]?.teamId ?? '');
    });
  }, []);

  /** 선택한 개인 용어를 팀으로 복사하거나 옮긴다. 🔴 실패해도 나머지는 계속 옮긴다. */
  const toTeam = async (remove) => {
    const target = personalTeams.find((item) => item.teamId === bulkTeam);
    if (!target) return;
    await setActiveTeam(target.teamId);
    const targets = (entries ?? []).filter((item) => picked.has(item.id));
    let done = 0;
    for (const item of targets) {
      try {
        await saveTeamGlossaryEntry(item);
        if (remove) await removePersonalGlossaryEntry(item.id);
        done += 1;
      } catch {
        /* 건너뛴다 */
      }
    }
    setPicked(new Set());
    setEntries(await listPersonalGlossary());
    onToast(
      remove
        ? `${done}개를 「${target.name}」 팀으로 옮겼어요`
        : `${done}개를 「${target.name}」 팀에 복사했어요 — 같은 낱말은 개인 것이 우선이에요`,
    );
  };

  const [formMode, setFormMode] = useState(null); // null | 'add' | entry.id(수정 중)
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [formError, setFormError] = useState('');

  // 개인 탭에서만 실제 데이터를 읽는다 — 팀/연동은 아직 백엔드가 없다(S02).
  useEffect(() => {
    if (scope !== 'personal') return;
    let cancelled = false;
    listPersonalGlossary().then((list) => {
      if (!cancelled) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  /**
   * 🔴 **추가하는 동안에는 목록을 감춘다** (2026-08-19 사용자 지적).
   *
   *    용어가 3개만 넘어도 추가 폼이 목록 **아래**로 밀려, 폼의 아래쪽(언어 칩·설명·저장 버튼)이
   *    화면 밖에 남았다. 그런데 **이 화면에서 목록과 폼을 동시에 볼 이유가 없다** — 새 용어를
   *    적는 중이지 기존 용어를 고르는 중이 아니다.
   *
   * 🔴 감추는 것은 **추가(`add`)일 때뿐**이다. 수정은 그 항목 자리에서 폼으로 바뀌는 방식이라
   *    (`formMode === entry.id`) 어느 용어를 고치는 중인지 **목록에 남아 있어야 알 수 있다.**
   *
   * 🔴 선택 상태(`picked`)는 건드리지 않는다 — 추가를 취소하면 고르던 것이 그대로 돌아온다.
   */
  const adding = formMode === 'add';

  const openAddForm = () => {
    setDraft(EMPTY_DRAFT);
    setFormError('');
    setFormMode('add');
  };

  const openEditForm = (entry) => {
    setDraft({
      sourceText: entry.sourceText,
      targetText: entry.targetText ?? '',
      keepSource: entry.keepSource,
      language: entry.language ?? null,
    });
    setFormError('');
    setFormMode(entry.id);
  };

  const closeForm = () => {
    setFormMode(null);
    setFormError('');
  };

  const submitForm = async () => {
    try {
      if (formMode === 'add') {
        await addPersonalGlossaryEntry(draft);
        onToast('용어를 추가했어요');
      } else {
        await updatePersonalGlossaryEntry(formMode, draft);
        onToast('용어를 수정했어요');
      }
      setEntries(await listPersonalGlossary());
      closeForm();
    } catch (error) {
      // 🔴 저장 실패 사유를 그대로 보여준다 — 조용히 삼키지 않는다.
      setFormError(error.message);
    }
  };

  const deleteEntry = async (entry) => {
    await removePersonalGlossaryEntry(entry.id);
    setEntries(await listPersonalGlossary());
    onToast('용어를 삭제했어요');
  };

  /**
   * 선택한 용어 일괄 삭제 (2026-08-18 사용자 요청 ④).
   *
   * 🔴 **되돌릴 수 없으므로 개수를 말하고 확인을 받는다.** 한 건 삭제는 다시 넣으면 그만이지만,
   *    여러 건은 무엇이 지워졌는지 기억하지 못한다.
   * 🔴 **실패해도 지운 것까지는 반영한다** — 전부 실패한 척하면 화면과 저장소가 어긋난다.
   */
  const deletePicked = async () => {
    const ids = [...picked];
    if (ids.length === 0) return;
    // eslint-disable-next-line no-alert
    if (!globalThis.confirm(`선택한 용어 ${ids.length}개를 삭제할까요? 되돌릴 수 없어요.`)) return;
    let done = 0;
    try {
      for (const id of ids) {
        await removePersonalGlossaryEntry(id);
        done += 1;
      }
      onToast(`용어 ${done}개를 삭제했어요`);
    } catch (error) {
      onToast(`${done}개만 삭제했어요 — ${error.message}`);
    } finally {
      setEntries(await listPersonalGlossary());
      setPicked(new Set());
    }
  };

  return (
    <>
      <div className="segment" role="tablist" aria-label="용어집 출처">
        {GLOSSARY_SCOPES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={scope === item.id}
            className={scope === item.id ? 'segment-item segment-active' : 'segment-item'}
            onClick={() => onScopeChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="hint">
        우선순위: <b>개인 &gt; 팀/연동 &gt; 기본 AI</b>
      </p>

      {scope === 'team' ? (
        <TeamGlossaryScope onToast={onToast} />
      ) : scope === 'linked' ? (
        <LinkedGlossaryScope onToast={onToast} />
      ) : entries === null ? (
        <p className="empty">불러오는 중…</p>
      ) : (
        <>
          {/**
            * 🔴 **조건에서 `personalTeams.length > 0`을 뺐다** (2026-08-18). 예전에는 팀이 없으면
            *    바 자체가 안 떠서, 팀이 없는 사용자는 **선택을 해 놓고도 할 수 있는 일이 없었다** —
            *    선택 해제조차 못 했다. 팀 관련 버튼만 팀이 있을 때 보이면 된다.
            */}
          {!adding && picked.size > 0 && (
            <div className="glossary-bulk">
              <span className="meta">{picked.size}개 선택됨</span>
              {personalTeams.length > 1 && (
                <select
                  className="form-input"
                  value={bulkTeam}
                  onChange={(event) => setBulkTeam(event.target.value)}
                >
                  {personalTeams.map((item) => (
                    <option key={item.teamId} value={item.teamId}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
              {personalTeams.length > 0 && (
                <>
                  <button type="button" className="chip chip-orange" onClick={() => toTeam(false)}>
                    팀으로 복사
                  </button>
                  <button type="button" className="chip chip-orange" onClick={() => toTeam(true)}>
                    팀으로 이동
                  </button>
                </>
              )}
              {/* 🔴 삭제는 되돌릴 수 없으므로 색으로 구분한다 — 옆 버튼과 같아 보이면 오조작한다. */}
              <button type="button" className="chip chip-danger" onClick={deletePicked}>
                선택 삭제
              </button>
              <button type="button" className="chip" onClick={() => setPicked(new Set())}>
                선택 해제
              </button>
            </div>
          )}
          {/**
            * 전체 선택 (2026-08-18 사용자 요청 ④).
            * 🔴 «토글»이다 — 이미 전부 골라져 있으면 누르면 전부 풀린다. 「전체 선택」 버튼과
            *    「선택 해제」 버튼을 따로 두면 같은 일을 하는 자리가 둘이 된다.
            * 🔴 목록이 비어 있으면 내지 않는다 — 고를 것이 없는데 버튼만 있으면 고장으로 읽힌다.
            */}
          {!adding && entries.length > 0 && (
            <label className="glossary-all">
              <input
                type="checkbox"
                checked={picked.size === entries.length}
                onChange={(event) =>
                  setPicked(event.target.checked ? new Set(entries.map((e) => e.id)) : new Set())
                }
              />
              <span>전체 선택 ({entries.length}개)</span>
            </label>
          )}
          {entries.length === 0 && formMode !== 'add' && (
            <p className="empty">등록된 용어가 없어요. 아래에서 추가해 보세요.</p>
          )}
          {/**
            * 🔴 **목록 자체가 스크롤한다** (2026-08-19 사용자 지적). 용어가 많아지면 목록이
            *    패널을 통째로 밀어내서 **아래의 「+ 용어 추가」 버튼에 닿을 수 없었다** —
            *    용어를 많이 만든 사람일수록 더 못 만드는 상태였다.
            *    상자에 높이 상한을 주면 **목록은 안에서 스크롤되고 추가 버튼은 늘 제자리**다.
            */}
          <div className="glossary-list">
          {adding ? null : entries.map((entry) =>
            formMode === entry.id ? (
              <GlossaryForm
                key={entry.id}
                draft={draft}
                onChange={setDraft}
                onSubmit={submitForm}
                onCancel={closeForm}
                error={formError}
                submitLabel="저장"
              />
            ) : (
              <div key={entry.id} className="card">
                <div className="card-row">
                {/**
                  * 🔴 **팀이 없어도 체크박스를 낸다** (2026-08-18 사용자 지적 ④).
                  *    예전 조건은 `personalTeams.length > 0`이었다 — 「팀으로 이동」 때문에 생긴
                  *    체크박스라 그렇게 걸었는데, 이제 **선택 삭제**가 생겨서 팀이 없어도 쓸 일이
                  *    있다. 팀이 없는 사용자는 **전체 선택은 되는데 개별 선택이 안 되는** 상태였다.
                  */}
                {(
                  <input
                    type="checkbox"
                    className="glossary-check"
                    aria-label={`선택: ${entry.sourceText}`}
                    checked={picked.has(entry.id)}
                    onChange={() =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (next.has(entry.id)) next.delete(entry.id);
                        else next.add(entry.id);
                        return next;
                      })
                    }
                  />
                )}
                <div className="card-row-main">
                  <div className="term-from">{entry.sourceText}</div>
                  {!entry.keepSource && <div className="term-to">→ {entry.targetText}</div>}
                </div>
                {entry.keepSource && <span className="chip chip-outline">원문 유지</span>}
              {entry.language && (
                <span className="chip chip-outline">{LANGUAGE_LABELS[entry.language]}일 때만</span>
              )}
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => openEditForm(entry)}
                  aria-label={`용어 수정: ${entry.sourceText}`}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => deleteEntry(entry)}
                  aria-label={`용어 삭제: ${entry.sourceText}`}
                >
                  🗑
                </button>
                </div>
              </div>
            ),
          )}
          </div>

          {formMode === 'add' && (
            <GlossaryForm
              title="새 용어 추가"
              draft={draft}
              onChange={setDraft}
              onSubmit={submitForm}
              onCancel={closeForm}
              error={formError}
              submitLabel="추가"
            />
          )}
        </>
      )}

      {scope === 'personal' && formMode === null && (
        <button type="button" className="button button-dashed" onClick={openAddForm}>
          + 용어 추가
        </button>
      )}
    </>
  );
}

/** 용어 추가/수정 인라인 폼. */
function GlossaryForm({ draft, onChange, onSubmit, onCancel, error, submitLabel, title }) {
  return (
    <div className="card glossary-form">
      {/* 🔴 추가 중에는 목록이 감춰지므로, **지금 무엇을 하는 중인지** 폼이 스스로 말해야 한다.
          수정은 목록 안에서 자리를 바꾸는 방식이라 제목이 필요 없다(`title` 없음). */}
      {title && <h3 className="card-label">{title}</h3>}
      <label className="form-label">
        원문
        <input
          type="text"
          className="form-input"
          value={draft.sourceText}
          onChange={(e) => onChange({ ...draft, sourceText: e.target.value })}
          placeholder="예: 배포"
        />
      </label>

      <label className="form-check">
        <input
          type="checkbox"
          checked={draft.keepSource}
          onChange={(e) => onChange({ ...draft, keepSource: e.target.checked })}
        />
        원문 유지 (번역하지 않고 그대로 둠)
      </label>

      {!draft.keepSource && (
        <>
          <label className="form-label">
            번역어
            <input
              type="text"
              className="form-input"
              value={draft.targetText}
              onChange={(e) => onChange({ ...draft, targetText: e.target.value })}
              placeholder="예: rollout"
            />
          </label>

          {/**
            * 🔴 **어느 언어로 쓸 때 적용할 것인가** (2026-08-16 사용자 승인 ④).
            *    이 칸이 없을 때는 `배포 → deployment` 하나가 **중국어 문장에도 그대로 박혔다.**
            *    항목에는 번역어가 하나뿐인데 프롬프트는 "나오면 그대로 쓰라"고 지시하기 때문이다.
            * 🔴 **기본은 「모든 언어」다** — 이미 등록한 용어가 전부 여기 해당하므로, 기본값을
            *    특정 언어로 두면 기존 용어집이 통째로 안 걸리게 된다.
            */}
          <p className="form-label">이 번역어를 쓸 언어</p>
          <div className="tag-row">
            <button
              type="button"
              className={!draft.language ? 'chip chip-on' : 'chip'}
              aria-pressed={!draft.language}
              onClick={() => onChange({ ...draft, language: null })}
            >
              모든 언어
            </button>
            {GLOSSARY_LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                className={draft.language === code ? 'chip chip-on' : 'chip'}
                aria-pressed={draft.language === code}
                onClick={() => onChange({ ...draft, language: code })}
              >
                {LANGUAGE_LABELS[code]}
              </button>
            ))}
          </div>
          <p className="meta">
            「모든 언어」로 두면 지금까지와 같아요. 중국어 팀과 영어 팀이 다른 낱말을 쓴다면 각각
            등록하세요 — 같은 원문을 언어별로 여러 개 둘 수 있어요.
          </p>
        </>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="button" className="button button-quiet" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="button button-primary" onClick={onSubmit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

/* ── 스니펫 (Spec 권장 10) ─────────────────────────────────────────────── */

/**
 * 스니펫 (S20 / Spec 권장 10 F-16).
 *
 * 🔴 "원클릭 재사용"의 실제 의미(한계 명시): 사이드패널은 호스트 페이지의 입력창에 직접 쓸 수
 *    없다(패널과 페이지는 다른 컨텍스트다). 그래서 **클립보드 복사**가 우리가 실제로 할 수 있는
 *    재사용이며, 그렇게 말한다 — "붙여넣기 하세요"를 숨기고 "적용됨"이라고 하면 거짓말이 된다.
 * 🔴 개별 삭제는 Zero Retention 단서 ③의 **조건**이다(`docs/ZeroRetention.md`) — 빼면 안 된다.
 */
/**
 * 접었다 펴는 섹션. 🔴 **제목 줄에 개수를 함께 보여준다** — 접힌 상태에서 "안에 뭐가 있는지"를
 * 모르면 매번 열어 봐야 해서, 접는 것이 오히려 비용이 된다.
 */
function FoldSection({ title, count = null, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="fold">
      <button
        type="button"
        className="fold-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="fold-title">
          {title}
          {count !== null && <span className="fold-count">{count}</span>}
        </span>
        <span className="fold-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}

/**
 * 보관함 — 용어집·저장 문구·예약 (S28 정리 / 2026-08-14 사용자 결정).
 *
 * 🔴 셋 다 **기존 컴포넌트를 그대로 감싸기만 한다.** 내용을 새로 쓰지 않는 것이 이 정리의 핵심이다 —
 *    동작하는 화면을 다시 만드는 건 새 가치가 아니라 재작업이고, 제출까지 남은 시간이 짧다.
 * 🔴 **기본은 전부 접힘.** 열어 두면 탭만 합치고 스크롤은 그대로여서 줄인 의미가 없다.
 */
function ArchiveTab({
  glossaryScope,
  onGlossaryScopeChange,
  snippets,
  onUseSnippet,
  onDeleteSnippet,
  reservations,
  onDeleteReservation,
  onToast,
}) {
  return (
    <>
      <FoldSection title="용어집">
        <GlossaryTab scope={glossaryScope} onScopeChange={onGlossaryScopeChange} onToast={onToast} />
      </FoldSection>

      <FoldSection title="저장 문구" count={snippets.length}>
        <SnippetsTab items={snippets} onUse={onUseSnippet} onDelete={onDeleteSnippet} />
      </FoldSection>

      <FoldSection title="예약 발송" count={reservations.length}>
        <ScheduleTab items={reservations} onDelete={onDeleteReservation} />
      </FoldSection>
    </>
  );
}

function SnippetsTab({ items, onUse, onDelete }) {
  return (
    <>
      <p className="hint">다듬은 문장을 저장해 다시 쓸 수 있어요. 이 기기에만 저장돼요.</p>
      {items.length === 0 ? (
        <p className="empty">아직 저장한 문장이 없어요. 다듬기 결과에서 「＋ 저장 문구」를 누르면 쌓여요.</p>
      ) : (
        items.map((snippet) => (
          <div key={snippet.id} className="card">
            <p className="snippet-text">{snippet.text}</p>
            <div className="card-head card-head-bare">
              <span className="meta">
                {snippet.useCount > 0 ? `${snippet.useCount}회 사용` : '아직 사용 안 함'}
              </span>
              <span className="tag-row">
                <button type="button" className="chip chip-orange" onClick={() => onUse(snippet)}>
                  복사
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onDelete(snippet.id)}
                  aria-label="저장 문구 삭제"
                >
                  🗑
                </button>
              </span>
            </div>
          </div>
        ))
      )}
    </>
  );
}

/* ── 프로필 — 소통 태그 + 학습 내역 (Spec 필수 9 · 권장 11) ───────────── */

function ProfileTab({
  items,
  onDelete,
  onClear,
  profile,
  onProfileChange,
  onboarding,
  onChangeMyLanguage,
  recipients = [],
  onToggleTag,
  onDeleteRecipient,
  onCreateRecipient,
  onUpdateRecipient,
  onNotice,
}) {
  const collabLabel = COLLAB_STYLES.find((item) => item.id === profile.collabStyleId)?.label ?? null;

  /**
   * 🔴 **접기를 「내 정보」 카드 하나로 올렸다** (2026-08-20 사용자 요청 ①③).
   *
   *    예전에는 **1순위 블록만** 따로 접혔다. 그래서 다 설정한 뒤에도 이름 입력칸 두 개와 언어
   *    칩 네 개가 계속 펼쳐져 있었고, 「설정을 마친 뒤에 필요한 건 이름과 말투 정도」라는 실제
   *    쓰임과 어긋났다.
   * 🔴 **중첩 접기를 만들지 않는다** — 카드가 접히는데 그 안에 또 접히는 블록이 있으면 「바꾸기」가
   *    무엇을 펼치는지 알 수 없다. 1순위의 개별 접기는 없앤다.
   *
   * 🔴 **판정표 — 표대로만 한다. 표에 없는 경우를 임의로 처리하지 않는다.**
   *    | 조건 | 기본 상태 | 요약 줄 |
   *    |---|---|---|
   *    | 이름 있음 **AND** 말투 정함 | 접힘 | `홍길동 · 백엔드 · 직접적으로` |
   *    | 그 밖 | **펼침** | — 설정해야 한다는 사실 자체를 숨기지 않는다 |
   *
   * 🔴 **「주로 쓰는 상황」은 판정에 넣지 않는다.** 선택 사항인데 이걸 조건에 넣으면, 안 고른
   *    사람에게는 카드가 **영영 펼쳐진 채**여서 접기가 아무 일도 하지 않는다.
   * 🔴 **직급·역할도 판정에 넣지 않는다** — 화면이 이미 「선택」이라고 쓰고 있다.
   */
  const [identity, setIdentityState] = useState({ displayName: '', jobTitle: '' });
  useEffect(() => {
    getIdentity().then(setIdentityState);
  }, []);
  const meChosen = !!identity.displayName && !!collabLabel;
  const [meOpen, setMeOpen] = useState(false);

  return (
    <>
      {/**
        * 🔴 **두 덩어리로 나눈다** (2026-08-16 사용자 지적 ⑨: "뭐가 많아").
        *    카드 5개가 평평하게 쌓여 있어서 무엇이 **나에 대한 설정**이고 무엇이 **상대에 대한
        *    정보**인지 구분되지 않았다. 성격이 다른 둘을 제목으로 갈라 놓으면, 찾을 때 절반만
        *    읽으면 된다. 카드를 지우거나 옮기지 않았다 — 순서와 그릇만 바꿨다.
        */}
      {/**
        * 🔴 **제목만 붙이는 건 정리가 아니었다** (2026-08-16 사용자 지적 ⑤: "너무 별로야").
        *    「나」 아래에 여전히 **카드 네 개**가 각자 테두리를 두르고 쌓여 있어서, 묶었다는 느낌은
        *    없고 제목 줄만 하나 늘었다. 덩어리로 보이게 하려면 **그릇을 하나로 합쳐야** 한다.
        * 🔴 그래서 카드 테두리를 벗기고 **한 카드 안의 구획**으로 넣는다 — 내용·순서·기능은
        *    그대로다(지우거나 옮기지 않았다). 상대 쪽은 항목이 늘어나는 목록이라 그대로 둔다.
        */}
      {/**
        * 🔴 **제목 「나」를 뺐다** (2026-08-16 사용자 요청 ④). 카드를 하나로 합쳐 놓으면 그
        *    덩어리가 「나에 대한 것」이라는 건 안의 항목들(내 이름·내 문체·내 상황)이 이미
        *    말한다 — 제목은 같은 말을 한 번 더 하면서 한 줄을 먹었다.
        *    🔴 **합친 카드 자체는 유지한다** — 그게 정리의 실체였고, 제목은 장식이었다.
        */}
      <section className="card profile-me">
        <div className="card-head card-head-bare">
          <h2 className="card-label">내 정보</h2>
          {meChosen && (
            <button type="button" className="link-button" onClick={() => setMeOpen((v) => !v)}>
              {meOpen ? '접기' : '바꾸기'}
            </button>
          )}
        </div>
        {meChosen && !meOpen && (
          <p className="card-text">
            <b>{identity.displayName}</b>
            {identity.jobTitle ? ` · ${identity.jobTitle}` : ''} · <b>{collabLabel}</b>
          </p>
        )}
        {(!meChosen || meOpen) && (
        <>
        <IdentityCard
          onNotice={onNotice}
          bare
          myLanguage={onboarding?.language ?? null}
          onChangeMyLanguage={onChangeMyLanguage}
          onSaved={setIdentityState}
        />

      {/**
        * 🔴 **「내 문체」를 제거했다** (2026-08-17 사용자 제안 → 검토 후 삭제 결정).
        *    ① Spec에 없다 — `docs/Spec.md`에 「문체」 언급이 **0건**이다(S30 Slack 연동의 대안으로
        *       들어온 기능이다).
        *    ② **재는 축이 1순위와 같다.** 문체 리포트는 「짧게 쓰는가 · 직접적인가」를 관측으로
        *       재는데, 바로 아래 1순위의 「선호하는 말투」가 **직접적으로/부드럽게/짧게**를
        *       사용자 선언으로 이미 갖고 있고 그 값은 프롬프트에 실린다.
        *    ③ Spec 필수 2는 **1순위가 항상 이긴다**고 못 박는다 → 관측값을 프롬프트에 실어도
        *       충돌하면 무시된다. 즉 연결해도 효과가 거의 없다.
        *    ④ 그런데 카드 문구(「교정할 때 쓴 내 원문으로 계산해요」)는 **교정에 반영되는 것처럼
        *       읽혔다** — 아무 일도 하지 않으면서 그렇게 보이는 것이 가장 나쁘다.
        *    남기고 연결(ⓐ)하는 대신 **지운다.** 화면이 줄고 오해가 사라진다.
        */}

      {/* Spec 필수 2 1순위 — 사용자가 직접 고른 상황 템플릿·협업 성향. 항상 100% 반영된다. */}
      <div className="profile-block">
        {/**
          * 🔴 **정하고 나면 요약으로 접는다** (2026-08-16 사용자 요청 ③). 이 값은 **한 번 정하고
          *    거의 안 바꾸는 것**인데, 칩 7개가 프로필 탭의 큰 자리를 계속 차지했다.
          * 🔴 **정하지 않았으면 펼친 채로 둔다** — 접어 두면 설정해야 한다는 사실 자체가 숨는다.
          *    (교정에 항상 100% 반영되는 값이라 비워 두면 손해다 — Spec 필수 2 1순위)
          */}
        <h3 className="card-label">1순위 — 내 상황 · 협업 성향</h3>
        {/**
          * 🔴 **「주로 쓰는 상황」은 지우지 않는다** (2026-08-20 사용자 확인 ② — "필요 없으면 숨겨").
          *    확인해 보니 **교정에 실제로 실린다**: `buildProfileForRefine()`가 `situation.hint`를
          *    만들고 `core/refine/prompt.js:321`이 그것을 **1순위 규칙**으로 넣는다(Spec 필수 2).
          *    화면에서 빼면 이미 고른 사람의 값이 계속 프롬프트에 실리는데 **어디서도 확인할 수
          *    없게 된다** — 지우는 대신 접기 안으로 넣는다.
          */}
        <p className="field-label">주로 쓰는 상황</p>
        <div className="tag-row">
          {SITUATION_TEMPLATES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={profile.situationId === item.id ? 'chip chip-on' : 'chip'}
              aria-pressed={profile.situationId === item.id}
              onClick={() =>
                onProfileChange({ situationId: profile.situationId === item.id ? null : item.id })
              }
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="field-label">선호하는 말투</p>
        <div className="tag-row">
          {COLLAB_STYLES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={profile.collabStyleId === item.id ? 'chip chip-on' : 'chip'}
              aria-pressed={profile.collabStyleId === item.id}
              onClick={() =>
                onProfileChange({
                  collabStyleId: profile.collabStyleId === item.id ? null : item.id,
                })
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/**
        * 🔴 **2순위 블록도 접기 안에 넣는다** (2026-08-20 사용자 지적 ①).
        *    비어 있을 때 이 블록은 **설명 두 줄뿐**이다 — 접힌 카드에서 「홍길동 · 백엔드 ·
        *    직접적으로」 한 줄보다 **더 큰 자리**를 차지하면서 아무 정보도 주지 않았다.
        *    쌓인 뒤에도 매일 볼 값이 아니라 가끔 확인·삭제하는 목록이다.
        * 🔴 **지우지는 않는다** — 왜 비어 있고 어떻게 채우는지는 계속 말해야 한다(아래 원 주석).
        */}
      {/**
        * 🔴 **비어 있으면 한 줄로 접는다** (2026-08-16 ⑨). 학습 전에는 이 블록이 「빈 목록 +
        *    긴 설명 문단」으로 **화면의 4분의 1**을 먹으면서 아무 정보도 주지 않았다.
        *    지우지는 않는다 — 왜 비어 있고 어떻게 채우는지는 계속 말해야 한다.
        */}
      {items.length === 0 ? (
        <div className="profile-block">
          <h3 className="card-label">2순위 — AI가 학습한 내 수정 패턴</h3>
          <p className="meta">
            아직 없어요. 교정 팝업에서 문장을 직접 고쳐 적용하면 {LEARNING_THRESHOLD}회부터 쌓여요.
          </p>
        </div>
      ) : (
      <div className="profile-block">
      <div className="card-head card-head-bare">
        <h3 className="card-label">2순위 — AI가 학습한 내 수정 패턴</h3>
        <button type="button" className="link-button" onClick={onClear}>
          전체 삭제
        </button>
      </div>

      {(
        items.map((item) => (
          <div key={item.id} className="card card-row">
            <span className="card-row-main learned-text">
              {item.text} ({item.count}회)
              {/* 과도기 규칙이 지금 이 항목에 걸려 있는지 그대로 보여준다 — 숨기지 않는다. */}
              {item.count < LEARNING_THRESHOLD && (
                <span className="meta"> · {LEARNING_THRESHOLD - item.count}회 더 쌓이면 반영돼요</span>
              )}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => onDelete(item.id)}
              aria-label={`학습 내역 삭제: ${item.text}`}
            >
              🗑
            </button>
          </div>
        ))
      )}

      {/* Spec 필수 2 과도기 규칙 — 3회 미만이면 1순위만 100% 반영. */}
      <p className="meta">
        {LEARNING_THRESHOLD}회 이상 축적된 패턴만 교정에 반영돼요 (2순위). 1순위는 항상 내 상황
        템플릿 · 협업 성향이에요. 국가·문화권 특성은 교정에 쓰지 않아요.
      </p>
      </div>
      )}
      </>
      )}
      </section>

      <RecipientSection
        recipients={recipients}
        onToggleTag={onToggleTag}
        onDelete={onDeleteRecipient}
        onCreate={onCreateRecipient}
        onUpdate={onUpdateRecipient}
        onNotice={onNotice}
      />
    </>
  );
}

/* ── 수신자 소통 가이드 (S17 / Spec 필수 9 F-07 · audit 2) ─────────────── */

/**
 * 🔴 **숫자 점수·등급을 표시하지 않는다** (필수 9 G1/G2). 사람에 대한 정보는 고정 집합의 서술형
 *    태그뿐이며, 태그는 **사용자가 직접 지정한 것만**이다(행동 데이터 자동 추론 없음 — 근거가 될
 *    데이터 소스가 아직 없다).
 * 🔴 필수 9가 요구하는 **열람·수정·비공개** 세 권리를 이 화면이 전부 제공한다.
 */
/**
 * S22 — GitHub 연결 (Device Flow). 🔴 연결은 **선택**이다: 공개 데이터는 연결 없이도 읽히고,
 * 토큰은 시간당 한도(60 → 5,000)를 올리는 용도뿐이다. 그래서 문구를 "로그인"이 아니라
 * "한도 늘리기"로 쓴다 — 권한을 주는 것처럼 보이게 하면 거짓말이 된다.
 */
/**
 * 🔴 **2026-08-19부터 화면에 붙어 있지 않다** (사용자 결정 ⓐ — 위 `AccountCard`의 제거 주석에
 *    이유 전체가 있다). **지우지 않은 것은 의도다** — IP 공유 망에서 GitHub 한도(시간당 60)에
 *    막히는 사용자가 생기면 `AccountCard`에 `<GitHubLinkRow />` 한 줄만 되살리면 된다.
 *    번들에는 들어가지 않는다(참조가 없어 트리셰이킹된다).
 */
function GitHubLinkRow({ onNotice }) {
  const [linked, setLinked] = useState(false);
  const [flow, setFlow] = useState(null);
  const [busy, setBusy] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    getStoredToken().then((token) => setLinked(Boolean(token)));
  }, []);

  const connect = async () => {
    setBusy(true);
    cancelledRef.current = false;
    try {
      const started = await startDeviceFlow();
      setFlow(started);
      // 🔴 코드를 클립보드에 넣고 페이지를 열어 준다 — 8자리를 손으로 옮겨 적게 하지 않는다.
      await navigator.clipboard?.writeText(started.userCode).catch(() => {});
      chrome?.tabs?.create?.({ url: started.verificationUri });

      const token = await pollForToken(started, { isCancelled: () => cancelledRef.current });
      await storeToken(token);
      setLinked(true);
      onNotice('GitHub를 연결했어요 — 요청 한도가 늘었어요');
    } catch (error) {
      onNotice(errorMessage(error?.reason, error?.detail));
    } finally {
      setFlow(null);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await clearToken();
    setLinked(false);
    onNotice('GitHub 연결을 해제했어요');
  };

  if (flow) {
    return (
      <div className="card">
        <p className="card-label">GitHub에 이 코드를 입력해 주세요</p>
        {/* 흐름 중에는 로고를 반복하지 않는다 — 지금 필요한 정보는 코드와 다음 행동이다. */}
        <p className="github-code">{flow.userCode}</p>
        <p className="meta">
          클립보드에 복사했어요. 열린 탭({flow.verificationUri})에 붙여넣고 승인하면 자동으로
          이어져요.
        </p>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            cancelledRef.current = true;
          }}
        >
          취소
        </button>
      </div>
    );
  }

  return (
    <div className="service-row">
      <span className="service-mark">
        <GitHubMark />
      </span>
      <span className="service-main">
        <span className="service-name">GitHub</span>
        {/* 🔴 「로그인」이라고 쓰지 않는다 — 권한을 주는 것이 아니라 조회 한도를 올리는 연결이다.
            스코프를 요청하지 않으며 공개 데이터만 읽는다(S22 결정). */}
        <span className="meta">
          {linked ? '연결됨 — 공개 활동 조회 한도가 늘어난 상태예요' : '로그인이 아니에요 · 공개 활동 조회 한도만 올려요'}
        </span>
      </span>
      <button
        type="button"
        className={linked ? 'chip' : 'chip chip-on'}
        disabled={busy}
        onClick={linked ? disconnect : connect}
      >
        {busy ? '…' : linked ? '해제' : '연결'}
      </button>
    </div>
  );
}

function RecipientTags({ person, onToggleTag }) {
  const [editing, setEditing] = useState(false);
  const attached = RECIPIENT_TAGS.filter((tag) => (person.tagIds ?? []).includes(tag.id));
  const shown = editing ? RECIPIENT_TAGS : attached;

  return (
    <>
      {shown.length === 0 ? (
        <p className="meta">아직 붙인 태그가 없어요.</p>
      ) : (
        <div className="tag-row">
          {shown.map((tag) => {
            const on = (person.tagIds ?? []).includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                className={on ? 'chip chip-on' : 'chip'}
                aria-pressed={on}
                // 편집 중이 아닐 때도 눌러서 뗄 수 있다 — 붙은 것만 보이므로 오작동 여지가 없다.
                onClick={() => onToggleTag(person.id, tag.id)}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
      )}
      <button type="button" className="link-button" onClick={() => setEditing((v) => !v)}>
        {editing ? '접기' : '태그 고르기'}
      </button>
    </>
  );
}

/** 수신자 폼의 빈 값. 🔴 추가와 편집이 **같은 폼**을 쓰므로 초기값 모양이 하나여야 한다. */
const EMPTY_RECIPIENT = {
  // 🔴 제안에서 고른 태그가 여기 쌓였다가 저장에 실린다(④).
  tagIds: [],
  name: '',
  timeZone: '',
  countryCode: '',
  githubLogin: '',
  register: null,
  language: null,
  /**
   * 🔴 **기본은 「개인」이다** (2026-08-19 사용자 결정 ③).
   *    새로 등록하는 상대가 «어느 팀 일인지»는 우리가 알 수 없다. 활성 팀을 기본으로 넣으면
   *    **외부 고객·파트너에게도 팀 내부 용어가 실린다** — 이 제품이 전제하는 상황이 정확히
   *    「다른 나라 기업과의 협업」이라 그 실수가 잦을 수밖에 없다. 팀 용어가 필요하면
   *    고르는 쪽이, 필요 없는데 실리는 쪽보다 낫다.
   */
  teamId: PERSONAL_TEAM_ID,
};

/**
 * 수신자 입력 폼 — **추가와 편집이 같은 폼이다** (2026-08-16 사용자 요청 ③).
 *
 * 🔴 **미리 등록한 사람도 고칠 수 있어야 한다.** 예전에는 태그·비공개·삭제만 가능해서,
 *    지역이나 언어를 잘못 넣었으면 **지우고 다시 만드는 것이 유일한 경로**였다 — 그러면 붙여
 *    둔 태그가 전부 날아간다. 언어·팀은 교정 결과를 바꾸는 값이라 특히 고칠 수 있어야 한다.
 * 🔴 **폼을 복제하지 않는다.** 추가용과 편집용을 따로 두면 한쪽에만 필드가 추가되는 사고가
 *    난다(이 파일에서 이미 겪은 종류의 문제다).
 */
function RecipientForm({ initial, personalTeams, activeTeamId, submitLabel, onSubmit, onCancel }) {
  const [draft, setDraft] = useState(initial);

  /**
   * 🔴 **화면에 보이는 값을 실제 값으로 만든다** (2026-08-19).
   *
   *    **옛 기록(teamId=null)은 「지금 실제로 쓰이는 값」으로 채운다** (2026-08-19 자체 점검
   *    수정). 처음에는 무조건 「개인」으로 채웠는데 그건 틀렸다 — null인 사람은 교정에서
   *    **활성 팀** 용어를 받고 있고, 다듬기 팝업도 활성 팀으로 보여준다. 폼만 「개인」이라고
   *    말하면 ① 같은 사람이 화면마다 다른 팀으로 보이고 ② 이름만 고치고 저장해도 그 사람의
   *    팀 용어가 **조용히 꺼진다.** 실제 동작을 그대로 보여주고, 저장하면 그 값이 명시된다.
   * 🔴 새 사람은 여기 걸리지 않는다 — `EMPTY_RECIPIENT`와 저장 계층(`addRecipient`)이
   *    「개인」을 이미 보증한다.
   * 🔴 이미 정해 둔 사람은 건드리지 않는다(`draft.teamId != null`이면 그대로).
   */
  useEffect(() => {
    if (draft.teamId != null) return;
    setDraft((current) =>
      current.teamId != null
        ? current
        : { ...current, teamId: activeTeamId ?? PERSONAL_TEAM_ID },
    );
  }, [draft.teamId, activeTeamId]);
  const [looking, setLooking] = useState(false);
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  /**
   * GitHub 공개 활동에서 온 태그 제안. `null` = 아직 조회하지 않음.
   * 🔴 **2026-08-16 — 이 줄이 빠져서 사이드패널이 통째로 하얗게 됐다.** `suggested`를 쓰는
   *    JSX만 넣고 선언을 못 넣었고, `npm run build`는 **선언되지 않은 식별자를 오류로 보지
   *    않는다**(번들러는 전역일 수도 있다고 본다). 그래서 빌드는 통과했고 렌더 순간
   *    `ReferenceError`로 React 트리 전체가 내려갔다 — 편집을 누르면 빈 화면.
   * 🔴 교훈: **"빌드 통과"는 이 종류의 결함에 대해 아무 보증도 하지 않는다.**
   */
  const [suggested, setSuggested] = useState(null);
  // 🔴 지역 선택이 언어를 채웠다는 사실을 화면이 말해야 한다 — 조용히 바뀌면 왜 그 언어인지 모른다.
  const [autoLang, setAutoLang] = useState(false);

  /**
   * GitHub 아이디로 이름을 채운다.
   * 🔴 **덮어쓰지 않는다** — 이미 이름을 쓰고 있으면 그대로 둔다. 사용자가 친 것을 우리가
   *    지우면 "왜 바뀌지"가 된다.
   */
  /**
   * 🔴 **아이디 하나로 이름 + 태그 제안까지 한 번에** (2026-08-16 사용자 요청 ④).
   *    예전에는 「불러오기」가 **이름만** 가져왔고, 태그 제안은 사람을 등록한 **뒤** 카드에서
   *    따로 눌러야 했다 — 같은 아이디를 두 번 치고 두 번 기다리는 구조라 사실상 안 쓰였다.
   * 🔴 **자동으로 붙이지는 않는다**(Spec 필수 9). 근거와 함께 보여주고 **사용자가 누른 것만**
   *    저장에 실린다. "바로 적용"은 「조회가 바로 된다」는 뜻이지 「우리가 대신 정한다」가 아니다.
   * 🔴 **분석이 실패해도 이름은 남긴다** — 태그는 곁다리고, 이름을 못 채우면 폼 자체가 헛수고다.
   */
  const lookup = async () => {
    setLooking(true);
    setHint('');
    setSuggested(null);
    try {
      const profile = await fetchUserProfile(draft.githubLogin);
      setDraft((current) => ({ ...current, name: current.name.trim() || profile.name }));
      /**
       * 🔴 **없는 정보는 말하지 않는다** (2026-08-19 사용자 요청 ②). 예전에는 위치 칸이 비어
       *    있으면 「GitHub에 위치 정보가 없어요」를 띄웠는데, 이건 **사용자가 할 일이 없는
       *    소식**이다. 지역은 어차피 아래에서 직접 고르는 값이라, 있든 없든 다음 행동이 같다.
       *    화면에는 **가져온 것만** 남긴다.
       */
      setHint(
        profile.locationHint
          ? `GitHub 위치: "${profile.locationHint}" — 참고만 하세요. 지역은 아래에서 직접 고르셔야 정확해요.`
          : '',
      );
      try {
        const events = await fetchPublicEvents(draft.githubLogin);
        // 🔴 `events`는 여기서만 산다 — 저장되지 않는다(Zero Retention).
        const outcome = analyzePublicActivity(events, { timeZone: draft.timeZone || null });
        setSuggested(outcome);
        /**
         * 🔴 **제안은 기본으로 켜 둔다** (2026-08-19 사용자 결정 ②). 판정표를 통과한 것만
         *    올라오는데(공개 글 15건 이상 + 규칙 충족), 매번 세 개를 다시 누르게 하는 것은
         *    **같은 판단을 사람에게 두 번 시키는 일**이다. 대부분 그대로 쓴다.
         * 🔴 **자동 «저장»이 아니다** (Spec 필수 9). 화면에 켜져 보이고, 아니면 눌러서 끄고,
         *    저장을 눌러야 들어간다 — 사용자가 확인할 기회가 남아 있다.
         * 🔴 이미 붙어 있던 태그는 건드리지 않는다(편집 화면) — 합집합으로만 더한다.
         */
        if (outcome.suggestions.length > 0) {
          setDraft((current) => {
            const ids = new Set(current.tagIds ?? []);
            for (const item of outcome.suggestions) ids.add(item.tagId);
            return { ...current, tagIds: [...ids] };
          });
        }
      } catch (caught) {
        setSuggested({ suggestions: [], skipped: 'error', message: errorMessage(caught?.reason, caught?.detail) });
      }
    } catch (caught) {
      setHint(errorMessage(caught?.reason, caught?.detail));
    } finally {
      setLooking(false);
    }
  };

  const submit = async () => {
    setError('');
    try {
      await onSubmit(draft);
    } catch (caught) {
      // 🔴 저장 실패를 폼 안에서 말한다 — 폼이 닫히면 무엇이 틀렸는지 볼 자리가 없다.
      setError(caught?.message ?? '저장하지 못했어요');
    }
  };

  return (
    <div className="card">
      {/**
        * 🔴 **GitHub 아이디로 채울 수 있는 것은 이름뿐이다** (2026-08-14 사용자 요청 검토 결과).
        *    GitHub `location`은 자유 텍스트라(`"Berlin, Germany"`·`"서울"`·`"Earth"`·빈 값)
        *    IANA 타임존으로 바꾸는 신뢰할 규칙이 없다. 억지로 매핑하면 **회의 시간 추천이
        *    통째로 틀린다** — 그 기능은 타임존이 정확하다는 전제 위에 있다.
        *    그래서 location은 **힌트로만** 보여주고 지역은 사용자가 목록에서 고른다.
        */}
      <div className="github-suggest-form">
        <input
          className="form-input"
          placeholder="GitHub 아이디 (선택)"
          value={draft.githubLogin}
          onChange={(event) => setDraft({ ...draft, githubLogin: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.githubLogin.trim()) lookup();
          }}
        />
        <button
          type="button"
          className="button"
          disabled={looking || !draft.githubLogin.trim()}
          onClick={lookup}
        >
          {looking ? '찾는 중…' : '불러오기'}
        </button>
      </div>
      {hint && <p className="meta">{hint}</p>}

      <input
        className="form-input"
        placeholder="이름"
        value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />

      {/* 🔴 제안이 있을 때만. 근거 문구를 **같이** 보여준다 — 근거 없이 누르는 버튼은 만들지 않는다. */}
      {suggested && (
        <div className="github-suggest">
          {suggested.suggestions.length === 0 ? (
            <p className="meta">{suggested.message || '제안할 태그를 찾지 못했어요.'}</p>
          ) : (
            <>
              {/**
                * 🔴 **문구를 바꿨다** (2026-08-19 사용자 지적 ②). 「맞는 것만 눌러 주세요」는
                *    누르는 순간 무언가 «일어난다»고 읽히는데, 실제로는 **저장할 때 반영**된다.
                *    그래서 눌러도 아무 변화가 없다고 느껴졌다(선택 표시가 없던 것도 겹쳤다).
                *    이제 화면이 **언제 반영되는지**를 말한다.
                */}
              <p className="meta">
                태그 제안 · 고른 것은 <b>저장할 때</b> 반영돼요
              </p>
              {suggested.suggestions.map((item) => {
                const picked = (draft.tagIds ?? []).includes(item.tagId);
                return (
                  <button
                    key={item.tagId}
                    type="button"
                    className={picked ? 'chip chip-on github-suggest-item' : 'chip github-suggest-item'}
                    aria-pressed={picked}
                    onClick={() =>
                      setDraft((current) => {
                        const ids = current.tagIds ?? [];
                        return {
                          ...current,
                          tagIds: ids.includes(item.tagId)
                            ? ids.filter((id) => id !== item.tagId)
                            : [...ids, item.tagId],
                        };
                      })
                    }
                  >
                    {/* 🔴 색만으로 상태를 알리지 않는다 — 고른 것에는 표식을 붙인다. */}
                    {picked && (
                      <span className="github-suggest-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                    {tagLabel(item.tagId)} · <span className="meta">{item.evidence}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

      {/**
        * 🔴 **이 사람과는 어느 팀 일을 하는가** — 교정에 실릴 **팀 용어집**을 정한다.
        *
        * 🔴 **팀이 하나여도 낸다** (2026-08-19 사용자 요청 ②). 예전 조건은 `> 1`이라 팀이
        *    하나인 사용자에게는 **설정할 자리가 화면에 아예 없었다.** 그런데 팀이 하나여도
        *    「이 사람과는 팀 일이 아니다」(외부 파트너·개인적인 상대)를 표현할 필요가 있다 —
        *    그게 「개인」 항목이고, 없으면 팀 용어가 그 사람에게도 계속 실린다.
        *
        * 🔴 **칩 → 드롭다운** (2026-08-19 요청 ⑤). 팀이 늘면 칩이 줄을 넘어가며 폼이 길어지고,
        *    무엇보다 칩은 **여러 개를 켤 수 있어 보인다** — 실제로는 하나만 고르는 값이다.
        *    드롭다운은 「하나만」이 모양으로 드러나고 개수가 늘어도 높이가 그대로다.
        */}
      <p className="field-label">이 사람과 하는 일의 팀</p>
      {/**
        * 🔴 **「정하지 않음」을 없앴다** (2026-08-19 사용자 지적 ③).
        *
        *    그 항목은 「활성 팀의 용어를 쓴다」는 뜻이었다. 즉 **화면에는 아무 팀도 안 적혀
        *    있는데 실제로는 어떤 팀의 용어가 실리고**, 팀 탭에서 활성 팀을 바꾸면 이 사람에게
        *    실리는 용어도 **말없이 따라 바뀌었다.** 고른 것과 쓰이는 것이 다른 상태다.
        *
        * 🔴 대신 폼을 열 때 **지금 실제로 쓰이는 값**(활성 팀, 팀이 없으면 「개인」)을 골라
        *    둔 채로 보여준다. 저장하면 그 값이 명시적으로 남아, 나중에 활성 팀을 바꿔도
        *    이 사람의 교정은 흔들리지 않는다.
        * 🔴 옛 기록(값이 비어 있는 사람)은 그대로 둔다 — 교정 쪽은 여전히 활성 팀으로 해석하고
        *    (`refineClient`의 팀 판정표), 이 폼을 한 번 저장하는 순간 명시값으로 바뀐다.
        */}
      <select
        className="form-input"
        value={draft.teamId ?? PERSONAL_TEAM_ID}
        aria-label="이 사람과 하는 일의 팀"
        onChange={(event) => setDraft({ ...draft, teamId: event.target.value || null })}
      >
        <option value={PERSONAL_TEAM_ID}>개인 (팀 용어 안 씀)</option>
        {personalTeams.map((item) => (
          <option key={item.teamId} value={item.teamId}>
            {item.name}
          </option>
        ))}
      </select>

      {/* 🔴 타임존과 국가를 **한 항목으로** 고른다 — 따로 고르면 Europe/Berlin + US 같은
          앞뒤 안 맞는 조합이 생긴다. 목록에 없는 지역의 직접 입력도 이 안에 있다(⑤). */}
      <p className="field-label">이 사람이 있는 지역</p>
      <RegionPicker
        timeZone={draft.timeZone}
        onPick={(region) =>
          setDraft((current) => {
            /**
             * 🔴 **판정은 `resolveLanguageOnRegionChange`가 한다** — 판정표와 근거는 그 함수의
             *    주석에 있고, `test/regions.unit.test.js`가 표대로 잠가 둔다. 화면 안에서
             *    조건식으로 두면 **편집에서만 틀리는 종류의 결함**(2026-08-17 실제 발생)을
             *    잡을 관문이 없다 — 렌더 테스트가 없기 때문이다.
             */
            const decided = resolveLanguageOnRegionChange({
              currentLanguage: current.language,
              currentTimeZone: current.timeZone,
              nextRegion: region,
            });
            setAutoLang(decided.auto);
            return {
              ...current,
              timeZone: region.timeZone,
              countryCode: region.countryCode ?? '',
              language: decided.language,
            };
          })
        }
      />

      {/**
        * 🔴 **국가코드는 목록 밖 지역을 실제로 골랐을 때만 낸다** (2026-08-16 ⑤).
        *    예전에는 아직 아무것도 안 고른 상태에서도 「직접 입력」·「국가코드」 칸이 같이 떠서,
        *    무엇을 해야 하는 화면인지 알 수 없었다. 목록에서 고른 지역은 국가코드가 이미 있다.
        * 🔴 **아직 비어 있을 때만** 낸다 — 직접 입력 화면에서 이미 넣었으면 같은 칸이 두 번
        *    나오면 안 된다. 이 자리는 예전에 국가코드 없이 저장한 사람을 **나중에 고치는** 통로다.
        * 🔴 비워 둬도 막지 않는다 — 없으면 공휴일 조회만 건너뛴다(등록은 된다).
        */}
      {draft.timeZone !== '' && !regionByTimeZone(draft.timeZone) && !draft.countryCode && (
        <input
          className="form-input"
          placeholder="국가코드 — 공휴일 조회용 (예: PT · 선택)"
          value={draft.countryCode}
          onChange={(event) => setDraft({ ...draft, countryCode: event.target.value })}
        />
      )}

      {/**
        * 🔴 **이 사람에게 쓸 언어** (2026-08-16). 예전에는 온보딩의 값 **하나**가 모든
        *    상대의 언어를 정해서, 여러 나라와 일하면 어느 쪽으로도 틀렸다. 언어는 사람마다
        *    다르므로 사람에 붙인다.
        */}
      <p className="field-label">이 사람에게 쓸 언어</p>
      <div className="tag-row">
        {RECIPIENT_LANGUAGES.map((code) => (
          <button
            key={code}
            type="button"
            className={draft.language === code ? 'chip chip-on' : 'chip'}
            aria-pressed={draft.language === code}
            onClick={() => {
              setAutoLang(false);
              setDraft({ ...draft, language: draft.language === code ? null : code });
            }}
          >
            {LANGUAGE_LABELS[code]}
          </button>
        ))}
      </div>
      {autoLang && (
        // 🔴 "그 지역 사람이 이 말을 쓴다"가 아니라 **"우리가 낼 수 있는 업무 언어"**라고 쓴다.
        <p className="meta">지역을 보고 골라 둔 기본값이에요 — 다르면 위에서 바꾸세요.</p>
      )}

      {/**
        * 🔴 **문체 칩을 여기서 없앴다** (2026-08-18 사용자 지적 ①). 프로필과 다듬기 패널
        *    **두 곳에서 같은 값을 정하는데 서로 반영되지 않았다** — 전역 저장값이 먼저라
        *    프로필에 정해 둔 값이 영영 안 쓰였다.
        * 🔴 이제 **다듬기 패널에서 고르면 그 사람에게 저장된다.** 다음에 같은 상대로 다듬으면
        *    그 값에서 시작한다. 정하는 자리가 하나뿐이라 어긋날 수 없다.
        */}

      {/* 🔴 국가코드는 공휴일 조회(S14)에만 쓰인다 — 성향 판단에 쓰지 않는다는 걸 명시한다. */}
      <p className="meta">지역은 시각 계산과 공휴일에만 써요. 성향 판단에는 쓰지 않아요.</p>
      {error && <p className="meta">{error}</p>}
      <div className="tag-row">
        <button type="button" className="button button-primary" onClick={submit}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            취소
          </button>
        )}
      </div>
    </div>
  );
}

function RecipientSection({
  recipients,
  onToggleTag,
  onDelete,
  onCreate,
  onUpdate,
  onNotice,
}) {
  const [personalTeams, setPersonalTeams] = useState([]);
  /**
   * 🔴 **활성 팀이 다시 필요해졌다** (2026-08-19 자체 점검 — 한 번 뺐다가 되돌린 자리다).
   *    새 사람의 기본값은 저장 계층이 「개인」으로 못 박았지만, **옛 기록(teamId=null)** 은
   *    실제로 활성 팀 용어를 받는다. 그 사람의 편집 폼이 「개인」을 보여주면 다듬기 팝업
   *    (활성 팀 표시)과 **같은 사람이 화면마다 다른 팀으로 보이고**, 이름만 고치고 저장해도
   *    팀 용어가 조용히 꺼진다. 폼은 **지금 실제로 쓰이는 값**을 보여야 한다.
   */
  const [activeTeamId, setActiveTeamId] = useState(null);
  useEffect(() => {
    listTeams().then(setPersonalTeams);
    getTeam().then((team) => setActiveTeamId(team?.teamId ?? null));
  }, []);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  /** 🔴 기본은 접힘(③). 「+ 추가」로 사람을 넣으면 바로 확인할 수 있게 자동으로 펼친다. */
  const [listOpen, setListOpen] = useState(false);

  return (
    // 🔴 1순위·2순위와 같은 카드 그릇에 담는다 — 카드 밖에 있으면 앞 블록의 꼬리로 읽힌다.
    <section className="card">
      <div className="card-head card-head-bare">
        <h2 className="card-label">내가 대화하는 사람들</h2>
        <button type="button" className="link-button" onClick={() => setAdding((on) => !on)}>
          {adding ? '취소' : '+ 추가'}
        </button>
      </div>

      {/**
        * 🔴 **설명 문단을 없앴다** (2026-08-19 사용자 요청 ①). 원래는 Spec 필수 9의 「대상자
        *    본인의 열람·수정·비공개 권리」를 화면 글로 해명한 것이었는데, **읽는 사람이 할 일이
        *    하나도 없는 문장**이라 목록 위에서 자리만 차지했다. 권리는 문장이 아니라 **동작**으로
        *    보장한다 — 편집(수정) · 🗑(삭제) · 비공개 버튼이 카드마다 그대로 있다.
        *    숫자 점수를 만들지 않는다는 것도 **코드가 지키는 사실**이지 안내문으로 지킬 일이 아니다.
        */}

      {/* 🔴 GitHub 연결 줄은 **설정 → 연결된 서비스**로 옮겼다(2026-08-15) — 로그인·연결을 한
          곳에서 보게 해 달라는 요청. 여기에 남겨 두면 같은 스위치가 두 곳에 생긴다. */}

      {adding && (
        <RecipientForm
          initial={EMPTY_RECIPIENT}
          personalTeams={personalTeams}
          activeTeamId={activeTeamId}
          submitLabel="저장"
          onCancel={() => setAdding(false)}
          onSubmit={async (draft) => {
            await onCreate(draft);
            setAdding(false);
            // 🔴 방금 넣은 사람이 안 보이면 저장이 됐는지 알 수 없다 — 목록을 열어 준다.
            setListOpen(true);
          }}
        />
      )}

      {/**
        * 🔴 **처음에는 접어 둔다** (2026-08-16 사용자 요청 ③). 사람이 늘수록 카드가 그만큼
        *    쌓여 프로필 탭의 대부분을 차지했다 — 그런데 이 목록은 **자주 볼 것이 아니라
        *    가끔 고칠 것**이다. 몇 명인지만 보이면 평소에는 충분하다.
        * 🔴 등록된 사람이 없을 때는 접는 버튼을 내지 않는다 — 열어 봐야 빈 화면이다.
        */}
      {recipients.length > 0 && (
        <button type="button" className="link-button" onClick={() => setListOpen((v) => !v)}>
          {listOpen ? '목록 접기' : `목록 보기 (${recipients.length}명)`}
        </button>
      )}

      {recipients.length === 0 ? (
        <p className="empty">등록된 사람이 없어요.</p>
      ) : !listOpen ? null : (
        recipients.map((person) => (
          /**
           * 🔴 **사람마다 카드를 뚜렷하게 나눈다** (2026-08-18 사용자 지적 ②).
           *    예전에는 카드 테두리가 옅어서 **어디까지가 james이고 어디부터 mina인지**
           *    한눈에 안 보였다 — 특히 편집을 펼치면 폼이 길어져 경계가 묻혔다.
           */
          <div key={person.id} className="card person-card">
            <div className="card-head card-head-bare">
              <h3 className="card-label">
                {person.name}
                <span className="meta">
                  {' · '}
                  {/* 🔴 **도시만 보인다** (2026-08-19 요청 ③) — `America/Chicago`는 타임존
                      식별자이지 지명이 아니다. 나라·대륙은 고를 때 이미 봤다. */}
                  {regionCityLabel(person.timeZone)}
                  {/* 🔴 언어가 없으면 기본값으로 교정된다 — 그 사실을 화면이 말해야 한다. */}
                  {person.language ? ` · ${LANGUAGE_LABELS[person.language]}` : ' · 언어 미지정'}
                </span>
              </h3>
              <span className="recipient-actions">
                {/* 🔴 **편집 입구** (2026-08-16 ③) — 지우고 다시 만들면 태그가 날아간다. */}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setEditingId((id) => (id === person.id ? null : person.id))}
                >
                  {editingId === person.id ? '편집 닫기' : '편집'}
                </button>
                <button
                  type="button"
                  className="icon-button icon-button-danger"
                  onClick={() => onDelete(person.id)}
                  aria-label={`수신자 삭제: ${person.name}`}
                >
                  <TrashIcon />
                </button>
              </span>
            </div>

            {editingId === person.id && (
              <RecipientForm
                // 🔴 저장된 값으로 폼을 채운다 — 빈 폼이 뜨면 "덮어쓰기"가 아니라 "새로 만들기"다.
                initial={{
                  ...EMPTY_RECIPIENT,
                  name: person.name ?? '',
                  timeZone: person.timeZone ?? '',
                  countryCode: person.countryCode ?? '',
                  language: person.language ?? null,
                  register: person.register ?? null,
                  teamId: person.teamId ?? null,
                  githubLogin: person.githubLogin ?? '',
                  // 🔴 편집에서도 제안을 쓸 수 있어야 하므로 **실제 태그를 들고 시작한다.**
                  //    빈 배열로 두면 폼이 저장할 때 붙어 있던 태그를 지운다.
                  tagIds: person.tagIds ?? [],
                }}
                personalTeams={personalTeams}
                activeTeamId={activeTeamId}
                submitLabel="변경 저장"
                onCancel={() => setEditingId(null)}
                onSubmit={async (draft) => {
                  await onUpdate(person.id, draft);
                  setEditingId(null);
                }}
              />
            )}

            <RecipientTags person={person} onToggleTag={onToggleTag} />

            {/**
              * 🔴 **「GitHub 공개 활동에서 태그 제안 받기」를 없앴다** (2026-08-17 사용자 요청 ①).
              *    같은 일을 하는 입구가 **두 개**였다: 여기(카드 아래 링크)와 편집 폼의
              *    「불러오기」. 그런데 편집 폼 쪽이 **아이디 하나로 이름 + 태그 제안을 한 번에**
              *    가져오므로(2026-08-16 개선), 이 링크는 **같은 아이디를 다시 치고 다시 기다리는**
              *    열등한 경로만 남아 있었다.
              * 🔴 판정 로직(`core/github/rules.js`)과 제안 UI는 그대로 살아 있다 — 편집 폼 안에서
              *    쓰인다. 없앤 것은 **중복된 입구**뿐이다.
              */}

            {/**
              * 🔴 **비공개 버튼을 없앴다** (2026-08-19 사용자 결정 ①). 하는 일은 「태그를 지우지
              *    않은 채 교정에만 반영 안 하기」 하나뿐이었는데, **태그를 지우는 것과 결과가
              *    같아 보이는** 조작이라 카드마다 자리만 차지했다.
              * 🔴 **데이터 계층은 그대로 둔다** — `toRefinePayloadRecipient`의 `private` 분기와
              *    `recipients.js`의 필드·테스트는 살아 있다(`src/lib/recipients.js:277`).
              *    지운 것은 **화면의 입구**뿐이므로, 필요해지면 버튼만 되살리면 된다.
              *    Spec 필수 9의 「비공개 권리」는 지금 **태그 삭제**(🗑 · 태그 고르기)로 갈음한다.
              */}
          </div>
        ))
      )}
    </section>
  );
}
