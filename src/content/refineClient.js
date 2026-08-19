/**
 * 콘텐츠 스크립트 → background → `POST /v1/refine` 배관.
 *
 * 🔴 콘텐츠 스크립트가 LLM을 직접 부르지 않는다. API 키가 확장 번들에 들어가면 그 순간
 *    누구나 꺼내 쓸 수 있다 — 키는 서버(Functions)에만 있고, 확장은 자기 백엔드만 부른다.
 * 🔴 Zero Retention (Spec 필수 5): 원문은 요청으로만 흘러가고 어디에도 저장하지 않는다.
 *    이 파일은 본문을 `console`·`chrome.storage` 어디에도 쓰지 않는다.
 */

import { REFINE_ENDPOINT } from '../config.js';
import { listPersonalGlossary, toRefinePayloadGlossary } from '../lib/glossary.js';
// Spec §3 — 팀 용어집. 🔴 팀이 없으면 빈 배열이라 아무것도 달라지지 않는다.
import { listTeamGlossary, toRefinePayloadTeamGlossary } from '../lib/teamClient.js';
import { buildProfileForRefine } from '../lib/profile.js';
import {
  getSelectedRecipient,
  toRefinePayloadRecipient,
  PERSONAL_TEAM_ID,
} from '../lib/recipients.js';
import { buildCasualToneBlock } from '../core/meme/index.js';
import { getLocal, STORAGE_KEYS } from '../lib/storage.js';
import { getOnboarding, languagePairFrom } from '../lib/onboarding.js';
import { detectLanguage } from '../lib/detectLanguage.js';

/** background에 보내는 메시지 타입. */
export const REFINE_MESSAGE = 'sai:refine';

/**
 * 교정을 요청한다. background가 응답을 돌려준다.
 *
 * @param {object} request
 * @param {string} request.text 선택된 원문.
 * @param {'CRITICAL'|'NORMAL'|'LOW'|null} [request.userUrgency] 사용자 사전 선택 (Spec 필수 1).
 * @param {'en'|'zh'} [request.targetLanguage]
 * @returns {Promise<object>} `/v1/refine` 응답 형태.
 */
export async function requestRefine(request) {
  // S12 — 저장된 개인 용어집을 매 호출마다 실어 보낸다. 호출자가 이미 glossary를 넘겼으면
  // (예: 테스트) 그 값을 존중하고 덮어쓰지 않는다.
  /**
   * S12 + Spec §3 — 개인 용어집 **다음에** 팀 용어집을 붙인다.
   *
   * 🔴 우선순위는 배열 순서가 아니라 각 항목의 `scope`가 정한다(`core/refine/prompt.js`의
   *    `glossaryRules()`: personal > team > ai). 순서에 의존하면 모델이 뒤엣것을 먼저 읽는
   *    날 조용히 뒤집힌다.
   * 🔴 팀 조회가 실패해도 **개인 용어집으로 교정은 계속돼야 한다** — `listTeamGlossary()`가
   *    던지지 않고 빈 배열을 준다. 팀 서버 장애가 교정 기능을 멈추게 하지 않는다.
   */
  /**
   * 🔴 **팀 용어는 「이 수신자의 팀」 것을 쓴다** (2026-08-16 ⓐ). 예전에는 활성 팀 하나가
   *    모든 상대에 적용돼, 팀이 여럿이면 엉뚱한 팀 용어가 실렸다. 수신자에 팀이 없으면
   *    활성 팀으로 되돌아간다 — 팀이 하나인 사람에게는 아무것도 달라지지 않는다.
   */
  const selected = await getSelectedRecipient();
  // S13 — 프로필(1순위 설정 + 3회 이상 축적된 2순위 패턴). 과도기 규칙 적용은 이 함수 안에서
  // 끝난다: 3회 미만 카테고리는 애초에 빠져 나온다 (Spec 필수 2).
  const profile = request.profile ?? (await buildProfileForRefine());
  /**
   * S17 — 선택된 수신자. 🔴 **언어와 태그가 둘 다 여기서 나온다**(2026-08-16).
   * 🔴 비공개면 `toRefinePayloadRecipient`가 null을 주고 태그가 나가지 않는다 (필수 9).
   *    이름·국가코드도 실리지 않는다. 언어는 태그와 달리 비공개와 무관하다 — 어떤 언어로 쓸지는
   *    그 사람에 대한 판단이 아니라 문장을 만들 조건이다.
   */
  const selectedRecipient = selected;
  const recipient = request.recipient ?? toRefinePayloadRecipient(selectedRecipient);

  // S11 — 온보딩에서 고른 내 언어가 언어쌍의 출발점이 된다 (Spec 권장 9).
  const pair = languagePairFrom(await getOnboarding());
  /**
   * 🔴 **언어는 수신자에게서 온다** (2026-08-16 사용자 지적). 예전에는 온보딩의 「주 협업 지역」
   *    **하나**가 모든 상대의 언어를 정했다 — 여러 나라와 일하면 어느 쪽으로도 틀린다.
   *    언어는 사람마다 다르므로 사람에 붙는 것이 맞다. 수신자에 언어가 없으면(옛 데이터·미지정)
   *    온보딩 기본값으로 되돌아간다 — 갑자기 교정이 멈추면 안 된다.
   */
  const targetLanguage =
    request.targetLanguage ?? selectedRecipient?.language ?? pair.targetLanguage;

  /**
   * 🔴 **용어집은 언어를 정한 뒤에 만든다** (2026-08-16 ④). 항목에 언어가 붙으면서 어느 항목을
   *    실을지가 `targetLanguage`에 달렸다 — 그래서 이 블록이 언어 계산 **아래로** 내려왔다.
   *    언어를 모르는 상태에서 만들면 필터가 통째로 무력화된다(모를 때는 안 거른다).
   */
  /**
   * 🔴 **어느 팀의 용어를 실을 것인가** (2026-08-19 사용자 요청 ③). 값이 세 가지다:
   *
   * | `teamId` | 뜻 | 싣는 용어 |
   * |---|---|---|
   * | `PERSONAL_TEAM_ID` | 사용자가 **「개인」을 골랐다** | 팀 용어 **없음** |
   * | 팀 id 문자열 | 그 팀을 골랐다 | 그 팀의 용어 |
   * | `null` | 아직 안 정했다 | **활성 팀**의 용어(기존 동작) |
   *
   * 🔴 「개인」을 `null`로 저장하지 않는 이유가 여기 있다 — 같은 값이면 「개인」을 골라도
   *    활성 팀 용어가 계속 실려서 **화면과 결과가 어긋난다.**
   * 🔴 팝업이 넘긴 값(`request.teamId`)이 최우선이다. 그다음이 이 수신자에 기억해 둔 값이다.
   */
  const teamId = request.teamId ?? selected?.teamId ?? null;
  const teamEntries =
    teamId === PERSONAL_TEAM_ID ? [] : await listTeamGlossary({ teamId });

  const glossary =
    request.glossary ??
    [
      ...toRefinePayloadGlossary(await listPersonalGlossary(), targetLanguage),
      ...toRefinePayloadTeamGlossary(teamEntries, targetLanguage),
    ];
  /**
   * 문체 수위 — **하나의 눈금, 세 칸** (2026-08-18). `'casual' | 'formal' | null(기본)`.
   *
   * 🔴 예전에는 캐주얼(불리언)과 수신자별 격식이 **같은 축을 두 버튼**으로 나눠 갖고 있어서
   *    둘 다 켜지는 모순 상태가 있었다. 이제 값이 하나라 그 상태가 존재할 수 없다.
   * 🔴 저장된 값이 없으면 **이 수신자에 정해 둔 기본 위치**를 쓴다 — 고객사를 한 번 「격식」으로
   *    등록해 두면 매번 고르지 않아도 그 자리에서 시작한다.
   */
  /**
   * 🔴 **전역 저장을 없앴다** (2026-08-18 사용자 지적 ①). 예전에는
   *    `getLocal(REGISTER)`(전역) → `selectedRecipient.register`(사람별) 순으로 봤는데,
   *    **전역이 먼저라 한 번 고르면 그 값이 모든 상대에게 계속 따라붙었다.** 프로필에 정해 둔
   *    값은 영영 적용되지 않았고, 그래서 「프로필과 패널이 서로 적용이 안 된다」로 보였다.
   * 🔴 이제 문체는 **그 사람의 것**이다. 팝업에서 고르면 그 수신자 기록에 저장되고, 다음에
   *    같은 사람으로 다듬으면 그 값에서 시작한다. 사람이 바뀌면 그 사람의 값으로 바뀐다.
   */
  const register = request.register ?? selectedRecipient?.register ?? null;

  // S16 — 캐주얼일 때만 검수 표현이 실린다. 🔴 그 외에는 null이라 표현이 하나도 나가지 않는다.
  const casualTone = request.casualTone ?? buildCasualToneBlock(targetLanguage, register === 'casual');

  // S21 — 직전 대화 맥락 (Spec 권장 8). 🔴 꺼져 있으면 빈 배열이라 한 조각도 나가지 않는다.
  //    호출자(오버레이)가 DOM에서 모아 넘긴다 — 이 파일은 DOM을 모른다.
  const threadContext = (await getLocal(STORAGE_KEYS.THREAD_CONTEXT, true))
    ? request.threadContext ?? []
    : [];

  const payload = {
    sourceLanguage: pair.sourceLanguage,
    targetLanguage,
    referenceDate: new Date().toISOString().slice(0, 10),
    ...request,
    glossary,
    profile,
    recipient,
    casualTone,
    register,
    threadContext,
  };

  /**
   * 🔴 **어느 언어쌍으로 만든 결과인지 응답에 붙여 돌려준다** (2026-08-16 ⓑ).
   *    서버 응답에는 언어가 없는데, 화면은 「역번역이 내 언어로 왔는가」를 판정해야 한다
   *    (`core/refine/backcheck.js`). 언어를 정한 곳이 여기이므로 여기서 붙이는 것이 맞다 —
   *    화면이 다시 계산하면 온보딩·수신자를 또 읽어야 하고 두 값이 갈릴 수 있다.
   * 🔴 서버가 준 값을 덮지 않는다(`...response`가 나중) — 서버가 언젠가 실어 보내면 그쪽이 진실이다.
   */
  const withLanguages = (response) => ({
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    ...response,
  });

  // 확장 밖(개발 하네스)에는 chrome.runtime이 없다 — 프록시를 직접 부르고, 그마저 죽어 있으면
  // 목업으로 떨어진다. 하네스에서도 실제 LLM 출력을 볼 수 있어야 UI 검증이 의미를 갖는다.
  if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
    try {
      const response = await fetch(REFINE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) return withLanguages(await response.json());
    } catch {
      // 아래 목업으로.
    }
    return withLanguages(mockRefine(payload));
  }

  const response = await chrome.runtime.sendMessage({ type: REFINE_MESSAGE, request: payload });
  if (!response) throw new Error('background가 응답하지 않았습니다');
  return withLanguages(response);
}

/**
 * 수신 메시지 해독을 요청한다 (S10 / Spec 필수 10). 같은 엔드포인트를 `mode:"decode"`로 부른다.
 *
 * @param {object} request
 * @param {string} request.text 상대가 보낸 원문.
 * @param {'ko'|'en'|'zh'} [request.sourceLanguage] 생략 시 자동 추정.
 * @param {'ko'|'en'|'zh'} [request.targetLanguage] 해석을 보여줄 언어. 생략 시 'ko'.
 * @returns {Promise<object>}
 */
export async function requestDecode(request) {
  // 🔴 맥락 토글이 꺼져 있으면 한 조각도 나가지 않는다 (Spec 권장 8 — refine과 같은 규칙).
  const threadContext = (await getLocal(STORAGE_KEYS.THREAD_CONTEXT, true))
    ? request.threadContext ?? []
    : [];

  /**
   * 🔴 **해석을 보여줄 언어는 「내 언어」다** (2026-08-20 실측으로 잡음). 예전에는 `'ko'`가
   *    하드코딩돼 있어, 온보딩에서 「내 언어 = English」를 고른 사용자도 **뜻 풀기 결과가 항상
   *    한국어**로 나왔다. 코어는 en 타깃을 지원한다(같은 날 ko→en 실호출로 확인) — **배선만
   *    없었다.** 이 제품은 한국어 사용자 전용이 아니다.
   * 🔴 온보딩을 아직 안 한 사용자는 `languagePairFrom`이 `ko`를 준다(기존 기본값 유지).
   */
  const { sourceLanguage: myLanguage } = languagePairFrom(await getOnboarding());

  const payload = {
    mode: 'decode',
    sourceLanguage: detectLanguage(request.text),
    targetLanguage: myLanguage,
    ...request,
    threadContext,
  };

  if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
    try {
      const response = await fetch(REFINE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) return await response.json();
    } catch {
      // 아래 목업으로.
    }
    return mockDecode(payload);
  }

  const response = await chrome.runtime.sendMessage({ type: REFINE_MESSAGE, request: payload });
  if (!response) throw new Error('background가 응답하지 않았습니다');
  return response;
}

/**
 * 회신 초안 요청 (S37 / 2026-08-14 제안 ①). 해독 팝업에서 의도를 고르면 호출된다.
 *
 * 🔴 **목업 폴백이 없다.** decisions와 같은 이유이며 더 직접적이다 — 초안은 사용자가 그대로
 *    복사해 **상대에게 보내는** 문장이라, 준비된 예시가 자기 메시지에 대한 답으로 오인되면
 *    잘못된 내용이 실제로 전송된다. 백엔드가 죽어 있으면 실패 사실만 올린다(background도 동일).
 *
 * @param {object} request
 * @param {string} request.text 상대가 보낸 원문.
 * @param {'accept'|'schedule'|'clarify'} request.intent
 * @param {{question: string, answer: string}[]} [request.answers] 사전 질문 답변(없으면 자동 모드).
 * @param {'ko'|'en'|'zh'} [request.sourceLanguage] 원문 언어 = 회신을 쓸 언어. 생략 시 자동 추정.
 * @param {'ko'|'en'|'zh'} [request.targetLanguage] 역번역 언어. 생략 시 'ko'.
 */
export async function requestReply(request) {
  // 🔴 역번역은 **내가 확인하려고** 보는 칸이다 — 내 언어로 와야 확인이 성립한다(위 decode와 같은 이유).
  const { sourceLanguage: myLanguage } = languagePairFrom(await getOnboarding());

  const payload = {
    mode: 'reply',
    sourceLanguage: detectLanguage(request.text),
    targetLanguage: myLanguage,
    ...request,
  };

  if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
    const response = await fetch(REFINE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`http ${response.status}`);
    return await response.json();
  }

  const response = await chrome.runtime.sendMessage({ type: REFINE_MESSAGE, request: payload });
  if (!response) throw new Error('background가 응답하지 않았습니다');
  return response;
}

/**
 * 결정 요약 요청 (S25 / Spec 부가 7).
 *
 * 🔴 **목업 폴백이 없다.** refine·decode와 다른 점이다 — 결정 표는 "그 자리에 없던 사람"이
 *    읽는 것이라, 준비된 예시 표가 실제 대화의 결정으로 오인되면 교정 목업보다 훨씬 위험하다.
 *    백엔드가 죽어 있으면 **빈 표 + 실패 사실**을 그대로 올린다(코어 폴백과 같은 판단).
 */
export async function requestDecisions({ text }) {
  const payload = { mode: 'decisions', text };

  if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
    const response = await fetch(REFINE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`http ${response.status}`);
    return await response.json();
  }

  const response = await chrome.runtime.sendMessage({ type: REFINE_MESSAGE, request: payload });
  if (!response) throw new Error('background가 응답하지 않았습니다');
  return response;
}

/** 한글이 섞여 있으면 ko, 아니면 en. 정교한 감지가 아니라 기본값을 위한 최소 추정이다. */
/**
 * 🔴 **추정기를 `lib/detectLanguage.js`로 옮겼다** (2026-08-20). 여기 있던 한 줄
 *    (`한글이면 ko, 아니면 en`)이 **일본어·중국어를 영어로 위장**시켜 서버 검증을 통과시켰다 —
 *    400도 안 나고 화면도 멀쩡한데 모델에게만 거짓을 말하는, 가장 찾기 어려운 실패였다.
 *    판정표와 회귀 테스트가 필요한 로직이라 테스트 가능한 자리로 뺐다.
 */

/**
 * 🔴 **목업 어댑터 — S02(Firebase Functions) 배포 전까지의 임시 경로.**
 *    Functions가 뜨면 이 함수를 지우고 background가 실제 엔드포인트를 호출하게 바꾼다.
 *    반환 형태는 `src/core/refine/schema.js`의 계약과 동일하게 맞춰 두었다 — 교체 시
 *    화면 코드를 고칠 필요가 없다.
 *
 *    데이터는 [DS] 프로토타입 `Sai Prototype.dc.html`의 시나리오 고정값이며 전부 합성이다.
 */
export async function mockRefine({
  text,
  userUrgency = null,
  targetLanguage = 'en',
  threadContext = [],
}) {
  await new Promise((resolve) => setTimeout(resolve, 450)); // 체감 지연 재현

  const isVenting = /갈아엎|또 바꿨|답답|짜증|왜 자꾸/.test(text);
  const aiUrgency = isVenting ? 'NORMAL' : 'CRITICAL';

  const fixtures = {
    en: {
      refined: isVenting
        ? 'Heads-up: the API spec changed again and it affects our sprint scope. Could we sync on how to handle it?'
        : 'Hi Miguel, could you review PR #482 by tomorrow EOD? The release schedule depends on it — sorry for the tight timeline.',
      backTranslation: isVenting
        ? '알려드려요: API 스펙이 또 변경되어 이번 스프린트 범위에 영향이 있어요. 대응 방법을 같이 논의할 수 있을까요?'
        : '미겔, 내일 업무 마감 전까지 PR #482 리뷰해 주실 수 있을까요? 릴리즈 일정이 여기에 달려 있어요 — 촉박하게 드려 죄송해요.',
      glossary: isVenting ? ['API spec'] : ['PR #482', 'release schedule'],
      ticket: {
        problem: 'The API spec was changed without prior notice.',
        impact: 'Frontend timeline may slip by ~3 days.',
        request: 'Please share a changelog and give 24h notice before future spec changes.',
        concernLevel: '높음 — 반복된 변경에 대한 강한 피로감이 드러남',
      },
      ticketBackTranslation:
        '[문제점] API 스펙이 사전 공지 없이 변경됨 · [영향] 프론트 일정 약 3일 지연 · [요청] 변경 24시간 전 공지와 체인지로그 공유',
    },
    zh: {
      refined: isVenting
        ? '提醒一下：API 规范又更新了，会影响我们本周的排期。方便讨论一下应对方案吗？'
        : 'Miguel 您好，能否在明天下班前审核一下 PR #482？发布日程取决于它——时间紧迫，非常抱歉。',
      backTranslation: isVenting
        ? '알려드려요: API 스펙이 또 변경되어 이번 스프린트 범위에 영향이 있어요. 대응 방법을 같이 논의할 수 있을까요?'
        : '미겔, 내일 업무 마감 전까지 PR #482 리뷰해 주실 수 있을까요? 릴리즈 일정이 여기에 달려 있어요 — 촉박하게 드려 죄송해요.',
      glossary: isVenting ? ['API 规范'] : ['PR #482', '发布日程'],
      ticket: {
        problem: 'API 规范在没有提前通知的情况下被修改。',
        impact: '前端排期可能推迟约 3 天。',
        request: '请提供变更日志，并在修改规范前提前 24 小时通知。',
        concernLevel: '높음 — 반복된 변경에 대한 강한 피로감이 드러남',
      },
      ticketBackTranslation:
        '[문제점] API 스펙이 사전 공지 없이 변경됨 · [영향] 프론트 일정 약 3일 지연 · [요청] 변경 24시간 전 공지와 체인지로그 공유',
    },
  };

  const fixture = fixtures[targetLanguage] ?? fixtures.en;

  return {
    urgency: userUrgency ?? aiUrgency,
    urgencySource: userUrgency ? 'user' : 'ai',
    aiUrgency,
    urgencyReason: isVenting
      ? '통상적인 업무 공유이며 즉시 조치가 필요한 신호는 없습니다.'
      : '릴리즈 일정이 이 리뷰에 걸려 있고 마감이 내일로 명시되어 있습니다.',
    urgencyFallback: false,
    urgencyNotice: null,

    refined: fixture.refined,
    refinedReason: '요청을 명시적인 문장으로 바꾸고 과잉 사과를 1회로 줄였습니다.',
    preserved: [],
    misreadRisks: [],

    backTranslation: fixture.backTranslation,

    detectedIntent: isVenting ? 'venting' : 'normal',
    intentEvidence: isVenting ? '갈아엎어야 해요' : null,
    // 🔴 감정 신호가 없으면 ticket은 반드시 null이다 — 티켓 변환을 제안하지 않는다
    //    (오탐 방지, Lessons 자산 3 / 구 AC-058). `schema.js`도 같은 규칙을 강제한다.
    ticket: isVenting ? fixture.ticket : null,
    ticketBackTranslation: isVenting ? fixture.ticketBackTranslation : null,

    appliedGlossary: fixture.glossary.map((phrase, index) => ({
      id: `mock-${index}`,
      sourceText: phrase,
      appliedText: phrase,
    })),
    unregisteredHonorifics: [],

    // S21 — 목업도 실제 경로와 같은 계약을 지킨다(화면 코드가 분기하지 않게).
    threadContextCount: threadContext.length,

    fallback: false,
    fallbackReason: null,
    cached: false,

    /** 🔴 목업임을 화면이 알 수 있게 명시한다 — 실제 결과로 오인시키지 않는다 (Lessons #5). */
    mock: true,
  };
}

/**
 * 🔴 목업 어댑터 — decode 버전. `src/core/decode/schema.js` 계약과 동일한 형태.
 *    프로토타입 "수신 해독 팝업"의 고정 시나리오(Sarah → 나, F-11 예시)를 그대로 쓴다.
 */
export async function mockDecode({ text }) {
  await new Promise((resolve) => setTimeout(resolve, 450));

  const isMinorComments = /minor comments|사소한 코멘트/i.test(text ?? '');

  if (!isMinorComments) {
    // 시드에 없는 입력은 의도를 지어내지 않는다 — 원문만 직역 자리에 그대로 둔다.
    return {
      literalTranslation: text,
      actualIntent: '',
      intentEvidence: '',
      surfaceUrgency: 'NORMAL',
      actualUrgency: 'NORMAL',
      urgencyGap: false,
      requiredActions: [],
      recommendedReply: null,
      fallback: false,
      fallbackReason: null,
      cached: false,
      mock: true,
    };
  }

  return {
    literalTranslation:
      '업데이트 고마워요! 사소한 코멘트가 몇 개 있어요 — 시간 될 때 전체 접근 방식을 다시 볼 수도 있겠네요.',
    actualIntent: '"minor comments"지만 접근 방식 전면 재검토 요구일 가능성이 높아요.',
    intentEvidence: '"a few minor comments" — 완곡한 화법 패턴, 확신도 높음',
    surfaceUrgency: 'LOW',
    actualUrgency: 'CRITICAL',
    urgencyReason: '표면상 가벼운 코멘트로 읽히지만 접근 방식 재검토라는 실질적 요구가 담겨 있어요.',
    requiredActions: ['접근 방식 재검토안 준비', '오늘 중 1차 회신 (상대 오후 일정 고려)'],
    recommendedReply: 'clarify',
    fallback: false,
    fallbackReason: null,
    cached: false,
    mock: true,
  };
}
