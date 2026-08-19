import { useState } from 'react';
import { regionByTimeZone, localTimeLabel, filterRegions } from '../lib/regions.js';

/**
 * 지역 선택 콤보박스 (2026-08-14 사용자 요청 — 검색 필터).
 *
 * 🔴 **`<select>`를 쓰지 않는 이유**: 네이티브 select의 타이핑 검색은 **첫 글자 점프**뿐이라
 *    `berlin`·`DE`처럼 라벨 중간이나 다른 표기로 치면 못 찾는다. 25개는 눈으로 훑기에도 많다.
 * 🔴 **고른 뒤에도 다시 열 수 있어야 한다** — 잘못 골랐을 때 되돌릴 방법이 없으면 카드를 지웠다
 *    새로 만들어야 한다.
 * 🔴 **Enter로 첫 결과를 고를 수 있다** — 마우스가 유일한 경로가 되면 안 된다(툴바 hover에서
 *    같은 실수를 한 적이 있다).
 *
 * 🔴 **직접 입력이 이 안에 있다** (2026-08-16 사용자 요청 ⑤). 예전에는 「지역을 고르세요」 버튼과
 *    「목록에 없으면 직접 입력」 칸과 「국가코드」 칸이 **항상 셋 다** 세로로 쌓여 있었다 —
 *    아직 아무것도 안 골랐는데 입력칸 세 개가 보이니 무엇을 해야 하는 화면인지 알 수 없었다.
 *    이제 **입구는 하나**고, 검색해서 안 나오면 **친 그대로 쓰는 선택지가 목록 안에 나타난다.**
 *    국가코드는 목록 밖 값을 실제로 골랐을 때만 부모가 낸다.
 * 🔴 **직접 입력은 검증한다** — IANA 타임존이 아니면 시각 계산이 통째로 조용히 틀린다.
 *    `Intl`에 물어보면 되고, 이건 우리 규칙이 아니라 브라우저의 판정이라 목록을 늘릴 필요가 없다.
 *
 * @param {string} timeZone 현재 선택된 IANA 타임존('' 가능).
 * @param {(region: {timeZone: string, countryCode: string|null, language?: string|null}) => void} onPick
 */
export default function RegionPicker({ timeZone, onPick }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /**
   * 🔴 **직접 입력 모드** (2026-08-16 사용자 지적 ③).
   *    증상: 「요르단」을 쳤더니 "찾지 못했어요 — IANA 타임존을 치세요"만 뜨고 **국가코드 칸이
   *    끝내 안 나왔다.** 원인은 검색창 하나로 두 가지 일을 시켰기 때문이다 — 검색어는 나라
   *    이름으로 치는 게 자연스러운데, 그 칸이 동시에 타임존 입력칸이라 「요르단」은 어느 쪽으로도
   *    성립하지 않아 **막다른 길**이 됐다.
   * 🔴 그래서 **입구는 하나로 두되, 목록에 없으면 전용 칸 두 개로 넘어간다** — 타임존과
   *    국가코드는 서로 다른 값이므로 칸도 둘이어야 한다(하나로 받으면 `Europe/Berlin`+`US`
   *    같은 조합이 다시 생긴다).
   */
  const [manual, setManual] = useState(null); // null | {timeZone, countryCode}

  const selected = regionByTimeZone(timeZone);
  const matches = filterRegions(query);

  const choose = (region) => {
    onPick(region);
    setOpen(false);
    setQuery('');
    setManual(null);
  };

  /** 친 문자열이 브라우저가 아는 타임존인지 — 아니면 `RangeError`가 난다. */
  const isValidZone = (candidate) => {
    const value = String(candidate ?? '').trim();
    if (value === '' || !value.includes('/')) return false;
    try {
      new Intl.DateTimeFormat('ko-KR', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  };
  const typedIsValidZone = isValidZone(query);

  if (!open) {
    return (
      <button type="button" className="form-input region-trigger" onClick={() => setOpen(true)}>
        {timeZone ? (
          <>
            {/* 🔴 목록 밖 값도 **고른 값으로 보여준다** — 빈 버튼이면 저장됐는지 알 수 없다. */}
            {selected ? selected.label : timeZone}
            <span className="meta"> · 지금 {localTimeLabel(timeZone)}</span>
          </>
        ) : (
          <span className="region-placeholder">지역을 고르거나 직접 입력하세요</span>
        )}
      </button>
    );
  }

  return (
    <div className="region-picker">
      <input
        className="form-input"
        placeholder="검색하거나 직접 입력 — 베를린 / berlin / DE / Europe/Lisbon"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key !== 'Enter') return;
          // 🔴 목록에 있으면 목록이 이긴다 — 친 값이 우연히 타임존 모양이어도 사용자는 보통 목록을 원한다.
          if (matches[0]) choose(matches[0]);
          else if (typedIsValidZone) choose({ timeZone: query.trim(), countryCode: null });
        }}
        aria-label="지역 검색 또는 직접 입력"
      />

      <div className="region-list" role="listbox">
        {matches.map((region) => (
          <button
            key={region.id}
            type="button"
            role="option"
            aria-selected={region.timeZone === timeZone}
            className={
              region.timeZone === timeZone ? 'region-option region-option-on' : 'region-option'
            }
            onClick={() => choose(region)}
          >
            <span>{region.label}</span>
            <span className="meta">지금 {localTimeLabel(region.timeZone)}</span>
          </button>
        ))}

        {/* 🔴 **직접 입력 결과도 목록의 한 줄이다** — 별도 입력칸을 두면 같은 일을 하는 자리가
            두 곳이 된다. 유효한 타임존일 때만 나오므로 오타는 애초에 고를 수 없다. */}
        {typedIsValidZone && !matches.some((region) => region.timeZone === query.trim()) && (
          <button
            type="button"
            role="option"
            aria-selected={false}
            className="region-option region-option-custom"
            onClick={() => choose({ timeZone: query.trim(), countryCode: null })}
          >
            <span>
              직접 입력: <b>{query.trim()}</b>
            </span>
            <span className="meta">지금 {localTimeLabel(query.trim())}</span>
          </button>
        )}

        {matches.length === 0 && !typedIsValidZone && (
          <p className="meta region-empty">
            {query.trim() === ''
              ? '지역을 고르거나, 목록에 없으면 아래 「직접 입력」을 쓰세요.'
              : `「${query.trim()}」로는 찾지 못했어요 — 아래 「직접 입력」으로 넣을 수 있어요.`}
          </p>
        )}
      </div>

      {/**
        * 🔴 **막다른 길을 없앤다** (③). 검색으로 못 찾은 뒤 갈 곳이 여기다. 이 버튼이 없으면
        *    목록 밖 지역의 사람은 아예 등록할 수 없다 — "그 사람과는 이 제품을 못 쓴다"가 된다.
        */}
      {manual === null ? (
        <button
          type="button"
          className="link-button"
          onClick={() => setManual({ timeZone: typedIsValidZone ? query.trim() : '', countryCode: '' })}
        >
          목록에 없어요 — 직접 입력할게요
        </button>
      ) : (
        <div className="region-manual">
          <p className="meta">
            타임존은 <b>IANA 형식</b>이라야 시각 계산이 맞아요 — 「요르단」이 아니라{' '}
            <b>Asia/Amman</b>처럼 씁니다.
          </p>
          <input
            className="form-input"
            placeholder="타임존 (예: Asia/Amman)"
            value={manual.timeZone}
            autoFocus
            onChange={(event) => setManual({ ...manual, timeZone: event.target.value })}
          />
          {/* 🔴 국가코드는 **여기서** 나온다 — 목록 밖 지역을 넣는 이 순간이 필요한 시점이다. */}
          <input
            className="form-input"
            placeholder="국가코드 — 공휴일 조회용 (예: JO · 선택)"
            maxLength={2}
            value={manual.countryCode}
            onChange={(event) => setManual({ ...manual, countryCode: event.target.value })}
          />
          {/* 🔴 형식이 틀리면 **저장 전에** 말한다 — 넣고 나서 시각이 틀리면 원인을 못 찾는다. */}
          {manual.timeZone.trim() !== '' && !isValidZone(manual.timeZone) && (
            <p className="meta">
              브라우저가 모르는 타임존이에요. 「대륙/도시」 형식인지 확인해 주세요.
            </p>
          )}
          {isValidZone(manual.timeZone) && (
            <p className="meta">지금 그곳은 {localTimeLabel(manual.timeZone.trim())}이에요.</p>
          )}
          <div className="tag-row">
            <button
              type="button"
              className="button button-primary"
              disabled={!isValidZone(manual.timeZone)}
              onClick={() =>
                choose({
                  timeZone: manual.timeZone.trim(),
                  countryCode: manual.countryCode.trim().toUpperCase() || null,
                })
              }
            >
              이 지역으로
            </button>
            <button type="button" className="button" onClick={() => setManual(null)}>
              취소
            </button>
          </div>
        </div>
      )}

      <button type="button" className="link-button" onClick={() => setOpen(false)}>
        닫기
      </button>
    </div>
  );
}
