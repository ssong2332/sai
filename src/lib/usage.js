/**
 * 오늘의 사용 카운트 (홈 「오늘의 사이」).
 *
 * 🔴 **이 파일이 생긴 이유는 화면이 거짓말을 하고 있었기 때문이다** (2026-08-15 사용자 지적).
 *    홈의 14·6·3은 `sidepanel/mockData.js`에 박아 둔 상수였고, 같은 패널의 보관함은 실제 값인
 *    「예약 발송 0」을 보여줬다 — **한 화면 안에서 3과 0이 동시에 보였다.** S33에서 지운
 *    「남들이 보는 나의 소통 태그」와 같은 유형의 실패다(가짜 데이터가 실데이터처럼 보인다).
 *
 * 🔴 **Zero Retention (Spec 필수 5): 카운트만 저장한다.** 본문·수신자·문장 길이 어느 것도
 *    들어가지 않는다. 저장 형태는 `{ dateKey, refined, decoded, scheduled }` 정수 3개가 전부다.
 *
 * 🔴 **어제 것을 남기지 않는다.** 「오늘의」라고 써 놓고 누적을 보여주면 그것도 거짓말이다.
 *    날짜가 바뀌면 읽는 시점에 0으로 본다 — 지난 날짜를 보관하지 않으므로 사용 이력이 쌓이지도
 *    않는다(적게 가지는 쪽이 항상 안전하다).
 */

import { getLocal, setLocal, STORAGE_KEYS } from './storage.js';

/** 셀 수 있는 것. 🔴 화면 라벨과 1:1이며, 늘리려면 `sidepanel/App.jsx`의 표시도 함께 고친다. */
export const USAGE_KINDS = {
  REFINED: 'refined',
  DECODED: 'decoded',
  SCHEDULED: 'scheduled',
  /**
   * 🔴 **「오늘 막은 것」** (2026-08-17 사용자 승인). 홈에 한 줄로 나간다.
   *    - `blockedSensitive` — 민감정보 가드가 보내기 전에 걸러낸 건수
   *    - `blockedOffHours` — 오프타임 전송 대신 예약을 고른 건수
   *    🔴 **새 판정을 만들지 않는다.** 둘 다 이미 내리고 있는 판정이고(`sensitiveGuard`,
   *       퇴근 요정), 지금까지는 마찰 지표로만 올라가고 **내 화면에는 안 보였다.**
   *    🔴 마찰 카운트(`friction.js`)로 대신하지 않는 이유: 그쪽은 팀 서버로 올린 뒤
   *       **로컬에서 지워진다**(`clearSentFriction`) — 오늘 것을 다시 못 읽는다.
   */
  BLOCKED_SENSITIVE: 'blockedSensitive',
  BLOCKED_OFF_HOURS: 'blockedOffHours',
};

const EMPTY = {
  refined: 0,
  decoded: 0,
  scheduled: 0,
  blockedSensitive: 0,
  blockedOffHours: 0,
};

/**
 * 로컬 시각 기준 `YYYY-MM-DD`.
 * 🔴 UTC(`toISOString`)를 쓰지 않는다 — 한국에서 오전 8시에 「오늘」이 바뀌어 버린다.
 */
function todayKey(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function asCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * 오늘의 카운트를 읽는다. 날짜가 지났으면 전부 0.
 * @returns {Promise<{refined: number, decoded: number, scheduled: number}>}
 */
export async function getTodayUsage(now = new Date()) {
  const stored = await getLocal(STORAGE_KEYS.USAGE_TODAY, null);
  if (!stored || stored.dateKey !== todayKey(now)) return { ...EMPTY };
  return {
    refined: asCount(stored.refined),
    decoded: asCount(stored.decoded),
    scheduled: asCount(stored.scheduled),
    blockedSensitive: asCount(stored.blockedSensitive),
    blockedOffHours: asCount(stored.blockedOffHours),
  };
}

/**
 * 카운트를 1 올린다.
 *
 * 🔴 **성공했을 때만 부른다.** 폴백·목업 응답까지 세면 화면의 숫자가 "AI가 일한 횟수"가 아니라
 *    "버튼을 누른 횟수"가 되어 다시 거짓이 된다.
 * 🔴 실패해도 조용히 넘어간다 — 통계 때문에 교정 화면이 막히면 안 된다.
 */
export async function bumpUsage(kind, now = new Date()) {
  if (!Object.values(USAGE_KINDS).includes(kind)) return;
  try {
    const current = await getTodayUsage(now);
    await setLocal(STORAGE_KEYS.USAGE_TODAY, {
      dateKey: todayKey(now),
      ...current,
      [kind]: current[kind] + 1,
    });
  } catch {
    /* 카운트는 부가 정보다 — 실패가 기능을 막지 않는다. */
  }
}
