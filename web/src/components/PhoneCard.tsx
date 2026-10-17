import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, post, put } from '../lib/api';
import { Alert, Button, Card, Input, Spinner } from './ui';

type PhoneState = { phone: string | null; verifiedAt: string | null; smsAvailable: boolean; pending: { phoneMasked: string; expiresAt: string } | null };
type Prefs = { categories: { key: string; label: string; sms?: boolean; smsCapable?: boolean }[]; sms?: { available: boolean; phoneVerified: boolean } };

/**
 * Mobile number (Ghana), verified with a 6-digit code by SMS. A verified number can be used to reset a forgotten password,
 * and (if switched on here) receives texts about meetings. SMS is opt-in.
 */
export function PhoneCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['account-phone'], queryFn: () => api<PhoneState>('/api/account/phone') });
  const prefs = useQuery({ queryKey: ['notif-prefs'], queryFn: () => api<Prefs>('/api/notifications/preferences') });
  const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['account-phone'] }); qc.invalidateQueries({ queryKey: ['notif-prefs'] }); };
  const send = useMutation({ mutationFn: (p: string) => post<{ phoneMasked: string }>('/api/account/phone', { phone: p }), onSuccess: (r) => { setMsg(`We texted a 6-digit code to ${r.phoneMasked}. It expires in 10 minutes.`); setCode(''); refresh(); } });
  const verify = useMutation({ mutationFn: () => post('/api/account/phone/verify', { code: code.trim() }), onSuccess: () => { setMsg('Your phone number is verified.'); setPhone(''); setCode(''); refresh(); } });
  const remove = useMutation({ mutationFn: () => del('/api/account/phone'), onSuccess: () => { setMsg('Your phone number was removed.'); refresh(); } });
  const meet = prefs.data?.categories.find((c) => c.key === 'meetings');
  const toggle = useMutation({ mutationFn: (on: boolean) => put('/api/notifications/preferences', { categories: { meetings: { sms: on } } }),
    onError: () => setSmsOn(null), onSettled: () => qc.invalidateQueries({ queryKey: ['notif-prefs'] }) });
  const [smsOn, setSmsOn] = useState<boolean | null>(null);
  if (q.isLoading) return <Card><h2 className="mb-2 font-semibold">Phone number</h2><Spinner /></Card>;
  if (q.error) return <Card><h2 className="mb-2 font-semibold">Phone number</h2><Alert>{(q.error as Error).message}</Alert></Card>;
  const d = q.data!; const err = send.error ?? verify.error ?? remove.error ?? toggle.error;
  return <Card><section aria-labelledby="phone-h" className="space-y-3">
    <h2 id="phone-h" className="font-semibold">Phone number</h2>
    {msg && !err && <Alert tone="success">{msg}</Alert>}{err && <Alert>{(err as Error).message}</Alert>}
    {d.phone ? <>
      <p className="text-sm"><span className="font-medium">{d.phone}</span> <span className="ml-1 rounded bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-900">Verified</span></p>
      <p className="text-sm text-slate-600">You can use this number to reset a forgotten password by SMS.</p>
      {meet?.smsCapable && <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={smsOn ?? !!meet.sms} disabled={!d.smsAvailable} onChange={(e) => { setSmsOn(e.target.checked); toggle.mutate(e.target.checked); }} />
        <span>Text me about meetings (requests, confirmations, declines, new times and a reminder an hour before).{!d.smsAvailable && ' SMS is switched off on GH Learn at the moment.'}</span></label>}
      <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>Remove phone number</Button>
    </> : !d.smsAvailable ? <p className="text-sm text-slate-600">Adding a phone number needs SMS, which is not available on GH Learn yet.</p> : <>
      <p className="text-sm text-slate-600">Add a Ghana mobile number (MTN, Telecel or AirtelTigo). We text you a code to check it is yours. GH Learn only texts you codes you ask for and, if you choose, meeting updates.</p>
      <form noValidate className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setMsg(null); send.mutate(phone); }}>
        <div className="min-w-[14rem] flex-1"><Input label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" placeholder="024 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <Button type="submit" loading={send.isPending} disabled={phone.trim().length < 9}>{d.pending ? 'Send a new code' : 'Send code'}</Button>
      </form>
      {d.pending && <form noValidate className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setMsg(null); verify.mutate(); }}>
        <div className="min-w-[10rem]"><Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} hint={`Sent to ${d.pending.phoneMasked}`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
        <Button type="submit" loading={verify.isPending} disabled={code.length !== 6}>Verify</Button>
      </form>}
    </>}
  </section></Card>;
}
