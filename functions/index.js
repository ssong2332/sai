/**
 * `POST /v1/refine` — Cloud Functions 핸들러 (S02 + S03 + S10).
 *
 * 🔴 이 파일은 **얇은 껍데기**다. 프롬프트·판정·캐시·폴백은 전부 `core/{refine,decode}/`에
 *    있고, 그건 `src/core/{refine,decode}/`의 복사본이다(`scripts/sync-core.mjs`가 배포 직전에
 *    넣는다). 로컬 프록시(`server/refine-proxy.js`)와 **같은 코어를 같은 방식으로** 부른다 —
 *    두 경로가 갈리면 "로컬에선 되는데 배포하면 다르다"가 시작된다.
 *
 * 🔴 **같은 엔드포인트, `mode` 필드로 분기** (Tasks.md S10 원문 — "`/v1/refine`과 별도 모드
 *    파라미터"). `mode: "decode"`면 수신 해독기(S10), `mode: "decisions"`면 결정 요약(S25),
 *    `mode: "reply"`면 회신 초안(S37), 그 외(기본값)는 작성 교정(S03/S05/S09).
 *
 * 🔴 **API 키는 코드·환경변수 파일이 아니라 Secret Manager에 있다.**
 *    등록: `firebase functions:secrets:set GEMINI_API_KEY` / `… OPENAI_API_KEY`
 *    (사용자가 직접 입력한다 — 키가 소스·로그·대화에 남지 않는다.)
 *    🔴 **숨김 프롬프트에 붙여넣기가 조용히 실패해 `Secret Payload cannot be empty`가 난다**
 *       (2026-08-17 실측). 값을 파일로 넘기고 지우는 쪽이 확실하다 — 끝 개행이 섞이면
 *       401을 받고 **코드 문제로 오진하게 된다**:
 *         [IO.File]::WriteAllText($tmp, $k, (New-Object System.Text.UTF8Encoding $false))
 *         firebase functions:secrets:set OPENAI_API_KEY --data-file $tmp; Remove-Item $tmp -Force
 *
 * 🔴 Zero Retention (Spec 필수 5): 요청 본문·교정문·해석 결과를 로그에 쓰지 않는다.
 *    남기는 것은 카운트·수치·플래그뿐이다.
 *
 * 🔴 **`defineSecret()`은 호출되는 순간 배포 시점 값 해석 대상이 된다** — 코드 안에서 실제로
 *    쓰는지, `secrets: [...]`에 넣었는지와 무관하다(firebase-functions v2 params가 코드베이스
 *    전역에서 미해결 시크릿을 찾아 배포를 막는다, 2026-08-13 실측: `secrets:` 배열에서 뺐는데도
 *    "no value for OPENAI_API_KEY"로 계속 막혔다). 그래서 **등록하지 않은 시크릿은 아예
 *    `defineSecret()`을 호출하지 않는다** — 새 provider를 붙일 때는 **값 등록이 먼저다.**
 *    (2026-08-17 OpenAI가 이 순서로 복원됐다. 순서를 지키지 않으면 배포가 죽는다.)
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { refine, MemoryCacheStore as RefineCacheStore } from './core/refine/index.js';
import { decode, MemoryCacheStore as DecodeCacheStore } from './core/decode/index.js';
import {
  summarizeDecisions,
  MemoryCacheStore as DecisionsCacheStore,
} from './core/decisions/index.js';
import { reply, MemoryCacheStore as ReplyCacheStore } from './core/reply/index.js';
// Spec §3 — 팀 생성·참가·마찰 카운트. 🔴 Admin SDK는 여기서 한 번만 초기화한다.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
// 🔴 `requireUid`는 teams.js와 **같은 함수**다 — 토큰 검증을 두 벌 두면 한쪽만 고쳐져 뚫린다.
import { TEAM_ACTIONS, TeamError, defaultDeps, requireUid } from './teams.js';
import { consumeDailyQuota, QUOTA_REASONS } from './refineQuota.js';

initializeApp();

/**
 * 확장 ID — `src/manifest.js`의 `key`가 고정한 값. CORS 오리진 판정에만 쓴다.
 * 🔴 **비밀이 아니다.** 확장 번들에서 누구나 읽을 수 있고, 이 값으로 막히는 것은
 *    "다른 웹사이트의 JS"뿐이다. 진짜 방어선은 토큰 검증이다.
 */
const EXTENSION_ID = 'ogbcccaaojphhgobeeidpafokjieckdf';

/** 🔴 `teamV1`과 같은 deps를 쓴다 — verifyIdToken 구현이 갈리면 안 된다. */
const teamDeps = defaultDeps();

const geminiKey = defineSecret('GEMINI_API_KEY');
// 2026-08-17 — `firebase functions:secrets:set OPENAI_API_KEY` 등록 완료(version 1) 후 복원.
// 🔴 등록 **전에** 이 줄을 되살리면 배포가 "no value for OPENAI_API_KEY"로 죽는다(위 주석 참조).
const openaiKey = defineSecret('OPENAI_API_KEY');
const BOUND_SECRETS = [geminiKey, openaiKey];

/**
 * 인스턴스 수명 동안만 사는 캐시 (Lessons #6). refine/decode는 프롬프트 버전이 달라
 * 캐시 키가 자동으로 갈리므로 **모듈별로 스토어를 나눌 필요는 없지만**, 코드 경로를 명확히
 * 하려고 각자 만든다.
 * 🔴 Firestore·로그로 내보내지 않는다 — 영속 백엔드로 바꾸면 Zero Retention 위반이다.
 */
/**
 * 🔴 **수명을 환경변수로 뺐다** (2026-08-19 시연 대비, 사용자 결정 ⓑ — 프록시와 같은 규칙).
 *    기본 10분은 리허설 한 번을 겨우 덮는다. `SAI_CACHE_TTL_MS`를 올리면 같은 문장 재호출이
 *    그 시간 동안 **API를 쓰지 않는다.**
 *
 * 🔴 **다만 여기서는 프록시만큼 잘 듣지 않는다.** Cloud Functions는 인스턴스가 여러 개 뜨고
 *    수시로 내려간다 — 캐시는 **그 인스턴스가 살아 있는 동안, 그 인스턴스에 걸린 요청에만**
 *    맞는다. 촬영 중 호출을 확실히 줄이려면 로컬 프록시 쪽이 낫다.
 * 🔴 Zero Retention 경계는 그대로 — 프로세스 메모리 전용, 상한 6시간.
 */
const CACHE_TTL_MAX_MS = 6 * 60 * 60 * 1000;
const cacheTtlMs = (() => {
  const raw = Number(process.env.SAI_CACHE_TTL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(raw, CACHE_TTL_MAX_MS);
})();

const refineCache = new RefineCacheStore({ ttlMs: cacheTtlMs });
const decodeCache = new DecodeCacheStore({ ttlMs: cacheTtlMs });
const decisionsCache = new DecisionsCacheStore({ ttlMs: cacheTtlMs });
const replyCache = new ReplyCacheStore({ ttlMs: cacheTtlMs });

/**
 * provider 판정표 (2026-08-17). **표에 없는 경우를 임의로 처리하지 않는다.**
 *
 * | `req.body.provider` | OPENAI 키 | GEMINI 키 | 선택 |
 * |---|---|---|---|
 * | `'openai'` | 있음 | — | openai |
 * | `'openai'` | 없음 | — | **null** (다른 걸로 대체하지 않는다) |
 * | `'gemini'` | — | 있음 | gemini |
 * | `'gemini'` | — | 없음 | **null** |
 * | 미지정·기타 | 있음 | — | openai ← Spec §6-3 기준 provider |
 * | 미지정·기타 | 없음 | 있음 | gemini |
 * | 미지정·기타 | 없음 | 없음 | **null** |
 *
 * 🔴 **명시 요청은 대체하지 않는다.** `provider: 'openai'`로 부른 쪽은 그 결과를 기준으로
 *    판단하는 중인데, 조용히 gemini로 바꿔 답하면 **어느 모델의 출력인지 모르는 채로
 *    품질을 논하게 된다**(역번역 문제를 Gemini에서 4번 오진한 것이 정확히 이 계열이다).
 * 🔴 미지정일 때만 openai → gemini 순으로 내려간다. 기본값이 Spec의 기준 provider다.
 * 🔴 **없는 키로 부르지 않는다** — 지어낸 키를 보내면 401을 받고 그게 폴백 사유를 흐린다.
 */
function resolveProviderAndKey(requested) {
  const openai = safeSecret(openaiKey);
  const gemini = safeSecret(geminiKey);

  if (requested === 'openai') return openai ? { provider: 'openai', apiKey: openai } : null;
  if (requested === 'gemini') return gemini ? { provider: 'gemini', apiKey: gemini } : null;

  if (openai) return { provider: 'openai', apiKey: openai };
  return gemini ? { provider: 'gemini', apiKey: gemini } : null;
}

/**
 * 한도(`quota`)에 걸렸을 때만 **다른 provider로 한 번 더** 부른다
 * (2026-08-19 사용자 결정 ⓓ — `server/refine-proxy.js`도 같은 규칙을 갖는다).
 *
 * 🔴 **명시 요청은 넘기지 않는다.** `req.body.provider`를 적어 보낸 쪽은 그 모델의 출력을
 *    기준으로 판단하는 중이다 — 조용히 바꿔 답하면 **어느 모델의 출력인지 모르는 채 품질을
 *    논하게 된다**(위 판정표의 원칙과 같다). 미지정일 때만 넘긴다.
 * 🔴 **한도일 때만.** 네트워크·형식 오류는 두 번 불러도 같은 이유로 실패하고, 조용한 이중
 *    호출은 한도만 더 태운다.
 * 🔴 **한 번만.** 예비까지 실패하면 원래대로 폴백 응답을 낸다.
 * 🔴 어느 쪽이 답했는지 `providerUsed`로 남긴다 — 문체가 달라진 이유를 나중에 추적할 수 있어야 한다.
 * 🔴 코어(`refine/decode/...`)는 고치지 않았다. 실패를 던지지 않고 `{fallback, fallbackReason}`
 *    으로 흡수하므로, **결과만 보고** 판단하면 네 모드에 한 번에 적용된다.
 */
async function runWithFailover(mode, modeName, selected, body) {
  const first = await mode.run(selected);
  if (body?.provider) return first; // 명시 요청 — 대체하지 않는다
  if (!first?.fallback || first.fallbackReason !== 'quota') return first;

  const other = selected.provider === 'openai' ? 'gemini' : 'openai';
  const backup = resolveProviderAndKey(other);
  if (!backup) return first;

  console.log(`[${modeName}] ${selected.provider} 한도 — ${backup.provider}로 한 번 더 시도합니다.`);
  const second = await mode.run(backup);
  if (second?.fallback) {
    console.log(`[${modeName}] ${backup.provider}도 실패(${second.fallbackReason}) — 폴백을 냅니다.`);
    return second;
  }
  return { ...second, providerUsed: backup.provider };
}

/** 시크릿이 등록돼 있지 않으면 접근 자체가 던진다 — 그걸 null로 흡수한다. */
function safeSecret(secret) {
  try {
    return secret.value() || null;
  } catch {
    return null;
  }
}

export const refineV1 = onRequest(
  {
    region: 'asia-northeast3', // 서울 — 주 사용자가 한국이라 왕복 지연을 줄인다.
    secrets: BOUND_SECRETS,
    /**
     * 확장(chrome-extension://…)에서 부르므로 CORS가 필요하다. 2026-08-17 확장 오리진으로 좁혔다.
     * 🔴 **CORS는 보안 장치가 아니다.** 브라우저가 남의 사이트 JS를 막아 줄 뿐이고, curl·서버는
     *    CORS를 아예 무시한다. **실제 방어선은 아래 `requireUid` 토큰 검증**이다 — 좁힌 것으로
     *    안심하면 안 된다.
     * 🔴 확장 ID는 `src/manifest.js`의 `key`가 고정한다. 그 값을 바꾸면 여기도 바꿔야 한다.
     */
    cors: [`chrome-extension://${EXTENSION_ID}`],
    timeoutSeconds: 60,
    memory: '256MiB',
    maxInstances: 10, // 폭주로 과금이 튀지 않게 상한을 둔다.
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method not allowed' });
      return;
    }

    /**
     * 🔴 **로그인하지 않으면 여기서 끝난다** (2026-08-17). 그전에는 인증이 아예 없어서 URL만
     *    알면 누구나 우리 LLM 키를 썼다. provider가 유료(OpenAI)로 바뀐 시점부터 그건 곧 청구서다.
     * 🔴 목업으로 대신 답하지 않는다 — 확장이 401을 보고 「로그인이 필요해요」를 띄운다.
     *    여기서 그럴듯한 결과를 돌려주면 **로그인이 안 된 것을 아무도 모른 채** 넘어간다.
     */
    let uid;
    try {
      uid = await requireUid(req, teamDeps);
    } catch (error) {
      console.warn(`[refine] 인증 거절 reason=${error?.reason ?? 'unknown'}`);
      res.status(401).json({ error: 'unauthorized', reason: error?.reason ?? 'no-token' });
      return;
    }

    /**
     * 🔴 **인증만으로는 비용이 막히지 않는다.** 로그인한 한 명이 스크립트로 수천 건을 태울 수
     *    있다. 상한 초과는 429로 돌려주고 **LLM을 부르지 않는다** — 부른 뒤 거절하면 돈은 이미 나갔다.
     * 🔴 세는 값은 uid·count·날짜뿐이다 (Zero Retention — `refineQuota.js` 헤더).
     */
    try {
      const quota = await consumeDailyQuota(getFirestore(), { uid });
      if (!quota.ok) {
        console.warn(`[refine] 일일 상한 초과 used=${quota.used} limit=${quota.limit}`);
        res.status(429).json({ error: QUOTA_REASONS.OVER_LIMIT, limit: quota.limit });
        return;
      }
    } catch (error) {
      // 🔴 카운터 장애로 교정을 멈추지 않는다 — 상한은 비용 방어선이지 기능의 전제가 아니다.
      //    다만 조용히 넘어가면 안 되므로 로그에 남긴다(본문은 없다).
      console.error(`[refine] 상한 확인 실패 — 통과시킴: ${error?.code ?? error?.name ?? 'unknown'}`);
    }

    const selected = resolveProviderAndKey(req.body?.provider);
    if (!selected) {
      console.error('[refine] 등록된 API 키가 없습니다 — functions:secrets:set 필요');
      res.status(500).json({ error: 'no provider configured' });
      return;
    }

    /**
     * 🔴 `mode` 라우팅 표 — `server/refine-proxy.js`도 **같은 표**를 갖는다(S25에서 이분기를
     *    표로 바꿨다). 모드를 추가할 때는 반드시 두 파일을 함께 고친다. 한쪽만 고치면
     *    "로컬에선 되는데 배포하면 다르다"가 시작된다.
     * 🔴 모든 logger는 **본문 없는 메타데이터만** 찍는다 (Spec 필수 5).
     */
    const MODES = {
      refine: {
        run: (creds) =>
          refine(req.body ?? {}, {
            apiKey: creds.apiKey,
            provider: creds.provider,
            cache: refineCache,
            logger: (event) =>
              console.log(
                `[refine] provider=${selected.provider} urgency=${event.urgency ?? '-'} ` +
                  `intent=${event.detectedIntent ?? '-'} cache=${event.cacheHit ? 'hit' : 'miss'} ` +
                  `fallback=${event.fallback ? (event.fallbackReason ?? 'yes') : 'no'} ${event.latencyMs}ms`,
              ),
          }),
      },
      decode: {
        run: (creds) =>
          decode(req.body ?? {}, {
            apiKey: creds.apiKey,
            provider: creds.provider,
            cache: decodeCache,
            logger: (event) =>
              console.log(
                `[decode] provider=${selected.provider} surface=${event.surfaceUrgency ?? '-'} ` +
                  `actual=${event.actualUrgency ?? '-'} gap=${event.urgencyGap ?? '-'} ` +
                  `cache=${event.cacheHit ? 'hit' : 'miss'} ` +
                  `fallback=${event.fallback ? (event.fallbackReason ?? 'yes') : 'no'} ${event.latencyMs}ms`,
              ),
          }),
      },
      decisions: {
        run: (creds) =>
          summarizeDecisions(req.body ?? {}, {
            apiKey: creds.apiKey,
            provider: creds.provider,
            cache: decisionsCache,
            // 🔴 건수와 플래그뿐 — 결정 문구·담당자 이름은 남기지 않는다.
            logger: (event) =>
              console.log(
                `[decisions] provider=${selected.provider} decisions=${event.decisionCount ?? '-'} ` +
                  `unresolved=${event.unresolvedCount ?? '-'} ` +
                  `unknownAuthority=${event.unknownAuthorityCount ?? '-'} ` +
                  `cache=${event.cacheHit ? 'hit' : 'miss'} ` +
                  `fallback=${event.fallback ? (event.fallbackReason ?? 'yes') : 'no'} ${event.latencyMs}ms`,
              ),
          }),
      },
      reply: {
        run: (creds) =>
          reply(req.body ?? {}, {
            apiKey: creds.apiKey,
            provider: creds.provider,
            cache: replyCache,
            // 🔴 초안 본문은 남기지 않는다 — 의도 키와 길이 수치뿐이다.
            logger: (event) =>
              console.log(
                `[reply] provider=${selected.provider} intent=${event.intent ?? '-'} ` +
                  `len=${event.draftLength ?? '-'} cache=${event.cacheHit ? 'hit' : 'miss'} ` +
                  `fallback=${event.fallback ? (event.fallbackReason ?? 'yes') : 'no'} ${event.latencyMs}ms`,
              ),
          }),
      },
    };

    const modeName = MODES[req.body?.mode] ? req.body.mode : 'refine';
    const started = Date.now();
    try {
      res.status(200).json(await runWithFailover(MODES[modeName], modeName, selected, req.body));
    } catch (error) {
      // 🔴 에러 메시지에 본문이 섞이지 않게 우리 문구만 내보낸다.
      console.error(
        `[${modeName}] 요청 거절: ${error?.name ?? 'error'} (${Date.now() - started}ms)`,
      );
      res.status(400).json({ error: error?.message ?? 'bad request' });
    }
  },
);

/**
 * `POST /teamV1` — 팀 생성·참가·마찰 카운트 적재 (Spec §3, 2026-08-15 신설).
 *
 * 🔴 **refineV1과 합치지 않는다.** 저건 시크릿(LLM 키)이 붙은 함수고 이건 Firestore·Auth를
 *    쓰는 함수다. 한 함수에 묶으면 LLM 키가 팀 관리 경로에도 로드되고, 한쪽 배포 실패가
 *    양쪽을 함께 죽인다.
 * 🔴 판정·검증은 전부 `teams.js`에 있다 — 이 파일은 라우팅과 상태 코드만 맡는다(refineV1과 같은
 *    구조). 그래야 네트워크 없이 테스트할 수 있다.
 * 🔴 Zero Retention: 에러 로그에 요청 본문을 쓰지 않는다 — 액션 이름과 사유 코드만 남긴다.
 */
export const teamV1 = onRequest(
  {
    region: 'asia-northeast3',
    cors: true,
    /**
     * 🔴 **없으면 확장이 함수에 도달조차 못 한다** (2026-08-15 배포 직후 실측: 구글이 낸
     *    HTML 403/401이 돌아왔다 — 우리 JSON이 아니었다). 2세대 함수는 기본이 「인증된
     *    호출자만」이고, **Firebase ID 토큰은 Cloud IAM 신원이 아니다.** 즉 로그인한
     *    사용자여도 IAM 단계에서 먼저 잘린다.
     * 🔴 `refineV1`은 이 옵션이 없어도 되는데, 먼저 만들어질 때 공개 호출 권한을 받았기
     *    때문이다 — **새로 만드는 함수는 받지 못한다.** 코드에 명시해 두지 않으면 다음에
     *    함수를 추가할 때 같은 곳에서 또 막힌다.
     * 🔴 「공개」는 **HTTP로 닿을 수 있다**는 뜻일 뿐이다. 실제 권한 판정은 핸들러 안에서
     *    Firebase ID 토큰 검증(`requireUid`)과 팀원 확인이 한다 — refineV1과 같은 구조다.
     */
    invoker: 'public',
  },
  async (req, res) => {
  const action = String(req.body?.action ?? '');
  const handler = TEAM_ACTIONS[action];
  if (!handler) {
    res.status(400).json({ error: 'unknown action' });
    return;
  }
  try {
    res.status(200).json(await handler(req, defaultDeps()));
  } catch (error) {
    const status = error instanceof TeamError ? error.status : 500;
    console.error(`[team:${action}] 거절: ${error?.reason ?? error?.name ?? 'error'}`);
    res.status(status).json({ error: error?.reason ?? 'failed' });
  }
  },
);

/** 배포·시크릿 상태를 눈으로 확인하는 용도. 키 값은 절대 노출하지 않는다. */
export const health = onRequest({ region: 'asia-northeast3', secrets: BOUND_SECRETS, cors: true }, (_req, res) => {
  const selected = resolveProviderAndKey(undefined);
  res.status(200).json({
    ok: true,
    provider: selected?.provider ?? null,
    // 🔴 실제 코드 지원 여부가 아니라 "이 배포에 시크릿이 등록된 provider"만 보고한다.
    availableProviders: ['gemini'],
    configured: selected !== null,
  });
});
