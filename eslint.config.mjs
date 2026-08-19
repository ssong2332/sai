/**
 * 정적 검사 — **`no-undef` 하나만 본다** (2026-08-16 사용자 승인 ⓐ).
 *
 * 🔴 **왜 생겼나.** `RecipientForm`에서 `suggested`를 쓰는 JSX만 넣고 `useState` 선언을 빠뜨렸다.
 *    `npm run build`는 **통과했다** — 번들러는 선언되지 않은 식별자를 오류로 보지 않는다(전역일
 *    수도 있다고 본다). 그래서 빌드 green을 근거로 "됐다"고 보고했고, 실제로는 편집 버튼을 누르는
 *    순간 `ReferenceError`로 **사이드패널이 통째로 하얗게** 됐다.
 *    단위 테스트도 못 잡는다 — 그 컴포넌트를 렌더하는 테스트가 없다(jsdom 미도입).
 *    즉 **이 결함을 잡을 수 있는 관문이 하나도 없었다.**
 *
 * 🔴 **일부러 규칙 하나만 켠다.** 스타일 규칙을 켜면 기존 코드 전체에 경고가 쏟아지고, 마감을
 *    앞두고 그걸 정리하다 진짜 결함을 놓친다. 여기 목적은 **런타임에 죽는 코드**를 막는 것뿐이다.
 *    규칙을 늘리는 것은 제출 이후에 판단한다.
 *
 * 🔴 **플러그인을 설치하지 않는다.** 소스에 `eslint-disable-next-line react-hooks/exhaustive-deps`
 *    같은 주석이 있는데, ESLint 9는 **모르는 규칙 이름을 오류로** 낸다. 그렇다고 그 플러그인들을
 *    설치하면 검사 목적과 무관한 의존성이 늘고 규칙도 딸려 온다. 대신 **이름만 존재하는 빈 규칙**을
 *    등록해 주석이 해석되게 한다 — 그 규칙들은 실제로 아무것도 검사하지 않는다(원래도 안 했다).
 */

/** 아무것도 하지 않는 규칙. 이름을 해석시키기 위한 자리 표시용이다. */
const noop = { create: () => ({}) };

export default [
  {
    /**
     * 🔴 **배포용 zip을 푼 폴더도 무시한다** (2026-08-17). 테스터 배포본을 저장소 루트에 풀면
     *    그 안의 **번들된 React**가 검사에 걸려 `MSApp`·`__REACT_DEVTOOLS_GLOBAL_HOOK__` 같은
     *    남의 전역으로 `npm test`가 통째로 실패한다. 우리 소스의 결함이 아닌데 관문이 닫힌다.
     */
    ignores: [
      'dist/**',
      'node_modules/**',
      'functions/node_modules/**',
      'dashboard/dist/**',
      'sai-extension-*/**',
    ],
  },
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    /**
     * 🔴 위의 빈 규칙들은 아무것도 보고하지 않으므로, 소스의 `eslint-disable` 주석이 전부
     *    「쓸모없는 지시」로 경고된다. 그 주석들은 **사람이 읽는 근거**이고 다른 도구에서는
     *    의미가 있으므로 지우지 않는다 — 대신 이 경고를 끈다.
     */
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: {
      'react-hooks': { rules: { 'exhaustive-deps': noop } },
      react: { rules: { 'no-array-index-key': noop } },
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      /**
       * 브라우저 · 확장 · Node가 한 저장소에 섞여 있다. 🔴 여기 없는 전역을 쓰면 검사에 걸리는데,
       * **그게 이 검사의 목적이다** — 진짜 전역이면 이 목록에 한 줄 추가하면 되고, 오타면 잡힌다.
       */
      globals: {
        // 브라우저
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        matchMedia: 'readonly',
        getComputedStyle: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        HTMLElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLInputElement: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        InputEvent: 'readonly',
        DOMParser: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        unescape: 'readonly',
        escape: 'readonly',
        crypto: 'readonly',
        performance: 'readonly',
        structuredClone: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        Intl: 'readonly',
        alert: 'readonly',
        // 확장
        chrome: 'readonly',
        // Node (스크립트·프록시·Functions)
        process: 'readonly',
        globalThis: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
    },
  },
];
