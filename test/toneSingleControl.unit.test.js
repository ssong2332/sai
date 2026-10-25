/**
 * 「협업 성향」 → 「기본 톤」 합치기 (2026-10-25 사용자 결정). 🔴 화면만 합쳤다 — 저장 키는 그대로다.
 *
 * 🔴 이 테스트가 지키는 것:
 *    ① 화면마다 말투 컨트롤은 「기본 톤」 하나뿐이다(사이드패널 · 설정 페이지). 협업 성향 칩이 없다.
 *    ② 어느 화면에서 톤을 바꿔도 `sai.onboarding.tone`과 `sai.profile.collabStyleId`가 **같이** 바뀐다 —
 *       교정 요청은 `collabStyleId`를 읽으므로(`buildProfileForRefine`), 하나만 바뀌면 화면과 요청이 어긋난다.
 *    ③ 온보딩을 아직 안 끝낸 상태에서도 같다(`setOnboardingFields`는 `completedAt`을 보지 않는다).
 *
 * | 톤을 바꾸는 자리 | 함수 | collabStyleId 동기화 |
 * |---|---|---|
 * | 사이드패널 설정 시트 「보내는 글 기본값」 | `setOnboardingFields({tone})` | 값이 있으면 항상 |
 * | 설정 페이지 「보내는 글 기본값」 | `setOnboardingFields({tone})` | 값이 있으면 항상 |
 * | 홈 3초 온보딩 | `saveOnboarding` | 값이 있으면 항상 |
 * 🔴 톤을 비우는(null) 화면은 없다 — 어느 화면도 「선택 안 함」을 두지 않는다(비우면 collabStyleId가 남는다).
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { setOnboardingFields, saveOnboarding } from '../src/lib/onboarding.js';
import { buildProfileForRefine } from '../src/lib/profile.js';
import { clearAllLocal, getLocal, setLocal, STORAGE_KEYS } from '../src/lib/storage.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const panel = read('../src/sidepanel/App.jsx');
const page = read('../src/settings/App.jsx');

beforeEach(async () => {
  await clearAllLocal();
});

async function both() {
  const onboarding = await getLocal(STORAGE_KEYS.ONBOARDING);
  const profile = await getLocal(STORAGE_KEYS.PROFILE);
  return { tone: onboarding?.tone ?? null, collab: profile?.collabStyleId ?? null };
}

test('🔴 화면마다 말투 컨트롤은 「기본 톤」 하나 — 협업 성향 칩이 없다', () => {
  for (const [name, src] of [['사이드패널', panel], ['설정 페이지', page]]) {
    assert.equal(src.includes('COLLAB_STYLES'), false, `${name}가 아직 협업 성향 목록을 그린다`);
    assert.equal(
      /(onProfileChange|setProfileSyncingTone|setProfile)\(\{[^}]*collabStyleId/s.test(src),
      false,
      `${name}가 collabStyleId를 직접 쓴다(톤 동기화를 건너뛴다)`,
    );
    assert.equal((src.match(/label="기본 톤"/g) ?? []).length, 1, `${name}에 기본 톤 컨트롤이 하나가 아니다`);
    assert.equal(src.includes('label="협업 성향"'), false);
    assert.equal(src.includes('선호하는 말투</p>'), false);
  }
  assert.equal(page.includes('「나」의 협업 성향과 같은 값이에요'), false);
  assert.ok(panel.includes('1순위 — 내 상황</h3>'));
});

test('🔴 톤 설정 경로 — 두 화면 모두 setOnboardingFields를 거친다', () => {
  assert.ok(panel.includes('onPick={(tone) => onChangeOnboarding({ tone })}'));
  assert.ok(panel.includes('setOnboarding(await setOnboardingFields(patch));'));
  assert.ok(page.includes('const set = (patch) => act(() => setOnboardingFields(patch));'));
  assert.ok(page.includes('onChange={(next) => set({ tone: next })}'));
});

test('🔴 톤을 바꾸면 onboarding.tone과 profile.collabStyleId가 같이 바뀐다 — 온보딩 미완료', async () => {
  await setOnboardingFields({ tone: 'warm' });
  assert.deepEqual(await both(), { tone: 'warm', collab: 'warm' });
  const onboarding = await getLocal(STORAGE_KEYS.ONBOARDING);
  assert.equal(onboarding.completedAt ?? null, null, '미완료 온보딩을 완료로 바꾸지 않는다');
  assert.equal((await buildProfileForRefine()).collabStyle != null, true, '교정 요청에 실린다');
});

test('🔴 톤을 바꾸면 둘 다 바뀐다 — 온보딩 완료 후 · 예전에 다른 협업 성향이 있었어도', async () => {
  await saveOnboarding({ language: 'ko', partnerRegion: null, tone: 'direct' });
  assert.deepEqual(await both(), { tone: 'direct', collab: 'direct' });
  await setLocal(STORAGE_KEYS.PROFILE, { situationId: 'incident', collabStyleId: 'brief' }); // 예전 화면에서 따로 바꾼 값
  await setOnboardingFields({ tone: 'rationale' });
  assert.deepEqual(await both(), { tone: 'rationale', collab: 'rationale' });
  assert.equal((await getLocal(STORAGE_KEYS.PROFILE)).situationId, 'incident', '상황은 건드리지 않는다');
});
