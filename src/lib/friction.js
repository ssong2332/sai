/**
 * 협업 마찰·긍정 신호 집계 (Spec §3 F-10/F-26 — B2B 건강도 지수).
 *
 * 🔴 **Zero Retention이 이 파일의 설계를 통째로 결정한다** (Spec 필수 5). 서버에는 본문이 없으므로
 *    마찰을 서버에서 계산할 수 없다 — **확장에서 세고 카운트만 올린다.** 그래서 저장·전송되는
 *    것은 `{종류: 정수}`가 전부다. 원문·수신자·문장 길이 어느 것도 들어가지 않는다.
 *
 * 🔴 **개인을 지목하는 값을 만들지 않는다** (Spec 필수 9 G1/G2 · EU AI Act Art 5(1)(f), Lessons #7).
 *    "누가 하소연했는지"가 아니라 "하소연으로 감지된 메시지가 몇 건인지"만 센다. 서버에서도
 *    팀 단위로 합산되며 개인별로 분해되지 않는다.
 *
 * 판정표 — 무엇을 언제 세는가 (2026-08-15 확정, 이 표대로만 센다)
 * | 종류             | 극성 | 세는 순간                                        |
 * |---|---|---|
 * | `misread`        | 마찰 | 교정 결과에 **원문의** 오해 소지 표현이 잡혔을 때 |
 * | `venting`        | 마찰 | 교정이 하소연으로 판정했을 때                     |
 * | `forceOffHours`  | 마찰 | 긴급도를 올려 오프타임 예약 제한을 푼 순간        |
 * | `clear`          | 긍정 | 오해 소지가 있던 문장을 **교정문으로 적용**했을 때 |
 * | `schedule`       | 긍정 | 예약 제안을 받아들여 저장에 성공했을 때           |
 *
 * 🔴 `misread`와 `clear`가 **같은 메시지에서 둘 다** 오를 수 있다. 의도된 것이다 — 전자는 "원문에
 *    위험이 있었다", 후자는 "그 위험이 교정으로 정리됐다"로 서로 다른 사실이고, 대시보드 목업의
 *    설명("교정 전 원문 기준, 교정 후 반영됨" / "오해 소지 표현이 교정 과정에서 정리됨")도 그렇다.
 *
 * 🔴 **「제때 회신함」(`ontime`)은 만들지 않는다.** 대시보드 목업에는 있지만, 그것을 세려면 상대
 *    메시지가 **언제 도착했는지**를 알아야 하고 우리는 모른다(우리가 보는 것은 사용자가 선택한
 *    문장뿐이다). 셀 수 없는 지표를 0으로라도 넣으면 그 순간 대시보드가 거짓말을 시작한다 —
 *    S45에서 걷어낸 목업 카운트와 같은 실패다. 지표 자체를 두지 않는다.
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

/** 🔴 이 키 집합이 계약이다 — `functions/teams.js`의 `COUNT_KEYS`와 같아야 한다. */
export const FRICTION_EVENTS = {
  MISREAD: 'misread',
  VENTING: 'venting',
  FORCE_OFF_HOURS: 'forceOffHours',
  CLEAR: 'clear',
  SCHEDULE: 'schedule',
  /**
   * 🔴 **신호가 아니라 분모다** (2026-08-15). 다듬기가 성공한 총 횟수.
   *    Spec §3의 공식은 `Health = 100 - (**정규화된** 마찰 카운트)`인데, 정규화할 총량이
   *    없어서 설계 시안이 「긍정 대비 마찰」로 바꿔 놨었다. 그 형태는 `ontime`처럼 마찰과
   *    무관하게 쌓이는 대량 긍정 신호가 있어야 성립하는데, 그것은 **만들 수 없는 지표**라
   *    뺐다(상대 메시지 도착 시각을 모른다). 남은 긍정은 `clear`뿐인데 `clear`는 정의상
   *    `misread`를 넘을 수 없어 **Health가 50 근처에 갇혔다**(실측: 데모 50 / 45.1).
   *    총량을 분모로 쓰면 Spec 원문으로 돌아가고 지수가 다시 말이 된다.
   */
  REFINED: 'refined',
  /**
   * 🔴 **이미 판정하고 있으면서 쓰지 않던 신호 3종** (2026-08-16 사용자 승인 ⑨).
   *    새로 만드는 판정이 아니라 **버리고 있던 결과를 세는 것**이라 정확도가 이미 검증돼 있다.
   *    특히 `missing`(핵심 정보 누락)은 협업 마찰의 가장 흔한 원인인데 지표에 없었다.
   */
  URGENCY_GAP: 'urgencyGap',
  MISSING: 'missing',
  SENSITIVE_BLOCKED: 'sensitiveBlocked',
};

/** 극성 — 대시보드가 신호 막대와 분모를 가르는 데 쓴다. */
export const EVENT_POLARITY = {
  misread: 'friction',
  venting: 'friction',
  forceOffHours: 'friction',
  clear: 'positive',
  schedule: 'positive',
  // 🔴 `volume`은 막대로 그리지 않는다 — 분모일 뿐 잘잘못이 아니다.
  refined: 'volume',
  urgencyGap: 'friction',
  missing: 'friction',
  // 🔴 민감정보를 **막은 것**은 긍정이다 — 사고가 났다는 뜻이 아니라 사고를 막았다는 뜻이다.
  sensitiveBlocked: 'positive',
};

const EVENT_KEYS = Object.values(FRICTION_EVENTS);

/** 화면 문구 — 대시보드와 사이드패널이 같은 말을 쓰게 한다. */
export const EVENT_LABELS = {
  misread: '오해 소지 표현 발생',
  venting: '하소연으로 감지된 메시지',
  forceOffHours: '오프타임 강행 시도',
  clear: '명확한 요청으로 교정됨',
  schedule: '예약 제안을 수락함',
  refined: '다듬은 메시지',
  urgencyGap: '긴급도가 실제와 다름',
  missing: '기한·영향이 빠진 요청',
  sensitiveBlocked: '민감정보 전송을 막음',
};

function emptyCounts() {
  return Object.fromEntries(EVENT_KEYS.map((key) => [key, 0]));
}

/**
 * 로컬 시각 기준 `YYYY-MM-DD`.
 * 🔴 UTC를 쓰지 않는다 — 한국에서 오전 9시에 「어제」가 되어 버린다(`usage.js`와 같은 이유).
 */
function todayKey(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function asCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** 저장된 미전송 묶음을 정규화해 읽는다. 형태가 깨져 있으면 빈 묶음으로 본다. */
/**
 * **팀 없이 쌓인 마찰을 담는 칸** (2026-08-19).
 *
 * 🔴 **어디에도 올라가지 않는다.** 사이는 팀 없이도 쓰는 제품이고, 팀에 속하지 않은 대화의
 *    마찰은 **주인이 없다.** 예전에는 이런 카운트도 그냥 쌓였다가 **나중에 팀에 들어가는 순간
 *    그 팀 대시보드로 통째로 올라갔다** — 그 팀과 아무 상관 없는 수치가 팀장 화면에 찍혔다.
 * 🔴 그래도 «세기는» 한다 — 세지 않으면 나중에 팀을 붙이는 선택지가 사라지고, 무엇보다
 *    호출부가 팀 유무를 신경 쓰게 만들면 빠뜨리는 자리가 생긴다.
 */
export const NO_TEAM_BUCKET = '__none__';

/**
 * **옛 저장물(팀 구분 없음)을 담는 칸.**
 *
 * 🔴 이미 쌓인 카운트는 어느 팀 것인지 **알 방법이 없다.** 버리면 데이터가 사라지고, 아무
 *    팀에나 넣으면 거짓이 된다. 그래서 **지금까지의 동작(활성 팀으로 올림)을 그대로 한 번만**
 *    수행하도록 이 칸에 넣는다 — `uploadFriction`이 활성 팀으로 보내고 나면 비워진다.
 */
export const LEGACY_TEAM_BUCKET = '__legacy__';

function readDays(raw) {
  const counts = emptyCounts();
  const byDate = {};
  for (const [dateKey, day] of Object.entries(raw ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !day || typeof day !== 'object') continue;
    const next = { ...counts };
    for (const key of EVENT_KEYS) next[key] = asCount(day[key]);
    byDate[dateKey] = next;
  }
  return byDate;
}

/**
 * 🔴 **팀별로 나눠 쌓는다** (2026-08-19 사용자 지적 — 대시보드 기준 불일치).
 *
 *    예전 구조는 `{ byDate }` 하나였고, 업로드는 **항상 활성 팀**으로 보냈다. 그래서 팀이 둘일 때
 *    **B팀 상대와 대화한 마찰이 A팀 대시보드에 쌓였다.** 교정에 실리는 용어집은 «수신자의 팀»을
 *    따르는데 지표는 «활성 팀»을 따라서, 같은 한 번의 교정이 두 기준으로 갈렸다.
 *    팀장이 보는 협업 상황이 실제와 다른 것은 이 제품에서 가장 나쁜 종류의 오류다.
 *
 * 🔴 옛 저장물은 버리지 않고 `LEGACY_TEAM_BUCKET`으로 옮긴다(위 주석).
 */
async function readPending() {
  const stored = await getLocal(STORAGE_KEYS.FRICTION_PENDING, null);
  if (!stored || typeof stored !== 'object') return { byTeam: {} };

  // 옛 구조(`{ byDate }`)를 만나면 레거시 칸으로 옮겨 읽는다.
  if (stored.byDate && !stored.byTeam) {
    const legacy = readDays(stored.byDate);
    return Object.keys(legacy).length > 0
      ? { byTeam: { [LEGACY_TEAM_BUCKET]: legacy } }
      : { byTeam: {} };
  }

  const byTeam = {};
  for (const [teamId, raw] of Object.entries(stored.byTeam ?? {})) {
    if (typeof teamId !== 'string' || teamId === '') continue;
    const days = readDays(raw);
    if (Object.keys(days).length > 0) byTeam[teamId] = days;
  }
  return { byTeam };
}

/**
 * 🔴 **저장소 쓰기를 직렬화한다** (2026-08-16 실측으로 잡은 경합).
 *
 * 한 번의 교정이 이벤트 여럿을 동시에 낸다(`refined` + `misread` + `venting`). 호출부는
 * 화면을 막지 않으려고 `await` 없이 부르는데, 각 호출이 **같은 키를 read-modify-write** 하므로
 * 셋이 같은 옛 값을 읽고 각자 덮어써 **마지막 하나만 살아남았다.**
 *
 * 증상이 고약했다: 대시보드에 「하소연 2건」은 뜨는데 분모인 「다듬은 메시지」가 **0건**이라
 * Health Index가 계산조차 되지 않았다(실확장 스크린샷). 카운트가 틀린 게 아니라 **사라졌다.**
 *
 * 재현: 대역 저장소에 1ms 지연을 주고 세 번 연달아 부르면 저장된 값이 1건뿐이다.
 *
 * 🔴 큐를 쓰는 이유: 호출부에서 `await`로 바꾸면 교정 응답 처리가 저장소 왕복만큼 느려지고,
 *    호출부가 늘 때마다 같은 실수가 반복된다. 여기서 한 번 막는다.
 */
let writeQueue = Promise.resolve();

function enqueue(task) {
  // 🔴 앞선 작업이 실패해도 큐가 멈추면 안 된다 — `catch`로 체인을 살려 둔다.
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

/**
 * 이벤트 하나를 센다.
 *
 * 🔴 **날짜별로 따로 쌓는다.** 자정을 넘겨 업로드되면 어제 것이 오늘로 합산되어, 리더가 보는
 *    추세가 하루씩 밀린다.
 * 🔴 실패해도 조용히 넘어간다 — 통계 때문에 교정 화면이 막히면 안 된다.
 */
export async function recordFrictionEvent(kind, options = {}) {
  if (!EVENT_KEYS.includes(kind)) return;
  /**
   * 🔴 두 번째 인자가 `Date`면 옛 호출 방식(`recordFrictionEvent(kind, now)`)이다.
   *    호출부가 10곳이라 시그니처를 바꾸는 순간 하나만 빠뜨려도 **그 이벤트가 조용히
   *    엉뚱한 칸에 쌓인다** — 형태로 갈라 둘 다 받는다.
   */
  const isDate = options instanceof Date;
  const now = isDate ? options : (options.now ?? new Date());
  const teamId = isDate ? NO_TEAM_BUCKET : (options.teamId ?? NO_TEAM_BUCKET);

  return enqueue(async () => {
    try {
      const pending = await readPending();
      const dateKey = todayKey(now);
      const days = pending.byTeam[teamId] ?? {};
      const day = days[dateKey] ?? emptyCounts();
      day[kind] += 1;
      days[dateKey] = day;
      pending.byTeam[teamId] = days;
      await setLocal(STORAGE_KEYS.FRICTION_PENDING, pending);
    } catch {
      /* 집계는 부가 정보다 — 실패가 기능을 막지 않는다. */
    }
  });
}

/**
 * 아직 올리지 않은 묶음을 날짜별로 돌려준다. **지우지 않는다.**
 *
 * 🔴 읽기와 지우기를 나눈 이유: 업로드가 실패했는데 먼저 지우면 **그 카운트는 영영 사라진다.**
 *    올린 것이 확인된 뒤에만 `clearSentFriction()`으로 정확히 그만큼 뺀다.
 * @returns {Promise<Array<{dateKey: string, counts: object}>>} 0건인 날짜는 빠진다.
 */
export async function takeFrictionBatch(teamId) {
  // 🔴 큐를 통과시켜 **쓰기가 끝난 뒤** 읽는다 — 중간 상태를 올리면 그만큼이 다음 배치에서
  //    빠지거나 두 번 올라간다.
  const pending = await enqueue(() => readPending());
  return Object.entries(pending.byTeam[teamId] ?? {})
    .map(([dateKey, counts]) => ({ dateKey, counts }))
    .filter(({ counts }) => EVENT_KEYS.some((key) => counts[key] > 0))
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
}

/**
 * 올릴 것이 있는 **팀 목록**. 🔴 `NO_TEAM_BUCKET`은 빼고 준다 — 주인이 없는 카운트다.
 * @returns {Promise<string[]>}
 */
export async function pendingFrictionTeams() {
  const pending = await enqueue(() => readPending());
  return Object.keys(pending.byTeam).filter((teamId) => teamId !== NO_TEAM_BUCKET);
}

/**
 * 업로드가 **성공한 만큼만** 뺀다.
 *
 * 🔴 통째로 비우지 않는다. 업로드가 도는 동안에도 사용자는 계속 교정하므로, 그 사이에 늘어난
 *    카운트까지 지우면 **올리지 않은 이벤트가 사라진다.** 보낸 수치를 빼기만 한다.
 * 🔴 음수가 되지 않게 0에서 막는다 — 어떤 경합이 나도 카운트가 음수로 남지 않게 한다.
 */
export async function clearSentFriction(teamId, sent) {
  if (!Array.isArray(sent) || sent.length === 0) return;
  // 🔴 기록과 **같은 큐**를 쓴다. 업로드가 빼는 동안 새 이벤트가 끼어들면 그 이벤트가 사라진다.
  return enqueue(async () => {
    try {
      const pending = await readPending();
      const days = pending.byTeam[teamId];
      if (!days) return;
      for (const { dateKey, counts } of sent) {
        const day = days[dateKey];
        if (!day) continue;
        for (const key of EVENT_KEYS) day[key] = Math.max(0, day[key] - asCount(counts?.[key]));
        // 전부 0이 된 날짜는 들고 다니지 않는다.
        if (EVENT_KEYS.every((key) => day[key] === 0)) delete days[dateKey];
      }
      // 남은 날짜가 없으면 팀 칸도 들고 다니지 않는다.
      if (Object.keys(days).length === 0) delete pending.byTeam[teamId];
      await setLocal(STORAGE_KEYS.FRICTION_PENDING, pending);
    } catch {
      /* 다음 업로드에서 다시 시도된다 — 중복은 서버가 아니라 여기서 막힌다. */
    }
  });
}

/**
 * 건강도 지수 = `100 - (마찰 건수 / 다듬은 메시지 총수) × 100` (Spec §3 원문 공식).
 *
 * 🔴 **분모는 「긍정+마찰」이 아니라 「다듬은 총수」다** (2026-08-15 수정). 전자는 마찰과 무관하게
 *    쌓이는 대량 긍정 신호를 전제하는데 그런 지표를 만들 수 없어서(`REFINED` 주석 참고)
 *    Health가 50 근처에 갇혔다. 총량으로 나누면 "100건 다듬는 동안 마찰 9건 → 91"이 되어
 *    지수가 다시 읽힌다.
 * 🔴 **다듬은 적이 없으면 100이 아니라 `null`이다.** 아무 일도 없었던 팀과 마찰이 없던 팀은
 *    다르다. 100으로 채우면 "쓰지 않는 팀이 가장 건강한 팀"이 된다.
 * 🔴 한 메시지가 마찰 둘을 동시에 낼 수 있어(오해 소지 + 하소연) 비율이 100%를 넘을 수 있다 —
 *    0에서 막는다. 음수 지수는 의미가 없다.
 * @param {object} counts `{misread: n, refined: n, ...}`
 * @returns {number|null} 0~100 정수, 다듬은 기록이 없으면 null.
 */
export function healthIndex(counts) {
  const total = asCount(counts?.[FRICTION_EVENTS.REFINED]);
  if (total === 0) return null;
  let friction = 0;
  for (const key of EVENT_KEYS) {
    if (EVENT_POLARITY[key] === 'friction') friction += asCount(counts?.[key]);
  }
  return Math.max(0, Math.round(100 - (friction / total) * 100));
}
