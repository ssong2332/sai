import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * 미끄러지는 손잡이가 달린 세그먼트(시안 A2 `.seg`).
 * - `mode="radio"`: role=radiogroup/radio + aria-checked (설정 화면)
 * - `mode="pressed"`: aria-pressed 버튼 묶음 (소개 페이지 데모)
 * 손잡이는 선택된 버튼의 offset을 재서 transform·width·height로만 움직인다. 줄이 넘어가도(wrap) 따라간다.
 */
export default function Segmented({
  options,
  value,
  onChange,
  mode = 'radio',
  labelledBy,
  label,
  disabled = false,
  wrap = false,
  className = '',
  knobClassName = '',
}) {
  const root = useRef(null);
  const [knob, setKnob] = useState(null);

  const measure = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const on = el.querySelector('[data-on="true"]');
    if (!on) {
      setKnob(null);
      return;
    }
    const next = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
    setKnob((prev) =>
      prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next,
    );
  }, []);

  useLayoutEffect(measure, [measure, value, options]);

  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    let ro;
    if (typeof window.ResizeObserver !== 'undefined') {
      ro = new window.ResizeObserver(() => measure());
      ro.observe(el);
    }
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro?.disconnect();
  }, [measure]);

  const isRadio = mode === 'radio';
  return (
    <div
      ref={root}
      className={`seg${wrap ? ' wrapable' : ''}${knob ? ' has-knob' : ''} ${className}`.trim()}
      role={isRadio ? 'radiogroup' : 'group'}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
    >
      <span
        className={`knob ${knobClassName}`.trim()}
        aria-hidden="true"
        data-ready={knob ? 'true' : 'false'}
        style={knob ? { width: knob.w, height: knob.h, transform: `translate(${knob.x}px, ${knob.y}px)` } : undefined}
      />
      {options.map((opt) => {
        const on = opt.id === value;
        return (
          <button
            key={String(opt.id)}
            type="button"
            data-on={on}
            {...(isRadio ? { role: 'radio', 'aria-checked': on } : { 'aria-pressed': on })}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
