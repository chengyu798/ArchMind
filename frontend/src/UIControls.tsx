import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './UIControls.css';

type Option = { value: string; label: string };
type SelectProps = {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

/** Keyboard focus stays on the combobox; its active option is exposed to assistive technology. */
export function SelectField({ label, value, options, onChange, disabled = false }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 240 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef({ value: '', time: 0 });
  const id = useId();
  const selected = options.findIndex((option) => option.value === value);
  const expanded = open && !disabled && options.length > 0;

  const show = () => { setActive(Math.max(0, selected)); setOpen(true); };
  const choose = (index: number) => {
    if (!options[index]) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const height = Math.min(240, options.length * 40 + 10);
      const upwards = below < height && above > below;
      const available = Math.max(40, upwards ? above : below);
      const actualHeight = Math.min(height, available);
      const width = Math.min(Math.max(rect.width, 160), window.innerWidth - 24);
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: upwards ? rect.top - actualHeight - 4 : rect.bottom + 4, width, maxHeight: actualHeight });
    };
    place();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [expanded, options.length]);

  useEffect(() => {
    if (expanded) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, expanded, id]);

  return (
    <>
      <button ref={trigger} type="button" className="ui-select" role="combobox" aria-label={label}
        aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? id : undefined}
        aria-activedescendant={expanded ? `${id}-${active}` : undefined} disabled={disabled || !options.length}
        onClick={() => expanded ? setOpen(false) : show()}
        onBlur={(event) => { if (!popup.current?.contains(event.relatedTarget)) setOpen(false); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
          if (event.key === 'Tab') { setOpen(false); return; }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            if (!expanded) { show(); return; }
            setActive((index) => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (expanded) choose(active); else show();
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            const now = Date.now();
            search.current = { value: (now - search.current.time < 700 ? search.current.value : '') + event.key.toLowerCase(), time: now };
            const index = options.findIndex((option) => option.label.toLowerCase().startsWith(search.current.value));
            if (index >= 0) { setOpen(true); setActive(index); }
          }
        }}>
        <span>{options[selected]?.label ?? (value || '请选择')}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {expanded && createPortal(
        <div ref={popup} id={id} className="ui-select-popup" data-ui-select-popup role="listbox" aria-label={label} style={position}>
          {options.map((option, index) => (
            <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={value === option.value}
              className={`ui-select-option ${active === index ? 'is-active' : ''}`}
              onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
              <span>{option.label}</span><span aria-hidden="true">{value === option.value ? '✓' : ''}</span>
            </div>
          ))}
        </div>, document.body,
      )}
    </>
  );
}

export function NumberField({ label, value, min, max, onChange, disabled = false }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = (next: number) => {
    const bounded = Math.max(min, Math.min(max, Number.isFinite(next) ? Math.trunc(next) : value));
    setDraft(String(bounded)); onChange(bounded);
  };
  return (
    <div className="ui-number">
      <input aria-label={label} role="spinbutton" inputMode="numeric" value={draft} disabled={disabled}
        aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}
        onChange={(event) => {
          if (!/^\d*$/.test(event.target.value)) return;
          setDraft(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value && next >= min && next <= max) onChange(next);
        }} onBlur={() => commit(draft ? Number(draft) : value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); commit(value + (event.key === 'ArrowUp' ? 1 : -1)); }
          if (event.key === 'Enter') commit(draft ? Number(draft) : value);
        }} />
      <div className="ui-number-actions">
        <button type="button" aria-label={`减少${label}`} disabled={disabled || value <= min} onClick={() => commit(value - 1)}>−</button>
        <button type="button" aria-label={`增加${label}`} disabled={disabled || value >= max} onClick={() => commit(value + 1)}>+</button>
      </div>
    </div>
  );
}

type ConfirmOptions = { title: string; description: string; confirmLabel?: string };

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (confirmed: boolean) => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancel.current?.focus();
    const keepFocus = (event: FocusEvent) => { if (!dialog.current?.contains(event.target as Node)) cancel.current?.focus(); };
    document.addEventListener('focusin', keepFocus);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('focusin', keepFocus); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(
    <div className="ui-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(false); }}>
      <div ref={dialog} className="ui-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(false); }
          if (event.key === 'Tab') {
            const buttons = dialog.current!.querySelectorAll<HTMLButtonElement>('button');
            const first = buttons[0]; const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
        <div className="ui-dialog-icon" aria-hidden="true">!</div>
        <h2 id={`${id}-title`}>{options.title}</h2>
        <p id={`${id}-description`}>{options.description}</p>
        <div className="form-actions">
          <button ref={cancel} type="button" className="btn-small" onClick={() => onClose(false)}>取消</button>
          <button type="button" className="btn-small ui-danger-solid" onClick={() => onClose(true)}>{options.confirmLabel ?? '确认删除'}</button>
        </div>
      </div>
    </div>, document.body,
  );
}

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((result: boolean) => void) | null>(null);
  useEffect(() => () => { resolver.current?.(false); resolver.current = null; }, []);
  const confirm = (next: ConfirmOptions) => new Promise<boolean>((resolve) => {
    if (resolver.current) { resolve(false); return; }
    resolver.current = resolve; setOptions(next);
  });
  const close = (result: boolean) => { const resolve = resolver.current; resolver.current = null; setOptions(null); resolve?.(result); };
  return { confirm, confirmDialog: options ? <ConfirmDialog options={options} onClose={close} /> : null };
}
