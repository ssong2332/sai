/**
 * 민감정보 가드 테스트 (S15 / Spec 필수 11).
 *
 * 🔴 **오탐 케이스가 절반이다.** 미탐(비밀 유출)이 더 나쁘지만, 오탐이 잦으면 사용자가 가드를
 *    꺼버려서 결국 같은 결과가 된다. 규칙을 추가할 때는 반드시 오탐 케이스도 함께 넣는다.
 * 🔴 아래 키·번호는 전부 **합성값**이며 실재하지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { detectSensitive, redact, summarize, REDACTION } from '../src/content/sensitiveGuard.js';

const types = (text) => detectSensitive(text).findings.map((f) => f.type);

/* ── 탐지되어야 하는 것 ────────────────────────────────────────────────── */

test('OpenAI API 키를 잡는다', () => {
  assert.deepEqual(types('키는 sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456 입니다'), ['openai-key']);
});

test('GitHub 토큰을 잡는다 (classic·fine-grained 둘 다)', () => {
  assert.deepEqual(types('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'), ['github-token']);
  assert.deepEqual(types('github_pat_11ABCDEFG0abcdefghijklmnop'), ['github-token']);
});

test('AWS 액세스 키를 잡는다', () => {
  assert.deepEqual(types('AKIAIOSFODNN7EXAMPLE 로 접속'), ['aws-access-key']);
});

test('Google API 키를 잡는다', () => {
  // 실제 Google API 키는 총 39자 = 'AIza' + 35자. 규칙도 그 길이를 정확히 요구한다.
  const key = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';
  assert.equal(key.length, 39, '픽스처 길이가 실제 키 형식과 달라졌다');
  assert.deepEqual(types(key), ['google-api-key']);
});

test('Slack 토큰을 잡는다', () => {
  assert.deepEqual(types('xoxb-1234567890-abcdefghij'), ['slack-token']);
});

test('개인키 블록을 잡는다', () => {
  assert.deepEqual(types('-----BEGIN RSA PRIVATE KEY-----\nMIIE...'), ['private-key']);
});

test('Bearer 토큰을 잡는다', () => {
  assert.deepEqual(types('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), [
    'bearer-token',
  ]);
});

test('비밀번호 라벨 뒤 값을 잡는다 (한/영)', () => {
  assert.deepEqual(types('비밀번호: hunter2024'), ['password']);
  assert.deepEqual(types('password=Tr0ub4dor'), ['password']);
});

test('Luhn을 통과하는 카드번호를 잡는다 (구분자 있어도)', () => {
  assert.deepEqual(types('4111111111111111'), ['credit-card']);
  assert.deepEqual(types('4111-1111-1111-1111'), ['credit-card']);
  assert.deepEqual(types('4111 1111 1111 1111'), ['credit-card']);
});

test('유효한 생년월일의 주민등록번호를 잡는다', () => {
  assert.deepEqual(types('900101-1234567'), ['korean-rrn']);
});

/* ── 잡히면 안 되는 것 (오탐 방지) ─────────────────────────────────────── */

test('Luhn을 통과하지 못하는 16자리는 카드번호가 아니다 — 주문번호 오탐 방지', () => {
  assert.deepEqual(types('주문번호 1234567812345678 확인 부탁드립니다'), []);
});

test('전화번호·일반 숫자는 잡지 않는다', () => {
  assert.deepEqual(types('연락처는 010-1234-5678 입니다'), []);
  assert.deepEqual(types('응답 시간이 200ms에서 3초로 늘었습니다'), []);
  assert.deepEqual(types('예산이 50000000원에서 30000000원으로 줄었습니다'), []);
});

test('생년월일이 불가능하면 주민등록번호가 아니다', () => {
  assert.deepEqual(types('123456-1234567'), []); // 34월 56일
  assert.deepEqual(types('991301-1234567'), []); // 13월
});

test('평범한 업무 메시지는 아무것도 잡지 않는다', () => {
  const text = '미겔, 내일까지 PR #482 리뷰 부탁드립니다. 릴리즈 일정이 걸려 있어요.';
  assert.deepEqual(types(text), []);
});

test('sk- 로 시작해도 짧으면 키가 아니다', () => {
  assert.deepEqual(types('sk-123'), []);
});

test('빈 입력·비문자열은 안전하게 통과한다', () => {
  assert.equal(detectSensitive('').hasSensitive, false);
  assert.equal(detectSensitive(null).hasSensitive, false);
  assert.equal(detectSensitive(undefined).hasSensitive, false);
});

/* ── 마스킹 ────────────────────────────────────────────────────────────── */

test('감지 구간을 [REDACTED]로 치환하고 나머지는 보존한다', () => {
  const text = '배포용 키는 sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456 이고 내일까지 필요해요';
  const { findings } = detectSensitive(text);
  const masked = redact(text, findings);

  assert.equal(masked, `배포용 키는 ${REDACTION} 이고 내일까지 필요해요`);
  assert.ok(!masked.includes('sk-proj'));
});

test('여러 건을 모두 치환한다', () => {
  const text = 'key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456 card 4111111111111111 끝';
  const { findings } = detectSensitive(text);
  const masked = redact(text, findings);

  assert.equal(masked, `key ${REDACTION} card ${REDACTION} 끝`);
});

test('겹치는 감지 구간이 있어도 원문 조각이 남지 않는다', () => {
  // 비밀번호 라벨 규칙과 OpenAI 키 규칙이 같은 자리를 겹쳐 잡는 경우.
  const text = 'password: sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456';
  const { findings } = detectSensitive(text);
  assert.ok(findings.length >= 2, '겹치는 감지가 재현되지 않았다');

  const masked = redact(text, findings);
  assert.ok(!masked.includes('sk-proj'), '치환 후에도 키 조각이 남았다');
});

test('감지가 없으면 원문을 그대로 돌려준다', () => {
  const text = '평범한 메시지입니다';
  assert.equal(redact(text, []), text);
});

/* ── 값 유출 방지 ──────────────────────────────────────────────────────── */

test('반환값에 원문 조각이 담기지 않는다 — 화면·로그로 새는 경로를 만들지 않는다', () => {
  const secret = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456';
  const { findings } = detectSensitive(`키: ${secret}`);

  assert.ok(!JSON.stringify(findings).includes('sk-proj'));
  assert.deepEqual(Object.keys(findings[0]).sort(), ['end', 'label', 'start', 'type']);
});

test('요약 문구에도 값이 들어가지 않는다', () => {
  const text = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456 와 4111111111111111';
  const { findings } = detectSensitive(text);
  const summary = summarize(findings);

  assert.match(summary, /OpenAI API 키 1건/);
  assert.match(summary, /카드번호 1건/);
  assert.ok(!summary.includes('sk-proj'));
  assert.ok(!summary.includes('4111'));
});
