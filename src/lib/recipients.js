/**
 * 수신자 소통 가이드 (S17 / Spec 필수 9 F-07 · audit 2 · Lessons #4·#8).
 *
 * 🔴 **숫자 점수 전면 금지 (필수 9 G1/G2)**: 이 파일은 점수·등급·순위·별점을 저장하지도, 계산하지도,
 *    표시용으로 만들지도 않는다. 사람에 대한 정보는 **고정 집합의 서술형 태그**뿐이다.
 * 🔴 **태그가 저장되는 경로는 「사용자가 눌렀다」 하나뿐이다.** 2026-08-16부터 GitHub 공개
 *    활동에서 **제안**을 받을 수 있지만(`core/github/rules.js` 판정표 6개), 제안은 근거 문구와
 *    함께 화면에 뜰 뿐 **자동으로 붙지 않는다** — 누르는 것은 사람이다(필수 9).
 *    「전부 적용」 버튼을 두지 않은 것도 같은 이유다: 근거를 안 읽고 누르는 버튼이 된다.
 * 🔴 **국가/문화권에서 태그를 유추하지 않는다** (필수 2 3순위 규칙과 같은 이유). `countryCode`는
 *    오직 공휴일 조회(S14 퇴근 요정)에만 쓰이며 성향 판단에 쓰이지 않는다.
 * 🔴 **비공개(private) 권리 (필수 9)**: `private: true`인 수신자의 태그는 프롬프트에 싣지 않는다.
 *    화면에는 본인 열람용으로 남되, LLM으로는 나가지 않는다.
 * 🔴 **수동 선택이 주 경로다** (Lessons #4): DOM에서 수신자를 자동 감지하는 범용 규칙은 성립하지
 *    않는다(사이트마다 마크업이 완전히 다름). 이 모듈은 자동 감지를 시도하지 않는다.
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

/**
 * 소통 태그 고정 집합 (Spec 필수 9 예시 문구를 그대로 씀).
 * `hint`는 프롬프트에 실리는 영어 지시문 — 값 자체는 payload 필드로만 나간다(주입 방어).
 */
export const RECIPIENT_TAGS = [
  /**
   * 🔴 **「오전 응답 빠름」을 뺐다** (2026-08-19 사용자 결정 ①).
   *
   *    이 태그만 성격이 달랐다 — 나머지 다섯은 「**어떻게 쓸지**」인데 이것은 「**언제 답이
   *    오는가**」다. 프롬프트에 실어도 **교정 문장이 달라질 여지가 없었다**(모델이 "아침에
   *    답하는 사람이니 이렇게 쓰자"로 바꿀 근거가 없다). 붙여도 아무 변화가 없는 태그는
   *    "이 기능이 되는 건가"를 만든다.
   * 🔴 그 정보가 버려지는 것은 아니다 — 상대의 시간대는 **듀얼 시계·퇴근 요정·회의 시간
   *    추천**이 실제 타임존으로 계산한다. 그쪽이 훨씬 정확하다.
   * 🔴 이미 이 태그를 붙여 둔 사람이 있어도 조용히 무시된다(id로 조회해 없으면 건너뛴다) —
   *    저장물을 건드리지 않는다.
   */
  {
    id: 'prefers-direct',
    label: '직접적 표현 선호',
    hint: 'This recipient prefers direct, explicit phrasing over indirect hints.',
  },
  {
    id: 'prefers-short',
    label: '짧은 메시지 선호',
    hint: 'This recipient prefers short messages with minimal preamble.',
  },
  {
    id: 'prefers-context',
    label: '배경 설명 선호',
    hint: 'This recipient prefers a brief statement of context before the request.',
  },
  {
    id: 'async-friendly',
    label: '비동기 소통 선호',
    hint: 'This recipient prefers asynchronous updates over real-time interruptions.',
  },
  /**
   * 🔴 **2026-08-14 추가 (사용자 승인).** 위 5개는 Spec 필수 9의 예시 문구를 그대로 옮긴 것이고
   *    이 하나는 S22(GitHub 공개 활동 분석)가 실제로 판정할 수 있는 축이라 추가했다 — 밈 사전
   *    45건과 축약형 히트율로 관측된다(`src/core/github/rules.js` 판정표 6번).
   * 🔴 **"이 사람은 가볍다"가 아니라 "가벼운 표현을 써도 괜찮다"**이다. 사람의 성격이 아니라
   *    문장을 어떻게 쓸지에 대한 지침으로 문구를 잡았다(필수 9 G1/G2 — 사람에 대한 등급 금지).
   */
  {
    id: 'casual-ok',
    label: '가벼운 표현 괜찮음',
    hint: 'This recipient is comfortable with light, casual phrasing in work messages.',
  },
  /**
   * 🔴 **2026-08-19 추가 (사용자 결정 ①).** 지금까지 **순서**를 다루는 태그는
   *    「배경 설명 선호」 하나뿐이라 **그 반대편이 없었다** — 「결론부터 말해 달라」는
   *    다른 나라 기업과 일할 때 가장 자주 부딪히는 축인데 표현할 방법이 없었다.
   * 🔴 「배경 설명 선호」와 **함께 켜면 서로 반대**다. 둘 다 켜는 것을 막지는 않는다 —
   *    사람이 그렇게 고를 이유가 없고, 막는 규칙을 넣으면 그 규칙이 또 설명 대상이 된다.
   *    (프롬프트에서는 뒤엣것이 이기지만, 그 조합은 사용자가 만든 모순이다.)
   * 🔴 **GitHub 자동 판정은 하지 않는다.** 「첫 문장이 결론인가」를 재는 신호가 지금 없다
   *    (`core/github/signals.js`는 길이·완곡·시간대·몰아쓰기·구어 다섯 축뿐이다).
   *    없는 신호로 규칙을 만들면 근거 없는 제안이 된다 — **직접 고르는 태그**로 둔다.
   */
  {
    id: 'conclusion-first',
    label: '결론 먼저 선호',
    hint: 'This recipient prefers the request or conclusion in the first sentence, before any background.',
  },
];

const TAG_BY_ID = new Map(RECIPIENT_TAGS.map((tag) => [tag.id, tag]));

/**
 * 🔴 **데모 시드(Miguel·Sarah)를 제거했다** (2026-08-15 사용자 요청).
 *
 * 존재하지 않는 사람 둘이 태그까지 붙은 채 자동으로 등록돼 있었다. 수신자는 **교정 결과를 바꾸는
 * 설정**이라(태그가 프롬프트에 실린다) 사용자가 등록한 적 없는 사람의 성향이 자기 문장에 적용됐고,
 * 퇴근 요정·회의 시간 추천도 그 가짜 타임존을 기준으로 계산했다.
 * 🔴 특히 나쁜 조합이었다: Spec 필수 9는 태그를 **사용자가 직접 지정한 것만** 두라고 하는데,
 *    「직접 지정한 태그예요」라는 문구 아래에 **우리가 심은 태그**가 있었다.
 */

function makeId() {
  return `rc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 수신자 목록. 등록한 적이 없으면 빈 목록이다 — 아무도 심지 않는다. */
export async function listRecipients() {
  const stored = await getLocal(STORAGE_KEYS.RECIPIENTS, null);
  return Array.isArray(stored) ? stored : [];
}

/**
 * 🔴 태그는 고정 집합 안의 id만 허용한다 — 모르는 id는 조용히 버린다. 자유 문자열이 들어오면
 *    프롬프트 주입 표면이 되고, 사람에 대한 임의 낙인이 저장된다.
 */
function sanitizeTagIds(tagIds) {
  if (!Array.isArray(tagIds)) return [];
  return tagIds.filter((id) => TAG_BY_ID.has(id));
}

/** `@octocat` · 공백 → `octocat`. 빈 값이면 null. */
function normalizeLogin(value) {
  const clean = String(value ?? '').trim().replace(/^@/, '');
  return clean === '' ? null : clean;
}

function validate({ name, timeZone }) {
  if (!name || !String(name).trim()) throw new Error('이름은 비워둘 수 없어요');
  if (!timeZone || !String(timeZone).trim()) throw new Error('타임존을 선택해 주세요');
}

export async function addRecipient(input) {
  validate(input);
  const entry = {
    id: makeId(),
    name: String(input.name).trim(),
    timeZone: String(input.timeZone).trim(),
    countryCode: input.countryCode ? String(input.countryCode).trim().toUpperCase() : null,
    /**
     * 🔴 **이 사람에게 쓰는 언어** (2026-08-16). 예전에는 온보딩의 「주 협업 지역」 **하나**가
     *    모든 상대의 언어를 정했다 — 여러 나라와 일하면 어느 쪽으로도 틀린다(사용자 지적).
     *    언어는 사람마다 다르므로 **사람에 붙는 것이 맞다.**
     * 🔴 목록 밖 값은 버린다 — 프롬프트의 `targetLanguage`로 그대로 들어가는 값이다.
     */
    language: RECIPIENT_LANGUAGES.includes(input.language) ? input.language : null,
    /**
     * 🔴 **이 사람과는 어느 팀 일을 하는가** (2026-08-16 사용자 승인 ⓐ). 팀 용어집이 실릴 때
     *    어느 팀 것인지 정하는 값이다. 예전에는 **활성 팀 하나**가 모든 상대에 적용돼서, 팀이
     *    여럿이면 엉뚱한 팀 용어가 실렸다.
     * 🔴 언어를 수신자로 옮긴 것과 **같은 논리**다 — "이 사람과는 이 팀 일을 한다"가 실제 업무
     *    단위이고, 한 번 정하면 이후엔 자동이다. 매번 고르게 하면 대부분 기본값으로 잘못 쓴다.
     * 🔴 값 검증은 하지 않는다(팀 목록은 비동기라 여기서 못 본다) — 없는 팀 id면 조회가 빈
     *    배열을 주므로 **아무 용어도 안 실리는** 안전한 실패로 끝난다.
     * 🔴 **새 사람의 기본값은 「개인」이다** (2026-08-19 자체 점검에서 잡은 불일치).
     *    프로필 폼만 기본을 개인으로 채우고 **팝업의 「＋ 새 사람 추가」와 자동 감지 추가는
     *    이 함수를 그냥 불러서** `null`(= 활성 팀)이 됐다 — 대화에서 감지돼 추가되는 사람이
     *    정확히 외부 파트너 케이스인데, 그쪽 입구만 팀 내부 용어를 받았다.
     *    **입구가 아니라 저장 계층이 기본값을 정한다** — 입구가 늘어도 어긋날 수 없다.
     * 🔴 `null`은 이제 **새로 만들어지지 않는다** — 옛 기록(2026-08-19 이전)에만 남아 있고,
     *    그 값의 해석(활성 팀)은 `refineClient`의 판정표가 유지한다.
     */
    teamId:
      typeof input.teamId === 'string' && input.teamId.trim() !== ''
        ? input.teamId
        : PERSONAL_TEAM_ID,
    /**
     * 🔴 **문체 수위** (2026-08-18). 목록 밖 값은 버린다 — 프롬프트에 그대로 나가는 값이다.
     *    저장되는 것은 "이 상대에게는 격식체로 쓴다"는 **작성 지침**이지 직급이 아니다 (필수 9).
     */
    register: RECIPIENT_REGISTERS.includes(input.register) ? input.register : null,
    /**
     * 🔴 **GitHub 아이디를 저장한다** (2026-08-16 사용자 요청 ②). 태그 제안을 받을 때마다
     *    아이디를 다시 치게 하면 그 기능은 사실상 안 쓰인다.
     * 🔴 저장하는 것은 **공개 사용자명뿐**이다 — 토큰이 아니고, 공개 활동 조회에만 쓴다.
     */
    githubLogin: normalizeLogin(input.githubLogin),
    tagIds: sanitizeTagIds(input.tagIds),
    private: !!input.private,
  };
  const list = await listRecipients();
  const next = [...list, entry];
  await setLocal(STORAGE_KEYS.RECIPIENTS, next);
  return entry;
}

/**
 * 이 사람에게 쓸 **문체 수위** (2026-08-18 신설).
 *
 * 🔴 **사람에 대한 평가가 아니라 문장 작성 지침이다** (Spec 필수 9 G1/G2). `casual-ok` 태그가
 *    "이 사람은 가볍다"가 아니라 "가벼운 표현을 써도 괜찮다"인 것과 같은 형태로 잡았다 —
 *    저장되는 것은 **"이 상대에게는 격식체로 쓴다"**이지 "이 사람은 윗사람이다"가 아니다.
 *    직급·서열을 저장하지 않는다.
 *
 * 🔴 **왜 필요한가** (2026-08-18 실측): 한국어→영어에는 격식 손잡이가 **아예 없었다.**
 *    `honorificLevel`은 `enKoRules`(영→한)에서만 쓰이고 `KO_EN_RULES`에는 격식 지시가 한 줄도
 *    없다. 그래서 가장 정중한 조합(LOW + 캐주얼 OFF)조차
 *    `Could we discuss… when you get a chance?` 수준에 머물렀고, 고객사에 보낼
 *    `I would like to… Would it be possible to…` 수위에 **도달할 방법이 없었다.**
 *
 * 🔴 `null`이 기본이다 — 채우지 않는다. "설정 안 함"과 "보통"을 구분해야 한다.
 */
export const RECIPIENT_REGISTERS = ['casual', 'formal'];

/** 화면 문구. 🔴 사람이 아니라 **문장**을 서술한다. */
export const REGISTER_LABELS = {
  casual: '가볍게',
  formal: '격식체로',
};

/** 🔴 화면에서 「기본」이 무엇인지 말한다 — 비워 두면 사용자가 무슨 상태인지 모른다. */
export const REGISTER_DEFAULT_LABEL = '기본';

/**
 * **「이 사람과는 팀 없이(개인으로) 일한다」를 나타내는 값** (2026-08-19 사용자 요청 ③).
 *
 * 🔴 **`null`과 구분해야 한다.** `teamId`가 `null`이면 「아직 안 정함」이고, 그때 교정은
 *    **활성 팀**의 용어집을 쓴다(`teamClient.listTeamGlossary`의 기존 동작). 그런데 사이는
 *    팀 없이도 쓰는 제품이라 **「팀 용어를 쓰지 않겠다」를 사용자가 직접 고를 수 있어야 한다** —
 *    그 상태가 `null`과 같은 값이면 화면에서 「개인」을 골라도 활성 팀 용어가 계속 실린다.
 * 🔴 팀 id와 충돌하지 않게 서버가 만들지 않는 모양(`__personal__`)을 쓴다.
 */
export const PERSONAL_TEAM_ID = '__personal__';

/** 수신자에게 쓸 수 있는 언어 — `core/refine/prompt.js`의 지원 언어와 같아야 한다. */
export const RECIPIENT_LANGUAGES = ['en', 'zh', 'ja', 'de', 'fr', 'es', 'ko'];

/** 화면 문구. */
export const LANGUAGE_LABELS = {
  en: '영어',
  zh: '중국어',
  ja: '일본어',
  de: '독일어',
  fr: '프랑스어',
  es: '스페인어',
  ko: '한국어',
};

/** @returns {Promise<object|null>} 갱신된 수신자. id가 없으면 null. */
export async function updateRecipient(id, patch) {
  const list = await listRecipients();
  const index = list.findIndex((entry) => entry.id === id);
  if (index === -1) return null;

  const merged = { ...list[index], ...patch };
  validate(merged);
  merged.name = String(merged.name).trim();
  merged.tagIds = sanitizeTagIds(merged.tagIds);
  merged.private = !!merged.private;
  /**
   * 🔴 **추가와 같은 검증을 건다** (2026-08-16 — 편집 기능이 생기면서 필요해졌다).
   *    예전에는 이 함수가 태그·비공개만 바꾸는 데 쓰여서 나머지를 검사하지 않았다. 이제 화면에서
   *    언어·지역·팀을 고칠 수 있으므로, **`addRecipient`가 막는 값을 여기서 통과시키면**
   *    「추가할 땐 못 넣는데 고치면 들어가는」 구멍이 된다. `language`는 프롬프트의
   *    `targetLanguage`로 그대로 나가는 값이라 특히 그렇다.
   */
  merged.timeZone = String(merged.timeZone).trim();
  merged.countryCode = merged.countryCode
    ? String(merged.countryCode).trim().toUpperCase()
    : null;
  merged.language = RECIPIENT_LANGUAGES.includes(merged.language) ? merged.language : null;
  merged.teamId =
    typeof merged.teamId === 'string' && merged.teamId.trim() !== '' ? merged.teamId : null;
  merged.register = RECIPIENT_REGISTERS.includes(merged.register) ? merged.register : null;
  merged.githubLogin = normalizeLogin(merged.githubLogin);

  const next = [...list];
  next[index] = merged;
  await setLocal(STORAGE_KEYS.RECIPIENTS, next);
  return merged;
}

/** @returns {Promise<boolean>} 실제로 지워졌으면 true. */
export async function removeRecipient(id) {
  const list = await listRecipients();
  const next = list.filter((entry) => entry.id !== id);
  if (next.length === list.length) return false;
  await setLocal(STORAGE_KEYS.RECIPIENTS, next);
  return true;
}

/** 마지막으로 고른 수신자 id — 팝업이 열릴 때마다 다시 고르게 하지 않는다. */
export async function getSelectedRecipientId() {
  return getLocal(STORAGE_KEYS.RECIPIENT_SELECTED, null);
}

export async function setSelectedRecipientId(id) {
  await setLocal(STORAGE_KEYS.RECIPIENT_SELECTED, id);
}

/**
 * 지금 선택된 수신자를 돌려준다. 선택값이 없거나 그 수신자가 지워졌으면 목록의 첫 번째,
 * 목록도 비었으면 null.
 */
export async function getSelectedRecipient() {
  const [list, selectedId] = await Promise.all([listRecipients(), getSelectedRecipientId()]);
  if (list.length === 0) return null;
  return list.find((entry) => entry.id === selectedId) ?? list[0];
}

/** 화면 표시용 라벨. 모르는 id는 null — 지어내지 않는다. */
export function tagLabel(id) {
  return TAG_BY_ID.get(id)?.label ?? null;
}

/**
 * `/v1/refine` payload에 실을 수신자 블록을 만든다.
 *
 * 🔴 **비공개면 태그를 싣지 않는다** (필수 9 본인 비공개 권리) — 화면 열람은 되지만 LLM으로는
 *    나가지 않는다.
 * 🔴 **국가코드·이름·타임존을 싣지 않는다.** 국가는 성향 판단 근거가 될 수 없고(필수 2 3순위),
 *    이름은 교정 품질에 기여하지 않으면서 개인정보만 늘린다. 나가는 것은 태그 지시문뿐이다.
 *
 * @returns {{tags: string[]}|null} 실을 게 없으면 null.
 */
export function toRefinePayloadRecipient(recipient) {
  if (!recipient) return null;
  /**
   * 🔴 **`register`는 비공개와 무관하게 나간다** — 언어와 같은 성격이기 때문이다.
   *    「어느 언어로 쓸지」가 그 사람에 대한 판단이 아니듯, 「격식체로 쓸지」도 그 사람에 대한
   *    판단이 아니라 **문장을 만들 조건**이다. 반대로 태그는 관찰된 소통 습관이라
   *    비공개면 나가지 않는다 (Spec 필수 9).
   */
  const register = RECIPIENT_REGISTERS.includes(recipient.register) ? recipient.register : null;
  const tags = recipient.private
    ? []
    : (recipient.tagIds ?? []).map((id) => TAG_BY_ID.get(id)?.hint).filter(Boolean);
  if (tags.length === 0 && register === null) return null;
  return { ...(tags.length > 0 ? { tags } : {}), ...(register ? { register } : {}) };
}
