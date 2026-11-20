import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Button } from './ui';

/**
 * Shared confirmation dialog for risky actions (spec §3C). Modal, labelled and described, focus moves in and is
 * trapped, Escape cancels, focus returns to the trigger. Optional type-to-confirm for destructive actions.
 * `onConfirm` may return a promise; the dialog stays open with the error shown if it rejects.
 */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', tone = 'danger', typeToConfirm, onConfirm, onClose }: {
  open: boolean; title: string; children?: ReactNode; confirmLabel?: string; tone?: 'danger' | 'primary'; typeToConfirm?: string;
  onConfirm: () => unknown | Promise<unknown>; onClose: () => void;
}) {
  const id = useId(); const box = useRef<HTMLDivElement>(null); const back = useRef<Element | null>(null);
  const [typed, setTyped] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement; setTyped(''); setErr(null);
    const t = setTimeout(() => (box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('button'))?.focus(), 0);
    return () => { clearTimeout(t); (back.current as HTMLElement | null)?.focus?.(); };
  }, [open]);
  if (!open) return null;
  const ok = !typeToConfirm || typed.trim() === typeToConfirm;
  const run = async () => { setBusy(true); setErr(null); try { await onConfirm(); onClose(); } catch (e: any) { setErr(e?.message ?? 'Something went wrong'); } finally { setBusy(false); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); }
    if (e.key !== 'Tab' || !box.current) return;
    const f = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, a[href]')]; if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  };
  return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onKeyDown={onKey}>
    <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
      <h2 id={`${id}-t`} className="text-lg font-semibold">{title}</h2>
      <div id={`${id}-d`} className="space-y-2 text-sm text-slate-700">{children}</div>
      {typeToConfirm && <label className="block text-sm"><span className="mb-1 block font-medium">Type <strong>{typeToConfirm}</strong> to confirm</span>
        <input data-autofocus className="w-full rounded-lg border border-slate-300 px-3 py-2" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>}
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose} disabled={busy} {...(!typeToConfirm ? { 'data-autofocus': true } : {})}>Cancel</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={!ok} loading={busy} onClick={run}>{confirmLabel}</Button></div>
    </div></div>, document.body);
}
/** A button that asks for confirmation first. */
export function ConfirmButton({ label, ariaLabel, title, body, confirmLabel, tone = 'danger', typeToConfirm, onConfirm, variant, className, disabled }: {
  label: ReactNode; ariaLabel?: string; title: string; body: ReactNode; confirmLabel?: string; tone?: 'danger' | 'primary'; typeToConfirm?: string;
  onConfirm: () => unknown | Promise<unknown>; variant?: 'primary' | 'ghost' | 'danger'; className?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <><Button variant={variant ?? (tone === 'danger' ? 'danger' : 'ghost')} className={className ?? 'px-2 py-1 text-xs'} aria-label={ariaLabel} disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>
    <ConfirmDialog open={open} title={title} confirmLabel={confirmLabel ?? (typeof label === 'string' ? label : 'Confirm')} tone={tone} typeToConfirm={typeToConfirm} onConfirm={onConfirm} onClose={() => setOpen(false)}>{body}</ConfirmDialog></>;
}
