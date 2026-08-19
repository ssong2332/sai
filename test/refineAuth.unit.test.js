/**
 * `/v1/refine` 인증 계약 (2026-08-17 신설).
 *
 * 🔴 **왜 소스를 읽는 테스트인가.** 여기서 지키려는 것은 함수의 반환값이 아니라 **배관의
 *    순서**다. 세 가지가 동시에 참이어야 하고, 셋 다 실행해서 확인하기 어렵다:
 *      ① 서버가 토큰을 검사하는가 (`requireUid`)
 *      ② 확장이 토큰을 실어 보내는가 (`Authorization: Bearer`)
 *      ③ 401·429가 **목업으로 덮이지 않는가**
 *    ③이 특히 중요하다. 덮이면 오류가 나지 않고 빌드도 통과하는데, 사용자에게는 **준비된
 *    예시가 실제 교정 결과처럼** 보인다 — `fallback.js`가 "가장 나쁜 실패"라고 부르는 상태다.
 *    로그인만 하면 될 사람이 그걸 모른 채 잘못된 문장을 보낸다.
 * 🔴 **주석을 걷어내고 본다** (`tabs.unit.test.js`와 같은 이유). 아래 파일들의 주석에는 401·
 *    목업·requireUid가 설명으로 인용돼 있어서, 걷어내지 않으면 **설명이 테스트를 통과시킨다.**
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 🔴 **`://`를 주석으로 오인하지 않는다.** 두 슬래시 뒤를 무조건 지우면
//    `chrome-extension://…`이 `chrome-extension:`으로 잘려서, **CORS를 제대로 좁혀 놨는데도
//    테스트가 실패한다**(첫 실행에서 실제로 그랬다). 앞 글자가 `:`가 아닐 때만 주석으로 본다.
// 🔴 이 설명을 블록 주석으로 쓰지 않는다 — 정규식을 인용하면 `*` + `/`가 주석을 조기 종료시켜
//    파일 전체가 파싱 오류가 된다(두 번째 실행에서 실제로 그랬다).
const strip = (raw) =>
  raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*/gm, '$1');

const FUNCTIONS = strip(readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8'));
const BACKGROUND = strip(
  readFileSync(new URL('../src/background/index.js', import.meta.url), 'utf8'),
);
const RULES = strip(readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'));

test('🔴 서버가 refineV1에서 토큰을 검증한다', () => {
  assert.match(
    FUNCTIONS,
    /requireUid\(req, teamDeps\)/,
    'refineV1에 인증 검사가 없다 — URL만 알면 누구나 우리 LLM 키를 쓴다',
  );
  assert.match(FUNCTIONS, /status\(401\)/, '인증 실패에 401을 돌려주지 않는다');
});

test('🔴 인증 검사가 LLM 호출보다 **먼저** 온다', () => {
  // 부른 뒤 거절하면 돈은 이미 나갔다.
  const auth = FUNCTIONS.indexOf('requireUid(req, teamDeps)');
  const provider = FUNCTIONS.indexOf('resolveProviderAndKey(req.body?.provider)');
  assert.ok(auth >= 0 && provider >= 0, '테스트가 낡았다 — 두 지점을 못 찾았다');
  assert.ok(auth < provider, '인증보다 provider 선택이 먼저다 — 미인증 요청이 LLM까지 간다');
});

test('🔴 일일 상한도 LLM 호출보다 먼저 온다', () => {
  const quota = FUNCTIONS.indexOf('consumeDailyQuota');
  const provider = FUNCTIONS.indexOf('resolveProviderAndKey(req.body?.provider)');
  assert.ok(quota >= 0, '상한 검사가 없다 — 인증만으로는 비용이 막히지 않는다');
  assert.ok(quota < provider, '상한을 넘겨도 LLM을 먼저 부른다 — 거절해도 돈은 나간 뒤다');
});

test('CORS가 확장 오리진으로 좁혀져 있다', () => {
  /**
   * 🔴 **refineV1의 옵션 블록만 본다.** 파일 전체를 훑으면 `teamV1`·`health`의 `cors: true`가
   *    걸린다(첫 실행에서 실제로 그랬다). 그 둘은 각각 이미 토큰을 검사하거나 비밀이 없어서
   *    이 테스트의 대상이 아니다 — 대상을 넓히면 통과시키려고 무관한 코드를 고치게 된다.
   */
  const options = FUNCTIONS.match(/export const refineV1 = onRequest\(\s*\{([\s\S]*?)\n {2}\},/);
  assert.ok(options, 'refineV1 옵션 블록을 못 찾았다 — 테스트가 낡았다');
  assert.doesNotMatch(options[1], /cors:\s*true/, 'refineV1의 CORS가 아직 전면 개방이다');
  assert.match(options[1], /chrome-extension:\/\/\$\{EXTENSION_ID\}/, '확장 오리진이 없다');
});

test('🔴 확장이 Authorization 헤더를 실어 보낸다', () => {
  assert.match(
    BACKGROUND,
    /Authorization:\s*`Bearer \$\{token\}`/,
    '토큰을 안 보낸다 — 서버가 전부 401로 막는다',
  );
});

test('🔴 401·429가 목업 폴백으로 덮이지 않는다', () => {
  assert.match(BACKGROUND, /AUTH_FAILURE_NOTICES\[error\?\.status\]/, '상태 코드를 구분하지 않는다');

  const branch = BACKGROUND.indexOf('AUTH_FAILURE_NOTICES[error?.status]');
  const mock = BACKGROUND.search(/await mockRefine\(/);
  assert.ok(branch >= 0 && mock >= 0, '테스트가 낡았다 — 두 지점을 못 찾았다');
  assert.ok(
    branch < mock,
    '목업 폴백이 먼저다 — 로그인이 안 된 사용자에게 준비된 예시가 실제 결과처럼 보인다',
  );
});

test('401·429 안내가 각각 다른 행동을 지시한다', () => {
  // 둘 다 "안 됐어요"로 끝나면 사용자는 무엇을 해야 할지 모른다.
  const block = BACKGROUND.match(/const AUTH_FAILURE_NOTICES = \{[\s\S]*?\n\};/);
  assert.ok(block, 'AUTH_FAILURE_NOTICES 선언을 못 찾았다');
  assert.match(block[0], /401:/, '401 항목이 없다');
  assert.match(block[0], /429:/, '429 항목이 없다');
  assert.match(block[0], /로그인/, '401 안내에 로그인 지시가 없다');
});

test('🔴 상한 카운터를 클라이언트가 건드리지 못한다', () => {
  // 쓰기를 열면 스스로 0으로 되돌리면 그만이고, 읽기를 열면 남의 uid로 사용량이 조회된다.
  const block = RULES.match(/match \/refineQuota\/\{docId\} \{[\s\S]*?\n {4}\}/);
  assert.ok(block, 'refineQuota 규칙이 없다 — 기본 거부에 기대지 말고 명시한다');
  assert.match(block[0], /allow read, write: if false;/, 'refineQuota가 클라이언트에 열려 있다');
});
