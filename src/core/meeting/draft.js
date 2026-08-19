/**
 * 회의 제안 초안 · 캘린더 등록 링크 (2026-08-16 사용자 요청 ⑦⑧).
 *
 * 🔴 **모델을 부르지 않는다.** 회의 제안은 「누구·언제·어디서·얼마나」가 전부고 값은 이미 우리가
 *    갖고 있다 — LLM을 태우면 느리고, 돈이 들고, **없는 안건을 지어낼 여지**가 생긴다(이 프로젝트가
 *    반복해서 겪은 실패다). 그래서 순수 템플릿이다.
 * 🔴 **본문을 어디에도 저장하지 않는다** (Zero Retention · Spec 필수 5). 만들어서 클립보드로 주고 끝.
 * 🔴 **양쪽 현지 시각을 둘 다 쓴다.** 한쪽 시각만 쓰면 상대가 다시 계산해야 하고, 13시간 차이가
 *    나면 날짜까지 달라 오해가 난다 — 이 제품이 줄이려는 마찰이 바로 그것이다.
 * 🔴 **안건은 대괄호 자리표시자로 둔다.** 우리가 아는 것이 아니므로 지어내지 않고, 사용자가
 *    지우거나 채우게 한다(`core/refine/prompt.js`의 NO_FABRICATION 규칙과 같은 원칙).
 * 🔴 국가·국민성으로 문구를 바꾸지 않는다 (Spec 필수 2 3순위) — 바뀌는 것은 **언어**뿐이다.
 *
 * 🔴 **2026-08-16 방향 전환 (사용자 요청): 초안은 「내 언어」로 쓴다.**
 *    예전에는 상대 언어로 바로 만들었다. 그런데 그 문장은 **교정 파이프라인을 통과하지 않은
 *    문장**이다 — 용어집·톤·수신자 태그·민감정보 가드가 하나도 안 걸린 채 상대에게 나간다.
 *    같은 제품 안에 **품질이 다른 두 개의 번역 경로**가 생기는 것이 진짜 문제였다.
 *    이제 초안은 내 언어로 만들고, 사용자가 그걸 **「다듬기」에 넣어** 상대 언어로 보낸다 —
 *    경로가 하나로 합쳐지고, 초안도 용어집 적용을 받는다.
 */

/** 회의 형태. 🔴 사용자가 고르는 값이다 — 우리가 추론하지 않는다. */
export const MEETING_KINDS = [
  { id: 'video', label: '화상회의' },
  { id: 'voice', label: '음성 통화' },
  { id: 'inperson', label: '대면 회의' },
];

const KIND_TEXT = {
  ko: { video: '화상회의', voice: '음성 통화', inperson: '대면 회의', place: '[장소/링크]' },
  en: { video: 'a video call', voice: 'a voice call', inperson: 'an in-person meeting', place: '[location/link]' },
  zh: { video: '视频会议', voice: '语音通话', inperson: '线下会议', place: '[地点/链接]' },
  ja: { video: 'ビデオ会議', voice: '音声通話', inperson: '対面ミーティング', place: '[場所/リンク]' },
  de: { video: 'ein Videocall', voice: 'ein Telefonat', inperson: 'ein Treffen vor Ort', place: '[Ort/Link]' },
  fr: { video: 'une visioconférence', voice: 'un appel vocal', inperson: 'une réunion sur place', place: '[lieu/lien]' },
  es: { video: 'una videollamada', voice: 'una llamada de voz', inperson: 'una reunión presencial', place: '[lugar/enlace]' },
};

const WEEKDAY = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  fr: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
};

function hh(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** `2026-08-17` + weekday → 언어별 `8/17 (Mon)`. */
function dayLabel(dateKey, weekday, language) {
  const [, month, day] = String(dateKey).split('-');
  const names = WEEKDAY[language] ?? WEEKDAY.en;
  return `${Number(month)}/${Number(day)} (${names[weekday] ?? ''})`;
}

/**
 * 회의 제안 초안을 만든다.
 *
 * @param {object} input
 * @param {object} input.slot `findMeetingSlots()`가 준 슬롯.
 * @param {string} [input.language] **내 언어**(초안을 쓸 언어). 모르면 영어.
 *   🔴 상대 언어가 아니다 — 이 초안은 그대로 보내는 문장이 아니라 「다듬기」에 넣을 원문이다.
 * @param {string} [input.kind] `MEETING_KINDS`의 id. 기본 video.
 * @param {string} [input.theirName] 상대 이름. 없으면 호칭 줄을 아예 넣지 않는다.
 * @param {number} [input.minutes] 길이(분). 기본 30.
 * @returns {string} 복사해서 쓸 초안.
 */
export function buildMeetingDraft({
  slot,
  language = 'en',
  kind = 'video',
  theirName = '',
  minutes = 30,
}) {
  if (!slot) return '';
  const lang = KIND_TEXT[language] ? language : 'en';
  const t = KIND_TEXT[lang];
  const kindText = t[kind] ?? t.video;
  const theirs = `${dayLabel(slot.theirs.dateKey, slot.theirs.weekday, lang)} ${hh(slot.theirs.hour)}`;
  const mine = `${dayLabel(slot.mine.dateKey, slot.mine.weekday, lang)} ${hh(slot.mine.hour)}`;
  // 🔴 이름을 모르면 「Hi ,」 같은 빈 호칭을 만들지 않는다.
  const hello = theirName.trim();

  if (lang === 'ko') {
    return [
      hello ? `${hello}님, 안녕하세요.` : '안녕하세요.',
      `[안건]에 대해 ${kindText}를 ${minutes}분 정도 제안드려요.`,
      `그쪽 시각 ${theirs} (제 시각 ${mine})이 어떠신가요?`,
      `장소/링크: ${t.place}`,
      '괜찮은 다른 시간이 있으면 알려 주세요.',
    ].join('\n');
  }
  if (lang === 'zh') {
    return [
      hello ? `${hello}，您好：` : '您好：',
      `想就[议题]安排一次${kindText}，约${minutes}分钟。`,
      `您那边的时间 ${theirs}（我这边 ${mine}）方便吗？`,
      `地点/链接：${t.place}`,
      '如果不方便，请告诉我其他合适的时间。',
    ].join('\n');
  }
  if (lang === 'ja') {
    return [
      hello ? `${hello}様` : 'お世話になっております。',
      `[議題]について${kindText}を${minutes}分ほどお願いできればと思います。`,
      `そちらの時間で ${theirs}（当方 ${mine}）はいかがでしょうか。`,
      `場所/リンク: ${t.place}`,
      'ご都合が合わない場合は、可能な時間をお知らせください。',
    ].join('\n');
  }
  if (lang === 'de') {
    return [
      hello ? `Hallo ${hello},` : 'Hallo,',
      `ich schlage ${kindText} von etwa ${minutes} Minuten zum Thema [Thema] vor.`,
      `Passt Ihnen ${theirs} Ihrer Zeit (${mine} meiner Zeit)?`,
      `Ort/Link: ${t.place}`,
      'Falls es nicht passt, nennen Sie mir gern eine Alternative.',
    ].join('\n');
  }
  if (lang === 'fr') {
    return [
      hello ? `Bonjour ${hello},` : 'Bonjour,',
      `je propose ${kindText} d'environ ${minutes} minutes au sujet de [sujet].`,
      `Est-ce que ${theirs} chez vous (${mine} chez moi) vous conviendrait ?`,
      `Lieu/lien : ${t.place}`,
      'Si cela ne convient pas, indiquez-moi un autre créneau.',
    ].join('\n');
  }
  if (lang === 'es') {
    return [
      hello ? `Hola ${hello}:` : 'Hola:',
      `propongo ${kindText} de unos ${minutes} minutos sobre [tema].`,
      `¿Te viene bien ${theirs} en tu hora (${mine} en la mía)?`,
      `Lugar/enlace: ${t.place}`,
      'Si no te encaja, dime otra franja que te vaya bien.',
    ].join('\n');
  }
  return [
    hello ? `Hi ${hello},` : 'Hi,',
    `I'd like to propose ${kindText} of about ${minutes} minutes about [topic].`,
    `Would ${theirs} your time (${mine} my time) work for you?`,
    `Location/link: ${t.place}`,
    "If that doesn't work, let me know a time that does.",
  ].join('\n');
}

/** `2026-08-17T04:00:00.000Z` → `20260817T040000Z` (구글·아웃룩이 받는 형식). */
function stamp(iso) {
  return String(iso).replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * 캘린더에 넣는 링크를 만든다.
 *
 * 🔴 **OAuth 쓰기 권한을 새로 받지 않는다** (⑧). 일정을 API로 만들려면 `calendar.events` 범위를
 *    추가하고 구글 동의 화면을 다시 심사받아야 한다 — 마감까지 할 수 있는 일이 아니고, 우리가
 *    남의 달력에 조용히 쓰는 권한을 갖게 된다.
 *    대신 **구글/아웃룩의 「일정 만들기」 화면을 값만 채워서 연다.** 최종 저장은 사용자가 그쪽
 *    화면에서 직접 누른다 — 권한도 덜 받고, 되돌리기도 쉽다.
 * 🔴 제목·본문에 **메시지 본문을 넣지 않는다** — URL은 브라우저 기록에 남는다(Zero Retention).
 *    넣는 것은 사용자가 방금 만든 회의 제목과 시각뿐이다.
 *
 * @returns {{google: string, outlook: string}}
 */
export function calendarLinks({ slot, title, minutes = 30, location = '' }) {
  const start = new Date(slot.startUtcISO);
  const end = new Date(start.getTime() + minutes * 60_000);
  const text = title || '회의';

  const google = new URL('https://calendar.google.com/calendar/render');
  google.searchParams.set('action', 'TEMPLATE');
  google.searchParams.set('text', text);
  google.searchParams.set('dates', `${stamp(start.toISOString())}/${stamp(end.toISOString())}`);
  if (location) google.searchParams.set('location', location);

  const outlook = new URL('https://outlook.office.com/calendar/0/deeplink/compose');
  outlook.searchParams.set('path', '/calendar/action/compose');
  outlook.searchParams.set('subject', text);
  outlook.searchParams.set('startdt', start.toISOString());
  outlook.searchParams.set('enddt', end.toISOString());
  if (location) outlook.searchParams.set('location', location);

  return { google: google.toString(), outlook: outlook.toString() };
}
