/**
 * 수신자 등록용 지역 목록 (S17 후속 / 2026-08-14 사용자 요청).
 *
 * 🔴 **타임존과 국가코드를 한 항목으로 묶는다.** 따로 고르게 하면 `Europe/Berlin` + `US` 같은
 *    앞뒤가 안 맞는 조합이 만들어진다. 하나를 고르면 둘 다 정해진다.
 *
 * 🔴 **이 목록은 시각 계산과 공휴일 조회에만 쓴다** (Spec 필수 2 3순위 · 필수 9).
 *    - `timeZone` → 회의 시간 겹침·퇴근 요정(`core/schedule`, `core/meeting`)
 *    - `countryCode` → Nager.Date 공휴일 조회
 *    **성향·톤·문화 추론에 쓰지 않는다.** "독일 사람이니 직설적일 것" 같은 판단을 만들 여지를
 *    코드 수준에서 두지 않는다 — 태그는 사용자가 직접 지정하거나 GitHub 공개 활동(S22)에서만 온다.
 *
 * 🔴 **완전한 목록이 아니다.** 여기 없는 지역은 「직접 입력」으로 IANA 타임존을 넣을 수 있어야 한다 —
 *    목록에 없다고 등록을 막으면 그 사람과는 이 제품을 못 쓴다.
 *
 * `countryCode`는 ISO 3166-1 alpha-2 (Nager.Date 형식).
 *
 * 🔴 **`language` — 지역을 고르면 채워지는 「쓸 언어」 기본값** (2026-08-16 사용자 요청 ④).
 *    - **사람에 대한 서술이 아니다.** "이 나라 사람은 이렇다"가 아니라 **"이 상대에게 어느 언어로
 *      쓸 것인가"**이며, 값은 `targetLanguage`로만 나간다(필수 2 3순위 · 필수 9 위반 아님).
 *    - **처음 한 번만 채우고, 이미 고른 값은 덮지 않는다** — 사용자가 친 것을 우리가 지우지 않는다.
 *    - **우리가 실제로 쓸 수 있는 언어만 넣는다**(`RECIPIENT_LANGUAGES` 7개). 그래서 네덜란드·
 *      스웨덴·폴란드·베트남·브라질처럼 현지어를 지원하지 않는 곳은 `en`이다 — 이는 "그 나라 말이
 *      영어다"가 아니라 **"우리가 낼 수 있는 업무 공용어가 영어뿐"**이라는 뜻이고, 화면도 그렇게
 *      말한다(고치라고 안내한다).
 */

export const REGIONS = [
  { id: 'seoul', label: '한국 · 서울', timeZone: 'Asia/Seoul', countryCode: 'KR', language: 'ko' },
  { id: 'tokyo', label: '일본 · 도쿄', timeZone: 'Asia/Tokyo', countryCode: 'JP', language: 'ja' },
  { id: 'shanghai', label: '중국 · 상하이', timeZone: 'Asia/Shanghai', countryCode: 'CN', language: 'zh' },
  { id: 'taipei', label: '대만 · 타이베이', timeZone: 'Asia/Taipei', countryCode: 'TW', language: 'zh' },
  { id: 'singapore', label: '싱가포르', timeZone: 'Asia/Singapore', countryCode: 'SG', language: 'en' },
  { id: 'jakarta', label: '인도네시아 · 자카르타', timeZone: 'Asia/Jakarta', countryCode: 'ID', language: 'en' },
  { id: 'hochiminh', label: '베트남 · 호치민', timeZone: 'Asia/Ho_Chi_Minh', countryCode: 'VN', language: 'en' },
  { id: 'bengaluru', label: '인도 · 벵갈루루', timeZone: 'Asia/Kolkata', countryCode: 'IN', language: 'en' },
  { id: 'dubai', label: 'UAE · 두바이', timeZone: 'Asia/Dubai', countryCode: 'AE', language: 'en' },
  { id: 'telaviv', label: '이스라엘 · 텔아비브', timeZone: 'Asia/Jerusalem', countryCode: 'IL', language: 'en' },
  { id: 'warsaw', label: '폴란드 · 바르샤바', timeZone: 'Europe/Warsaw', countryCode: 'PL', language: 'en' },
  { id: 'berlin', label: '독일 · 베를린', timeZone: 'Europe/Berlin', countryCode: 'DE', language: 'de' },
  { id: 'paris', label: '프랑스 · 파리', timeZone: 'Europe/Paris', countryCode: 'FR', language: 'fr' },
  { id: 'amsterdam', label: '네덜란드 · 암스테르담', timeZone: 'Europe/Amsterdam', countryCode: 'NL', language: 'en' },
  { id: 'madrid', label: '스페인 · 마드리드', timeZone: 'Europe/Madrid', countryCode: 'ES', language: 'es' },
  { id: 'stockholm', label: '스웨덴 · 스톡홀름', timeZone: 'Europe/Stockholm', countryCode: 'SE', language: 'en' },
  { id: 'london', label: '영국 · 런던', timeZone: 'Europe/London', countryCode: 'GB', language: 'en' },
  { id: 'saopaulo', label: '브라질 · 상파울루', timeZone: 'America/Sao_Paulo', countryCode: 'BR', language: 'en' },
  { id: 'newyork', label: '미국 동부 · 뉴욕', timeZone: 'America/New_York', countryCode: 'US', language: 'en' },
  { id: 'toronto', label: '캐나다 · 토론토', timeZone: 'America/Toronto', countryCode: 'CA', language: 'en' },
  { id: 'chicago', label: '미국 중부 · 시카고', timeZone: 'America/Chicago', countryCode: 'US', language: 'en' },
  { id: 'mexicocity', label: '멕시코 · 멕시코시티', timeZone: 'America/Mexico_City', countryCode: 'MX', language: 'es' },
  { id: 'losangeles', label: '미국 서부 · LA', timeZone: 'America/Los_Angeles', countryCode: 'US', language: 'en' },
  { id: 'sydney', label: '호주 · 시드니', timeZone: 'Australia/Sydney', countryCode: 'AU', language: 'en' },
  { id: 'auckland', label: '뉴질랜드 · 오클랜드', timeZone: 'Pacific/Auckland', countryCode: 'NZ', language: 'en' },
];

const BY_TIMEZONE = new Map(REGIONS.map((region) => [region.timeZone, region]));

/** 저장된 타임존으로 목록 항목을 되찾는다. 없으면 null(= 직접 입력한 값). */
export function regionByTimeZone(timeZone) {
  return BY_TIMEZONE.get(timeZone) ?? null;
}

/**
 * 목록에 뿌릴 **도시 이름만** 돌려준다 (2026-08-19 사용자 요청 ③).
 *
 * 🔴 예전에는 저장된 값(`America/Chicago`)을 그대로 찍었다. 그런데 이건 **타임존 식별자**이지
 *    사람이 읽는 지명이 아니다 — 앞의 `America`는 대륙이고, 사용자가 고른 것은 「시카고」다.
 *    나라·대륙은 이미 고를 때 봤으므로 목록에서는 **도시만** 보이면 된다.
 *
 * | 입력 | 나오는 값 | 이유 |
 * |---|---|---|
 * | `America/Chicago` (목록에 있음) | `시카고` | 라벨 `미국 중부 · 시카고`의 뒷부분 |
 * | `Asia/Singapore` (도시국가) | `싱가포르` | 라벨에 ` · `가 없으면 라벨 전체 |
 * | `Europe/Zurich` (직접 입력) | `Zurich` | 목록에 없으면 식별자의 뒷부분, `_`는 공백으로 |
 * | 빈 값 | `''` | 호출부가 `·`를 붙이지 않도록 |
 */
export function regionCityLabel(timeZone) {
  if (!timeZone) return '';
  const region = regionByTimeZone(timeZone);
  if (region) {
    const parts = region.label.split(' · ');
    return parts[parts.length - 1];
  }
  return String(timeZone).split('/').pop().replace(/_/g, ' ');
}

/**
 * 지역을 바꿨을 때 **이 사람에게 쓸 언어**를 어떻게 할 것인가 (2026-08-17 사용자 지적).
 *
 * 🔴 **왜 함수로 뺐나.** 처음 규칙은 「언어가 **비어 있을 때만** 채운다」였다. 등록 화면에서는
 *    맞았지만 **편집에서는 정반대로 동작했다**: 이미 등록된 사람은 언어가 **항상 차 있어서**,
 *    뉴욕 → 베를린으로 고쳐도 언어가 **영어에 그대로 남았다.** 지역을 일부러 바꾸는 것은
 *    「이 사람이 옮겼다」는 뜻인데 화면이 아무 반응을 안 했다.
 *    반대로 **무조건 덮으면** 베를린에 있지만 영어로 쓰는 상대에게 사용자가 일부러 골라 둔
 *    「영어」가, 지역 오타를 고치는 순간 독일어로 바뀐다. **둘 다 실제로 나쁜 결과**라
 *    경계가 미묘하다 — 그래서 화면 밖으로 꺼내 표로 고정하고 테스트로 잠근다.
 *
 * 🔴 **판정표 — 「사용자가 고른 값인가」로 가른다.** 표에 없는 경우를 임의로 처리하지 않는다.
 *
 * | 지금 언어 | 새 지역의 언어 | 판정 |
 * |---|---|---|
 * | 비어 있음 | 있음 | **채운다** (auto) |
 * | **이전 지역의 기본값과 같다** | 있음 | **바꾼다** (auto) ← 따라온 값이지 고른 값이 아니다 |
 * | 이전 지역 기본값과 **다르다** | 있음 | **그대로** ← 사용자가 일부러 바꾼 값 |
 * | 무엇이든 | 없음(직접 입력 지역) | **그대로** |
 *
 * 🔴 이 판정은 **언어에 대한 것이지 사람에 대한 것이 아니다** — "그 지역 사람은 이 말을 쓴다"가
 *    아니라 "우리가 그 상대에게 어느 언어로 쓸 것인가"의 기본값이다 (Spec 필수 2 3순위 · 필수 9).
 *
 * @returns {{language: string|null, auto: boolean}} `auto`가 true면 화면이 "기본값이에요"를 알린다.
 */
export function resolveLanguageOnRegionChange({ currentLanguage, currentTimeZone, nextRegion }) {
  const keep = { language: currentLanguage ?? null, auto: false };
  if (nextRegion?.language == null) return keep;

  const previous = regionByTimeZone(currentTimeZone);
  const wasAuto = previous != null && currentLanguage === previous.language;
  if (currentLanguage == null || wasAuto) return { language: nextRegion.language, auto: true };
  return keep;
}

/**
 * 지금 시각을 그 지역 현지 시각으로 — 드롭다운 옆에 보여주면 고르기 전에 감이 온다.
 * 🔴 잘못된 타임존에도 죽지 않는다.
 */
export function localTimeLabel(timeZone, now = new Date()) {
  if (!timeZone) return '';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    return '';
  }
}

/**
 * 검색어로 지역을 거른다 (2026-08-14 사용자 요청).
 *
 * 🔴 **라벨·타임존·국가코드를 모두 본다.** 한국어 라벨만 대조하면 `berlin`·`DE`·`Europe`으로는
 *    아무것도 안 나온다 — 사용자가 어느 쪽으로 칠지 우리가 정할 수 없다.
 * 🔴 공백으로 나눠 **모든 조각이 포함되는** 것만 남긴다(AND). `미국 뉴욕`처럼 두 단어를 쳐도
 *    걸리게 하려는 것이다.
 * 🔴 빈 검색어면 **전체**를 준다 — 아무것도 안 보여 주면 목록을 훑어볼 수 없다.
 */
export function filterRegions(query, regions = REGIONS) {
  const words = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return regions;
  return regions.filter((region) => {
    const haystack = `${region.label} ${region.timeZone} ${region.countryCode}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
