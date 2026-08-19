/**
 * 태그 도출 판정표 (S22 / Spec audit 3 · 필수 9).
 *
 * 🔴 **2026-08-14 사용자 승인 판정표를 그대로 옮긴 것이다.** 표를 코드에 흩뿌리지 않고 배열
 *    하나로 두는 이유: 조건이 if문으로 흩어지면 "표대로 하고 있는가"를 눈으로 확인할 수 없다.
 *    **표에 없는 케이스는 판단하지 않는다** — 임의 판단 대신 표에 행을 추가할지 사용자에게 묻는다.
 *
 * 🔴 **입력 정의 갱신 (2026-08-14 사용자 승인)**: `N`은 처음엔 "코멘트 수"였으나 **PR 설명문을
 *    포함한 '사람이 쓴 공개 글' 수**(`writingCount`)로 바꿨다. 실측에서 코멘트 0건·PR 149건인
 *    계정이 나와, 코멘트만 보면 PR 중심으로 일하는 사람에게 이 기능이 아무것도 못 했다.
 *
 * | # | 조건 | 제안 태그 |
 * |---|---|---|
 * | 0 | `writingCount < 15` | **제안 없음** (게이트) |
 * | 1 | `lengthMedian <= 80` | `prefers-short` |
 * | 2 | `lengthMedian >= 200` | `prefers-context` |
 * | 3 | `hedgeRatio <= 0.15` | `prefers-direct` |
 * | ~~4~~ | ~~`morningRatio >= 0.5`~~ | **제거됨** (2026-08-19 — 태그 자체를 없앴다) |
 * | 5 | `burstRatio >= 0.4` | `async-friendly` |
 * | 6 | `casualRatio >= 0.2` | `casual-ok` |
 *
 * 🔴 **임계값은 실측으로 검증되지 않았다** (2026-08-14 시점). 근거가 될 데이터셋이 없어 내가
 *    정한 값이다. 실제 계정으로 돌려 보고 조정하기로 했으며, 조정하면 **이 표와 위 주석을
 *    함께** 고친다.
 *
 * 🔴 **전부 "제안"이다. 자동 확정하지 않는다** (필수 9). 사용자가 항목별로 승인해야 수신자에
 *    붙는다. 그래서 각 행이 `evidence`(사람이 읽는 근거 문구)를 함께 낸다 — 근거 없이 태그만
 *    들이밀면 사용자가 판단할 수 없다.
 *
 * 🔴 **근거 문구의 수치는 화면용이다 — 저장되지 않는다.** 저장은 태그 id뿐이다(Lessons #8이
 *    검증된 패턴으로 기록한 형태: "코멘트 평균 2문장 → 간결 제안").
 */

/**
 * 판정을 아예 하지 않는 최소 활동량. 이 아래는 표본이 적어 무엇을 말해도 추측이 된다.
 *
 * 🔴 **수집은 반드시 3페이지(300건)를 받아야 한다** (2026-08-14 실측). `events/public` 1페이지
 *    (100건)만 받으면 대부분이 PushEvent라 코멘트가 12~13건에 그쳐, **활발한 계정도 이 문턱을
 *    못 넘는다**(gaearon 12 / sindresorhus 13 → 둘 다 제안 없음). 3페이지를 받으면 40 / 34로
 *    올라가 판정이 나온다. 즉 이 상수를 낮출 게 아니라 **수집을 늘려야** 하는 문제였다.
 */
export const MIN_WRITINGS = 15;

/** 왜 제안이 없는지 — 화면에 그대로 쓴다. 🔴 조용히 빈 목록을 주지 않는다. */
export const SKIP_REASONS = {
  TOO_FEW: 'too-few-writings',
  NO_MATCH: 'no-rule-matched',
};

const round1 = (value) => Math.round(value * 10) / 10;
const percent = (value) => Math.round(value * 100);

/**
 * 판정표 본문. 각 행은 `{ id, tagId, when, evidence }`.
 * `when(signals)` → boolean · `evidence(signals)` → 사용자에게 보여줄 한 줄.
 */
export const TAG_RULES = [
  {
    id: 1,
    tagId: 'prefers-short',
    when: (s) => s.lengthMedian <= 80,
    evidence: (s) => `공개 글(코멘트·PR 설명) 중앙값 ${round1(s.lengthMedian)}자 — 짧게 쓰는 편이에요`,
  },
  {
    id: 2,
    tagId: 'prefers-context',
    when: (s) => s.lengthMedian >= 200,
    evidence: (s) => `중앙값 ${round1(s.lengthMedian)}자 — 배경을 함께 쓰는 편이에요`,
  },
  {
    id: 3,
    tagId: 'prefers-direct',
    when: (s) => s.hedgeRatio <= 0.15,
    evidence: (s) => `완곡한 표현이 ${percent(s.hedgeRatio)}%로 적어요`,
  },
  /**
   * 🔴 **4번 규칙(`morning-fast`)을 없앴다** (2026-08-19 사용자 결정). 태그 자체가 사라졌다 —
   *    그 태그만 「어떻게 쓸지」가 아니라 「언제 답이 오는가」였고, 교정 문장을 바꾸지 못했다
   *    (`src/lib/recipients.js`의 제거 주석 참고).
   * 🔴 `morningRatio` 신호는 `signals.js`에 그대로 둔다 — 지금 쓰는 규칙은 없지만, 계산이
   *    싸고 「현지 오전 활동 비율」은 나중에 다른 판정(회신 시간대 추천 등)에 쓸 수 있는 값이다.
   *    쓰지 않을 것이 확정되면 그때 신호까지 지운다.
   * 🔴 **번호는 다시 매기지 않는다** — 5·6은 그대로다. 번호를 당기면 예전 로그·문서의
   *    「규칙 5번」이 다른 것을 가리키게 된다.
   */
  {
    id: 5,
    tagId: 'async-friendly',
    when: (s) => s.burstRatio >= 0.4,
    evidence: (s) => `${percent(s.burstRatio)}%가 몰아서 처리한 흔적이에요`,
  },
  {
    id: 6,
    tagId: 'casual-ok',
    when: (s) => s.casualRatio >= 0.2,
    evidence: (s) => `가벼운 관용 표현이 공개 글의 ${percent(s.casualRatio)}%예요`,
  },
];

/**
 * 신호 → 태그 제안.
 *
 * @param {object} signals `collectSignals()` 결과.
 * @returns {{suggestions: {tagId: string, ruleId: number, evidence: string}[], skipped: string|null}}
 *   🔴 `suggestions`가 비면 `skipped`에 **왜 비었는지**가 들어간다 — 화면이 "찾지 못했어요"와
 *      "판단하지 않았어요"를 구분해 말할 수 있어야 한다(결정 요약에서 같은 실수를 한 적이 있다).
 */
export function suggestTags(signals) {
  if (!signals || signals.writingCount < MIN_WRITINGS) {
    return { suggestions: [], skipped: SKIP_REASONS.TOO_FEW };
  }

  const suggestions = [];
  for (const rule of TAG_RULES) {
    if (!rule.when(signals)) continue;
    suggestions.push({ tagId: rule.tagId, ruleId: rule.id, evidence: rule.evidence(signals) });
  }

  return {
    suggestions,
    skipped: suggestions.length === 0 ? SKIP_REASONS.NO_MATCH : null,
  };
}

/** 화면 문구 — 코드 여기저기에 문장을 흩뿌리지 않는다. */
export function skipMessage(skipped, signals = null) {
  if (skipped === SKIP_REASONS.TOO_FEW) {
    // 🔴 `commentCount`를 읽고 있었다(2026-08-14 이름 변경 후 남은 잔재) — 항상 0으로 표시됐다.
    const count = signals?.writingCount ?? 0;
    return `공개 글이 ${count}건이라 판단하지 않았어요 (${MIN_WRITINGS}건 이상 필요)`;
  }
  if (skipped === SKIP_REASONS.NO_MATCH) {
    return '판정 기준에 뚜렷하게 걸리는 항목이 없었어요 — 태그는 직접 골라 주세요';
  }
  return '';
}
