/**
 * 웹 설정 브리지 — 관리용 웹사이트(`site/`)가 `externally_connectable`로 보내는 메시지를 처리한다
 * (2026-10-24, `docs/WebSplit.md` 「C — 로컬 브리지」).
 *
 * 🔴 **서버가 없다.** 웹이 읽고 쓰는 것은 이 기기의 `chrome.storage.local`뿐이고, 여기서 어디로도
 *    내보내지 않는다. 로그도 남기지 않는다 — 값은 물론 메시지 type도 찍지 않는다.
 * 🔴 **프로토콜은 고정이다**(웹이 이 모양에 맞춰 만들어지고 있다). type·필드·오류 코드 이름을 바꾸지 않는다.
 *    응답: `{ok:true, ...}` 또는 `{ok:false, error}` — error ∈ `forbidden_origin`|`bad_request`|`unknown_type`|`failed`.
 * 🔴 **저장은 반드시 `src/lib/*.js`를 거친다**(WebSplit 「B를 싸게 만들기 위해 지금 지킬 것」 1) — 사이드패널과
 *    같은 함수를 써야 같은 규칙(용어집 덮어쓰기, 학습 삭제 대기 기록, 말투↔기본 톤 연결)이 지켜진다.
 *
 * 🔴 **브리지로 절대 나가지도 들어오지도 않는 것** (WebSplit 금지 표 + 개인 정보):
 *    `sai.auth`(토큰·이메일) · 저장 문구 · 예약 · 결정 로그 · GitHub 토큰 · 수신자 · 팀 · 마찰 · 포인트 ·
 *    사용량 · 동의. 응답은 아래 `readSettings`가 **필드를 하나씩 골라** 만든다 — 저장값을 통째로 펼치지
 *    않는다. `test/siteBridge.unit.test.js`가 이 키들의 값이 어떤 응답에도 섞이지 않음을 잠근다.
 *
 * 판정표 (요청 1건):
 * | 조건 | 결과 |
 * |---|---|
 * | `sender.origin`이 허용 목록(`SITE_ALLOWED_ORIGINS`)에 없음 | `forbidden_origin` |
 * | 메시지가 객체가 아니거나 `type`이 문자열이 아님 | `bad_request` |
 * | 모르는 `type` | `unknown_type` |
 * | 모르는 섹션·필드, 형식·목록 밖 값, 길이 초과, 없는 id | `bad_request` — **아무것도 쓰지 않는다** |
 * | 저장소 오류 등 그 밖의 예외 | `failed` (사유 문구를 싣지 않는다) |
 */

import { SITE_ALLOWED_ORIGINS } from '../config.js';
import { getLocal, setLocal, STORAGE_KEYS, THREAD_CONTEXT_DEFAULT } from '../lib/storage.js';
import {
  getOnboarding,
  setOnboardingFields,
  setProfileSyncingTone,
  MY_LANGUAGES,
  PARTNER_REGIONS,
  DEFAULT_TONES,
} from '../lib/onboarding.js';
import {
  getProfile,
  getLearnedCounts,
  removeLearnedPattern,
  clearLearnedPatterns,
  SITUATION_TEMPLATES,
  COLLAB_STYLES,
} from '../lib/profile.js';
import { getIdentity, setIdentity, MAX_IDENTITY_FIELD } from '../lib/identity.js';
import {
  listPersonalGlossary,
  addPersonalGlossaryEntry,
  updatePersonalGlossaryEntry,
  removePersonalGlossaryEntry,
  GLOSSARY_LANGUAGES,
} from '../lib/glossary.js';
import { LANGUAGE_LABELS } from '../lib/recipients.js';
import { DIFF_CATEGORIES } from '../core/profile/diff.js';
import { getSession } from '../lib/authClient.js';
import { flushLearnedDeletions, SYNC_ERRORS } from '../lib/syncClient.js';

export const SITE_PROTOCOL_VERSION = 1;

export const SITE_ERRORS = {
  FORBIDDEN_ORIGIN: 'forbidden_origin',
  BAD_REQUEST: 'bad_request',
  UNKNOWN_TYPE: 'unknown_type',
  FAILED: 'failed',
};

/** 짧은 문자열(이름·직급 등) 상한 — 프로토콜 고정값. */
export const MAX_SHORT_STRING = 40;
/** 용어집 문자열 상한 — 프로토콜 고정값. */
export const MAX_GLOSSARY_STRING = 200;

/**
 * 표시 설정 — 저장 키와 **화면이 실제로 쓰는 기본값**.
 *
 * 🔴 기본값을 새로 정하지 않는다. 그 설정이 **효과를 내는 화면**이 읽는 기본값을 그대로 옮겼다
 *    (사이드패널 설정 시트와 팝업이 서로 다른 기본값을 쓰는 항목이 둘 있다 — 기존 동작은 바꾸지 않았다):
 * | 필드 | 기본값 | 근거 |
 * |---|---|---|
 * | theme | 'light' | 사이드패널 `App.jsx` — 저장값 없으면 라이트(2026-08-20 결정) |
 * | backTranslation | true | 팝업·사이드패널 둘 다 true |
 * | refineReasoning | false | 팝업·사이드패널 둘 다 false |
 * | highlightHints | **true** (2026-10-31 기본값 변경) | `displaySettings.js`와 같은 값 — 팝업도 그 값을 읽는다 |
 * | threadContext | `THREAD_CONTEXT_DEFAULT` | 공용 상수(false) |
 * | threadContextPreview | **true** (2026-10-31 기본값 변경) | 같음 |
 * | replyAuto | false | `SaiOverlay.jsx` |
 * | snippetInsertMode | **'append'** (2026-10-31 기본값 변경) | 같음 — 오버레이도 그 값을 읽는다 |
 */
const DISPLAY_FIELDS = {
  theme: { key: STORAGE_KEYS.THEME, fallback: 'light', values: ['light', 'dark'] },
  backTranslation: { key: STORAGE_KEYS.BACK_TRANSLATION, fallback: true },
  refineReasoning: { key: STORAGE_KEYS.REFINE_REASONING, fallback: false },
  highlightHints: { key: STORAGE_KEYS.HIGHLIGHT_HINTS, fallback: true },
  threadContext: { key: STORAGE_KEYS.THREAD_CONTEXT, fallback: THREAD_CONTEXT_DEFAULT },
  threadContextPreview: { key: STORAGE_KEYS.THREAD_CONTEXT_PREVIEW, fallback: true },
  replyAuto: { key: STORAGE_KEYS.REPLY_AUTO, fallback: false },
  snippetInsertMode: { key: STORAGE_KEYS.SNIPPET_INSERT_MODE, fallback: 'append', values: ['replace', 'append'] },
};

/** 검증 실패 — 바깥에서 `bad_request`로 바뀐다. 🔴 사유 문구·값을 담지 않는다. */
class BadRequest extends Error {}

function fail() {
  throw new BadRequest('bad_request');
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function ids(list) {
  return list.map((item) => item.id);
}

/** 패치의 필드가 전부 허용 목록 안인지 본다. */
function assertKnownFields(patch, allowed) {
  if (!isPlainObject(patch)) fail();
  for (const field of Object.keys(patch)) {
    if (!allowed.includes(field)) fail();
  }
}

/** 목록 id 또는 null. */
function enumOrNull(value, allowedIds) {
  if (value === null) return null;
  if (typeof value !== 'string' || !allowedIds.includes(value)) fail();
  return value;
}

/** 다듬은 짧은 문자열. 상한을 넘으면 자르지 않고 거절한다 — 조용히 잘린 값이 저장되지 않게. */
function shortString(value, max) {
  if (typeof value !== 'string') fail();
  const trimmed = value.trim();
  if (trimmed.length > max) fail();
  return trimmed;
}

/* ── 읽기 ─────────────────────────────────────────────── */

async function readDisplay(deps) {
  const display = {};
  for (const [field, spec] of Object.entries(DISPLAY_FIELDS)) {
    const stored = await deps.getLocal(spec.key, spec.fallback);
    const valid = spec.values ? spec.values.includes(stored) : typeof stored === 'boolean';
    display[field] = valid ? stored : spec.fallback;
  }
  return display;
}

/** 🔴 필드를 하나씩 골라 만든다 — 저장 엔트리를 펼치지 않는다(모르는 필드가 섞여 나가지 않게). */
function toSiteGlossary(list) {
  return (Array.isArray(list) ? list : []).map((entry) => ({
    id: String(entry?.id ?? ''),
    sourceText: String(entry?.sourceText ?? ''),
    targetText: typeof entry?.targetText === 'string' ? entry.targetText : null,
    keepSource: entry?.keepSource === true,
    language: GLOSSARY_LANGUAGES.includes(entry?.language) ? entry.language : null,
  }));
}

/** 🔴 수치만 — 숫자가 아닌 값은 버린다. */
function toSiteLearned(counts) {
  const out = {};
  for (const [id, count] of Object.entries(isPlainObject(counts) ? counts : {})) {
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) out[id] = count;
  }
  return { counts: out };
}

/** 선택지 표 — 라벨을 사이트에 두 벌 두지 않도록 `src/lib`의 상수표에서 `{id,label}`만 뽑는다. */
export function buildOptions() {
  const pick = (list) => list.map(({ id, label }) => ({ id, label }));
  return {
    languages: pick(MY_LANGUAGES),
    partnerRegions: pick(PARTNER_REGIONS),
    tones: pick(DEFAULT_TONES),
    situations: pick(SITUATION_TEMPLATES),
    collabStyles: pick(COLLAB_STYLES),
    learnedCategories: pick(DIFF_CATEGORIES),
    glossaryLanguages: GLOSSARY_LANGUAGES.map((id) => ({ id, label: LANGUAGE_LABELS[id] ?? id })),
  };
}

async function readSettings(deps) {
  const [display, onboarding, profile, identity, counts, glossary] = await Promise.all([
    readDisplay(deps),
    deps.getOnboarding(),
    deps.getProfile(),
    deps.getIdentity(),
    deps.getLearnedCounts(),
    deps.listPersonalGlossary(),
  ]);
  return {
    display,
    language: {
      myLanguage: onboarding?.language ?? null,
      partnerRegion: onboarding?.partnerRegion ?? null,
      tone: onboarding?.tone ?? null,
    },
    profile: {
      situationId: profile?.situationId ?? null,
      collabStyleId: profile?.collabStyleId ?? null,
    },
    identity: {
      displayName: identity?.displayName ?? '',
      jobTitle: identity?.jobTitle ?? '',
    },
    learned: toSiteLearned(counts),
    glossary: toSiteGlossary(glossary),
    options: buildOptions(),
  };
}

/* ── site:set ─────────────────────────────────────────── */

/**
 * 섹션별 「검증 → 쓰기」. 🔴 **검증을 전부 끝낸 뒤에만 쓴다** — 필드 하나가 틀리면 아무것도 쓰지 않는다.
 */
const SECTIONS = {
  display: {
    validate(patch) {
      assertKnownFields(patch, Object.keys(DISPLAY_FIELDS));
      const clean = {};
      for (const [field, value] of Object.entries(patch)) {
        const spec = DISPLAY_FIELDS[field];
        if (spec.values ? !spec.values.includes(value) : typeof value !== 'boolean') fail();
        clean[field] = value;
      }
      return clean;
    },
    async write(clean, deps) {
      for (const [field, value] of Object.entries(clean)) {
        await deps.setLocal(DISPLAY_FIELDS[field].key, value);
      }
    },
  },
  language: {
    validate(patch) {
      assertKnownFields(patch, ['myLanguage', 'partnerRegion', 'tone']);
      const clean = {};
      if ('myLanguage' in patch) clean.language = enumOrNull(patch.myLanguage, ids(MY_LANGUAGES));
      if ('partnerRegion' in patch) clean.partnerRegion = enumOrNull(patch.partnerRegion, ids(PARTNER_REGIONS));
      if ('tone' in patch) clean.tone = enumOrNull(patch.tone, ids(DEFAULT_TONES));
      return clean;
    },
    async write(clean, deps) {
      if (Object.keys(clean).length > 0) await deps.setOnboardingFields(clean);
    },
  },
  profile: {
    validate(patch) {
      assertKnownFields(patch, ['situationId', 'collabStyleId']);
      const clean = {};
      if ('situationId' in patch) clean.situationId = enumOrNull(patch.situationId, ids(SITUATION_TEMPLATES));
      if ('collabStyleId' in patch) clean.collabStyleId = enumOrNull(patch.collabStyleId, ids(COLLAB_STYLES));
      return clean;
    },
    async write(clean, deps) {
      // 🔴 사이드패널과 같은 함수 — 말투를 바꾸면 (온보딩을 끝낸 경우) 기본 톤도 같이 바뀐다.
      if (Object.keys(clean).length > 0) await deps.setProfileSyncingTone(clean);
    },
  },
  identity: {
    validate(patch) {
      assertKnownFields(patch, ['displayName', 'jobTitle']);
      /**
       * 🔴 상한은 프로토콜의 40자와 `identity.js`의 `MAX_IDENTITY_FIELD`(30, 서버와 같은 값) 중 **작은 쪽**이다.
       *    40자까지 받으면 31~40자가 `setIdentity` 안에서 **말없이 잘려** 저장된다 — 그래서 넘으면 거절한다.
       */
      const max = Math.min(MAX_SHORT_STRING, MAX_IDENTITY_FIELD);
      const clean = {};
      if ('displayName' in patch) clean.displayName = shortString(patch.displayName, max);
      if ('jobTitle' in patch) clean.jobTitle = shortString(patch.jobTitle, max);
      return clean;
    },
    async write(clean, deps) {
      if (Object.keys(clean).length > 0) await deps.setIdentity(clean);
    },
  },
};

/* ── 용어집 ───────────────────────────────────────────── */

const GLOSSARY_FIELDS = ['sourceText', 'targetText', 'keepSource', 'language'];

/** 들어온 필드만 검증해 돌려준다. `requireSource`면 원문이 반드시 있어야 한다(추가). */
function validateGlossaryFields(input, { requireSource }) {
  assertKnownFields(input, GLOSSARY_FIELDS);
  const clean = {};
  if ('sourceText' in input || requireSource) {
    const source = shortString(input.sourceText, MAX_GLOSSARY_STRING);
    if (source === '') fail();
    clean.sourceText = source;
  }
  if ('targetText' in input) {
    clean.targetText = input.targetText === null ? null : shortString(input.targetText, MAX_GLOSSARY_STRING);
  }
  if ('keepSource' in input) {
    if (typeof input.keepSource !== 'boolean') fail();
    clean.keepSource = input.keepSource;
  }
  if ('language' in input) clean.language = enumOrNull(input.language, GLOSSARY_LANGUAGES);
  return clean;
}

/** 엔트리 id — 비어 있지 않은 짧은 문자열. */
function entryId(value) {
  if (typeof value !== 'string' || value === '' || value.length > MAX_GLOSSARY_STRING) fail();
  return value;
}

/**
 * `glossary.js`의 `validateEntry`와 같은 규칙 — 원문이 있고, 번역어가 있거나 [원문 유지]다.
 * 🔴 라이브러리는 이 경우 한국어 `Error`를 던지는데, 그 문구로 저장소 오류와 가려내지 않으려고 **쓰기 전에**
 *    여기서 먼저 본다. 그러면 라이브러리 호출에서 나는 예외는 전부 저장소 쪽(`failed`)이다.
 */
function assertUsableEntry(entry) {
  if (!(typeof entry.sourceText === 'string' && entry.sourceText.trim() !== '')) fail();
  if (!entry.keepSource && !(typeof entry.targetText === 'string' && entry.targetText.trim() !== '')) fail();
}

/* ── 처리기 ───────────────────────────────────────────── */

const HANDLERS = {
  async 'site:hello'(_message, deps) {
    // 🔴 로그인 여부(불리언)만 — 토큰·이메일·uid는 싣지 않는다.
    const session = await deps.getSession();
    return { protocol: SITE_PROTOCOL_VERSION, version: deps.getVersion(), signedIn: Boolean(session) };
  },

  async 'site:get'(_message, deps) {
    return { settings: await readSettings(deps) };
  },

  async 'site:set'(message, deps) {
    if (typeof message.section !== 'string' || !Object.hasOwn(SECTIONS, message.section)) fail();
    const section = SECTIONS[message.section];
    const clean = section.validate(message.patch);
    await section.write(clean, deps);
    return { settings: await readSettings(deps) };
  },

  async 'site:glossary:add'(message, deps) {
    const entry = validateGlossaryFields(message.entry, { requireSource: true });
    assertUsableEntry(entry);
    // 🔴 같은 원문 + 같은 언어면 덮어쓴다 — 사이드패널과 같은 함수라 같은 규칙이다.
    await deps.addPersonalGlossaryEntry(entry);
    return { glossary: toSiteGlossary(await deps.listPersonalGlossary()) };
  },

  async 'site:glossary:update'(message, deps) {
    const id = entryId(message.id);
    const patch = validateGlossaryFields(message.patch, { requireSource: false });
    const current = (await deps.listPersonalGlossary()).find((entry) => entry.id === id);
    // 🔴 없는 id — 프로토콜에 not_found가 없으므로 `bad_request`다. 아무것도 쓰지 않는다.
    if (!current) fail();
    assertUsableEntry({ ...current, ...patch });
    const updated = await deps.updatePersonalGlossaryEntry(id, patch);
    if (updated == null) fail();
    return { glossary: toSiteGlossary(await deps.listPersonalGlossary()) };
  },

  async 'site:glossary:remove'(message, deps) {
    const id = entryId(message.id);
    const removed = await deps.removePersonalGlossaryEntry(id);
    if (!removed) fail();
    return { glossary: toSiteGlossary(await deps.listPersonalGlossary()) };
  },

  async 'site:learned:remove'(message, deps) {
    const categoryId = message.categoryId;
    if (typeof categoryId !== 'string' || categoryId === '' || categoryId.length > MAX_SHORT_STRING) fail();
    // 🔴 사이드패널과 같은 함수 — 서버 삭제 대기(`sai.profile.learned.deleted`)에 올라간다.
    const removed = await deps.removeLearnedPattern(categoryId);
    if (!removed) fail();
    const server = await flushServerDeletions(deps);
    return { learned: toSiteLearned(await deps.getLearnedCounts()), server };
  },

  async 'site:learned:clear'(_message, deps) {
    // 🔴 사이드패널과 같은 함수 — 서버에 있는 것까지 지우도록 `all`이 선다.
    await deps.clearLearnedPatterns();
    const server = await flushServerDeletions(deps);
    return { learned: toSiteLearned(await deps.getLearnedCounts()), server };
  },
};

/**
 * 사이드패널(`deleteOnServer`)처럼 지운 즉시 서버 기록도 지운다 (2026-10-25 사용자 요청).
 * 실패해도 로컬 삭제는 이미 끝났고 대기 목록이 남아 다음 동기화가 다시 지운다 — 그래서 요청은 성공이다.
 * @returns {Promise<'deleted' | 'local' | 'later'>} `local` = 로그인 안 함(서버에 지울 것이 없다)
 */
async function flushServerDeletions(deps) {
  try {
    await deps.flushLearnedDeletions();
    return 'deleted';
  } catch (error) {
    return error?.reason === SYNC_ERRORS.NOT_SIGNED_IN ? 'local' : 'later';
  }
}

function defaultVersion() {
  try {
    return chrome.runtime.getManifest().version ?? null;
  } catch {
    return null;
  }
}

/** 실제 확장에서 쓰는 의존성. 테스트는 일부를 바꿔 끼운다. */
export const DEFAULT_SITE_BRIDGE_DEPS = {
  allowedOrigins: SITE_ALLOWED_ORIGINS,
  getVersion: defaultVersion,
  getSession,
  getLocal,
  setLocal,
  getOnboarding,
  setOnboardingFields,
  getProfile,
  setProfileSyncingTone,
  getIdentity,
  setIdentity,
  getLearnedCounts,
  removeLearnedPattern,
  clearLearnedPatterns,
  flushLearnedDeletions,
  listPersonalGlossary,
  addPersonalGlossaryEntry,
  updatePersonalGlossaryEntry,
  removePersonalGlossaryEntry,
};

/**
 * 메시지 1건 처리. **절대 reject하지 않는다** — 언제나 `{ok, ...}` 객체로 끝난다.
 * @param {unknown} message
 * @param {{origin?: string}} sender `chrome.runtime.onMessageExternal`의 sender
 * @param {Partial<typeof DEFAULT_SITE_BRIDGE_DEPS>} [overrides]
 */
export async function handleSiteMessage(message, sender, overrides = {}) {
  const deps = { ...DEFAULT_SITE_BRIDGE_DEPS, ...overrides };
  // 🔴 이중 방어 — manifest의 matches가 이미 막지만, 다른 확장이 보낸 메시지나 설정 실수까지 여기서 거른다.
  const origin = typeof sender?.origin === 'string' ? sender.origin : '';
  if (!deps.allowedOrigins.includes(origin)) return { ok: false, error: SITE_ERRORS.FORBIDDEN_ORIGIN };

  if (!isPlainObject(message) || typeof message.type !== 'string') {
    return { ok: false, error: SITE_ERRORS.BAD_REQUEST };
  }
  if (!Object.hasOwn(HANDLERS, message.type)) return { ok: false, error: SITE_ERRORS.UNKNOWN_TYPE };

  try {
    const result = await HANDLERS[message.type](message, deps);
    return { ok: true, ...result };
  } catch (error) {
    // 🔴 사유·값을 응답에도 로그에도 싣지 않는다(Zero Retention — 저장소 오류 문구에 무엇이 섞일지 모른다).
    return { ok: false, error: error instanceof BadRequest ? SITE_ERRORS.BAD_REQUEST : SITE_ERRORS.FAILED };
  }
}
