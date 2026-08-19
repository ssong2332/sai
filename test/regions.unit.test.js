/**
 * 수신자 지역 목록 단위 테스트 (S17 후속 / 2026-08-14).
 *
 * 🔴 이 테스트가 지키려는 핵심:
 *    ① **모든 타임존이 실제로 동작한다** — 오타 하나면 그 지역 사용자의 회의 시간 추천이 통째로
 *       죽는다. 눈으로 확인하지 않고 `Intl`에 실제로 물어본다.
 *    ② **타임존과 국가코드가 짝으로 붙어 있다** — 따로 고르면 앞뒤가 안 맞는 조합이 생긴다.
 *    ③ 목록에 없는 지역도 **막지 않는다**(직접 입력 경로가 살아 있어야 한다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REGIONS,
  regionByTimeZone,
  regionCityLabel,
  localTimeLabel,
  filterRegions,
  resolveLanguageOnRegionChange,
} from '../src/lib/regions.js';

test('🔴 모든 타임존이 Intl에서 실제로 동작한다 — 오타면 그 지역이 통째로 죽는다', () => {
  for (const region of REGIONS) {
    const label = localTimeLabel(region.timeZone);
    assert.match(label, /^\d{2}:\d{2}$/, `${region.timeZone} → "${label}"`);
  }
});

test('타임존은 IANA 형식, 국가코드는 ISO alpha-2', () => {
  for (const region of REGIONS) {
    assert.ok(region.timeZone.includes('/'), `IANA 형식이 아니다: ${region.timeZone}`);
    assert.match(region.countryCode, /^[A-Z]{2}$/, `alpha-2가 아니다: ${region.countryCode}`);
    assert.ok(region.label.length > 0, `${region.id}에 라벨이 없다`);
  }
});

test('id·타임존에 중복이 없다', () => {
  const ids = REGIONS.map((region) => region.id);
  const zones = REGIONS.map((region) => region.timeZone);
  assert.equal(ids.length, new Set(ids).size, 'id가 중복됐다');
  assert.equal(zones.length, new Set(zones).size, '타임존이 중복됐다');
});

test('🔴 같은 국가의 여러 시간대를 허용한다 — 미국은 하나가 아니다', () => {
  const us = REGIONS.filter((region) => region.countryCode === 'US');
  assert.ok(us.length >= 3, `미국 시간대가 ${us.length}개뿐이다`);
});

test('regionByTimeZone은 짝을 되찾고, 없는 값에는 null을 준다', () => {
  assert.equal(regionByTimeZone('Europe/Berlin').countryCode, 'DE');
  assert.equal(regionByTimeZone('Asia/Seoul').countryCode, 'KR');
  // 🔴 null이어야 화면이 "직접 입력" 칸을 연다 — 목록에 없다고 등록을 막으면 안 된다.
  assert.equal(regionByTimeZone('Europe/Lisbon'), null);
  assert.equal(regionByTimeZone(''), null);
  assert.equal(regionByTimeZone(undefined), null);
});

test('🔴 regionCityLabel은 도시만 남긴다 — 나라·대륙은 목록에서 뺀다(2026-08-19 요청 ③)', () => {
  assert.equal(regionCityLabel('America/Chicago'), '시카고');
  assert.equal(regionCityLabel('Asia/Tokyo'), '도쿄');
  assert.equal(regionCityLabel('America/Los_Angeles'), 'LA');
  // 도시국가는 라벨에 ` · `가 없다 — 라벨 전체가 곧 도시다.
  assert.equal(regionCityLabel('Asia/Singapore'), '싱가포르');
  // 목록에 없는 값(직접 입력)은 식별자의 뒷부분, `_`는 공백으로.
  assert.equal(regionCityLabel('Europe/Zurich'), 'Zurich');
  assert.equal(regionCityLabel('America/Argentina/Buenos_Aires'), 'Buenos Aires');
  // 빈 값에 `·`가 붙지 않도록 빈 문자열.
  assert.equal(regionCityLabel(''), '');
  assert.equal(regionCityLabel(undefined), '');
});

test('🔴 모든 등록 지역이 빈 도시 이름을 내지 않는다 — 하나라도 비면 그 카드가 `· ·`가 된다', () => {
  for (const region of REGIONS) {
    assert.ok(regionCityLabel(region.timeZone).length > 0, `${region.id}에 도시 이름이 없다`);
  }
});

test('잘못된 타임존에도 죽지 않는다', () => {
  assert.equal(localTimeLabel('Not/AZone'), '');
  assert.equal(localTimeLabel(null), '');
  assert.equal(localTimeLabel(''), '');
});

/**
 * 🔴 **2026-08-16 계약 변경**: `language`를 허용 목록에 넣었다(사용자 요청 ④ — 지역을 고르면
 *    쓸 언어 기본값이 채워진다). 이 테스트는 원래 「필드가 넷뿐」을 지켰는데, 그 규칙의 목적은
 *    필드 수가 아니라 **사람의 성향·문화를 국가에서 유추하는 경로를 막는 것**이다.
 *    - `language`는 **문장을 어느 언어로 쓸지**이고 `targetLanguage`로만 나간다 — 사람에 대한
 *      서술이 아니다.
 *    - 성향·톤·문화를 담는 필드는 **여전히 금지**다. 아래 금지 목록이 그 부분을 지킨다.
 */
test('🔴 목록에 성향·문화 관련 필드가 없다 (Spec 필수 2 3순위 · 필수 9)', () => {
  const allowed = ['id', 'label', 'timeZone', 'countryCode', 'language'];
  for (const region of REGIONS) {
    for (const key of Object.keys(region)) {
      assert.ok(allowed.includes(key), `지역 데이터에 ${key}가 있다 — 성향 추론 경로가 열린다`);
    }
  }
});

test('🔴 성향·톤·문화 필드는 이름조차 존재하지 않는다', () => {
  const banned = ['tone', 'style', 'culture', 'directness', 'formality', 'traits', 'tags', 'hint'];
  for (const region of REGIONS) {
    for (const key of banned) {
      assert.ok(!(key in region), `지역 데이터에 ${key}가 생겼다 — 국가로 사람을 판단하게 된다`);
    }
  }
});

test('🔴 language는 우리가 실제로 낼 수 있는 언어뿐이다', () => {
  // 🔴 목록 밖 값이 들어가면 `targetLanguage` 검증에서 서버가 400을 낸다 — 화면이 아니라
  //    교정 자체가 죽는다. 지원 언어 목록과 어긋나지 않는지 데이터 단계에서 잠근다.
  const supported = ['en', 'zh', 'ja', 'de', 'fr', 'es', 'ko'];
  for (const region of REGIONS) {
    assert.ok(
      supported.includes(region.language),
      `${region.id}의 language(${region.language})는 지원 언어가 아니다`,
    );
  }
});

/* ── 검색 (2026-08-14 사용자 요청) ─────────────────────────────────────── */

test('🔴 라벨·타임존·국가코드 어느 쪽으로 쳐도 걸린다', () => {
  const labels = (q) => filterRegions(q).map((region) => region.label);
  assert.deepEqual(labels('베를린'), ['독일 · 베를린'], '한국어 라벨로 못 찾는다');
  assert.deepEqual(labels('berlin'), ['독일 · 베를린'], '영문 도시명으로 못 찾는다');
  assert.deepEqual(labels('DE'), ['독일 · 베를린'], '국가코드로 못 찾는다');
});

test('여러 단어는 AND로 좁힌다', () => {
  assert.equal(filterRegions('미국').length, 3);
  assert.deepEqual(
    filterRegions('미국 뉴욕').map((region) => region.label),
    ['미국 동부 · 뉴욕'],
  );
});

test('🔴 빈 검색어는 전체를 준다 — 아무것도 안 보이면 목록을 훑을 수 없다', () => {
  assert.equal(filterRegions('').length, REGIONS.length);
  assert.equal(filterRegions('   ').length, REGIONS.length);
  assert.equal(filterRegions(null).length, REGIONS.length);
});

test('대소문자를 가리지 않는다', () => {
  assert.deepEqual(filterRegions('BERLIN'), filterRegions('berlin'));
  assert.deepEqual(filterRegions('de'), filterRegions('DE'));
});

test('없는 검색어는 빈 배열 — 화면이 "직접 입력" 안내로 바뀐다', () => {
  assert.deepEqual(filterRegions('zzzz'), []);
});

/* ── 지역을 바꿨을 때 언어 판정 (2026-08-17 사용자 지적) ───────────────────
 *
 * 🔴 **편집에서만 틀리는 결함이었다.** 등록 화면은 언어가 비어 있어 잘 동작했고, 편집 화면은
 *    언어가 **항상 차 있어서** 지역을 바꿔도 옛 언어가 남았다. 화면을 렌더하는 테스트가 없으니
 *    판정을 순수 함수로 꺼내 표대로 잠근다.
 * 🔴 반대 방향(사용자가 고른 언어를 덮는 것)도 똑같이 나쁜 결과라, **양쪽 다** 테스트한다.
 */

const NY = REGIONS.find((r) => r.id === 'newyork');
const BERLIN = REGIONS.find((r) => r.id === 'berlin');
const SEOUL = REGIONS.find((r) => r.id === 'seoul');

test('🔴 이전 지역의 기본 언어를 쓰고 있었다면 새 지역 언어로 **바뀐다** (편집 결함의 본체)', () => {
  // 뉴욕(en)에 있던 MANE을 베를린으로 옮긴다 → 영어가 독일어가 되어야 한다.
  const out = resolveLanguageOnRegionChange({
    currentLanguage: NY.language,
    currentTimeZone: NY.timeZone,
    nextRegion: BERLIN,
  });
  assert.equal(out.language, 'de');
  assert.equal(out.auto, true, '자동으로 바뀌었으면 화면이 그 사실을 알려야 한다');
});

test('🔴 사용자가 일부러 고른 언어는 **덮지 않는다**', () => {
  // 베를린에 있지만 영어로 쓰는 상대. 지역을 서울로 고쳐도 영어여야 한다.
  const out = resolveLanguageOnRegionChange({
    currentLanguage: 'en',
    currentTimeZone: BERLIN.timeZone, // 베를린 기본은 de → en은 사용자가 고른 값
    nextRegion: SEOUL,
  });
  assert.equal(out.language, 'en', '사용자가 정한 값을 지역 변경이 지웠다');
  assert.equal(out.auto, false);
});

test('언어가 비어 있으면 채운다 (등록 화면의 원래 동작 — 회귀 방지)', () => {
  const out = resolveLanguageOnRegionChange({
    currentLanguage: null,
    currentTimeZone: '',
    nextRegion: BERLIN,
  });
  assert.equal(out.language, 'de');
  assert.equal(out.auto, true);
});

test('🔴 직접 입력한 지역(언어 없음)으로 바꾸면 언어를 건드리지 않는다', () => {
  const custom = { timeZone: 'Asia/Amman', countryCode: 'JO', language: null };
  const out = resolveLanguageOnRegionChange({
    currentLanguage: 'en',
    currentTimeZone: BERLIN.timeZone,
    nextRegion: custom,
  });
  assert.equal(out.language, 'en');
  assert.equal(out.auto, false);
});

test('이전 지역이 목록 밖이면 사용자가 고른 값으로 보고 지킨다', () => {
  // 직접 입력한 타임존에는 기본 언어가 없다 → 지금 언어는 사용자가 고른 것이다.
  const out = resolveLanguageOnRegionChange({
    currentLanguage: 'ja',
    currentTimeZone: 'Asia/Amman',
    nextRegion: BERLIN,
  });
  assert.equal(out.language, 'ja');
  assert.equal(out.auto, false);
});

test('같은 언어를 쓰는 지역끼리 옮겨도 결과가 흔들리지 않는다', () => {
  const taipei = REGIONS.find((r) => r.id === 'taipei');
  const shanghai = REGIONS.find((r) => r.id === 'shanghai');
  const out = resolveLanguageOnRegionChange({
    currentLanguage: shanghai.language,
    currentTimeZone: shanghai.timeZone,
    nextRegion: taipei,
  });
  assert.equal(out.language, 'zh');
});
