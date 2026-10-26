/**
 * Worker 주간 점검 (M2, 2026-10-27) — 최근 N일 `betaMetrics` 합계 + `/health`를 표로 찍는다.
 *
 *   SAI_SERVICE_ACCOUNT_FILE=<키 JSON 경로> npm --prefix workers/refine run report [-- --days 14]
 *
 * 🔴 키는 **파일 경로**로만 받는다. 값을 환경 변수·명령줄·저장소에 넣지 않는다. 키 파일은 저장소 밖에 둔다.
 *    읽기 권한만 있으면 된다(Worker에 쓰는 것과 같은 서비스 계정이어도 된다).
 * 🔴 출력은 숫자·사유 코드뿐이다(Spec 필수 5) — 키·토큰·오류 원문을 찍지 않는다.
 * 경고가 하나라도 있으면 종료 코드 1 — 나중에 자동 실행(M3)으로 옮길 때 그대로 쓴다.
 */
import { readFileSync } from 'node:fs';

import { createTokenSource } from '../src/google/serviceAccount.js';
import { RestFirestore } from '../src/google/firestoreRest.js';
import { summarizeDay, judgeDay, judgeHealth, pct } from './reportCore.mjs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'sai-global-msg-2026';
const ORIGIN = process.env.SAI_WORKER_ORIGIN || 'https://sai-refine.aiisgod.workers.dev';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function seoulDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

async function main() {
  const days = Math.min(Math.max(Number(arg('days', 7)) || 7, 1), 90);
  const keyFile = process.env.SAI_SERVICE_ACCOUNT_FILE;
  if (!keyFile) {
    console.error('SAI_SERVICE_ACCOUNT_FILE(서비스 계정 키 JSON 경로)가 필요해요.');
    process.exit(2);
  }
  let raw;
  try {
    raw = readFileSync(keyFile, 'utf8');
  } catch {
    console.error('키 파일을 읽지 못했어요 — 경로를 확인해 주세요.');
    process.exit(2);
  }

  const tokenSource = createTokenSource({ credentials: raw });
  const db = new RestFirestore({ projectId: PROJECT_ID, token: () => tokenSource.token() });

  const now = Date.now();
  const keys = Array.from({ length: days }, (_, i) => seoulDateKey(new Date(now - i * 86_400_000)));
  let snaps;
  try {
    snaps = await db.getAll(...keys.map((key) => db.collection('betaMetrics').doc(key)));
  } catch (error) {
    console.error(`Firestore 읽기 실패: ${error?.code ?? error?.status ?? error?.name ?? 'unknown'}`);
    process.exit(2);
  }

  const rows = snaps.map((snap, i) => summarizeDay(keys[i], snap.exists ? snap.data() : null));
  const warnings = [];
  console.log('날짜        요청  성공  실패  실패율  2초내   10초초과  사용자(재방문)  적용/되돌림  경고');
  for (const day of rows) {
    const dayWarnings = judgeDay(day);
    warnings.push(...dayWarnings.map((w) => `${day.dateKey} ${w}`));
    console.log(
      [
        day.dateKey,
        String(day.requests).padStart(5),
        String(day.ok).padStart(5),
        String(day.failures).padStart(5),
        pct(day.failures, day.requests).padStart(7),
        pct(day.within2s, day.requests).padStart(7),
        pct(day.over10s, day.requests).padStart(9),
        `${day.active}(${day.returning})`.padStart(14),
        `${day.applied}/${day.undone}`.padStart(12),
        day.requests === 0 ? ' 요청 없음' : ` ${dayWarnings.join(', ') || '-'}`,
      ].join(' '),
    );
  }

  let status = 0;
  let body = null;
  try {
    const res = await fetch(`${ORIGIN}/health`);
    status = res.status;
    body = await res.json().catch(() => null);
  } catch {
    status = 0;
  }
  const healthWarnings = judgeHealth(status, body);
  warnings.push(...healthWarnings);
  console.log(
    `\n/health ${status} · provider=${body?.provider ?? '-'} · 사슬=${(body?.failoverChain ?? []).join('→') || '-'} · ` +
      `usageStore=${body?.usageStore ?? '-'} · team=${body?.team ?? '-'}`,
  );

  console.log(warnings.length ? `\n⚠ 경고 ${warnings.length}건\n- ${warnings.join('\n- ')}` : '\n경고 없음');
  process.exit(warnings.length ? 1 : 0);
}

main();
