import { useEffect, useState } from 'react';
import { Link } from '../router.jsx';

/**
 * 요금제 (L36, 2026-10-29 사용자 결정 — Spec §0 수익화).
 * 🔴 **결제는 붙이지 않는다.** 출시 v1.0은 전부 무료이고 유료 플랜은 「곧 출시」로만 보여 준다.
 * 🔴 **정하지 않은 숫자를 쓰지 않는다** — 유료 출시 후 무료 하루 횟수 · Pro 하루 횟수 · 팀 1인당 가격은
 *    미정이다(Spec §0). 정해진 것만 숫자로: 지금 하루 100회(`functions/refineQuota.js` DAILY_REFINE_LIMIT —
 *    Worker가 mode를 가리지 않고 센다, `workers/refine/src/handler.js` consumeDailyQuota) · Pro 월 $4.
 */
const PLANS = [
  {
    id: 'free',
    name: '무료',
    blurb: '혼자 쓰기 시작할 때',
    price: '$0',
    unit: '지금 모든 기능',
    cta: { label: '지금 무료', note: '출시 기간에는 개인·팀 기능 모두 무료예요' },
    lead: '지금 쓸 수 있는 것',
    features: [
      '다듬기 · 뜻 풀기 · 회신 초안',
      '하루 100회(다듬기 · 뜻 풀기 · 회신 초안 합산)',
      '상대 시간대 · 예약 알림',
      '개인 용어집 · 저장 문구',
      '팀 용어집 · 팀 대시보드',
    ],
  },
  {
    id: 'pro',
    name: '개인 Pro',
    blurb: '매일 많이 보내는 사람',
    price: '$4',
    unit: '월 · 예정',
    featured: true,
    cta: { label: '곧 출시', note: '나오면 이 페이지에서 알려 드려요' },
    lead: '무료의 모든 기능에 더해',
    features: ['하루 다듬기 횟수 확대'],
  },
  {
    id: 'team',
    name: '팀',
    blurb: '해외 동료와 일하는 팀',
    price: '곧 공개',
    unit: '1인당 · 월',
    cta: { label: '곧 출시', note: '팀 기능은 지금 무료로 쓸 수 있어요' },
    lead: '개인 Pro의 모든 기능에 더해',
    features: ['팀 용어집 공유', '팀 대시보드 — 협업 지표 합계', '팀원 관리'],
  },
];

/** 비교표 — true/false는 ✓/–, 문자열은 그대로. 「예정」 칸은 유료 출시 때 기준이다. */
const COMPARE = [
  {
    group: '쓰기와 읽기',
    rows: [
      ['다듬기 · 뜻 풀기 · 회신 초안', true, true, true],
      ['하루 횟수(다듬기 · 뜻 풀기 · 회신 합산)', '100회(지금)', '확대 예정', '확대 예정'],
      ['상대 시간대 · 예약 알림', true, true, true],
      ['민감정보 전송 전 차단', true, true, true],
    ],
  },
  {
    group: '맞춤',
    rows: [
      ['개인 용어집 · 저장 문구', true, true, true],
      ['수정 습관 학습', true, true, true],
      ['팀 용어집 공유', '지금 무료', false, true],
    ],
  },
  {
    group: '팀',
    rows: [
      ['팀 대시보드(협업 지표 합계)', '지금 무료', false, true],
      ['팀원 관리', '지금 무료', false, true],
    ],
  },
  {
    group: '데이터',
    rows: [
      ['메시지 본문 서버 미저장', true, true, true],
      ['AI 학습에 쓰지 않음', true, true, true],
    ],
  },
];

const FAQ = [
  {
    q: '지금 돈을 내야 하나요?',
    a: '아니요. 출시 기간에는 개인 기능과 팀 기능을 모두 무료로 쓸 수 있어요. 결제 수단을 등록하는 곳도 없어요.',
  },
  {
    q: '유료 플랜은 언제 나오나요?',
    a: '날짜는 아직 정하지 않았어요. 정해지면 이 페이지에 먼저 알려 드려요. 유료 플랜이 나와도 무료 플랜은 남아요.',
  },
  {
    q: '어떤 결제 수단을 쓰게 되나요?',
    a: '해외 결제 대행사를 통한 카드 결제를 준비하고 있어요. 확정되면 결제 정보 처리 내용을 개인정보처리방침에 먼저 반영해요.',
  },
  {
    q: '유료 플랜에서도 메시지 본문을 저장하지 않나요?',
    a: '네. 어느 플랜이든 메시지 본문은 사이 서버와 데이터베이스에 저장하지 않아요. 자세한 내용은 개인정보처리방침에 있어요.',
    link: { to: '/privacy', label: '개인정보처리방침 보기' },
  },
  {
    q: '하루 횟수를 다 쓰면 어떻게 되나요?',
    a: '그날은 다듬기 · 뜻 풀기 · 회신 초안을 더 할 수 없고, 다음 날 다시 채워져요. 하루 횟수는 이 셋을 합쳐 세요. 저장 문구 · 용어집 · 예약 알림은 그대로 쓸 수 있어요.',
  },
];

function Cell({ value }) {
  if (value === true) {
    return (
      <span className="pr-yes" aria-label="포함">
        ✓
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="pr-no" aria-label="없음">
        –
      </span>
    );
  }
  return <span className="pr-text">{value}</span>;
}

export default function Pricing() {
  const [open, setOpen] = useState(0);

  useEffect(() => {
    document.title = '요금제 — 사이';
    return () => {
      document.title = '사이 — 해외 동료와 주고받는 업무 메시지';
    };
  }, []);

  return (
    <main id="main" className="pricing page-pad">
      <div className="wrap">
        <header className="pr-head">
          <p className="pr-eyebrow">요금제</p>
          <h1 className="pr-title">지금은 모두 무료예요</h1>
          <p className="pr-lede">
            출시 기간에는 개인·팀 기능을 모두 무료로 써요. 유료 플랜은 준비 중이고, 나와도 무료 플랜은 남아요.
          </p>
        </header>

        <section className="pr-plans" aria-label="플랜">
          {PLANS.map((plan) => (
            <article key={plan.id} className={`pr-card${plan.featured ? ' featured' : ''}`}>
              {plan.featured && <p className="pr-flag">예정</p>}
              <h2 className="pr-name">{plan.name}</h2>
              <p className="pr-blurb">{plan.blurb}</p>
              <p className="pr-price">
                <span className="num">{plan.price}</span>
                <span className="pr-unit">{plan.unit}</span>
              </p>
              <button
                type="button"
                className={`btn ${plan.id === 'free' ? 'primary' : 'ghost'} pr-cta`}
                aria-disabled="true"
              >
                {plan.cta.label}
              </button>
              <p className="pr-note">{plan.cta.note}</p>
              <hr className="pr-rule" />
              <p className="pr-lead">{plan.lead}</p>
              <ul className="pr-features">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="pr-compare" aria-labelledby="pr-compare-title">
          <h2 id="pr-compare-title" className="pr-section-title">
            플랜 비교
          </h2>
          <div className="pr-table-scroll">
            <table className="pr-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">기능</span>
                  </th>
                  {PLANS.map((p) => (
                    <th key={p.id} scope="col">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              {COMPARE.map((section) => (
                <tbody key={section.group}>
                  <tr className="pr-group">
                    <th scope="rowgroup" colSpan={4}>
                      {section.group}
                    </th>
                  </tr>
                  {section.rows.map(([label, ...cells]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {cells.map((value, i) => (
                        <td key={PLANS[i].id}>
                          <Cell value={value} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <p className="pr-footnote">「지금 무료」는 출시 기간에만 무료로 여는 기능이에요. 「예정」 칸은 유료 플랜이 나올 때의 기준이에요.</p>
        </section>

        <section className="pr-faq" aria-labelledby="pr-faq-title">
          <h2 id="pr-faq-title" className="pr-section-title">
            자주 묻는 질문
          </h2>
          <ul>
            {FAQ.map((item, i) => {
              const expanded = open === i;
              return (
                <li key={item.q}>
                  <button
                    type="button"
                    className="pr-q"
                    aria-expanded={expanded}
                    aria-controls={`pr-a-${i}`}
                    onClick={() => setOpen(expanded ? -1 : i)}
                  >
                    {item.q}
                    <span className="pr-chev" aria-hidden="true" />
                  </button>
                  <div id={`pr-a-${i}`} className="pr-a" hidden={!expanded}>
                    <p>{item.a}</p>
                    {item.link && <Link to={item.link.to}>{item.link.label}</Link>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
