import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../lib/api';
import { Alert, Button, Card, Spinner } from '../components/ui';
import { NotificationPreferences } from '../admin/insights';

export function NotificationsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications', 'all'], queryFn: () => api<any>('/api/notifications?limit=100') });
  const read = useMutation({ mutationFn: (b: any) => post('/api/notifications/read', b), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return <section className="space-y-4"><div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Notifications</h1><Button variant="ghost" disabled={!q.data?.unread} onClick={() => read.mutate({ all: true })}>Mark all read</Button></div>
    {q.isLoading ? <Spinner /> : q.error ? <Alert>{q.error.message}</Alert> : q.data.items.length ? <ul className="space-y-2">{q.data.items.map((n: any) => <li key={n._id}><Card className={n.readAt ? 'opacity-75' : 'border-brand-700'}>
      <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{!n.readAt && <span className="sr-only">Unread: </span>}{n.title}</p><span className="text-xs text-slate-500">{new Date(n.createdAt).toLocaleString()}</span></div>
      {n.body && <p className="text-sm">{n.body}</p>}<div className="mt-1 flex gap-3 text-sm">{n.link && <Link className="text-brand-700 underline" to={n.link} onClick={() => !n.readAt && read.mutate({ ids: [n._id] })}>Open</Link>}{!n.readAt && <button className="underline" onClick={() => read.mutate({ ids: [n._id] })}>Mark read</button>}</div></Card></li>)}</ul> : <Alert tone="info">No notifications.</Alert>}
  <Card><h2 className="mb-2 font-semibold">Notification preferences</h2><NotificationPreferences /></Card>
  </section>;
}
