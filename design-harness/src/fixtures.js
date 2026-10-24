/**
 * 하네스 목업 데이터 — 🔴 전부 합성이다(인물·회사 실재하지 않음). 화면 검토 전용.
 * 기본 결과는 `src/content/refineClient.js`의 `mockRefine`/`mockDecode`를 그대로 쓰고,
 * 여기서는 화면 요소(경고·하이라이트)를 보이게 하는 필드만 덧붙인다.
 */

export const SOURCE_TEXT =
  '미겔, 내일까지 PR #482 리뷰 부탁해요. 릴리즈 일정이 여기 걸려 있어서요. 급하게 드려서 죄송해요';

export const VENT_TEXT = 'API 스펙을 또 바꿨네요. 이번 스프린트 다 갈아엎어야 해요. 왜 자꾸 이러는지 답답합니다';

export const RECIPIENTS = [
  {
    id: 'r1',
    name: 'Miguel',
    timeZone: 'America/Sao_Paulo',
    language: 'en',
    tagIds: ['prefers-direct', 'async-friendly'],
    teamId: 'personal',
  },
  { id: 'r2', name: 'Yuki', timeZone: 'Asia/Tokyo', language: 'ja', tagIds: [] },
];

export const TEAMS = [{ id: 'team-a', name: '플랫폼팀' }];

/** 결과 화면에 경고·하이라이트가 보이도록 덧붙이는 필드. */
export const refineOverrides = {
  urgency: 'CRITICAL',
  urgencySource: 'ai',
  aiUrgency: 'CRITICAL',
  sourceLanguage: 'ko',
  targetLanguage: 'en',
  preserved: [
    { kind: 'deadline', sourceText: '내일까지', refinedText: 'by tomorrow EOD' },
    { kind: 'number', sourceText: 'PR #482', refinedText: 'PR #482' },
  ],
  misreadRisks: [
    {
      quote: 'sorry for the tight timeline',
      misreading: '사과가 반복되면 요청의 무게가 약해 보일 수 있어요',
      evidence: '원문에 사과 표현이 1회 있어 1회로 유지',
    },
  ],
};

/** 상대가 퇴근 시간대 — 예약 제안 배너가 뜬다. */
export const SCHEDULE_OFF = {
  needsSchedule: true,
  reason: 'off-hours',
  sendAt: new Date(Date.now() + 8 * 3600 * 1000),
  localParts: { weekday: 4, hour: 9, minute: 0, year: 2026, month: 10, day: 29, dateKey: '2026-10-29' },
  holidayLookupFailed: false,
};

export const REPLY_RESULT = {
  fallback: false,
  draft:
    'Sarah, 코멘트 고마워요. 접근 방식 자체를 다시 보자는 말씀인지, 세부 수정이면 되는지 확인하고 싶어요. [가능한 미팅 시간]에 15분 정도 이야기 나눌 수 있을까요?',
};
