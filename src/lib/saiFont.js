/**
 * 번들 서체 `SaiPretendard` 등록 — 콘텐츠 스크립트 전용 (시안 A2, 2026-10-24).
 *
 * 🔴 왜 `FontFace` API로 **호스트 문서**에 등록하나
 *    - 팝업은 Shadow DOM 안이다. Shadow root 안의 `@font-face`는 쓰지 않는다(브라우저가 문서 범위로만
 *      서체를 등록한다 — 명세 §3). 문서의 `document.fonts`에 넣은 서체는 그 문서의 shadow 트리에서도 쓰인다.
 *    - **고유 이름**(`SaiPretendard`)이라 페이지 서체를 바꾸지 않는다 — 페이지가 이 이름을 부르지 않는 한
 *      아무 영향이 없다. 사용자가 설치한 `Pretendard`와도 섞이지 않는다.
 * 🔴 지연 로드: URL 출처 `FontFace`는 `document.fonts.add()`만으로는 내려받지 않는다 — 그 굵기의 글자가
 *    실제로 그려질 때 처음 불러온다. 그래서 팝업을 열지 않는 페이지는 서체 파일을 읽지 않는다.
 * 🔴 실패해도 아무것도 깨지지 않는다 — `--font-sans`의 다음 순위(OS 서체)로 그려진다. 던지지 않는다.
 * 🔴 파일은 `public/fonts/`(OFL, `Pretendard-OFL.txt`)이고 manifest `web_accessible_resources`에 노출된다.
 */

export const SAI_FONT_FAMILY = 'SaiPretendard';

/** 번들 굵기 4개 — 🔴 CSS는 이 네 값만 쓴다(400·600·700·800). */
export const SAI_FONT_FILES = [
  { weight: '400', file: 'fonts/Pretendard-Regular.subset.woff2' },
  { weight: '600', file: 'fonts/Pretendard-SemiBold.subset.woff2' },
  { weight: '700', file: 'fonts/Pretendard-Bold.subset.woff2' },
  { weight: '800', file: 'fonts/Pretendard-ExtraBold.subset.woff2' },
];

/**
 * @param {Document} [doc]
 * @param {(path: string) => string} [getURL] 확장 리소스 URL을 만든다(기본 `chrome.runtime.getURL`).
 * @returns {boolean} 등록했거나 이미 있으면 true.
 */
export function registerSaiFont(doc = globalThis.document, getURL = defaultGetURL) {
  try {
    if (!doc?.fonts || typeof globalThis.FontFace !== 'function' || typeof getURL !== 'function') return false;
    for (const face of doc.fonts) {
      if (face.family === SAI_FONT_FAMILY || face.family === `"${SAI_FONT_FAMILY}"`) return true;
    }
    for (const { weight, file } of SAI_FONT_FILES) {
      const face = new globalThis.FontFace(SAI_FONT_FAMILY, `url("${getURL(file)}") format("woff2")`, {
        weight,
        style: 'normal',
        display: 'swap',
      });
      doc.fonts.add(face);
    }
    return true;
  } catch {
    // 고아 컨텍스트(확장 리로드 직후)·FontFace 미지원 — OS 서체로 그린다.
    return false;
  }
}

function defaultGetURL(path) {
  return globalThis.chrome?.runtime?.getURL?.(path);
}
