/**
 * 표시·교정 기본값 설정 — 확장 설정 페이지(`src/settings/`)의 「일반」 패널이 읽고 쓴다 (2026-10-25).
 *
 * 🔴 기본값을 새로 정하지 않는다. 그 설정이 **효과를 내는 화면**(대부분 페이지 팝업)이 읽는 기본값이다 —
 *    웹 설정 브리지(`src/background/siteBridge.js` `DISPLAY_FIELDS`)와 같은 표다. 브리지는 제거 후보라
 *    (docs/WebSplit.md 2026-10-25) 그쪽을 import하지 않고 여기 둔다. 둘이 다르면 이 표가 맞다.
 * | 필드 | 저장 키 | 기본값 | 근거 |
 * |---|---|---|---|
 * | theme | THEME | 'light' | 사이드패널·팝업 — 저장값 없으면 라이트(2026-08-20) |
 * | backTranslation | BACK_TRANSLATION | true | 팝업·사이드패널 |
 * | refineReasoning | REFINE_REASONING | false | 팝업·사이드패널 |
 * | highlightHints | HIGHLIGHT_HINTS | false | 설명이 뜨는 곳은 팝업(`RefinePopup.jsx`) — 팝업 기본값 |
 * | threadContext | THREAD_CONTEXT | `THREAD_CONTEXT_DEFAULT` | 공용 상수(false) |
 * | threadContextPreview | THREAD_CONTEXT_PREVIEW | false | 미리보기를 그리는 팝업의 기본값 |
 * | replyAuto | REPLY_AUTO | false | `SaiOverlay.jsx` |
 * | snippetInsertMode | SNIPPET_INSERT_MODE | 'replace' | 오버레이·사이드패널 |
 * | quality | QUALITY | `DEFAULT_QUALITY`('standard') | 다듬기 품질 모드 이름(2026-10-30) — `core/refine/quality.js` |
 * 🔴 여기에는 on/off·선택값만 있다 — 본문 없음(Spec 필수 5).
 */

import { getLocal, setLocal, STORAGE_KEYS, THREAD_CONTEXT_DEFAULT } from './storage.js';
import { DEFAULT_QUALITY, QUALITY_IDS } from '../core/refine/quality.js';

export const DISPLAY_SETTINGS = {
  theme: { key: STORAGE_KEYS.THEME, fallback: 'light', values: ['light', 'dark'] },
  backTranslation: { key: STORAGE_KEYS.BACK_TRANSLATION, fallback: true },
  refineReasoning: { key: STORAGE_KEYS.REFINE_REASONING, fallback: false },
  highlightHints: { key: STORAGE_KEYS.HIGHLIGHT_HINTS, fallback: false },
  threadContext: { key: STORAGE_KEYS.THREAD_CONTEXT, fallback: THREAD_CONTEXT_DEFAULT },
  threadContextPreview: { key: STORAGE_KEYS.THREAD_CONTEXT_PREVIEW, fallback: false },
  replyAuto: { key: STORAGE_KEYS.REPLY_AUTO, fallback: false },
  snippetInsertMode: { key: STORAGE_KEYS.SNIPPET_INSERT_MODE, fallback: 'replace', values: ['replace', 'append'] },
  quality: { key: STORAGE_KEYS.QUALITY, fallback: DEFAULT_QUALITY, values: QUALITY_IDS },
};

/** 저장값 하나를 검증한다 — 형식 밖이면 기본값. */
export function coerceDisplayValue(field, stored) {
  const spec = DISPLAY_SETTINGS[field];
  if (!spec) return undefined;
  const valid = spec.values ? spec.values.includes(stored) : typeof stored === 'boolean';
  return valid ? stored : spec.fallback;
}

export async function readDisplaySettings() {
  const out = {};
  for (const [field, spec] of Object.entries(DISPLAY_SETTINGS)) {
    out[field] = coerceDisplayValue(field, await getLocal(spec.key, spec.fallback));
  }
  return out;
}

export async function writeDisplaySetting(field, value) {
  const spec = DISPLAY_SETTINGS[field];
  if (!spec) throw new Error('unknown display field');
  if (spec.values ? !spec.values.includes(value) : typeof value !== 'boolean') throw new Error('bad value');
  await setLocal(spec.key, value);
}

/** 이 키들 중 하나가 바뀌면 화면이 다시 읽는다. */
export const DISPLAY_KEYS = Object.values(DISPLAY_SETTINGS).map((spec) => spec.key);
