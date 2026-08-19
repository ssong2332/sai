/**
 * 외부 도구 용어집 가져오기 — 붙여넣기(CSV/TSV) (2026-08-16 사용자 결정 ⓐ).
 *
 * 🔴 **왜 붙여넣기인가.** 조사 결과 지금 권한으로 가능한 방법은 둘뿐이었다: 붙여넣기(권한 0)와
 *    GitHub 레포 파일(권한 이미 있음). Notion·Slack·Sheets는 새 OAuth 앱이나 스코프가 필요해
 *    동의 화면 재검증까지 따라온다. 붙여넣기는 **도구를 가리지 않는다** — Notion·Google Sheets·
 *    Excel·Confluence가 전부 CSV/TSV로 내보낸다. 연동 하나를 붙이는 것보다 넓게 덮는다.
 *
 * 🔴 **파일을 읽지 않는다.** 파일 선택은 권한과 별개로 "어떤 파일을 읽었는지"라는 새 표면을
 *    만든다. 사용자가 자기 눈으로 보고 복사한 텍스트만 받는다.
 *
 * 🔴 Zero Retention과 무관하다 — 여기 들어오는 것은 메시지 본문이 아니라 사용자가 등록하려는
 *    **용어 대응쌍**이다(개인 용어집과 같은 성격).
 */

/** 용어집 한 줄의 최대 길이 — `firestore.rules`·개인 용어집과 같은 상한. */
const MAX_FIELD = 200;
/** 한 번에 받을 수 있는 줄 수. 🔴 붙여넣기 사고(문서 통째로 복사)를 막는다. */
export const MAX_IMPORT_ROWS = 200;

/** 흔한 머리글 — 첫 줄이 이것이면 데이터가 아니라 제목이다. */
const HEADER_WORDS = ['원문', '용어', 'source', 'term', 'from', '한국어', 'ko'];

function splitRow(line) {
  // 🔴 탭을 먼저 본다. 스프레드시트에서 복사하면 **탭 구분**이고, 값 안에 쉼표가 있을 수 있다
  //    ("Seoul, Korea"). 쉼표부터 자르면 그런 값이 두 칸으로 쪼개진다.
  if (line.includes('\t')) return line.split('\t');
  return line.split(',');
}

function clean(value) {
  return String(value ?? '')
    .trim()
    // 따옴표로 감싼 CSV 값을 벗긴다 — 스프레드시트가 쉼표 든 값에 붙인다.
    .replace(/^"(.*)"$/s, '$1')
    .trim()
    .slice(0, MAX_FIELD);
}

/**
 * 붙여넣은 텍스트를 용어 목록으로 바꾼다.
 *
 * 지원 형태 (판정표 — 이 표대로만 읽는다)
 * | 입력 줄                  | 결과                                   |
 * |---|---|
 * | `배포<TAB>rollout`       | `배포 → rollout`                        |
 * | `배포,rollout`           | `배포 → rollout`                        |
 * | `배포`                   | 🔴 **원문 유지**로 본다(번역어가 비었다) |
 * | 빈 줄 · 머리글 줄        | 건너뛴다                                |
 * | 세 칸 이상               | 앞 두 칸만 쓴다                          |
 *
 * 🔴 **던지지 않는다.** 형태가 이상한 줄은 `skipped`로 세어 화면이 "몇 줄을 건너뛰었다"고
 *    말할 수 있게 한다 — 조용히 버리면 사용자는 다 들어간 줄 안다.
 *
 * @returns {{entries: Array<{sourceText, targetText, keepSource}>, skipped: number, truncated: boolean}}
 */
export function parseGlossaryText(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const entries = [];
  const seen = new Set();
  let skipped = 0;

  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    const cells = splitRow(line).map(clean);
    const sourceText = cells[0] ?? '';
    if (sourceText === '') {
      skipped += 1;
      continue;
    }
    // 첫 줄이 머리글이면 버린다(값이 아니다).
    if (index === 0 && HEADER_WORDS.includes(sourceText.toLowerCase())) continue;
    // 🔴 같은 원문이 두 번 있으면 뒤엣것을 버린다 — 어느 쪽이 이기는지 모호한 항목을 만들지 않는다.
    const key = sourceText.toLowerCase();
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);

    const targetText = cells[1] ?? '';
    entries.push({
      sourceText,
      targetText,
      // 번역어가 비었으면 「원문 유지」다 — 개인 용어집의 같은 규칙(`glossary.js`의 검증).
      keepSource: targetText === '',
    });
    if (entries.length >= MAX_IMPORT_ROWS) {
      return { entries, skipped, truncated: index < lines.length - 1 };
    }
  }

  return { entries, skipped, truncated: false };
}
