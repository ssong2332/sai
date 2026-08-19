/**
 * S11 — 3초 퀵 온보딩 단위 테스트 (Spec 권장 9 F-15).
 *
 * 🔴 핵심 검증: `partnerRegion`이 **언어 기본값 계산 외의 어디로도 나가지 않는다.**
 *    Spec 권장 9는 "주 협업 국가"를 묻지만 필수 2 3순위·필수 9는 국가 기반 추론을 금지한다.
 *    두 요구를 동시에 지키는 유일한 방법은 그 값의 **용도를 물리적으로 좁히는 것**이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MY_LANGUAGES,
  PARTNER_REGIONS,
  DEFAULT_TONES,
  languagePairFrom,
  onboardingLabels,
  getOnboarding,
  saveOnboarding,
  needsOnboarding,
  resetOnboarding,
} from '../src/lib/onboarding.js';

test('세 문항 모두 고정 선택지다 — 자유 입력이 프롬프트로 흘러갈 경로가 없다', () => {
  for (const list of [MY_LANGUAGES, PARTNER_REGIONS, DEFAULT_TONES]) {
    assert.ok(list.length > 0);
    for (const item of list) {
      assert.equal(typeof item.id, 'string');
      assert.equal(typeof item.label, 'string');
    }
  }
});

test('기본 톤 id가 S13 협업 성향 id와 일치한다 — 두 화면이 다른 값을 말하지 않게', async () => {
  const { COLLAB_STYLES } = await import('../src/lib/profile.js');
  const styleIds = COLLAB_STYLES.map((item) => item.id).sort();
  const toneIds = DEFAULT_TONES.map((item) => item.id).sort();
  assert.deepEqual(toneIds, styleIds);
});

/* ── 언어쌍 매핑 ─────────────────────────────────────────────────────── */

test('온보딩 값이 언어쌍 기본값이 된다', () => {
  const pair = languagePairFrom({ language: 'ko', partnerRegion: 'english' });
  assert.deepEqual(pair, { sourceLanguage: 'ko', targetLanguage: 'en' });
});

test('중화권을 고르면 상대 언어가 중국어가 된다', () => {
  const pair = languagePairFrom({ language: 'ko', partnerRegion: 'chinese' });
  assert.equal(pair.targetLanguage, 'zh');
});

test('내 언어와 상대 언어가 같으면 교정 방향이 없으므로 기본값으로 되돌린다', () => {
  const pair = languagePairFrom({ language: 'ko', partnerRegion: 'korean' });
  assert.notEqual(pair.targetLanguage, pair.sourceLanguage);
});

test('온보딩이 비어 있어도 안전한 기본값을 준다', () => {
  const pair = languagePairFrom(null);
  assert.equal(pair.sourceLanguage, 'ko');
  assert.equal(pair.targetLanguage, 'en');
});

test('모르는 값이 들어와도 지어내지 않고 기본값으로 떨어진다', () => {
  const pair = languagePairFrom({ language: 'xx', partnerRegion: 'yy' });
  assert.ok(MY_LANGUAGES.some((item) => item.id === pair.sourceLanguage));
});

/* ── 🔴 국가 격리 — S11의 핵심 안전장치 ─────────────────────────────── */

test('🔴 partnerRegion에서 나오는 것은 언어 코드뿐이다 — 성향·특성 필드가 없다', () => {
  const pair = languagePairFrom({ language: 'ko', partnerRegion: 'english' });
  assert.deepEqual(
    Object.keys(pair).sort(),
    ['sourceLanguage', 'targetLanguage'],
    'languagePairFrom이 언어 외의 값을 만들어내면 안 된다',
  );
});

test('🔴 지역 선택지에 국민성·성향 서술이 없다', () => {
  const banned = ['성향', '특성', '스타일', '보통', '대개', '항상', 'tend', 'typical', 'polite', 'direct'];
  for (const region of PARTNER_REGIONS) {
    const text = JSON.stringify(region).toLowerCase();
    for (const word of banned) {
      assert.ok(!text.includes(word), `지역 ${region.id}에 "${word}"가 있으면 안 된다`);
    }
  }
});

test('🔴 지역 항목이 갖는 필드는 id·label·language뿐이다', () => {
  for (const region of PARTNER_REGIONS) {
    assert.deepEqual(Object.keys(region).sort(), ['id', 'label', 'language']);
  }
});

/* ── 저장·복원 ───────────────────────────────────────────────────────── */

test('저장하면 완료로 바뀌고, 초기화하면 다시 질문 대상이 된다', async () => {
  await resetOnboarding();
  assert.equal(await needsOnboarding(), true, '초기 상태에서는 온보딩이 필요하다');

  await saveOnboarding({ language: 'ko', partnerRegion: 'english', tone: 'brief' });
  assert.equal(await needsOnboarding(), false);

  const stored = await getOnboarding();
  assert.equal(stored.language, 'ko');
  assert.ok(stored.completedAt, '완료 시각이 기록돼야 한다');

  await resetOnboarding();
  assert.equal(await needsOnboarding(), true);
});

test('🔴 온보딩의 기본 톤이 S13 프로필 1순위에 실제로 반영된다', async () => {
  const { getProfile, setProfile } = await import('../src/lib/profile.js');
  await setProfile({ collabStyleId: null });

  await saveOnboarding({ language: 'ko', partnerRegion: 'english', tone: 'direct' });

  const profile = await getProfile();
  assert.equal(
    profile.collabStyleId,
    'direct',
    '온보딩에서 고른 톤이 교정에 아무 영향을 주지 않으면 질문한 의미가 없다',
  );
  await resetOnboarding();
});

test('표시 라벨은 고정 집합에서만 나오고 모르는 값은 null이다', () => {
  const labels = onboardingLabels({ language: 'ko', partnerRegion: 'nope', tone: 'brief' });
  assert.equal(labels.language, '한국어');
  assert.equal(labels.partnerRegion, null);
  assert.equal(labels.tone, '짧게');
});
