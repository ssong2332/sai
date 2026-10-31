/**
 * 제3자 이름 빠짐 검사 (L28 남은 구멍 ①, 2026-10-31 사용자 승인 「판정표대로 진행」).
 *
 * 🔴 **실측한 결함 (2026-10-29 실확장, Claude Haiku 5.5)**: 원문 「박 과장님이 오늘 오후에 배포 결과를
 *    확인해야 합니다.」 → 교정문 "Could you check the deployment results this afternoon?" ·
 *    역번역 「오늘 오후에 배포 결과를 확인해 주실 수 있나요?」 — **「박 과장님」이 통째로 사라졌다.**
 *    `names.js`는 **수신자** 이름만 보고, `titleCheck.js`는 **지어낸 직급**만 봐서 둘 다 못 잡았다.
 *
 * 🔴 **고쳐 쓰지 않는다. 표시만 한다.** 이름을 어디에 어떻게 넣을지는 우리가 맞다는 근거가 없다.
 * 🔴 **틀릴 거면 「못 잡는」 쪽으로 틀린다** — 교정문과 역번역 **둘 다**에서 흔적이 없을 때만 경고한다.
 *
 * 판정표 (위에서부터 처음 맞는 행 하나만 적용한다)
 * | 순서 | 조건 | 결과 |
 * |---|---|---|
 * | 1 | 폴백 · 결과 없음 · 원문 언어가 `ko`가 아님 · 대상 언어가 `en`이 아님 | 없음 — 로마자 표가 영어 기준 |
 * | 2 | 원문에 「성 [이름] 직급[님]」(`titleCheck.js` `findTitledReferences`)이 없다 | 없음 |
 * | 3 | 그 참조가 용어집과 겹친다 · 화면이 아는 수신자 이름과 겹친다 | 없음 — 등록된 표기로 바뀌었거나, 받는 사람 본인이라 이름을 안 부르는 게 자연스럽다 |
 * | 4 | 교정문에 그 성의 로마자(`SURNAMES`, 첫 글자 대문자)나 원문 참조(한글)가 있다 | 없음 |
 * | 5 | 역번역에 그 성 글자가 **낱말 첫 글자로** 있다(「박 과장님」「박수홍」) | 없음 |
 * | 6 | 그 밖 | 🔴 경고 `{reference}` |
 *
 * 범위 밖 (알려진 한계): 성 표에 없는 성 · 직급 없이 이름만 부른 원문(「수진 씨」) · 영어 이외 대상 언어 ·
 * 역번역에서 그 성 글자로 시작하는 다른 낱말(「이것」「정말」)이 있으면 놓친다(못 잡는 쪽).
 * 🔴 Zero Retention: 입력 문자열은 이 함수 안에서만 쓰이고 어디에도 저장·기록되지 않는다.
 */

import { SURNAMES, collectGlossaryKeys, findTitledReferences, referenceRegistered } from './titleCheck.js';

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 받는 사람 본인인가 — 공백을 지우고 서로 포함하면(2자 이상) 같은 사람으로 본다. */
function isRecipient(reference, recipientNames) {
  const ref = reference.replace(/\s/g, '').replace(/님$/, '');
  return recipientNames
    .map((n) => String(n ?? '').replace(/\s/g, '').replace(/님$/, ''))
    .filter((n) => n.length >= 2)
    .some((n) => ref.includes(n) || n.includes(ref));
}

/**
 * 순수 판정 — 언어 판정은 호출자가 끝냈다고 본다.
 * @returns {Array<{reference: string}>} 사라진 원문 참조. 중복 없음, 원문 순서.
 */
export function findLostNames({ sourceText, refined, backTranslation, glossary = [], appliedGlossary = [], recipientNames = [] }) {
  const src = String(sourceText ?? '');
  const out = String(refined ?? '');
  const back = String(backTranslation ?? '');
  if (src.trim() === '' || out.trim() === '') return [];

  const { sourceKeys } = collectGlossaryKeys(glossary, appliedGlossary);
  const lost = [];
  for (const { reference, surname } of findTitledReferences(src)) {
    if (referenceRegistered(reference, sourceKeys)) continue;
    if (isRecipient(reference, recipientNames)) continue;
    const romans = SURNAMES[surname].map(escapeRe).join('|');
    if (new RegExp(`\\b(?:${romans})\\b`).test(out)) continue;
    if (out.replace(/\s/g, '').includes(reference.replace(/\s/g, '').replace(/님$/, ''))) continue;
    if (new RegExp(`(?:^|[^가-힣])${surname}`).test(back)) continue;
    if (!lost.some((item) => item.reference === reference)) lost.push({ reference });
  }
  return lost;
}

/** 화면용 진입점 — 판정표 행 1을 여기서 거른다. */
export function checkLostNames(result, sourceText = '', { glossary = [], recipientNames = [] } = {}) {
  if (!result || typeof result !== 'object' || result.fallback) return [];
  if (result.sourceLanguage !== 'ko' || result.targetLanguage !== 'en') return [];
  return findLostNames({
    sourceText,
    refined: result.refined ?? '',
    backTranslation: result.backTranslation ?? '',
    glossary,
    appliedGlossary: result.appliedGlossary ?? [],
    recipientNames,
  });
}

/** 화면 문구. 🔴 「빠졌을 수 있어요」 — 단정하지 않는다. */
export function lostNameWarningText(lost) {
  if (!Array.isArray(lost) || lost.length === 0) return '';
  const list = lost.map((item) => `「${item.reference}」`).join(', ');
  return `원문의 ${list}이(가) 다듬은 문장에서 빠졌을 수 있어요 — 누구 이야기인지 상대가 모를 수 있으니 역번역을 확인해 주세요.`;
}
