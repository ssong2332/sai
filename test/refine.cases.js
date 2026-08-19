/**
 * `/v1/refine` 통합 테스트 케이스 — `docs/reference/TestCases-legacy.md` 74건에서 **20건 선별**.
 * 6개 반환 필드를 전부 덮도록 골랐다 (Tasks.md S03).
 *
 * 🔴 레거시 문서의 금지 조항을 그대로 승계한다:
 *    - 케이스를 통과시키려고 프롬프트를 케이스 문자열에 맞추지 말 것(과적합). 규칙을 고치고 케이스는 둔다.
 *    - 실행하지 않은 케이스를 "통과"로 기록하지 말 것. 미실행은 `-`로 남긴다.
 *    - 케이스를 삭제하지 말 것. 부적절하면 사유를 적고 `skip: true` 표시만 한다.
 *
 * 판정: `통과 = (mustInclude 전부 존재) AND (mustNotInclude 전부 부재) AND (expect 전부 일치)`
 * 문자열 매칭은 소문자 정규화 후 부분일치이며, `필수 포함`은 **의미 보존**이 원칙이라
 * 대안 표기는 배열 안의 배열(OR)로 적는다.
 */

const KO_EN = { sourceLanguage: 'ko', targetLanguage: 'en' };
const REFERENCE_DATE = '2026-08-12';

/** 용어집 시드 — AC-015/AC-047 케이스용. 실제 인물이 아닌 합성 데이터다. */
export const GLOSSARY_SEED = [
  { id: 'g1', entryType: 'term', scope: 'personal', sourceText: 'Nexus', targetText: null, keepSource: true },
  { id: 'g2', entryType: 'person', scope: 'personal', sourceText: '김수진', honorifics: { ko: '김 대리님', en: 'Sujin Kim' } },
];

/**
 * @typedef {object} RefineCase
 * @property {string} id 레거시 케이스 ID (추적용 — 새로 만들지 않는다).
 * @property {string} field 이 케이스가 주로 검증하는 반환 필드.
 * @property {object} request refine() 요청.
 * @property {object} [expect] 필드 동등 비교 (urgency, detectedIntent, ticketPresent).
 * @property {Array<string|string[]>} [mustInclude] refined에 있어야 하는 값(배열이면 OR).
 * @property {string[]} [mustNotInclude] refined에 나타나면 실패.
 */

/** @type {RefineCase[]} */
export const REFINE_CASES = [
  // ── urgency (Spec 필수 1) — 레거시 T-U 세트 ────────────────────────────
  {
    id: 'T-U01',
    field: 'urgency',
    request: { ...KO_EN, text: '결제 API 전체 다운, 주문 전부 실패 중', referenceDate: REFERENCE_DATE },
    expect: { urgency: 'CRITICAL', urgencySource: 'ai' },
  },
  {
    id: 'T-U02',
    field: 'urgency',
    request: { ...KO_EN, text: '보안 취약점 발견, 오늘 중 패치 필요', referenceDate: REFERENCE_DATE },
    expect: { urgency: 'CRITICAL', urgencySource: 'ai' },
  },
  {
    id: 'T-U03',
    field: 'urgency',
    request: { ...KO_EN, text: '내일 오전까지 리뷰 부탁드립니다', referenceDate: REFERENCE_DATE },
    expect: { urgency: 'NORMAL', urgencySource: 'ai' },
  },
  {
    id: 'T-U04',
    field: 'urgency',
    request: { ...KO_EN, text: '다음 주 회의 자료 초안입니다', referenceDate: REFERENCE_DATE },
    expect: { urgency: 'LOW', urgencySource: 'ai' },
  },
  {
    // 사용자 사전 선택이 AI 판정을 이긴다 (Spec 필수 1). 레거시의 override 시연용 케이스.
    id: 'T-U05',
    field: 'urgency',
    request: { ...KO_EN, text: '버튼 색상이 조금 어두운 것 같습니다', userUrgency: 'CRITICAL', referenceDate: REFERENCE_DATE },
    expect: { urgency: 'CRITICAL', urgencySource: 'user', aiUrgency: 'LOW' },
  },

  // ── refined — 정보 보존 (레거시 AC-006 / T-P) ─────────────────────────
  {
    id: 'P-02',
    field: 'refined',
    request: { ...KO_EN, text: '결제 API 죽었습니다. 지금 주문 전부 실패 중이에요. 당장 확인 부탁드립니다.', referenceDate: REFERENCE_DATE },
    mustInclude: ['payment', ['all orders', 'every order', 'orders are failing']],
    mustNotInclude: ['if possible', 'at your convenience'],
  },
  {
    id: 'P-04',
    field: 'refined',
    request: { ...KO_EN, text: '서버 응답이 평소 200ms에서 3초로 늘었습니다. 원인 확인이 필요합니다.', referenceDate: REFERENCE_DATE },
    mustInclude: ['200ms', ['3 seconds', '3s', '3 sec']],
  },
  {
    id: 'P-05',
    field: 'refined',
    request: { ...KO_EN, text: '예산이 5천만원에서 3천만원으로 줄었습니다. 범위 재조정이 필요합니다.', referenceDate: REFERENCE_DATE },
    mustInclude: [['krw', '원', 'won']],
    mustNotInclude: ['usd', '$'],
  },
  {
    // 부정 사실의 보존 — "안 했습니다"가 사라지면 실패.
    id: 'T-P07',
    field: 'refined',
    request: { ...KO_EN, text: '테스트 환경에서만 확인됐고 운영 반영은 안 했습니다', referenceDate: REFERENCE_DATE },
    mustInclude: [['not', "haven't", 'has not', 'no']],
  },

  // ── refined — 어미에 숨은 긴급도 복원 (레거시 AC-045) ─────────────────
  {
    id: 'U-01',
    field: 'refined',
    request: { ...KO_EN, text: '혹시 오늘 중으로 가능하실까요?', referenceDate: REFERENCE_DATE },
    mustInclude: [['today', 'end of day', 'eod']],
    mustNotInclude: ['maybe', 'if possible', 'whenever'],
  },
  {
    id: 'U-07',
    field: 'refined',
    request: { ...KO_EN, text: '바쁘신 와중에 죄송하지만, 결제 API 장애 건 확인 부탁드립니다.', referenceDate: REFERENCE_DATE },
    mustInclude: ['payment'],
    mustNotInclude: ['sorry to bother you'],
  },
  {
    id: 'U-10',
    field: 'refined',
    request: { ...KO_EN, text: '혹시 제가 놓친 부분이 있을까요? 금요일까지 승인이 안 되면 다음 스프린트가 밀립니다.', referenceDate: REFERENCE_DATE },
    mustInclude: ['friday', ['approval', 'approve'], 'sprint'],
    mustNotInclude: ['did i miss something'],
  },

  // ── refined — 날짜·숫자 정규화 (레거시 AC-049) ────────────────────────
  {
    id: 'D-01',
    field: 'refined',
    request: { ...KO_EN, text: '8/4까지 초안 부탁드립니다.', referenceDate: REFERENCE_DATE },
    mustInclude: [['aug 4, 2026', 'august 4, 2026']],
    mustNotInclude: ['8/4', '04/08'],
  },
  {
    id: 'D-04',
    field: 'refined',
    request: { ...KO_EN, text: '비용은 3,000만원입니다.', referenceDate: REFERENCE_DATE },
    mustInclude: [['30,000,000', '30 million', '3천만원']],
    mustNotInclude: ['usd', '$'],
  },
  {
    id: 'D-05',
    field: 'refined',
    request: { ...KO_EN, text: '응답 시간이 200ms입니다.', referenceDate: REFERENCE_DATE },
    mustInclude: ['200ms'],
    mustNotInclude: ['0.2s', '0.2 seconds'],
  },

  // ── detectedIntent + ticket (Spec 필수 4) — 레거시 T-E 세트 ───────────
  {
    id: 'T-E01',
    field: 'ticket',
    request: { ...KO_EN, text: '이거 왜 자꾸 늦어지는 거예요? 답답하네요', referenceDate: REFERENCE_DATE },
    expect: { detectedIntent: 'venting', ticketPresent: true },
    // 감정은 삭제가 아니라 concernLevel에 보존되어야 한다 (AC-018).
    ticketConcernNotEmpty: true,
  },
  {
    id: 'T-E02',
    field: 'ticket',
    request: { ...KO_EN, text: '이건 명백히 그쪽 실수입니다', referenceDate: REFERENCE_DATE },
    expect: { detectedIntent: 'venting', ticketPresent: true },
  },
  {
    // 🔴 이 세트의 핵심 — 감정 신호가 없으면 티켓을 제안하지 않는다 (오탐 방지, Lessons 자산 3).
    id: 'T-E03',
    field: 'detectedIntent',
    request: { ...KO_EN, text: '확인 부탁드립니다', referenceDate: REFERENCE_DATE },
    expect: { detectedIntent: 'normal', ticketPresent: false },
  },
  {
    id: 'T-E04',
    field: 'ticket',
    request: { ...KO_EN, text: '저번에도 이러셨는데 또 이러시네요', referenceDate: REFERENCE_DATE },
    expect: { detectedIntent: 'venting', ticketPresent: true },
  },

  // ── appliedGlossary (Spec 필수 7) — 레거시 T-G / AC-047 ───────────────
  {
    id: 'T-G01',
    field: 'appliedGlossary',
    request: { ...KO_EN, text: 'Nexus 프로젝트 스테이징 배포 완료', glossary: GLOSSARY_SEED, referenceDate: REFERENCE_DATE },
    mustInclude: ['Nexus'],
    expect: { appliedGlossaryMin: 1 },
  },
  {
    // 한국어 직급을 영어로 옮기며 위계를 지어내는 것("Manager Kim")이 금지 대상이다.
    id: 'N-02',
    field: 'appliedGlossary',
    request: { ...KO_EN, text: '김 대리님이 확인해 주셔야 합니다.', glossary: GLOSSARY_SEED, referenceDate: REFERENCE_DATE },
    mustInclude: ['Sujin Kim'],
    mustNotInclude: ['manager kim', 'assistant manager kim'],
    expect: { appliedGlossaryMin: 1 },
  },
];

/** backTranslation(Spec 필수 3)은 상시 노출이므로 전 케이스 공통으로 검사한다. */
export const BACK_TRANSLATION_REQUIRED_FOR_ALL = true;

/** 케이스 1건을 판정한다. @returns {{pass: boolean, failures: string[]}} */
export function judgeCase(testCase, result) {
  const failures = [];
  const refined = (result.refined ?? '').toLowerCase();

  for (const needle of testCase.mustInclude ?? []) {
    const options = Array.isArray(needle) ? needle : [needle];
    if (!options.some((option) => refined.includes(option.toLowerCase()))) {
      failures.push(`mustInclude: ${options.join(' | ')}`);
    }
  }
  for (const needle of testCase.mustNotInclude ?? []) {
    if (refined.includes(needle.toLowerCase())) failures.push(`mustNotInclude: ${needle}`);
  }

  const expect = testCase.expect ?? {};
  if (expect.urgency !== undefined && result.urgency !== expect.urgency) {
    failures.push(`urgency: ${result.urgency} != ${expect.urgency}`);
  }
  if (expect.urgencySource !== undefined && result.urgencySource !== expect.urgencySource) {
    failures.push(`urgencySource: ${result.urgencySource} != ${expect.urgencySource}`);
  }
  if (expect.aiUrgency !== undefined && result.aiUrgency !== expect.aiUrgency) {
    failures.push(`aiUrgency: ${result.aiUrgency} != ${expect.aiUrgency}`);
  }
  if (expect.detectedIntent !== undefined && result.detectedIntent !== expect.detectedIntent) {
    failures.push(`detectedIntent: ${result.detectedIntent} != ${expect.detectedIntent}`);
  }
  if (expect.ticketPresent !== undefined && (result.ticket !== null) !== expect.ticketPresent) {
    failures.push(`ticketPresent: ${result.ticket !== null} != ${expect.ticketPresent}`);
  }
  if (expect.appliedGlossaryMin !== undefined && result.appliedGlossary.length < expect.appliedGlossaryMin) {
    failures.push(`appliedGlossary: ${result.appliedGlossary.length} < ${expect.appliedGlossaryMin}`);
  }
  if (testCase.ticketConcernNotEmpty && (!result.ticket || result.ticket.concernLevel === '없음')) {
    failures.push('ticket.concernLevel: 감정이 보존되지 않음');
  }

  if (BACK_TRANSLATION_REQUIRED_FOR_ALL && !result.fallback) {
    if (typeof result.backTranslation !== 'string' || result.backTranslation.trim() === '') {
      failures.push('backTranslation: 비어 있음 (Spec 필수 3 상시 노출)');
    }
  }

  return { pass: failures.length === 0, failures };
}
