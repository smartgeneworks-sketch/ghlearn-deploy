import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import { Loader2 } from 'lucide-react';
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
export function Button({ variant = 'primary', loading, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean }) {
  const v = { primary: 'bg-brand-700 text-white hover:bg-brand-900', ghost: 'bg-white border border-slate-300 hover:bg-slate-100', danger: 'bg-red-700 text-white hover:bg-red-800' }[variant];
  return <button {...p} disabled={p.disabled || loading} aria-busy={loading} className={cx('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 font-medium transition disabled:opacity-60', v, className)}>{loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}</button>;
}
type FieldProps = { label: string; error?: string; hint?: string };
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(({ label, error, hint, ...p }, ref) => {
  const id = useId();
  return <div className="space-y-1"><label htmlFor={id} className="block text-sm font-medium">{label}</label>
    <input ref={ref} id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...p} className={cx('w-full rounded-lg border px-3 py-2', error ? 'border-red-600' : 'border-slate-300')} />
    {hint && !error && <p id={`${id}-h`} className="text-xs text-slate-500">{hint}</p>}{error && <p id={`${id}-e`} role="alert" className="text-sm text-red-700">{error}</p>}</div>;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps & { children: ReactNode }>(({ label, error, children, ...p }, ref) => {
  const id = useId();
  return <div className="space-y-1"><label htmlFor={id} className="block text-sm font-medium">{label}</label>
    <select ref={ref} id={id} aria-invalid={!!error} {...p} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{children}</select>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>;
});
export const Card = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cx('rounded-xl border border-slate-200 bg-white p-5 shadow-sm', className)}>{children}</div>;
export const Alert = ({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'success' }) =>
  <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-lg p-3 text-sm', tone === 'error' && 'bg-red-50 text-red-800', tone === 'info' && 'bg-amber-50 text-amber-900', tone === 'success' && 'bg-brand-50 text-brand-900')}>{children}</div>;
export const Spinner = ({ label = 'Loading' }: { label?: string }) => <div role="status" className="flex items-center gap-2 p-6 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" aria-hidden />{label}…</div>;
export const SampleBadge = () => <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">SAMPLE DATA</span>;
