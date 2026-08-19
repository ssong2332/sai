/**
 * 캐주얼 톤 표현 시드 (S16 / Spec 필수 8).
 *
 * 🔴 **전부 사람이 검수한 목록이다**(`reviewed: true`). Tasks.md의 순서 규칙 — "봇 차단 리스크가
 *    있으므로 **시드 데이터 동봉 후 크론은 보강**" — 을 그대로 따른다. 자동 수집(RSS/크론)은 아직
 *    붙지 않았고, 붙더라도 `checkWorkSafe()`의 `reviewed` 게이트에 막혀 검수 전까지는 쓰이지 않는다.
 *
 * 🔴 **언어에 붙지 국적에 붙지 않는다.** 각 항목은 `language`(표현이 통용되는 언어)만 갖고
 *    국가 코드를 갖지 않는다 — "○○ 나라 사람들은 이렇게 말한다"는 서술을 만들 여지 자체를 없앴다
 *    (Spec 필수 2 3순위 · 필수 9).
 *
 * 🔴 **업무 메시지 기준으로 고른다.** 유행의 첨단이 아니라 "동료에게 써도 관계가 상하지 않는
 *    가벼움"이 기준이다. 밈 자체가 목적이 아니라 캐주얼 톤이 목적이다.
 *
 * `register`: 'casual'(가벼운 업무 대화) — 지금은 전부 casual이며, 더 낮은 등급은 두지 않는다.
 *
 * `explainAlways`: **직역으로는 뜻을 알 수 없는가** (S19 / 2026-08-14 사용자 결정).
 *   true  — 캐주얼 톤을 꺼도 해설을 붙인다. 직역하면 오해하거나 아예 안 읽히는 표현
 *           (`ship it`을 "배로 보내라"로 읽는 식). 내가 캐주얼 톤을 켜지 않았어도 **모델이
 *           자연스럽게 쓸 수 있으므로**, 모르는 표현을 그대로 보내는 일을 막는다.
 *   false — 캐주얼 톤을 켰을 때만 해설을 붙인다. 직역해도 뜻이 대충 통해서(`辛苦了` → "고생했다")
 *           항상 설명을 달면 군더더기가 되는 표현.
 *   🔴 이 분류는 **사람의 판단이 필요하다**(`reviewed`와 같은 성격). 항목을 추가할 때 감으로 채우지
 *      말고 "직역했을 때 오해가 생기는가"를 실제로 따져 본다.
 */

export const MEME_SEED = [
  {
    id: 'mm-en-1',
    language: 'en',
    text: 'heads-up',
    meaning: '미리 알려주는 가벼운 공지. "Heads-up: the build is red."',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-2',
    language: 'en',
    text: 'circle back',
    meaning: '나중에 다시 이야기하자. 회의를 미룰 때 자주 쓴다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-3',
    language: 'en',
    text: 'quick sanity check',
    meaning: '큰일 아니고 간단히 한 번만 봐 달라는 요청.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-4',
    language: 'en',
    text: 'no worries if not',
    meaning: '거절해도 괜찮다는 신호. 부담을 덜어 주는 표현.',
    register: 'casual',
    reviewed: true,
    explainAlways: false,
  },
  {
    id: 'mm-en-5',
    language: 'en',
    text: 'ship it',
    meaning: '이대로 배포하자. 승인의 가벼운 표현.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-6',
    language: 'en',
    text: 'LGTM',
    meaning: 'Looks Good To Me — 코드 리뷰 승인 약어.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-zh-1',
    language: 'zh',
    text: '辛苦了',
    meaning: '수고했어요. 업무 마무리·감사 인사로 널리 쓰인다.',
    register: 'casual',
    reviewed: true,
    explainAlways: false,
  },
  {
    id: 'mm-zh-2',
    language: 'zh',
    text: '收到',
    meaning: '확인했습니다. 짧은 수신 확인.',
    register: 'casual',
    reviewed: true,
    explainAlways: false,
  },
  {
    id: 'mm-ko-1',
    language: 'ko',
    text: '넵 확인했어요',
    meaning: '가벼운 수신 확인. 과한 격식 없이 쓰는 응답.',
    register: 'casual',
    reviewed: true,
    explainAlways: false,
  },

  /* ── 2026-08-14 확장 36건 (사용자 검수 통과) ─────────────────────────────
   *
   * 🔴 **새 항목은 반드시 여기 아래에 붙인다.** 위 9건은 `buildCasualToneBlock()`이
   *    `slice(0, MAX_EXPRESSIONS)`로 **모델에 실어 보내는** 후보이기도 하다 — 앞에 끼워 넣으면
   *    프롬프트에 실리는 표현이 조용히 바뀐다. 아래 항목은 **탐지(해설) 전용**으로 들어왔다.
   *    영어는 기존이 정확히 6건이라 프롬프트에 실리는 목록이 그대로 유지된다.
   * 🔴 중국어는 기존이 2건뿐이라 아래 4건까지 프롬프트에 실린다(상한 6). 의도한 결과다 —
   *    전부 업무 메시지에 그대로 써도 되는 표현이다.
   * 🔴 **한국어는 추가하지 않았다.** 해설이 한국어인데 대상 언어도 한국어면 설명할 것이 없다.
   */

  {
    id: 'mm-en-7',
    language: 'en',
    text: 'touch base',
    meaning: '짧게 상황을 공유하자. 직역 "베이스를 만지다"와 무관하다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-8',
    language: 'en',
    text: 'loop in',
    meaning: '논의에 끼워 넣다. "I\'ll loop in Sarah."',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-9',
    language: 'en',
    text: 'keep you in the loop',
    meaning: '계속 공유하겠다는 약속.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-10',
    language: 'en',
    text: 'ping me',
    meaning: '연락 줘. 메신저·메일 어느 쪽이든 쓴다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-11',
    language: 'en',
    text: 'reach out',
    meaning: '연락하다. 직역 "손을 뻗다"와 무관하다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-12',
    language: 'en',
    text: 'take it offline',
    meaning: '이 자리 말고 따로 이야기하자. 온라인·오프라인 여부와 무관하다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-13',
    language: 'en',
    text: "let's sync",
    meaning: '짧게 인식을 맞추자. 직역 "동기화"가 아니다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-14',
    language: 'en',
    text: 'heads down',
    meaning: '방해받지 않고 집중해서 일하는 중.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-15',
    language: 'en',
    text: 'on my radar',
    meaning: '알고 있고 놓치지 않았다는 뜻.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-16',
    language: 'en',
    text: 'bandwidth',
    meaning: '일을 더 맡을 여력. "I don\'t have the bandwidth."',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-17',
    language: 'en',
    text: 'nit',
    meaning: '사소한 지적. 코드 리뷰에서 "고쳐도 되고 안 고쳐도 되는" 수준을 뜻한다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-18',
    language: 'en',
    text: 'drop the ball',
    meaning: '실수로 놓치다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-19',
    language: 'en',
    text: 'low-hanging fruit',
    meaning: '적은 노력으로 얻을 수 있는 성과.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-20',
    language: 'en',
    text: 'move the needle',
    meaning: '실질적인 변화를 만들다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-21',
    language: 'en',
    text: 'back to the drawing board',
    meaning: '처음부터 다시 하자.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-22',
    language: 'en',
    text: 'ballpark',
    meaning: '대략적인 수치. "a ballpark figure"',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-23',
    language: 'en',
    text: 'no-brainer',
    meaning: '고민할 필요 없이 당연한 선택.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-24',
    language: 'en',
    text: 'bear with me',
    meaning: '조금만 기다려 주세요.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-25',
    language: 'en',
    text: 'EOD',
    meaning: 'end of day — 오늘 업무 종료까지.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-26',
    language: 'en',
    text: 'ETA',
    meaning: 'estimated time of arrival — 예상 완료 시각.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-27',
    language: 'en',
    text: 'PTAL',
    meaning: 'please take a look — 한번 봐 주세요.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-28',
    language: 'en',
    text: 'SGTM',
    meaning: 'sounds good to me — 좋습니다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-29',
    language: 'en',
    text: 'OOO',
    meaning: 'out of office — 부재중.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-30',
    language: 'en',
    text: 'WFH',
    meaning: 'work from home — 재택근무.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-en-31',
    language: 'en',
    text: 'FYI',
    meaning: 'for your information — 참고로.',
    register: 'casual',
    reviewed: true,
    explainAlways: false,
  },
  {
    id: 'mm-en-32',
    language: 'en',
    text: 'ASAP',
    meaning: 'as soon as possible — 가능한 한 빨리.',
    register: 'casual',
    reviewed: true,
    explainAlways: false,
  },
  {
    id: 'mm-en-33',
    language: 'en',
    text: 'quick win',
    meaning: '빠르게 낼 수 있는 성과.',
    register: 'casual',
    reviewed: true,
    explainAlways: false,
  },
  {
    id: 'mm-en-34',
    language: 'en',
    text: 'blocker',
    meaning: '진행을 막고 있는 문제.',
    register: 'casual',
    reviewed: true,
    explainAlways: false,
  },

  {
    id: 'mm-zh-3',
    language: 'zh',
    text: '麻烦你了',
    meaning:
      '번거롭게 해드렸습니다 — 부탁과 감사를 함께 담은 정중한 표현. 직역 "귀찮게 했다"로 읽으면 무례하게 느껴진다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-zh-4',
    language: 'zh',
    text: '请查收',
    meaning: '확인 부탁드립니다. 자료·첨부를 보낼 때 쓴다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-zh-5',
    language: 'zh',
    text: '对齐一下',
    meaning: '인식을 맞춰 보자. 직역 "정렬하다"와 무관한 업무 용어.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-zh-6',
    language: 'zh',
    text: '同步一下',
    meaning: '상황을 공유하자. 직역 "동기화"와 무관하다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-zh-7',
    language: 'zh',
    text: '拉个群',
    meaning: '단체 대화방을 만들자.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-zh-8',
    language: 'zh',
    text: '打个招呼',
    meaning: '미리 언질을 주다.',
    register: 'casual',
    reviewed: true,
    explainAlways: true,
  },
  {
    id: 'mm-zh-9',
    language: 'zh',
    text: '加油',
    meaning: '힘내세요.',
    register: 'casual',
    reviewed: true,
    explainAlways: false,
  },
  {
    id: 'mm-zh-10',
    language: 'zh',
    text: '没问题',
    meaning: '문제 없습니다.',
    register: 'casual',
    reviewed: true,
    explainAlways: false,
  },

  /**
   * 🔴 **2026-08-16 — 4개 언어가 통째로 비어 있었다** (사용자 지적으로 실측).
   *    `buildCasualToneBlock('de'|'fr'|'es'|'ja')`가 전부 `null`이었다. 즉 **캐주얼 톤 토글이
   *    이 언어들에서는 아무 일도 하지 않았다** — 켜도 꺼도 결과가 같았고, 화면은 그 사실을
   *    말하지 않았다(없는 기능을 있는 것처럼 보여 주는 상태).
   *    한국어도 1건뿐이라 상한(6건)에 한참 못 미쳤다.
   * 🔴 고르는 기준은 위 헤더 그대로다: **유행이 아니라 "동료에게 써도 관계가 상하지 않는
   *    가벼움"**. 업무 메시지에서 실제로 쓰이는 관용 표현만 넣었고, 속어·유행어는 넣지 않았다.
   * 🔴 `explainAlways`는 **직역으로 뜻이 안 통하는가**로만 정했다(감으로 채우지 않는다).
   */
  { id: 'mm-ja-1', language: 'ja', text: 'お疲れさまです', meaning: '수고 많으십니다. 일본 업무 메시지의 기본 인사로, 인사말 자리에 거의 항상 쓴다.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-ja-2', language: 'ja', text: '承知しました', meaning: '알겠습니다(정중한 수락). "了解"보다 윗사람에게 안전하다.', register: 'casual', reviewed: true, explainAlways: false },
  { id: 'mm-ja-3', language: 'ja', text: 'ざっくり', meaning: '대략, 개략적으로. "ざっくり言うと"는 "대충 말하면".', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-ja-4', language: 'ja', text: '取り急ぎ', meaning: '우선 급한 대로. 짧은 연락 앞에 붙여 "자세한 건 나중에"를 뜻한다.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-ja-5', language: 'ja', text: '助かります', meaning: '도움이 됩니다 = 고맙습니다. 부탁 뒤에 붙이면 부드러워진다.', register: 'casual', reviewed: true, explainAlways: false },
  { id: 'mm-ja-6', language: 'ja', text: 'すり合わせ', meaning: '서로 인식을 맞추는 일. 회의 목적으로 자주 쓴다.', register: 'casual', reviewed: true, explainAlways: true },

  { id: 'mm-de-1', language: 'de', text: 'kurz durchgeben', meaning: '짧게 알려주다. 영어 "heads-up"에 해당하는 가벼운 공지.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-de-2', language: 'de', text: 'passt', meaning: '괜찮아요/좋습니다. 짧은 동의 표현.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-de-3', language: 'de', text: 'melde mich', meaning: '(제가) 다시 연락드릴게요. "Ich melde mich"의 짧은 형태.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-de-4', language: 'de', text: 'auf dem Schirm haben', meaning: '염두에 두고 있다. 직역하면 "화면에 두고 있다"라 뜻이 안 통한다.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-de-5', language: 'de', text: 'zeitnah', meaning: '조만간, 가까운 시일 안에. 기한을 못 박지 않는 완곡 표현이다.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-de-6', language: 'de', text: 'Bescheid geben', meaning: '알려주다. "Sag mir Bescheid" = 알려주세요.', register: 'casual', reviewed: true, explainAlways: false },

  { id: 'mm-fr-1', language: 'fr', text: 'je te tiens au courant', meaning: '진행되면 알려줄게요. 후속 연락을 약속하는 상투 표현.', register: 'casual', reviewed: true, explainAlways: false },
  { id: 'mm-fr-2', language: 'fr', text: 'ça marche', meaning: '좋아요/그렇게 하죠. 직역은 "그것이 걷는다"라 뜻이 안 통한다.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-fr-3', language: 'fr', text: 'faire le point', meaning: '상황을 정리하고 점검하다. 회의 목적으로 자주 쓴다.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-fr-4', language: 'fr', text: 'dès que possible', meaning: '가능한 한 빨리. 기한을 못 박지 않는 완곡 표현이다.', register: 'casual', reviewed: true, explainAlways: false },
  { id: 'mm-fr-5', language: 'fr', text: 'en gros', meaning: '대략, 요약하면. 직역은 "크게"라 오해하기 쉽다.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-fr-6', language: 'fr', text: 'je reviens vers toi', meaning: '다시 연락드릴게요. 직역은 "당신에게 돌아간다"라 뜻이 안 통한다.', register: 'casual', reviewed: true, explainAlways: true },

  { id: 'mm-es-1', language: 'es', text: 'te aviso', meaning: '알려드릴게요. 후속 연락을 약속하는 짧은 표현.', register: 'casual', reviewed: true, explainAlways: false },
  { id: 'mm-es-2', language: 'es', text: 'a grandes rasgos', meaning: '대략적으로, 큰 틀에서. 직역으로는 뜻이 안 통한다.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-es-3', language: 'es', text: 'quedamos así', meaning: '그렇게 하기로 하죠. 합의를 마무리하는 표현.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-es-4', language: 'es', text: 'en cuanto pueda', meaning: '가능한 한 빨리. 기한을 못 박지 않는 완곡 표현이다.', register: 'casual', reviewed: true, explainAlways: false },
  { id: 'mm-es-5', language: 'es', text: 'lo reviso', meaning: '제가 확인해 볼게요.', register: 'casual', reviewed: true, explainAlways: false },
  { id: 'mm-es-6', language: 'es', text: 'ponerse al día', meaning: '밀린 것을 따라잡다 / 근황을 공유하다. 직역으로는 뜻이 안 통한다.', register: 'casual', reviewed: true, explainAlways: true },

  { id: 'mm-ko-2', language: 'ko', text: '확인 후 회신드릴게요', meaning: '지금은 답을 못 하지만 확인해서 알려주겠다는 뜻.', register: 'casual', reviewed: true, explainAlways: false },
  { id: 'mm-ko-3', language: 'ko', text: '가볍게 여쭤봐요', meaning: '부담 없이 묻는다는 신호. 상대의 부담을 줄인다.', register: 'casual', reviewed: true, explainAlways: false },
  { id: 'mm-ko-4', language: 'ko', text: '러프하게', meaning: '대략적으로, 다듬지 않은 상태로. 실무에서 자주 쓴다.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-ko-5', language: 'ko', text: '싱크 맞추다', meaning: '서로 인식을 맞추다. 직역하면 뜻이 안 통한다.', register: 'casual', reviewed: true, explainAlways: true },
  { id: 'mm-ko-6', language: 'ko', text: '일단 공유드려요', meaning: '결론 전이지만 먼저 알린다는 뜻.', register: 'casual', reviewed: true, explainAlways: false },
];

/** 해당 언어의 검수 통과 표현만 돌려준다. */
export function seedForLanguage(language) {
  return MEME_SEED.filter((entry) => entry.language === language);
}
