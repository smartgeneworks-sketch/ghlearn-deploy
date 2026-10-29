import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, patch, post, HttpError } from '../lib/api';
import { Alert, Button, Card, Input, Spinner } from '../components/ui';

/**
 * SMS (BMS Africa / mNotify) for Super Admins: on/off, sender ID and daily cap (saved through the audited System settings),
 * live balance and sender approval, a test send to a number the admin types, and the recent send log with masked numbers.
 * The API key lives only in the server environment (BMS_API_KEY); this page shows only whether it is present.
 */
type Status = { configured: boolean; provider: string | null; keyPresent: boolean; available: boolean; settings: { enabled: boolean; senderId: string; dailyCap: number };
  senderId: string | null; senderSource: 'settings' | 'environment' | 'none'; sentToday: number; dailyCap: number;
  live: null | { checkedAt: string; balance: { ok: true; smsCredits: number | null; bonus: number | null; wallet: string | null } | { ok: false; error: string }; senderStatus: null | { ok: true; status: string } | { ok: false; error: string; notFound?: boolean } } };
type Log = { _id: string; createdAt: string; kind: string; to: string; network?: string; status: string; error?: string; campaignId?: string; delivery?: string; chars?: number; userId?: { fullName: string } | null; by?: { fullName: string } | null };
const H = ({ children, id }: { children: string; id: string }) => <h2 id={id} className="text-lg font-semibold">{children}</h2>;

export function SmsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-sms'], queryFn: () => api<Status>('/api/admin/sms/status'), retry: false });
  const refresh = useMutation({ mutationFn: () => api<Status>('/api/admin/sms/status?refresh=1'), onSuccess: (d) => qc.setQueryData(['admin-sms'], d) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Alert>{q.error instanceof HttpError && q.error.status === 403 ? 'Only a Super Admin can manage SMS.' : (q.error as Error).message}</Alert>;
  const d = q.data!; const b = d.live?.balance; const s = d.live?.senderStatus;
  const approved = !!s && s.ok && /approv|active/.test(s.status);
  return <div className="space-y-4">
    <Card><section aria-labelledby="sms-status-h" className="space-y-3"><H id="sms-status-h">SMS status</H>
      {!d.configured ? <Alert tone="info">SMS is not configured on the server. Set BMS_API_KEY (and SMS_SENDER_ID) as environment variables on the API host; the key is never stored in GH Learn.</Alert>
        : !d.available ? <Alert tone="info">SMS is configured but not in use: {!d.settings.enabled ? 'it is switched off below.' : !d.senderId ? 'no sender ID is set.' : 'the daily cap is 0.'}</Alert>
          : !approved && s ? <Alert tone="info">The sender ID {d.senderId} is {s.ok ? `“${s.status}”` : 'not registered'} with the provider. Texts will fail until it is approved.</Alert> : null}
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="font-medium">Provider</dt><dd>{d.provider === 'mnotify' ? 'BMS Africa (mNotify)' : d.provider ?? 'none'} · API key {d.keyPresent ? 'present (environment)' : 'not set'}</dd>
        <dt className="font-medium">Sender ID</dt><dd>{d.senderId ?? 'none'}{d.senderId && <span className="text-slate-600"> (from {d.senderSource})</span>}{s && <> · {s.ok ? <strong>{s.status}</strong> : s.notFound ? 'not registered' : `could not check: ${s.error}`}</>}</dd>
        <dt className="font-medium">Balance</dt><dd>{!b ? '—' : b.ok ? `${b.smsCredits ?? '?'} SMS credits${b.bonus ? ` + ${b.bonus} bonus` : ''}${b.wallet != null ? ` · wallet GHS ${b.wallet}` : ''}` : `could not check: ${b.error}`}</dd>
        <dt className="font-medium">Sent today (UTC)</dt><dd>{d.sentToday} of {d.dailyCap}</dd>
      </dl>
      {d.configured && <div className="flex flex-wrap items-center gap-3"><Button variant="ghost" loading={refresh.isPending} onClick={() => refresh.mutate()}>Check balance and sender now</Button>
        {d.live?.checkedAt && <span className="text-xs text-slate-600">Checked {new Date(d.live.checkedAt).toLocaleTimeString()}</span>}{refresh.error && <Alert>{(refresh.error as Error).message}</Alert>}</div>}
    </section></Card>
    <SmsSettings d={d} />
    {d.configured && <TestSend available={d.available} />}
    <TestEmail />
    {d.configured && !approved && <RegisterSender current={d.senderId ?? ''} />}
    <SmsLog />
  </div>;
}

function SmsSettings({ d }: { d: Status }) {
  const qc = useQueryClient(); const [v, setV] = useState({ enabled: d.settings.enabled, senderId: d.settings.senderId, dailyCap: String(d.settings.dailyCap) });
  useEffect(() => setV({ enabled: d.settings.enabled, senderId: d.settings.senderId, dailyCap: String(d.settings.dailyCap) }), [d.settings.enabled, d.settings.senderId, d.settings.dailyCap]);
  const m = useMutation({ mutationFn: () => patch('/api/admin/settings', { sms: { enabled: v.enabled, senderId: v.senderId.trim(), dailyCap: Number(v.dailyCap) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-sms'] }); qc.invalidateQueries({ queryKey: ['admin-settings'] }); qc.invalidateQueries({ queryKey: ['platform'] }); } });
  const dirty = v.enabled !== d.settings.enabled || v.senderId.trim() !== d.settings.senderId || Number(v.dailyCap) !== d.settings.dailyCap;
  return <Card><section aria-labelledby="sms-set-h" className="space-y-3"><H id="sms-set-h">SMS settings</H>
    <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />Send SMS (verification codes, password reset codes, meeting texts for users who opted in)</label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Sender ID" maxLength={11} hint={`Up to 11 letters or digits; must be approved by the provider. Leave empty to use the server default${d.senderSource === 'environment' ? ` (${d.senderId})` : ''}.`} value={v.senderId} onChange={(e) => setV({ ...v, senderId: e.target.value })} />
        <Input label="Daily SMS cap" type="number" min={0} max={10000} hint="Most texts per day (UTC) across GH Learn. 0 stops all SMS." value={v.dailyCap} onChange={(e) => setV({ ...v, dailyCap: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" loading={m.isPending} disabled={!dirty}>Save SMS settings</Button>
        {m.isSuccess && !dirty && <span role="status" className="text-sm text-emerald-800">Saved. The change is in the audit log.</span>}</div>
      {m.error && <Alert>{(m.error as Error).message}</Alert>}
    </form></section></Card>;
}

function TestSend({ available }: { available: boolean }) {
  const qc = useQueryClient(); const [phone, setPhone] = useState(''); const [message, setMessage] = useState('GH Learn SMS test');
  const m = useMutation({ mutationFn: () => post<{ status: string; to: string; network: string; error?: string }>('/api/admin/sms/test', { phone, message }), onSettled: () => { qc.invalidateQueries({ queryKey: ['admin-sms-log'] }); qc.invalidateQueries({ queryKey: ['admin-sms'] }); } });
  const r = m.data;
  return <Card><section aria-labelledby="sms-test-h" className="space-y-3"><H id="sms-test-h">Send a test SMS</H>
    <p className="text-sm text-slate-600">Sends one real text (it uses a credit) to the number you enter. Only text numbers whose owners expect it.</p>
    <form noValidate className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Input label="Phone number" type="tel" inputMode="tel" placeholder="024 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <Input label="Message" maxLength={160} hint={`${message.length}/160`} value={message} onChange={(e) => setMessage(e.target.value)} />
      <Button type="submit" loading={m.isPending} disabled={!available || phone.trim().length < 9 || !message.trim()}>Send test</Button>
    </form>
    {r && (r.status === 'sent' ? <Alert tone="success">Sent to {r.to} ({r.network}). Check the log below for delivery.</Alert> : <Alert>Not sent to {r.to}: {r.error ?? r.status.replace('_', ' ')}.</Alert>)}
    {m.error && <Alert>{(m.error as Error).message}</Alert>}
  </section></Card>;
}

function RegisterSender({ current }: { current: string }) {
  const qc = useQueryClient(); const [name, setName] = useState(current || 'GHLearn');
  const [purpose, setPurpose] = useState('GH Learn education platform: account verification codes, password reset codes and class meeting notifications for students and teachers in Ghana');
  const m = useMutation({ mutationFn: () => post<{ status: string }>('/api/admin/sms/sender/register', { name: name.trim(), purpose }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-sms'] }) });
  return <Card><section aria-labelledby="sms-reg-h" className="space-y-3"><H id="sms-reg-h">Register a sender ID</H>
    <p className="text-sm text-slate-600">Asks the provider to approve a sender name. Approval is done by BMS Africa and can take a few working days; they may ask for documents. If the name is already submitted, there is nothing to do but wait.</p>
    <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Input label="Sender name" maxLength={11} value={name} onChange={(e) => setName(e.target.value)} />
      <Input label="Purpose" maxLength={300} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      <Button type="submit" variant="ghost" loading={m.isPending} disabled={name.trim().length < 3 || purpose.trim().length < 10}>Submit for approval</Button>
    </form>
    {m.isSuccess && <Alert tone="success">Submitted. Status: {m.data.status}.</Alert>}{m.error && <Alert>{(m.error as Error).message}</Alert>}
  </section></Card>;
}

function SmsLog() {
  const qc = useQueryClient(); const [limit, setLimit] = useState(50);
  const q = useQuery({ queryKey: ['admin-sms-log', limit], queryFn: () => api<{ items: Log[] }>(`/api/admin/sms/log?limit=${limit}`) });
  const check = useMutation({ mutationFn: (id: string) => post(`/api/admin/sms/log/${id}/delivery`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-sms-log'] }) });
  return <Card><section aria-labelledby="sms-log-h" className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><H id="sms-log-h">Recent SMS</H>
    <label className="text-sm">Show <select className="rounded border border-slate-300 px-2 py-1" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}</select> latest</label></div>
    <p className="text-sm text-slate-600">Numbers are masked and message text is never stored.</p>
    {check.error && <Alert>{(check.error as Error).message}</Alert>}
    {q.isLoading ? <Spinner /> : q.error ? <Alert>{(q.error as Error).message}</Alert> : !q.data!.items.length ? <p className="text-sm">No SMS sent yet.</p> :
      <div className="overflow-x-auto"><table className="w-full text-left text-sm" aria-label="Recent SMS"><thead><tr className="border-b"><th scope="col" className="py-1 pr-3">When</th><th scope="col" className="pr-3">Kind</th><th scope="col" className="pr-3">To</th><th scope="col" className="pr-3">Status</th><th scope="col" className="pr-3">Delivery</th><th scope="col">For / by</th></tr></thead>
        <tbody>{q.data!.items.map((l) => <tr key={l._id} className="border-b align-top">
          <td className="py-1 pr-3 whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td><td className="pr-3">{l.kind}</td><td className="pr-3 font-mono">{l.to}{l.network ? <span className="font-sans text-slate-600"> {l.network}</span> : null}</td>
          <td className="pr-3">{l.status.replace('_', ' ')}{l.error ? <span className="block text-xs text-red-800">{l.error}</span> : null}</td>
          <td className="pr-3">{l.delivery ?? (l.campaignId ? <Button variant="ghost" className="px-2 py-1 text-xs" loading={check.isPending && check.variables === l._id} onClick={() => check.mutate(l._id)}>Check</Button> : '—')}</td>
          <td>{l.userId?.fullName ?? l.by?.fullName ?? '—'}</td></tr>)}</tbody></table></div>}
  </section></Card>;
}

/** One real test email (super admins; audited as email.test). */
function TestEmail() {
  const q = useQuery({ queryKey: ['admin-email'], queryFn: () => api<{ configured: boolean; provider: string | null; from: string | null }>('/api/admin/email/status') });
  const [to, setTo] = useState('');
  const m = useMutation({ mutationFn: () => post<{ status: string; to: string; provider: string; messageId?: string; error?: string }>('/api/admin/email/test', { to: to.trim() }) });
  const r = m.data;
  return <Card><section aria-labelledby="email-test-h" className="space-y-3"><H id="email-test-h">Send a test email</H>
    {q.isLoading ? <Spinner /> : !q.data?.configured ? <p className="text-sm text-slate-600">Email is not configured on the server (EMAIL_API_PROVIDER, EMAIL_API_KEY and EMAIL_FROM, or SMTP).</p> : <>
      <p className="text-sm text-slate-600">Provider {q.data.provider}, from {q.data.from}. Sends one real email to the address you enter.</p>
      <form noValidate className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="min-w-[16rem] flex-1"><Input label="Email address" type="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button type="submit" loading={m.isPending} disabled={!to.includes('@')}>Send test email</Button>
      </form>
      {r && (r.status === 'sent' ? <Alert tone="success">Sent to {r.to} via {r.provider}.</Alert> : <Alert>Not sent to {r.to}: {r.error ?? r.status.replace('_', ' ')}.</Alert>)}
      {m.error && <Alert>{(m.error as Error).message}</Alert>}</>}
  </section></Card>;
}
