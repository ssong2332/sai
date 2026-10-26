/**
 * 「왜 이렇게 바꿨나」 — 서버가 **이미 보내고 있던** 근거 필드를 화면에 낼 수 있는 형태로 정리한다.
 * (2026-08-14 사용자 제안 ③ / Manyfast F-4.1 계열)
 *
 * 🔴 **새로 만드는 기능이 아니다.** `schema.js`가 `refinedReason`·`preserved`·`misreadRisks`·
 *    `unregisteredHonorifics`를 매 호출마다 정규화해 돌려주는데도 팝업이 한 글자도 렌더하지
 *    않고 있었다(2026-08-14 확인). 토큰을 내고 버리던 것을 꺼내 보이는 것뿐이라 서버·프롬프트·
 *    스키마를 건드리지 않는다 — 새 실패 지점이 생기지 않는다.
 *
 * 🔴 **단어별 툴팁을 만들지 않는다.** 한국어→영어는 단어 대응이 1:1이 아니라 정렬이 불안정하고,
 *    모델이 그럴듯한 거짓 근거를 붙이면 사용자가 검증할 방법이 없다 — 결정 요약을 끈 것과 같은
 *    실패 모드다(`FEATURES.decisionSummary = false`). 모델이 **자기 근거와 함께** 내놓은
 *    구절 단위 대응만 쓴다.
 *
 * ## 판정표 — 어떤 항목을 보여줄 것인가
 *
 * | 항목 | 통과 조건 | 근거 |
 * |---|---|---|
 * | `preserved` | `sourceText`가 **원문에 실제로 있고**, `refinedText`가 **교정문에 실제로 있다** | 지어낸 "지켜냈다"를 거르려고 |
 * | `misreadRisks` | `quote`가 **교정문 또는 원문에 실제로 있다** (인용·오해·근거 3요소는 스키마가 이미 강제) | 없는 문장을 경고하지 않으려고 |
 * | `unregisteredHonorifics` | 원문·교정문 어느 쪽에든 실제로 있다 **+ 사람 호칭이다**(`isPersonAddress`) | 위와 같음 · 존대 어미를 호칭으로 안내하지 않으려고 |
 * | `refinedReason` | 비어 있지 않다 | 인용이 없는 서술이라 대조할 대상이 없다 |
 *
 * 🔴 대조를 통과 못 한 항목은 **조용히 버린다**. "모델이 이렇게 주장했다"를 굳이 보여주면
 *    사용자가 검증해야 할 것만 늘어난다.
 * 🔴 이 파일은 본문을 **읽기만** 한다 — 어디에도 저장·전송하지 않는다 (Spec 필수 5).
 */

/**
 * `preserved.kind` → 화면 라벨. 스키마가 이 셋으로 좁혀서 준다.
 * 🔴 `action`은 「할 일」이다 (2026-10-27 사용자 승인). 예전 「요청」은 작성자 자신의 약속(「다시 공유드릴게요 →
 *    I'll share it」)에도 「요청 유지」로 붙어, 약속을 요청으로 읽게 했다(L28 계열). 모델은 요청과 약속을 구분해
 *    주지 않으므로 둘 다 맞는 이름을 쓴다 — 티켓 「다음 할 일」과 같은 말.
 */
export const PRESERVED_LABELS = {
  deadline: '기한',
  number: '숫자',
  action: '할 일',
};

/**
 * 「용어집에 없는 호칭」으로 보여줄 것 — **사람을 부르는 말**만 (2026-10-27 실측 결함).
 * 모델이 「드릴게요」「안녕하세요.」 같은 **존대 어미·인사**까지 `unregisteredHonorifics`로 신고했고, 화면은
 * 「등록해 두면 같은 번역이 나와요」라고 안내했다 — 용어집 사람 항목으로 등록할 수 없는 말이다.
 *
 * | 신고된 말 | 표시 |
 * |---|---|
 * | 사람 호칭·직함 낱말이 들어 있다(`님`·`씨`·직급·`Mr.`·`先生` …) | 보인다 |
 * | 그 밖(존대 어미 `드릴게요`·인사 `안녕하세요`·`감사합니다` …) | 버린다 |
 *
 * 🔴 틀릴 거면 「안 보이는」 쪽으로 — 이 안내는 경고가 아니라 등록 권유라 놓쳐도 해가 없다.
 */
const PERSON_ADDRESS =
  /님|씨|선배|대리|과장|차장|부장|팀장|실장|본부장|이사|상무|전무|사장|대표|매니저|책임|선임|수석|주임|교수|선생|박사|\b(?:Mr|Mrs|Ms|Mx|Dr|Prof)\b\.?|先生|女士|小姐|经理|老师|总监|老板/;

export function isPersonAddress(word) {
  return PERSON_ADDRESS.test(String(word ?? ''));
}

/**
 * 대조용 정규화 — 공백 차이·대소문자로 진짜 인용을 놓치지 않으려고.
 * 🔴 정규식을 만들지 않는다: 사용자·모델 문자열을 패턴으로 해석하면 안 된다.
 */
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** `needle`이 `haystack`에 실제로 들어 있는가. 빈 문자열은 **없는 것으로 친다**. */
export function occursIn(needle, haystack) {
  const a = normalize(needle);
  if (a === '') return false;
  return normalize(haystack).includes(a);
}

/**
 * 화면에 낼 근거 묶음을 만든다.
 *
 * @param {object|null} result `normalizeRefineResponse`의 결과.
 * @param {string} sourceText 사용자가 쓴 원문.
 * @returns {{
 *   reason: string,
 *   preserved: Array<{kind: string, label: string, sourceText: string, refinedText: string}>,
 *   risks: Array<{quote: string, misreading: string, evidence: string}>,
 *   honorifics: string[],
 *   total: number,
 * }} `total`은 근거로 셀 수 있는 항목 수 — 0이면 섹션을 아예 렌더하지 않는다.
 */
export function buildReasoning(result, sourceText = '') {
  if (!result || typeof result !== 'object') {
    return { reason: '', preserved: [], risks: [], honorifics: [], total: 0 };
  }

  const refined = result.refined ?? '';
  const both = `${sourceText}\n${refined}`;

  const preserved = (result.preserved ?? []).filter(
    (item) => occursIn(item.sourceText, sourceText) && occursIn(item.refinedText, refined),
  );

  const risks = (result.misreadRisks ?? []).filter((item) => occursIn(item.quote, both));

  // 🔴 중복 제거 — 같은 경어가 여러 번 나와도 안내는 한 번이면 된다.
  const honorifics = [
    ...new Set(
      (result.unregisteredHonorifics ?? []).filter((word) => occursIn(word, both) && isPersonAddress(word)),
    ),
  ];

  const reason = typeof result.refinedReason === 'string' ? result.refinedReason.trim() : '';

  return {
    reason,
    preserved: preserved.map((item) => ({
      ...item,
      label: PRESERVED_LABELS[item.kind] ?? PRESERVED_LABELS.action,
    })),
    risks,
    honorifics,
    total: (reason ? 1 : 0) + preserved.length + risks.length + honorifics.length,
  };
}
