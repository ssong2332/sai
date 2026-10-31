import { useEffect } from 'react';
import { navigate } from '../router.jsx';
import privacyHtml from '../legal/privacy.html?raw';
import termsHtml from '../legal/terms.html?raw';
import refundHtml from '../legal/refund.html?raw';

/**
 * 개인정보처리방침 · 이용약관 — `dashboard/public/*.html`의 본문을 글자 그대로 옮겨 스타일만 바꿨다.
 * 🔴 문구를 여기서 고치지 않는다. 원본이 초안(【】 자리표시)이라 그 사실을 화면 위에 밝힌다.
 */
const DOCS = {
  privacy: { html: privacyHtml, title: '개인정보처리방침' },
  terms: { html: termsHtml, title: '이용약관' },
  refund: { html: refundHtml, title: '환불 정책' },
};

export default function Legal({ doc }) {
  const { html, title } = DOCS[doc];
  const isDraft = html.includes('【');

  useEffect(() => {
    document.title = `${title} — 사이`;
    return () => {
      document.title = '사이 — 해외 동료와 주고받는 업무 메시지';
    };
  }, [title]);

  const onClick = (event) => {
    const a = event.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('/') && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      navigate(href);
    }
  };

  return (
    <main id="main" className="legal page-pad">
      <div className="wrap legal-inner">
        {isDraft && (
          <p className="legal-draft" role="note">
            <b>초안</b> — 시행일 등 【 】로 표시한 항목은 아직 정해지지 않았습니다. 공개 출시 전에 확정합니다.
          </p>
        )}
        {/* 정적 문서(저장소 안의 파일)라 사용자 입력이 섞이지 않는다. */}
        <article className="legal-doc" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </main>
  );
}
