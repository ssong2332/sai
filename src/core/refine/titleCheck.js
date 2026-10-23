/**
 * 등록되지 않은 사람의 직급 지어내기 검사 (L32, 2026-10-23 — L28 실확장 발견 D6).
 *
 * 🔴 **실측한 결함 (운영 Gemini, 2026-10-23, 2회)**: 원문 「박 과장님이 오늘 오후에 배포 결과를
 *    확인해야 합니다.」 →
 *    - "Could you please check the deployment results by this afternoon, as Manager Park needs to review them?"
 *    - "Manager Park needs to check the deployment results this afternoon."
 *    프롬프트(`prompt.js` glossaryRules)는 등록되지 않은 사람에게 「직급을 직역해 성에 붙인
 *    "Manager Kim"」을 만들지 말라고 **명시적으로** 금지한다. 모델이 안 지켰다 — 이름 검사
 *    (`names.js`)·숫자 검사(`numberCheck.js`)와 같은 이유로 **코드가 확인한다.**
 *
 * 🔴 **고쳐 쓰지 않는다. 표시만 한다.** "Manager Park"을 무엇으로 바꿀지 우리가 맞다는 근거가 없다
 *    (원문 그대로 둘지, Mr./Ms.로 할지는 사람과 관계를 아는 사용자가 정한다).
 *
 * 🔴 **틀릴 거면 「못 잡는」 쪽으로 틀린다** (S42·S44 — 오탐이 잦으면 경고 전체를 흘려본다).
 *    원문 쪽·교정문 쪽 **둘 다** 좁은 모양만 본다. 하나라도 애매하면 경고하지 않는다.
 *
 * 판정표 (2026-10-23, 위에서부터 처음 맞는 행 하나만 적용한다)
 * | 순서 | 조건 | 결과 |
 * |---|---|---|
 * | 1 | 폴백 결과 · 결과 없음 | 없음 — 교정문이 원문 그대로라 대조할 것이 없다 |
 * | 2 | 원문 언어가 `ko`가 아니다 | 없음 — 한국어 직급 직역이 이 결함의 정체다 |
 * | 3 | 대상 언어가 `en`이 아니다 (zh·ja·de·fr·es — 값이 없을 때 포함) | 없음 — 🔴 **아직 안 본다**(아래 「범위 밖」) |
 * | 4 | 원문에 「성 [이름] 직급[님]」이 없다 | 없음 |
 * | 5 | 그 참조가 용어집(개인·팀 항목 또는 모델이 신고한 `appliedGlossary`)과 겹친다 | 없음 — 등록된 호칭은 정당하다 |
 * | 6 | 교정문에 「영어 직급어 + 그 성의 로마자」가 **붙어서** 나온다 | 🔴 경고 `{original, produced}` |
 * | 7 | 그 밖 (Mr./Ms. Park · Park 혼자 · 「박 과장님」 그대로 · 다른 성 · "the manager, Park,") | 없음 |
 *
 * 원문 참조 판정 (행 4)
 * - 성: 아래 `SURNAMES` 표의 한 글자 성. **앞 글자가 한글이면 성이 아니다**(「대박 과장님」의 박 ✗).
 * - 이름(선택): 한글 1~2자(「박수홍 과장님」). 성과 직급 사이 공백은 있어도 없어도 된다.
 * - 직급: `KO_TITLES`(긴 것부터). 뒤에 `님`이 오거나, 한글이 아닌 글자·끝·조사가 와야 한다
 *   (「박 과장급」처럼 낱말 중간이면 ✗).
 *
 * 교정문 판정 (행 6)
 * - 형태: `<영어 직급어> <성 로마자>` 또는 `<영어 직급어> <대문자 이름> <성 로마자>`
 *   ("Manager Park", "Deputy General Manager Jung", "Manager Su-hong Park").
 * - 직급어는 대소문자를 가리지 않는다("our manager Park"도 직급을 붙인 것이다).
 *   성 로마자는 **첫 글자 대문자만** 인정한다 — 소문자 "park"·"song"은 보통 낱말이다.
 * - 🔴 **Mr./Ms./Mrs./Miss/Dr.는 직급이 아니다** — 지어낸 직급이 아니라 일반 경칭이라 잡지 않는다.
 * - 🔴 **떨어진 직급은 잡지 않는다** — "the manager, Park," · "Park, our manager" · "Park (Manager)".
 *   동격 서술은 문장에 따라 정당할 수 있고(원문에 「과장」이 있으니 옮긴 것), 모양이 너무 다양해
 *   넓히면 오탐이 먼저 생긴다. 「직급 + 성」을 **호칭처럼 붙인 것**만 이 결함으로 본다.
 * - 교정문의 그 표현이 **원문에도 그대로** 있으면(원문에 영어로 "Manager Park"을 썼다) 잡지 않는다.
 *
 * 용어집 겹침 판정 (행 5) — 공백을 지우고 비교한다
 * - 원문 참조 쪽: 항목의 `sourceText`·`honorifics.ko`·`matchedInOriginal`·(신고) `sourceText` 중
 *   하나가 2자 이상이고 참조에 들어 있거나, 참조(님 뺀 것)가 그 값에 들어 있으면 등록된 것으로 본다.
 *   🔴 용어 항목 「과장 → Manager」도 여기 걸린다 — 사용자가 직접 정한 번역이므로 정당하다.
 * - 교정문 쪽: 찾은 영어 표현이 항목의 `targetText`·`honorifics` 값·(신고) `appliedText` 안에 있으면 통과.
 *
 * 범위 밖 (알려진 한계)
 * - 영어 이외 대상 언어(「朴科长」·「パク課長」·「Manager Park」의 독일어 「Abteilungsleiter Park」 등) —
 *   언어마다 직급어·어순이 달라 표를 따로 만들어야 한다. 실측 사례가 생기면 추가.
 * - 성 표에 없는 성 · 로마자 표에 없는 표기("Pahk") — 놓친다.
 * - 직급 없이 이름만 쓴 원문(「수홍 님」) — 대상이 아니다.
 * - 확장 화면은 팀 용어집 항목을 모른다 — 팀 항목으로 정당하게 바뀐 경우는 모델이 `appliedGlossary`에
 *   신고했을 때만 거른다(신고 누락 시 오탐 가능).
 *
 * 🔴 Zero Retention: 입력 문자열은 이 함수 안에서만 쓰이고 어디에도 저장·기록되지 않는다.
 */

/**
 * 한국 성 → 영어 로마자 표기 후보.
 * 🔴 "You"(유)·"I"(이)처럼 보통 영어 낱말과 겹치는 표기는 뺀다 — 직급어 뒤에 와도 오탐 위험만 크다.
 */
export const SURNAMES = {
  김: ['Kim', 'Gim'],
  이: ['Lee', 'Yi', 'Rhee', 'Ree', 'Rhie'],
  박: ['Park', 'Pak', 'Bak'],
  최: ['Choi', 'Choe'],
  정: ['Jung', 'Jeong', 'Chung', 'Joung'],
  강: ['Kang', 'Gang'],
  조: ['Cho', 'Jo'],
  윤: ['Yoon', 'Yun'],
  장: ['Jang', 'Chang'],
  임: ['Lim', 'Im', 'Rim'],
  한: ['Han'],
  오: ['Oh'],
  서: ['Seo', 'Suh'],
  신: ['Shin', 'Sin'],
  권: ['Kwon', 'Gwon'],
  황: ['Hwang'],
  안: ['Ahn', 'An'],
  송: ['Song'],
  류: ['Ryu', 'Yoo', 'Yu'],
  유: ['Yoo', 'Yu', 'Ryu'],
  홍: ['Hong'],
  전: ['Jeon', 'Jun', 'Chun'],
  고: ['Ko', 'Koh', 'Go'],
  문: ['Moon', 'Mun'],
  양: ['Yang'],
  손: ['Son', 'Sohn'],
  배: ['Bae'],
  백: ['Baek', 'Paik'],
  남: ['Nam'],
  노: ['Noh', 'Roh'],
  하: ['Ha'],
};

/** 한국어 직급 — 🔴 긴 것부터(「대표이사」가 「대표」보다, 「본부장」이 「부장」보다 먼저). */
export const KO_TITLES = [
  '대표이사', '부사장', '본부장', '센터장', '그룹장', '파트장',
  '사원', '주임', '대리', '과장', '차장', '부장', '팀장', '실장', '소장',
  '이사', '상무', '전무', '사장', '대표', '회장', '선임', '책임', '수석', '매니저', '프로',
].sort((a, b) => b.length - a.length);

/** 직급 바로 뒤에 와도 되는 조사(님이 없을 때) — 「박 과장이」「박 과장께」. */
const PARTICLE_AFTER_TITLE = /^(?:이|가|은|는|께|에게|도|과|와|을|를|의|으로|로|한테)/;

/**
 * 영어 직급어. 앞꾸밈말(0개 이상) + 머리말 1개.
 * 🔴 Mr./Ms./Mrs./Miss/Dr.는 **넣지 않는다** — 직급이 아니다(판정표 행 7).
 */
const EN_TITLE_MODIFIERS = [
  'Assistant', 'Deputy', 'Senior', 'Junior', 'Associate', 'Executive', 'General', 'Managing',
  'Vice', 'Chief', 'Principal', 'Section', 'Department', 'Division', 'Team', 'Group', 'Center',
  'Centre', 'Part', 'Project', 'Representative',
];
const EN_TITLE_HEADS = [
  'Manager', 'Director', 'President', 'Leader', 'Lead', 'Head', 'Chief', 'Executive', 'Officer',
  'Supervisor', 'Associate', 'Engineer', 'Researcher', 'Staff', 'Employee', 'CEO', 'VP',
  'Chairman', 'Chairperson', 'Specialist', 'Consultant', 'Pro',
];

/**
 * 직급어는 대소문자를 가리지 않는다. 🔴 성 로마자까지 무시하면 "park"(공원)이 걸려서 정규식 전체에
 *    `i` 플래그를 쓰지 않고, **낱말 목록만** 글자마다 `[Mm]`로 풀어 쓴다. 정규식 조각 전체에 적용하면
 *    `\s`가 `\[Ss]`로 바뀌어 여러 단어 직급("Deputy General Manager")이 끊긴다 — 테스트가 잡은 결함.
 */
function caseInsensitiveWord(word) {
  return word.replace(/[A-Za-z]/g, (ch) => `[${ch.toUpperCase()}${ch.toLowerCase()}]`);
}

const MODIFIER_RE = `(?:(?:${EN_TITLE_MODIFIERS.map(caseInsensitiveWord).join('|')})\\s+)*`;
const HEAD_RE = `(?:${EN_TITLE_HEADS.map(caseInsensitiveWord).join('|')})`;

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 공백 제거 — 「박 과장님」과 「박과장님」을 같게 본다. */
function squash(value) {
  return String(value ?? '').replace(/\s+/g, '');
}

/**
 * 원문에서 「성 [이름] 직급[님]」 참조를 찾는다(판정표 행 4).
 * @returns {Array<{reference: string, surname: string}>} 중복 없음, 원문 순서.
 */
export function findTitledReferences(sourceText) {
  const text = String(sourceText ?? '');
  const surnames = Object.keys(SURNAMES).join('');
  const re = new RegExp(`([${surnames}])([가-힣]{1,2})?\\s?(${KO_TITLES.join('|')})(님)?`, 'g');
  const out = [];
  for (const match of text.matchAll(re)) {
    const start = match.index;
    // 🔴 앞 글자가 한글이면 성이 아니다 — 「대박 과장님」「하고 과장님」.
    if (start > 0 && /[가-힣]/.test(text[start - 1])) continue;
    const [whole, surname, given, , honorific] = match;
    // 이름 자리에 직급이 끼어든 경우 방지 — 「박과장」을 성 박 + 이름 「과장」으로 읽지 않는다.
    if (given && KO_TITLES.some((title) => title.startsWith(given))) continue;
    if (!honorific) {
      const rest = text.slice(start + whole.length);
      // 낱말 중간이면(「박 과장급」) 직급 호칭이 아니다.
      if (/^[가-힣]/.test(rest) && !PARTICLE_AFTER_TITLE.test(rest)) continue;
    }
    const reference = whole.trim();
    if (!out.some((item) => item.reference === reference)) out.push({ reference, surname });
  }
  return out;
}

/** 용어집 항목이 원문 참조와 겹치는가(판정표 행 5 — 원문 쪽). */
function referenceRegistered(reference, keys) {
  const ref = squash(reference);
  const core = ref.replace(/님$/, '');
  return keys.some((key) => {
    const k = squash(key).replace(/님$/, '');
    if (k.length < 2) return false;
    return ref.includes(k) || k.includes(core);
  });
}

/** 찾은 영어 표현이 등록된 출력값 안에 있는가(판정표 행 5 — 교정문 쪽). */
function producedRegistered(produced, values) {
  const p = produced.toLowerCase().replace(/\s+/g, ' ');
  return values.some((value) => String(value).toLowerCase().replace(/\s+/g, ' ').includes(p));
}

/** 용어집 항목들에서 원문 쪽 비교값·출력 쪽 비교값을 모은다. */
function collectGlossaryKeys(glossary, appliedGlossary) {
  const sourceKeys = [];
  const targetValues = [];
  const push = (list, value) => {
    if (typeof value === 'string' && value.trim() !== '') list.push(value);
  };
  for (const entry of Array.isArray(glossary) ? glossary : []) {
    if (!entry || typeof entry !== 'object') continue;
    push(sourceKeys, entry.sourceText);
    push(sourceKeys, entry.matchedInOriginal);
    push(sourceKeys, entry.honorifics?.ko);
    push(targetValues, entry.targetText);
    if (entry.honorifics && typeof entry.honorifics === 'object') {
      for (const value of Object.values(entry.honorifics)) push(targetValues, value);
    }
  }
  for (const entry of Array.isArray(appliedGlossary) ? appliedGlossary : []) {
    if (!entry || typeof entry !== 'object') continue;
    push(sourceKeys, entry.sourceText);
    push(targetValues, entry.appliedText);
  }
  return { sourceKeys, targetValues };
}

/**
 * 순수 판정 — 언어 판정은 호출자가 끝냈다고 본다.
 *
 * @param {object} input
 * @param {string} input.sourceText 한국어 원문.
 * @param {string} input.refined 영어 교정문.
 * @param {object[]} [input.glossary] 요청에 실린(또는 화면이 아는) 용어집 항목.
 * @param {object[]} [input.appliedGlossary] 모델이 신고한 적용 목록.
 * @returns {Array<{original: string, produced: string}>}
 */
export function findInventedTitles({ sourceText, refined, glossary = [], appliedGlossary = [] }) {
  const src = String(sourceText ?? '');
  const out = String(refined ?? '');
  if (src.trim() === '' || out.trim() === '') return [];

  const { sourceKeys, targetValues } = collectGlossaryKeys(glossary, appliedGlossary);
  const findings = [];
  for (const { reference, surname } of findTitledReferences(src)) {
    if (referenceRegistered(reference, sourceKeys)) continue;
    const romans = SURNAMES[surname].map(escapeRe).join('|');
    // 직급어는 대소문자 무시(목록에서 이미 풀어 씀), 성 로마자는 첫 글자 대문자만.
    const re = new RegExp(
      `\\b(${MODIFIER_RE}${HEAD_RE})\\s+(?:[A-Z][a-z]+(?:-[a-z]+)?\\s+)?(?:${romans})\\b`,
      'g',
    );
    for (const match of out.matchAll(re)) {
      const produced = match[0].replace(/\s+/g, ' ');
      if (src.includes(produced)) continue;
      if (producedRegistered(produced, targetValues)) continue;
      if (!findings.some((f) => f.original === reference && f.produced === produced)) {
        findings.push({ original: reference, produced });
      }
    }
  }
  return findings;
}

/**
 * 화면용 진입점 — 판정표 행 1~3을 여기서 거른다.
 *
 * @param {object|null} result `normalizeRefineResponse` 결과(+ `sourceLanguage`·`targetLanguage`).
 * @param {string} sourceText 원문.
 * @param {{glossary?: object[]}} [options] 화면이 아는 용어집 항목.
 */
export function checkInventedTitles(result, sourceText = '', { glossary = [] } = {}) {
  if (!result || typeof result !== 'object' || result.fallback) return [];
  if (result.sourceLanguage !== 'ko') return [];
  if (result.targetLanguage !== 'en') return [];
  return findInventedTitles({
    sourceText,
    refined: result.refined ?? '',
    glossary,
    appliedGlossary: result.appliedGlossary ?? [],
  });
}

/**
 * 화면 문구. 🔴 「지어냈을 수 있어요」 — 단정하지 않는다. 그 사람이 실제로 매니저일 수도 있다
 *    (우리가 아는 건 「등록이 안 됐다」는 것뿐이다). 판단은 사용자가 한다.
 */
export function inventedTitleWarningText(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return '';
  const list = findings.map((f) => `"${f.produced}"(원문 「${f.original}」)`).join(', ');
  return `직급을 지어냈을 수 있어요 — ${list}. 등록되지 않은 사람의 직급은 옮기지 않는 게 원칙이에요 — 용어집에 등록하면 원하는 호칭으로 바뀌어요.`;
}
