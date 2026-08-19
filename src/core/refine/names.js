/**
 * 이름·호칭 보존 검사 (2026-08-16 사용자 요청 — 「호칭 지어내는 것도 같이 잡아」).
 *
 * 🔴 **실측한 결함**: 수신자 「싱싱」에게 보내는 문장에서
 *    - 중국어 교정문은 `上晦先生/女士`를 만들어냈다 — **없는 한자 이름 + 성별 미상 호칭**.
 *    - 독일어 교정문은 이름을 **통째로 빼버렸다**.
 *    프롬프트에는 이미 「등록되지 않은 사람의 호칭을 지어내지 말라」가 있지만 모델이 지키지
 *    않았다. 프롬프트로 4번 시도해 실패한 다른 건(설명 언어)과 같은 성격이라, 여기서는
 *    **코드가 확인한다.**
 *
 * 🔴 **이 파일은 고쳐 쓰지 않는다. 표시만 한다.** 이 프로젝트의 검증기는 언제나 경고를 *더할*
 *    뿐 모델 출력을 다시 쓰지 않는다(`verify.js`·`missing.js`와 같은 규칙). 이름을 우리가
 *    치환하면 어색한 자리에 박히고, 무엇보다 **우리가 맞다는 근거가 없다.**
 *
 * 🔴 **판정은 「원문에 있던 이름이 교정문에 그대로 있는가」 하나뿐이다.**
 *    - 있으면 통과. 음차·번역 여부를 우리가 판정하려 들지 않는다(그건 언어 지식이 필요하다).
 *    - 없으면 **사라졌거나 바뀐 것**이고, 둘 다 사용자가 봐야 할 사건이다.
 *    이 규칙은 한 방향으로만 틀린다: 놓칠 수는 있어도 **멀쩡한 문장을 잡지는 않는다.**
 */

/** 한국어 호칭 접미사 — 「싱싱님」으로 등록돼 있어도 이름은 「싱싱」이다. */
const KO_SUFFIXES = ['님', '씨', '군', '양'];

/**
 * 등록된 표기에서 검사할 이름 후보를 만든다.
 * 🔴 너무 짧은 조각은 버린다 — 한 글자는 아무 문장에나 우연히 들어 있어 검사가 무의미해진다.
 */
function candidates(name) {
  const base = String(name ?? '').trim();
  if (base.length < 2) return [];
  const out = new Set([base]);
  for (const suffix of KO_SUFFIXES) {
    if (base.endsWith(suffix) && base.length - suffix.length >= 2) {
      out.add(base.slice(0, -suffix.length));
    }
  }
  return [...out];
}

/**
 * 원문에 있던 이름이 교정문에도 남아 있는지 본다.
 *
 * @param {object} input
 * @param {string} input.sourceText 사용자가 쓴 원문.
 * @param {string} input.refined 모델이 만든 교정문.
 * @param {string[]} [input.names] 확인할 이름들(수신자 이름 등).
 * @returns {{dropped: string[]}} 원문에는 있는데 교정문에서 사라진 이름. 없으면 빈 배열.
 */
export function checkNamesPreserved({ sourceText, refined, names = [] }) {
  const src = String(sourceText ?? '');
  const out = String(refined ?? '');
  // 🔴 둘 중 하나라도 비면 **판정하지 않는다** — 빈 값으로 "사라졌다"고 말하면 오탐만 만든다.
  if (src.trim() === '' || out.trim() === '') return { dropped: [] };

  const dropped = [];
  for (const raw of names) {
    /**
     * 🔴 **후보는 「또는」이다** (테스트가 잡은 결함). 「싱싱님」으로 등록해 두면 후보가
     *    `싱싱님`·`싱싱` 둘인데, 교정문이 `싱싱`만 남겼을 때 **멀쩡한 문장을 잡았다** —
     *    호칭이 언어에 따라 안 붙는 건 정상이고, 확인해야 할 것은 **이름이 남았는가**다.
     *    하나라도 남아 있으면 통과시킨다. 오탐이 잦으면 경고 자체를 안 읽게 된다.
     */
    const forms = candidates(raw);
    // 원문에 없던 이름은 애초에 검사 대상이 아니다(다른 사람 얘기일 수 있다).
    const inSource = forms.filter((name) => src.includes(name));
    if (inSource.length === 0) continue;
    if (inSource.some((name) => out.includes(name))) continue;
    // 표시는 **가장 짧은 형태**(이름 본체)로 — 「싱싱님」보다 「싱싱」이 확인하기 쉽다.
    const label = inSource.reduce((a, b) => (b.length < a.length ? b : a));
    if (!dropped.includes(label)) dropped.push(label);
  }
  return { dropped };
}

/**
 * 화면 문구. 🔴 **무엇이 잘못됐는지 단정하지 않는다** — 사라진 것인지 다른 표기로 바뀐 것인지
 *    우리는 구분할 수 없다. 확인해야 할 사실만 말하고 판단은 사용자가 한다.
 */
export function nameWarningText(dropped) {
  if (!Array.isArray(dropped) || dropped.length === 0) return '';
  const list = dropped.map((name) => `「${name}」`).join(', ');
  return `${list}이(가) 교정문에 그대로 없어요 — 이름이 빠졌거나 다른 표기로 바뀌었을 수 있어요. 보내기 전에 확인해 주세요.`;
}
