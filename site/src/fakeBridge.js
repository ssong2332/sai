/**
 * `?demo=1` 전용 가짜 브리지 — 메모리에만 있다. 새로고침하면 처음 값으로 돌아간다.
 *
 * 🔴 실제 확장과 연결되지 않았을 때 **자동으로 여기로 떨어지지 않는다.** 설정 페이지가
 *    `?demo=1`을 봤을 때만 만들고, 화면 위에 「미리보기」 띠를 항상 띄운다.
 * 🔴 선택지 id·라벨은 확장 원본에서 옮겼다 — `src/lib/onboarding.js`(MY_LANGUAGES·PARTNER_REGIONS·
 *    DEFAULT_TONES), `src/lib/profile.js`(SITUATION_TEMPLATES·COLLAB_STYLES),
 *    `src/core/profile/diff.js`(DIFF_CATEGORIES), `src/lib/glossary.js`(GLOSSARY_LANGUAGES).
 *    실제 연결에서는 확장이 보내 준 `options`를 그대로 쓴다.
 */

export const DEMO_OPTIONS = {
  languages: [
    { id: 'ko', label: '한국어' },
    { id: 'en', label: 'English' },
    { id: 'ja', label: '日本語' },
    { id: 'zh', label: '中文' },
  ],
  partnerRegions: [
    { id: 'english', label: '영어권' },
    { id: 'chinese', label: '중화권' },
    { id: 'korean', label: '한국어권' },
  ],
  tones: [
    { id: 'direct', label: '직접적으로' },
    { id: 'warm', label: '부드럽게' },
    { id: 'brief', label: '짧게' },
    { id: 'conclusion', label: '결론 먼저' },
    { id: 'rationale', label: '근거를 함께' },
  ],
  situations: [
    { id: 'code-review', label: '코드 리뷰' },
    { id: 'incident', label: '장애 대응' },
    { id: 'schedule', label: '일정 조율' },
    { id: 'report', label: '진행 보고' },
  ],
  collabStyles: [
    { id: 'direct', label: '직접적으로' },
    { id: 'warm', label: '부드럽게' },
    { id: 'brief', label: '짧게' },
    { id: 'conclusion', label: '결론 먼저' },
    { id: 'rationale', label: '근거를 함께' },
  ],
  learnedCategories: [
    { id: 'deadline-explicit', label: '"ASAP" 대신 구체적인 마감 시각을 쓰는 편이에요' },
    { id: 'fewer-apologies', label: '사과 표현을 문장당 1회 이하로 줄여요' },
    { id: 'no-emoji', label: '이모지를 빼는 편이에요' },
    { id: 'shorter', label: '더 짧고 간결한 문장을 선호해요' },
    { id: 'honorific-shift', label: '종결어미 레벨을 직접 바꾸는 편이에요' },
  ],
  glossaryLanguages: [
    { id: 'en', label: 'English' },
    { id: 'zh', label: '中文' },
    { id: 'ja', label: '日本語' },
    { id: 'de', label: 'Deutsch' },
    { id: 'fr', label: 'Français' },
    { id: 'es', label: 'Español' },
    { id: 'ko', label: '한국어' },
  ],
};

function initialState() {
  return {
    display: {
      theme: 'light',
      backTranslation: true,
      refineReasoning: false,
      highlightHints: true,
      threadContext: false,
      threadContextPreview: true,
      replyAuto: false,
      snippetInsertMode: 'replace',
    },
    language: { myLanguage: 'ko', partnerRegion: 'english', tone: 'conclusion' },
    profile: { situationId: 'code-review', collabStyleId: 'conclusion' },
    identity: { displayName: '', jobTitle: '' },
    learned: { counts: { 'deadline-explicit': 4, shorter: 2, 'fewer-apologies': 1 } },
    glossary: [
      { id: 'g-demo-1', sourceText: '배포', targetText: 'deploy', keepSource: false, language: 'en' },
      { id: 'g-demo-2', sourceText: '스프린트 회고', targetText: 'sprint retro', keepSource: false, language: null },
      { id: 'g-demo-3', sourceText: 'Sai', targetText: null, keepSource: true, language: null },
    ],
    options: DEMO_OPTIONS,
  };
}

const SECTIONS = ['display', 'language', 'profile', 'identity'];
const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * @param {{delayMs?: number}} [opts]
 * @returns {(message: object) => Promise<object>} 실제 브리지의 `send`와 같은 모양
 */
export function createFakeSend({ delayMs = 160 } = {}) {
  const state = initialState();
  let seq = 0;

  const handle = (message) => {
    switch (message?.type) {
      case 'site:hello':
        return { ok: true, protocol: 1, version: 'demo', signedIn: false };
      case 'site:get':
        return { ok: true, settings: clone(state) };
      case 'site:set': {
        if (!SECTIONS.includes(message.section) || !message.patch || typeof message.patch !== 'object') {
          return { ok: false, error: 'bad_request' };
        }
        state[message.section] = { ...state[message.section], ...message.patch };
        return { ok: true, settings: clone(state) };
      }
      case 'site:glossary:add': {
        const entry = message.entry ?? {};
        const sourceText = String(entry.sourceText ?? '').trim();
        if (!sourceText) return { ok: false, error: 'bad_request' };
        seq += 1;
        state.glossary = [
          {
            id: `g-demo-new-${seq}`,
            sourceText,
            targetText: entry.keepSource ? null : String(entry.targetText ?? '').trim() || null,
            keepSource: !!entry.keepSource,
            language: entry.language ?? null,
          },
          ...state.glossary,
        ];
        return { ok: true, glossary: clone(state.glossary) };
      }
      case 'site:glossary:update': {
        const index = state.glossary.findIndex((item) => item.id === message.id);
        if (index === -1) return { ok: false, error: 'bad_request' };
        state.glossary[index] = { ...state.glossary[index], ...message.patch, id: message.id };
        return { ok: true, glossary: clone(state.glossary) };
      }
      case 'site:glossary:remove':
        state.glossary = state.glossary.filter((item) => item.id !== message.id);
        return { ok: true, glossary: clone(state.glossary) };
      case 'site:learned:remove': {
        const counts = { ...state.learned.counts };
        delete counts[message.categoryId];
        state.learned = { counts };
        return { ok: true, learned: clone(state.learned) };
      }
      case 'site:learned:clear':
        state.learned = { counts: {} };
        return { ok: true, learned: clone(state.learned) };
      default:
        return { ok: false, error: 'unknown_type' };
    }
  };

  return (message) => new Promise((resolve) => setTimeout(() => resolve(handle(message)), delayMs));
}
