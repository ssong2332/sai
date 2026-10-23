/**
 * 콜드(새 isolate 첫 요청) CPU 추정 — **배포될 번들 그대로**(`npm run build:dry` 결과)를 새 Node 프로세스마다
 * 한 번씩 불러 「모듈 평가 + 첫 요청 + 둘째 요청」을 잰다 (2026-10-23 L33).
 *
 * 🔴 **추정이다.** 진짜 값은 배포 후 `npx wrangler tail --format json`의 `cpuTime`. 여기는 Node(V8)·이 PC다 —
 *    workerd와 V8은 같지만 CPU·JIT·스냅숏·node:crypto 구현이 다르다. **전후 비교(같은 PC·같은 방법)**로만 읽는다.
 * 🔴 `cpu-bench.mjs`와 다른 점: 그쪽은 소스(Node 모듈 그래프)를 불러 **데운 뒤** 건당 값을 본다. 여기는
 *    **번들 한 파일**(SDK 포함 여부가 그대로 반영됨)을 **새 프로세스**에서 처음 평가하는 비용을 본다.
 * 🔴 네트워크 없음 — 전역 fetch를 가짜로 바꾼다: JWKS URL → 부모가 만든 로컬 공개키, api.anthropic.com → 즉시 답.
 *    운영 진입점(`src/index.js` — 원격 JWKS·전역 fetch)을 **그대로** 탄다(테스트 주입 없음).
 * 🔴 키·토큰은 부모가 만들어 넘긴다 — 자식이 jose를 따로 불러 WebCrypto를 미리 데우지 않게.
 *
 * 실행: `npm run bench:cold` (workers/refine 안에서, 먼저 `npm run build:dry`)
 *       옵션 `--bundle <경로>`(다른 번들과 비교) · `--runs 15` · `--no-prewarm`(Node 플랫폼 첫 사용 비용까지 포함)
 *       · `--profile <폴더>`(자식마다 V8 .cpuprofile — 무엇이 콜드 비용인지)
 */

import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};

// ── 자식: 번들을 처음 불러 잰다.
if (process.argv.includes('--child')) {
  const { bundle, jwk, token, raw, env } = JSON.parse(process.env.SAI_COLD_BENCH);
  const seen = { anthropic: 0, jwks: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith('https://www.googleapis.com/')) {
      seen.jwks += 1;
      seen.jwksAt ??= performance.now();
      return new globalThis.Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' } });
    }
    if (u.startsWith('https://api.anthropic.com/')) {
      seen.anthropic += 1;
      seen.anthropicAt ??= performance.now();
      return new globalThis.Response(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: JSON.stringify(raw) }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 4900, output_tokens: 410 },
      }), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  console.log = () => {}; // 핸들러 로그 한 줄 출력 비용은 뺀다(운영 로그는 한 줄)
  const request = (i) => new globalThis.Request('https://sai-refine.example.workers.dev/v1/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: `chrome-extension://${env.EXTENSION_ID}` },
    body: JSON.stringify({ text: `내일 오전까지 리뷰 부탁드립니다 ${i}`, sourceLanguage: 'ko', targetLanguage: 'en', referenceDate: '2026-08-12', bypassCache: true }),
  });
  const measure = async (fn) => {
    const c0 = process.cpuUsage();
    const t0 = performance.now();
    const value = await fn();
    const c = process.cpuUsage(c0);
    return { value, wall: performance.now() - t0, cpu: (c.user + c.system) / 1000 };
  };
  /**
   * 🔴 플랫폼 데우기(기본 켬, `--no-prewarm`로 끔) — Node는 Request/Response(undici)·WebCrypto를 **처음 쓸 때** 불러온다.
   *    workerd에서는 그것들이 런타임 내장이라 isolate 첫 요청에 그 비용이 없다(🔴 추정). 그래서 번들과 무관한
   *    Node 고유 비용을 측정 밖으로 뺀다 — 다른 키로 RS256 검증 한 번 + Request/Response 한 번. 번들 코드는 안 건드린다.
   */
  if (!process.argv.includes('--no-prewarm')) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, new Uint8Array(256), new TextEncoder().encode('warm'));
    await new globalThis.Response(JSON.stringify({ a: 1 })).json();
    await new globalThis.Request('https://warm.example/', { method: 'POST', body: '{}' }).json();
  }
  const imp = await measure(() => import(bundle));
  const handler = imp.value.default;
  const firstStart = performance.now();
  const first = await measure(async () => { const r = await handler.fetch(request(1), env); await r.text(); return r.status; });
  const firstEnd = firstStart + first.wall;
  // 첫 요청 구간 나누기(벽시계): ① 시작→JWKS fetch(라우팅·설정·토큰 꺼내기·jose 진입) ② JWKS→Claude fetch(키 가져오기·
  // RS256 검증·본문 파싱·buildRefinePayload·캐시 키) ③ Claude fetch→끝(응답 파싱·정규화·응답 직렬화).
  const phases = {
    toJwks: seen.jwksAt - firstStart,
    jwksToProvider: seen.anthropicAt - seen.jwksAt,
    providerToEnd: firstEnd - seen.anthropicAt,
  };
  const second = await measure(async () => { const r = await handler.fetch(request(2), env); await r.text(); return r.status; });
  process.stdout.write(JSON.stringify({
    // 🔴 JWKS는 isolate(여기서는 프로세스)당 한 번만 받아야 한다 — 두 요청에 1회가 아니면 실패로 본다.
    ok: first.value === 200 && second.value === 200 && seen.anthropic === 2 && seen.jwks === 1,
    jwksFetches: seen.jwks,
    status: [first.value, second.value], ...phases,
    importWall: imp.wall, importCpu: imp.cpu, firstWall: first.wall, firstCpu: first.cpu, secondWall: second.wall, secondCpu: second.cpu,
  }));
  process.exit(0);
}

// ── 부모: 키·토큰을 만들고 새 프로세스를 runs번 띄운다.
const { SignJWT, exportJWK, generateKeyPair } = await import('jose');
const { goodRaw, TEST_ENV } = await import('../test/helpers.js');

const here = fileURLToPath(import.meta.url);
const bundlePath = resolve(arg('--bundle', fileURLToPath(new URL('../.wrangler/dry/index.js', import.meta.url))));
const RUNS = Number(arg('--runs', 15));

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: 'cold-kid', alg: 'RS256', use: 'sig' };
const nowSec = Math.floor(Date.now() / 1000);
const token = await new SignJWT({
  iss: `https://securetoken.google.com/${TEST_ENV.FIREBASE_PROJECT_ID}`, aud: TEST_ENV.FIREBASE_PROJECT_ID,
  sub: 'uid-cold', auth_time: nowSec - 60, iat: nowSec - 30, exp: nowSec + 3600,
}).setProtectedHeader({ alg: 'RS256', kid: 'cold-kid', typ: 'JWT' }).sign(privateKey);

const payload = JSON.stringify({ bundle: pathToFileURL(bundlePath).href, jwk, token, raw: goodRaw(), env: { ...TEST_ENV } });
const rows = [];
for (let i = 0; i < RUNS; i += 1) {
  const profileDir = arg('--profile', null); // 자식 V8 CPU 프로필(.cpuprofile)을 남긴다 — 무엇이 콜드 비용인지 볼 때
  const childArgs = [
    ...(profileDir ? ['--cpu-prof', '--cpu-prof-interval', '100', '--cpu-prof-dir', profileDir] : []),
    here, '--child', ...(process.argv.includes('--no-prewarm') ? ['--no-prewarm'] : []),
  ];
  const child = spawnSync(process.execPath, childArgs, { env: { ...process.env, SAI_COLD_BENCH: payload }, encoding: 'utf8' });
  if (child.status !== 0) throw new Error(`자식 실패: ${child.stderr}`);
  const row = JSON.parse(child.stdout);
  if (!row.ok) throw new Error(`요청 실패: ${JSON.stringify(row)}`);
  rows.push(row);
}

const median = (key) => {
  const s = rows.map((r) => r[key]).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const f = (n) => n.toFixed(2).padStart(7);
console.log(`번들 ${bundlePath} · 새 프로세스 ${RUNS}회 중앙값 (ms) · 플랫폼 데우기 ${process.argv.includes('--no-prewarm') ? '끔' : '켬'}`);
console.log(`  모듈 평가(import)     벽시계 ${f(median('importWall'))} | process CPU ${f(median('importCpu'))}`);
console.log(`  첫 요청(콜드)         벽시계 ${f(median('firstWall'))} | process CPU ${f(median('firstCpu'))}`);
console.log(`    ├ ① 시작→JWKS fetch    벽시계 ${f(median('toJwks'))}`);
console.log(`    ├ ② JWKS→Claude fetch  벽시계 ${f(median('jwksToProvider'))}  (키 가져오기·RS256 검증·payload·캐시 키)`);
console.log(`    └ ③ Claude fetch→끝    벽시계 ${f(median('providerToEnd'))}  (응답 파싱·정규화·직렬화)`);
console.log(`  둘째 요청            벽시계 ${f(median('secondWall'))} | process CPU ${f(median('secondCpu'))}`);
console.log(`  평가+첫 요청 합       벽시계 ${f(median('importWall') + median('firstWall'))}`);
console.log('🔴 추정 — Node·이 PC. Windows process.cpuUsage는 해상도가 거칠다(벽시계를 함께 본다). 실제는 배포 후 wrangler tail cpuTime.');
