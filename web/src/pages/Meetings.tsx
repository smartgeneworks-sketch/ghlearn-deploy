import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@ghlearn/shared';
import { api, post, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';

const when = (d: string) => new Date(d).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const range = (a: string, b: string) => `${when(a)} – ${new Date(b).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
const MODE: Record<string, string> = { in_person: 'In person', online: 'Online' };
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Waiting for teacher/counselor', cls: 'bg-amber-100 text-amber-900' }, awaiting_student: { label: 'New time proposed: waiting for student', cls: 'bg-sky-100 text-sky-900' },
  confirmed: { label: 'Confirmed', cls: 'bg-emerald-100 text-emerald-900' }, declined: { label: 'Declined', cls: 'bg-slate-200 text-slate-800' }, cancelled: { label: 'Cancelled', cls: 'bg-slate-200 text-slate-800' },
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

export function MeetingsPage() {
  const { user } = useAuth(); const host = hasPermission(user!.roles, 'meetings:host') && user!.roles.some((r) => r === 'teacher' || r === 'counselor'); const student = user!.roles.includes('student');
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  return <section className="space-y-4">
    <h1 className="text-2xl font-bold">Meetings</h1>
    {student && <RequestMeeting />}
    {host && <Availability />}
    <Card><div role="tablist" aria-label="Meetings" className="mb-3 flex gap-2">{(['upcoming', 'past'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded px-3 py-1 text-sm ${tab === t ? 'bg-brand-700 text-white' : 'bg-slate-100'}`}>{t === 'upcoming' ? 'Upcoming' : 'Past'}</button>)}</div>
      <MeetingList when={tab} /></Card>
  </section>;
}

function RequestMeeting() {
  const qc = useQueryClient();
  const hosts = useQuery({ queryKey: ['meeting-hosts'], retry: false, queryFn: () => api<{ items: any[] }>('/api/meetings/hosts').then((r) => r.items) });
  const [v, setV] = useState({ hostId: '', slotId: '', propose: '', durationMin: 30, topic: '', mode: 'in_person', link: '', note: '' });
  const set = (x: Partial<typeof v>) => { m.reset(); setV({ ...v, ...x }); };
  const slots = useQuery({ queryKey: ['meeting-slots', v.hostId], enabled: !!v.hostId, queryFn: () => api<{ items: any[] }>(`/api/meetings/slots?hostId=${v.hostId}`).then((r) => r.items) });
  const slot = slots.data?.find((s) => s._id === v.slotId);
  const m = useMutation({ mutationFn: () => post('/api/meetings', { hostId: v.hostId, topic: v.topic, mode: v.mode, ...(v.slotId ? { slotId: v.slotId } : { start: toIso(v.propose), durationMin: v.durationMin }), ...(v.link ? { link: v.link } : {}), ...(v.note ? { note: v.note } : {}) }),
    onSuccess: () => { setV({ ...v, slotId: '', propose: '', topic: '', note: '', link: '' }); qc.invalidateQueries({ queryKey: ['meetings'] }); qc.invalidateQueries({ queryKey: ['meeting-slots'] }); } });
  if (hosts.isLoading) return <Spinner />;
  if (hosts.error) return <Alert tone="info">{hosts.error.message} <Link className="underline" to="/profile">Open my profile</Link></Alert>;
  const ok = v.hostId && v.topic.trim().length >= 3 && (v.slotId || v.propose);
  return <Card><h2 className="mb-3 font-semibold">Request a meeting</h2>
    <div className="grid gap-3 sm:grid-cols-2">
      <Select label="Teacher or counselor" value={v.hostId} onChange={(e) => set({ hostId: e.target.value, slotId: '' })}><option value="">Choose…</option>{hosts.data!.map((h) => <option key={h._id} value={h._id}>{h.fullName} ({h.role})</option>)}</Select>
      <Input label="Topic" value={v.topic} maxLength={200} onChange={(e) => set({ topic: e.target.value })} />
      {v.hostId && <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Available times</legend>
        {slots.isLoading ? <Spinner /> : <div className="mt-1 flex flex-wrap gap-2">{slots.data?.map((s) => <label key={s._id} className={`flex items-center gap-2 rounded border px-2 py-1 text-sm ${v.slotId === s._id ? 'border-brand-700 bg-brand-50' : ''}`}>
          <input type="radio" name="slot" checked={v.slotId === s._id} onChange={() => set({ slotId: s._id, propose: '', mode: s.modes.includes(v.mode) ? v.mode : s.modes[0] })} />{range(s.start, s.end)} · {s.modes.map((x: string) => MODE[x]).join('/')}</label>)}
          {!slots.data?.length && <p className="text-sm text-slate-600">No open slots. Propose a time below.</p>}</div>}</fieldset>}
      <Input label="Or propose a time" type="datetime-local" value={v.propose} onChange={(e) => set({ propose: e.target.value, slotId: '' })} />
      {!v.slotId && <Select label="Duration" value={v.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })}>{[15, 30, 45, 60].map((n) => <option key={n} value={n}>{n} minutes</option>)}</Select>}
      <Select label="Mode" value={v.mode} onChange={(e) => set({ mode: e.target.value })}>{(slot?.modes ?? ['in_person', 'online']).map((x: string) => <option key={x} value={x}>{MODE[x]}</option>)}</Select>
      {v.mode === 'online' && <Input label="Online meeting link (optional)" type="url" placeholder="https://" value={v.link} onChange={(e) => set({ link: e.target.value })} hint="The teacher or counselor can add one when confirming." />}
      <Input label="Note (optional)" value={v.note} maxLength={1000} onChange={(e) => set({ note: e.target.value })} />
    </div>
    {m.error && <div className="mt-2"><Alert>{m.error.message}</Alert></div>}{m.isSuccess && <div className="mt-2"><Alert tone="success">Request sent. You will get a notification when it is answered.</Alert></div>}
    <Button className="mt-3" disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>Send request</Button></Card>;
}

function Availability() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-slots'], queryFn: () => api<{ items: any[] }>('/api/meetings/slots').then((r) => r.items) });
  const [v, setV] = useState({ start: '', end: '', inPerson: true, online: true, location: '', link: '' });
  const m = useMutation({ mutationFn: () => post('/api/meetings/slots', { start: toIso(v.start), end: toIso(v.end), modes: [...(v.inPerson ? ['in_person'] : []), ...(v.online ? ['online'] : [])], ...(v.location ? { location: v.location } : {}), ...(v.link ? { link: v.link } : {}) }),
    onSuccess: () => { setV({ ...v, start: '', end: '' }); qc.invalidateQueries({ queryKey: ['my-slots'] }); } });
  const d = useMutation({ mutationFn: (id: string) => del(`/api/meetings/slots/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['my-slots'] }) });
  return <Card><h2 className="mb-3 font-semibold">My availability</h2>
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="From" type="datetime-local" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} />
      <Input label="To" type="datetime-local" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} />
      <fieldset><legend className="text-sm font-medium">Modes</legend><div className="flex gap-4 text-sm"><label className="flex items-center gap-1"><input type="checkbox" checked={v.inPerson} onChange={(e) => setV({ ...v, inPerson: e.target.checked })} />In person</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={v.online} onChange={(e) => setV({ ...v, online: e.target.checked })} />Online</label></div></fieldset>
      <Input label="Room / location (optional)" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
      {v.online && <Input label="Online link (optional)" type="url" placeholder="https://" value={v.link} onChange={(e) => setV({ ...v, link: e.target.value })} />}
    </div>
    {m.error && <div className="mt-2"><Alert>{m.error.message}</Alert></div>}
    <Button className="mt-3" disabled={!v.start || !v.end || (!v.inPerson && !v.online)} loading={m.isPending} onClick={() => m.mutate()}>Add slot</Button>
    <ul className="mt-4 divide-y text-sm">{q.data?.map((s) => <li key={s._id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{range(s.start, s.end)} · {s.modes.map((x: string) => MODE[x]).join('/')}{s.location && ` · ${s.location}`}</span>
      {s.taken ? <span className="rounded bg-emerald-100 px-2 text-xs text-emerald-900">Booked</span> : <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => d.mutate(s._id)}>Remove</Button>}</li>)}
      {!q.data?.length && <li className="py-2 text-slate-600">No upcoming slots. Students can still propose a time.</li>}</ul>
    {d.error && <Alert>{d.error.message}</Alert>}</Card>;
}

function MeetingList({ when: w }: { when: 'upcoming' | 'past' }) {
  const q = useQuery({ queryKey: ['meetings', w], queryFn: () => api<{ items: any[] }>(`/api/meetings?when=${w}`).then((r) => r.items) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Alert>{q.error.message}</Alert>;
  if (!q.data!.length) return <p className="text-sm text-slate-600">{w === 'upcoming' ? 'No upcoming meetings.' : 'No past meetings.'}</p>;
  return <ul className="space-y-3">{q.data!.map((m) => <MeetingItem key={m._id} m={m} past={w === 'past'} />)}</ul>;
}

function MeetingItem({ m, past }: { m: any; past: boolean }) {
  const qc = useQueryClient(); const [link, setLink] = useState(''); const [re, setRe] = useState(''); const [open, setOpen] = useState(false);
  const act = useMutation({ mutationFn: (b: any) => post(`/api/meetings/${m._id}/respond`, b), onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['meetings'] }); qc.invalidateQueries({ queryKey: ['my-slots'] }); } });
  const isHost = m.myRole === 'host'; const s = STATUS[m.status];
  const other = isHost ? m.studentId?.fullName : `${m.hostId?.fullName}${m.hostId?.roles?.includes('counselor') ? ' (counselor)' : ''}`;
  const needLink = isHost && m.mode === 'online' && !m.link;
  return <li className="rounded-lg border p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{m.topic}</p>
      <p className="text-sm text-slate-700">{range(m.start, m.end)} · {MODE[m.mode]} · with {other}</p>
      {m.link && <p className="text-sm"><a className="text-brand-700 underline" href={m.link} target="_blank" rel="noopener noreferrer">Join online meeting</a></p>}
      {m.location && <p className="text-sm text-slate-700">Location: {m.location}</p>}{m.note && <p className="text-sm text-slate-700">Note: {m.note}</p>}</div>
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${s?.cls}`}>{s?.label ?? m.status}</span></div>
    {!past && <div className="mt-2 flex flex-wrap items-end gap-2">
      {isHost && m.status === 'pending' && <>{needLink && <div className="w-64"><Input label="Online link" type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} /></div>}
        <Button className="px-3 py-1 text-sm" disabled={needLink && !link} loading={act.isPending} onClick={() => act.mutate({ action: 'accept', ...(link ? { link } : {}) })}>Accept</Button></>}
      {!isHost && m.status === 'awaiting_student' && <Button className="px-3 py-1 text-sm" loading={act.isPending} onClick={() => act.mutate({ action: 'accept' })}>Accept new time</Button>}
      {(isHost ? ['pending', 'awaiting_student', 'confirmed'] : ['awaiting_student']).includes(m.status) && <Button variant="ghost" className="px-3 py-1 text-sm" onClick={() => act.mutate({ action: 'decline' })}>Decline</Button>}
      {isHost && ['pending', 'awaiting_student', 'confirmed'].includes(m.status) && <Button variant="ghost" className="px-3 py-1 text-sm" aria-expanded={open} onClick={() => setOpen(!open)}>Reschedule</Button>}
      {!isHost && ['pending', 'awaiting_student', 'confirmed'].includes(m.status) && <Button variant="danger" className="px-3 py-1 text-sm" onClick={() => act.mutate({ action: 'cancel' })}>Cancel</Button>}
      {open && <div className="flex items-end gap-2"><div className="w-56"><Input label="New time" type="datetime-local" value={re} onChange={(e) => setRe(e.target.value)} /></div>
        <Button className="px-3 py-1 text-sm" disabled={!re} onClick={() => act.mutate({ action: 'reschedule', start: toIso(re), ...(link ? { link } : {}) })}>Propose</Button></div>}
    </div>}
    {act.error && <div className="mt-2"><Alert>{act.error.message}</Alert></div>}
  </li>;
}
