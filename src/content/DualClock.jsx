import { useEffect, useState } from 'react';
import { getLocalParts, isOffHours } from '../core/schedule/fairy.js';

/**
 * 듀얼 시계 위젯 (S26 / Spec 부가 8 — 팝업 내 듀얼 시계).
 *
 * 내 현재 시각과 상대 현재 시각을 나란히 보여준다. "지금 상대는 몇 시인가"를 팝업을 떠나지 않고
 * 알 수 있어야, 퇴근 요정 배너(S14)나 회의 시간 추천(S23)의 판단이 납득된다.
 *
 * 🔴 타임존 변환은 새 의존성 없이 S14가 이미 검증한 `getLocalParts`를 그대로 재사용한다.
 * 🔴 상대가 오프타임이면 표시로 알린다 — 다만 **국가·문화에 대한 서술은 하지 않는다**
 *    (Spec 필수 2 3순위 · 필수 9). 여기 쓰는 것은 타임존과 시각 숫자뿐이다.
 * 🔴 상대 타임존이 없으면(수신자 미선택) 아무것도 렌더하지 않는다 — 내 시계만 덩그러니
 *    보여주는 건 정보가 아니라 장식이다.
 * 🔴 `hideOffBadge` — 퇴근 요정 배너가 같은 화면에 떠 있으면 「퇴근 시간대」를 **두 번**
 *    말하게 된다(2026-08-14 실측). 그때는 배지를 접는다. 시각이 주황으로 남으므로 정보
 *    자체는 잃지 않고, 같은 말을 두 번 하는 것만 없앤다.
 */
export default function DualClock({ theirTimeZone, theirName = '상대', hideOffBadge = false }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // 분 단위 표시라 30초마다면 충분하다 — 초 단위로 돌리면 배터리만 쓴다.
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!theirTimeZone) return null;

  const myTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let mine;
  let theirs;
  try {
    mine = getLocalParts(now, myTimeZone);
    theirs = getLocalParts(now, theirTimeZone);
  } catch {
    // 잘못된 타임존 문자열이 저장돼 있어도 팝업 전체를 죽이지 않는다.
    return null;
  }

  const theirOff = isOffHours(theirs.hour);
  const dayGap = dayDiff(mine.dateKey, theirs.dateKey);

  return (
    <div className="sai-clock" role="group" aria-label="현재 시각 비교">
      <span className="sai-clock-slot">
        <span className="sai-clock-label">나</span>
        <span className="sai-clock-time">{formatTime(mine)}</span>
      </span>
      <span className="sai-clock-sep" aria-hidden="true">·</span>
      <span className={theirOff ? 'sai-clock-slot sai-clock-off' : 'sai-clock-slot'}>
        <span className="sai-clock-label">{theirName}</span>
        <span className="sai-clock-time">
          {formatTime(theirs)}
          {dayGap !== 0 && <span className="sai-clock-day">{dayGap > 0 ? ' +1일' : ' -1일'}</span>}
        </span>
      </span>
      {theirOff && !hideOffBadge && <span className="sai-clock-badge">퇴근 시간대</span>}
    </div>
  );
}

function formatTime({ hour, minute }) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 날짜가 하루 넘어갔는지 — 시차 때문에 "몇 시"만 보면 어제인지 내일인지 알 수 없다. */
function dayDiff(myDateKey, theirDateKey) {
  if (myDateKey === theirDateKey) return 0;
  return theirDateKey > myDateKey ? 1 : -1;
}
