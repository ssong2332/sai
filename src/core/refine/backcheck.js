/**
 * 역번역이 실제로 「역번역」인지 확인한다 (2026-08-16 사용자 승인 ⓑ).
 *
 * 🔴 **실측한 결함**: 한국어 → 중국어 교정에서 `backTranslation`이 **중국어로** 나왔다.
 *    ```
 *    refined      : 싱싱님，您好。我想协调一下…
 *    backTranslation: 싱싱님，您好。我想协调一下…   ← 교정문과 글자까지 같다
 *    ```
 *    역번역은 「상대에게 이렇게 읽혀요」를 **내가** 확인하려고 보는 칸이다. 상대 언어로 나오면
 *    확인 자체가 불가능한데, 화면은 아무 일 없다는 듯 그것을 보여 준다 — **틀린 걸 맞는 것처럼
 *    보여 주는 상태**이고 이 프로젝트가 가장 피하려는 실패다(S33·S45와 같은 계열).
 *
 * 🔴 **프롬프트로는 못 고쳤다.** 지시 위치·표현을 바꿔 4번 시도했고 전부 실패했다
 *    (`prompt.js`의 실패 기록 참고). 게다가 **간헐적**이다 — 같은 배포본이 어떤 날은 한국어를,
 *    어떤 날은 중국어를 낸다. 확률적으로 흔들리는 대상은 프롬프트로 못 잠근다.
 *    그래서 **코드가 결과를 보고 판정한다.**
 *
 * 🔴 **고쳐 쓰지 않는다. 감추고 말한다.** 우리가 다시 번역할 수단이 없으므로(그러려면 호출이
 *    한 번 더 든다) 할 수 있는 최선은 **"만들지 못했다"고 정직하게 말하는 것**이다.
 */

/** 언어별 「이 글자가 없으면 그 언어가 아니다」 판정. 🔴 라틴 문자권은 서로 구분할 수 없다. */
const SCRIPT_TEST = {
  ko: /[가-힣]/, // 한글 음절
  ja: /[぀-ヿ]/, // 히라가나·가타카나 (한자만으로는 중국어와 구분 불가)
  zh: /[一-鿿]/, // CJK 통합 한자
};

export const BACK_FAIL = {
  /** 교정문과 사실상 같은 문자열 — 번역이 아예 일어나지 않았다. */
  SAME_AS_REFINED: 'same-as-refined',
  /** 내 언어의 문자가 하나도 없다 — 그 언어로 쓰이지 않았다. */
  WRONG_SCRIPT: 'wrong-script',
};

/** 공백·문장부호를 걷어낸 비교용 문자열. 구두점만 다른 경우를 「같다」로 본다. */
function normalize(text) {
  return String(text ?? '')
    .replace(/[\s　]+/g, '')
    .replace(/[.,!?;:·、。，！？；："'“”‘’()（）\[\]]/g, '')
    .toLowerCase();
}

/**
 * @param {object} input
 * @param {string} input.backTranslation 모델이 준 역번역.
 * @param {string} input.refined 교정문.
 * @param {string} input.sourceLanguage 내 언어 — 역번역이 이 언어여야 한다.
 * @param {string} input.targetLanguage 상대 언어.
 * @returns {{usable: boolean, reason: string|null}}
 */
export function checkBackTranslation({
  backTranslation,
  refined,
  sourceLanguage,
  targetLanguage,
}) {
  const back = String(backTranslation ?? '').trim();
  // 🔴 애초에 비어 있으면 이 검사의 일이 아니다 — 화면이 이미 아무것도 그리지 않는다.
  if (back === '') return { usable: true, reason: null };

  /**
   * 🔴 **언어쌍이 같으면 검사하지 않는다.** ko→ko 같은 경우(톤만 다듬기) 역번역이 교정문과
   *    같은 것이 **정상**이다. 여기서 걸면 멀쩡한 화면을 매번 지운다.
   */
  if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage) {
    return { usable: true, reason: null };
  }

  if (normalize(back) === normalize(refined) && normalize(refined) !== '') {
    return { usable: false, reason: BACK_FAIL.SAME_AS_REFINED };
  }

  /**
   * 🔴 **문자 검사는 확실할 때만 한다.** 한국어·일본어·중국어는 고유 문자로 판별되지만,
   *    영어·독일어·프랑스어·스페인어는 전부 라틴 문자라 서로 구분할 수 없다 —
   *    그 언어들에는 이 검사를 **적용하지 않는다.** 못 잡는 경우가 생기더라도,
   *    멀쩡한 역번역을 「실패」로 지우는 것보다 낫다.
   */
  const test = SCRIPT_TEST[sourceLanguage];
  if (test && !test.test(back)) {
    return { usable: false, reason: BACK_FAIL.WRONG_SCRIPT };
  }

  return { usable: true, reason: null };
}

/**
 * 설명 문구가 **내 언어로 왔는지** 본다 (2026-08-16 실확장 스크린샷에서 발견).
 *
 * 🔴 역번역만 문제가 아니었다. 같은 턴에 **「AI 판정 근거」도 독일어로** 나왔다:
 *    `직접 선택함 — AI 판정은 Critical · Der Rollout muss unbedingt heute erfolgen, …`
 *    모델이 그 호출에서 **설명 필드 전체를 상대 언어로** 써 버린 것이다. `backTranslation`만
 *    감췄더니 옆 칸에 같은 증상이 그대로 남아 있었다.
 *
 * 🔴 판정은 역번역과 **같은 문자 검사** 하나뿐이고 제한도 같다 — 라틴 문자권끼리는 구분할 수
 *    없으므로 검사하지 않는다. 못 잡을지언정 멀쩡한 설명을 지우지 않는다.
 * 🔴 여기서는 「교정문과 같은가」를 보지 않는다 — 설명은 원래 교정문과 다른 문장이다.
 *
 * @returns {boolean} 보여줘도 되면 true. 판정할 수 없을 때도 true(모를 때는 감추지 않는다).
 */
export function isExplanationReadable(text, sourceLanguage, targetLanguage) {
  const value = String(text ?? '').trim();
  if (value === '') return true;
  if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage) return true;
  const test = SCRIPT_TEST[sourceLanguage];
  if (!test) return true;
  return test.test(value);
}

/** 화면 문구. 🔴 무엇이 실패했는지 말하고, 사용자가 할 수 있는 일을 알린다. */
export function backFailMessage(reason) {
  if (reason === BACK_FAIL.SAME_AS_REFINED) {
    return '역번역을 만들지 못했어요 — 교정문이 그대로 돌아왔어요. 「다시 만들기」를 눌러 보세요.';
  }
  if (reason === BACK_FAIL.WRONG_SCRIPT) {
    return '역번역이 내 언어로 오지 않았어요 — 확인용으로 쓸 수 없어 감췄어요. 「다시 만들기」를 눌러 보세요.';
  }
  return '';
}
