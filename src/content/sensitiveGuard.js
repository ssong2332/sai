/**
 * 로컬 민감정보 발송 가드 (S15 / Spec 필수 11).
 *
 * 🔴 **LLM 서버로 나가기 전에, 클라이언트에서** 검사한다. 이 파일은 네트워크를 쓰지 않는다 —
 *    "보내고 나서 지운다"는 성립하지 않기 때문이다. 감지되면 전송 자체를 막고, 사용자가
 *    원할 때만 `[REDACTED]`로 치환한 본문을 보낸다.
 * 🔴 Zero Retention (Spec 필수 5): 감지된 값을 로그·저장소에 남기지 않는다. 이 모듈은
 *    **위치와 종류만** 돌려주고, 원문 조각을 반환값에 담지 않는다.
 *
 * ## 오탐/미탐 균형
 * 비밀이 새는 것(미탐)이 더 나쁘지만, 숫자 패턴을 검증 없이 잡으면 주문번호·전화번호를 계속
 * 막아 기능 자체가 꺼진다. 그래서 **접두사가 명확한 토큰류는 패턴만으로**, **순수 숫자류는
 * 체크섬·날짜 유효성까지 통과할 때만** 잡는다.
 */

/** 치환 문자열 — Spec 필수 11이 지정한 형태. */
export const REDACTION = '[REDACTED]';

/**
 * 규칙표. `verify`가 있으면 그 함수가 true를 돌려줄 때만 감지로 친다.
 * 🔴 규칙을 추가할 때는 반드시 오탐 케이스를 `test/sensitiveGuard.test.js`에 함께 넣는다.
 */
const RULES = [
  {
    type: 'openai-key',
    label: 'OpenAI API 키',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}/g,
  },
  {
    type: 'github-token',
    label: 'GitHub 토큰',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/g,
  },
  {
    type: 'aws-access-key',
    label: 'AWS 액세스 키',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    type: 'google-api-key',
    label: 'Google API 키',
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
  },
  {
    type: 'slack-token',
    label: 'Slack 토큰',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    type: 'private-key',
    label: '개인키 블록',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    type: 'bearer-token',
    label: 'Bearer 토큰',
    pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}/g,
  },
  {
    type: 'password',
    label: '비밀번호',
    // "비밀번호: hunter2" 처럼 라벨 뒤에 값이 오는 형태. 값이 공백·줄바꿈 전까지.
    pattern: /(?:비밀번호|비번|패스워드|password|passwd|pwd)\s*[:=]\s*\S{4,}/gi,
  },
  {
    type: 'credit-card',
    label: '카드번호',
    // 13~19자리, 공백/하이픈 구분 허용. 🔴 Luhn을 통과할 때만 감지 — 없으면 주문번호가 다 걸린다.
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    verify: (match) => luhnValid(match.replace(/[ -]/g, '')),
  },
  {
    type: 'korean-rrn',
    label: '주민등록번호',
    // 🔴 생년월일이 유효할 때만 감지 — 형식만 보면 일반 숫자 조합이 걸린다.
    pattern: /\b(\d{2})(\d{2})(\d{2})-[1-4]\d{6}\b/g,
    verify: (_match, groups) => validBirthDate(groups),
  },
];

/** Luhn 체크섬 — 카드번호 오탐을 걷어내는 핵심. */
function luhnValid(digits) {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** 주민등록번호 앞 6자리(YYMMDD)가 실제 날짜인지. */
function validBirthDate([, , month, day]) {
  const m = Number(month);
  const d = Number(day);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/**
 * 민감정보를 찾는다.
 *
 * 🔴 반환값에 **원문 조각을 담지 않는다** — 화면·로그로 값이 새는 경로를 아예 만들지 않는다.
 *    사용자에게는 종류와 개수만 보여주면 충분하다(자기가 쓴 글이므로 어디인지 안다).
 *
 * @param {string} text
 * @returns {{ findings: Array<{type: string, label: string, start: number, end: number}>,
 *             hasSensitive: boolean }}
 */
export function detectSensitive(text) {
  if (typeof text !== 'string' || text === '') {
    return { findings: [], hasSensitive: false };
  }

  const findings = [];
  for (const rule of RULES) {
    // lastIndex가 규칙 객체에 남지 않도록 매번 새 정규식을 만든다(전역 플래그 상태 공유 방지).
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match = pattern.exec(text);
    while (match !== null) {
      if (!rule.verify || rule.verify(match[0], match)) {
        findings.push({
          type: rule.type,
          label: rule.label,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
      // 빈 매치로 무한 루프에 빠지지 않게 강제 전진.
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
      match = pattern.exec(text);
    }
  }

  findings.sort((a, b) => a.start - b.start);
  return { findings, hasSensitive: findings.length > 0 };
}

/**
 * 감지 구간을 `[REDACTED]`로 치환한다 (Spec 필수 11).
 * 겹치는 구간은 넓은 쪽으로 합친다 — 두 규칙이 같은 자리를 잡아도 값이 남지 않게 한다.
 */
export function redact(text, findings) {
  if (!findings || findings.length === 0) return text;

  const merged = [];
  for (const finding of [...findings].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && finding.start <= last.end) {
      last.end = Math.max(last.end, finding.end);
    } else {
      merged.push({ start: finding.start, end: finding.end });
    }
  }

  let out = '';
  let cursor = 0;
  for (const span of merged) {
    out += text.slice(cursor, span.start) + REDACTION;
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

/** 화면 표시용 요약 — "OpenAI API 키 1건 · 카드번호 1건". 값은 포함하지 않는다. */
export function summarize(findings) {
  const counts = new Map();
  for (const finding of findings) {
    counts.set(finding.label, (counts.get(finding.label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => `${label} ${count}건`).join(' · ');
}
