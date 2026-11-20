import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAGE_AUDIENCES, PAGE_AUDIENCE_LABELS, pageInputSchema } from '@ghlearn/shared/src/pages';
import { api, patch, post } from '../lib/api';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Markdown } from '../lib/markdown';

/** Admin → Public Website → Pages: help articles (published to the Help Centre) and legal drafts (never public here). */
export interface SitePage { id: string; slug: string; title: string; kind: 'help' | 'legal'; audience: (typeof PAGE_AUDIENCES)[number]; summary: string; body: string; order: number; status: 'draft' | 'published' | 'archived'; reviewNote: string; version: number; publishedAt: string | null; updatedAt: string }
const STATUS: Record<SitePage['status'], string> = { draft: 'Draft (not public)', published: 'Published', archived: 'Archived' };
const blank = { slug: '', title: '', kind: 'help' as const, audience: 'everyone' as const, summary: '', body: '', order: 100, reviewNote: '' };

export function PagesAdmin() {
  const qc = useQueryClient(); const [showArchived, setShowArchived] = useState(false); const [edit, setEdit] = useState<SitePage | 'new' | null>(null);
  const q = useQuery({ queryKey: ['/api/admin/website/pages', showArchived], queryFn: () => api<{ items: SitePage[] }>(`/api/admin/website/pages${showArchived ? '?archived=true' : ''}`).then((r) => r.items) });
  const act = useMutation({ mutationFn: ({ id, op }: { id: string; op: string }) => post(`/api/admin/website/pages/${id}/${op}`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/admin/website/pages'] }) });
  if (edit) return <PageEditor page={edit === 'new' ? null : edit} onDone={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['/api/admin/website/pages'] }); }} />;
  return <div className="space-y-4">
    <p className="max-w-3xl text-sm text-slate-600">Help articles appear in the public Help Centre once published. Legal pages are drafts only: after owner and legal review, paste the approved text into System Settings → Legal, which publishes and versions it. Pages are archived, never deleted.</p>
    <div className="flex flex-wrap items-center gap-3"><Button type="button" onClick={() => setEdit('new')}>New page</Button>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label></div>
    {act.error && <Alert>{(act.error as Error).message}</Alert>}
    {q.isLoading ? <Spinner /> : q.error ? <Alert>{(q.error as Error).message}</Alert> : !q.data!.length ? <Alert tone="info">No pages yet.</Alert> :
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-slate-600"><th className="py-2 pr-3">Title</th><th className="pr-3">Type</th><th className="pr-3">For</th><th className="pr-3">Status</th><th className="pr-3">Actions</th></tr></thead>
        <tbody>{q.data!.map((p) => <tr key={p.id} className="border-b align-top">
          <td className="py-2 pr-3"><div className="font-semibold">{p.title}</div><div className="text-xs text-slate-500">/{p.kind === 'help' ? `help/${p.slug}` : p.slug}{p.reviewNote ? ` · ${p.reviewNote}` : ''}</div></td>
          <td className="pr-3">{p.kind === 'help' ? 'Help article' : 'Legal draft'}</td><td className="pr-3">{PAGE_AUDIENCE_LABELS[p.audience]}</td><td className="pr-3">{STATUS[p.status]}</td>
          <td className="space-x-2 whitespace-nowrap pr-3">
            {p.status !== 'archived' && <Button type="button" variant="ghost" onClick={() => setEdit(p)}>Edit</Button>}
            {p.status === 'draft' && p.kind === 'help' && <Button type="button" variant="ghost" onClick={() => act.mutate({ id: p.id, op: 'publish' })}>Publish</Button>}
            {p.status === 'published' && <Button type="button" variant="ghost" onClick={() => act.mutate({ id: p.id, op: 'unpublish' })}>Unpublish</Button>}
            {p.status !== 'archived' ? <ConfirmButton variant="ghost" label="Archive" title={`Archive “${p.title}”?`} body="It is hidden from the Help Centre and this list. You can restore it later." confirmLabel="Archive" onConfirm={() => act.mutateAsync({ id: p.id, op: 'archive' })} />
              : <Button type="button" variant="ghost" onClick={() => act.mutate({ id: p.id, op: 'restore' })}>Restore</Button>}
          </td></tr>)}</tbody></table></div>}
  </div>;
}

function PageEditor({ page, onDone }: { page: SitePage | null; onDone: () => void }) {
  const [f, setF] = useState(() => (page ? { slug: page.slug, title: page.title, kind: page.kind, audience: page.audience, summary: page.summary, body: page.body, order: page.order, reviewNote: page.reviewNote } : blank));
  const [preview, setPreview] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => { const v = pageInputSchema.safeParse(f); if (!v.success) throw new Error(v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return page ? patch(`/api/admin/website/pages/${page.id}`, v.data) : post('/api/admin/website/pages', v.data); }, onSuccess: onDone, onError: (e: Error) => setErr(e.message) });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: k === 'order' ? Number(e.target.value) || 0 : e.target.value });
  return <Card className="space-y-4"><h2 className="text-lg font-bold">{page ? `Edit “${page.title}”` : 'New page'}</h2>
    {page?.status === 'published' && <Alert tone="info">This page is published. Saving updates the live Help Centre straight away.</Alert>}
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label="Title" value={f.title} onChange={set('title')} required maxLength={140} />
      <Input label="Address (slug)" hint="Lower-case letters, numbers and hyphens" value={f.slug} onChange={set('slug')} required maxLength={80} />
      <Select label="Type" value={f.kind} onChange={set('kind')} disabled={!!page}><option value="help">Help article</option><option value="legal">Legal draft</option></Select>
      <Select label="For" value={f.audience} onChange={set('audience')}>{PAGE_AUDIENCES.map((a) => <option key={a} value={a}>{PAGE_AUDIENCE_LABELS[a]}</option>)}</Select>
      <Input label="Summary" value={f.summary} onChange={set('summary')} maxLength={300} />
      <Input label="Order" type="number" min={0} max={999} value={String(f.order)} onChange={set('order')} />
      <Input label="Review note" hint="Shown to admins only" value={f.reviewNote} onChange={set('reviewNote')} maxLength={300} />
    </div>
    <div className="flex gap-2"><Button type="button" variant={preview ? 'ghost' : 'primary'} onClick={() => setPreview(false)} aria-pressed={!preview}>Write</Button><Button type="button" variant={preview ? 'primary' : 'ghost'} onClick={() => setPreview(true)} aria-pressed={preview}>Preview</Button></div>
    {preview ? <div className="rounded-lg border p-4"><Markdown source={f.body} /></div>
      : <label className="block text-sm font-medium">Body<span className="block text-xs font-normal text-slate-500">## Heading, ### Subheading, - list, 1. steps, &gt; note, **bold**, [link](/path). A blank line separates paragraphs.</span>
        <textarea className="mt-1 h-96 w-full rounded-lg border border-slate-300 p-3 font-mono text-sm" value={f.body} onChange={set('body')} maxLength={60000} /></label>}
    {err && <Alert>{err}</Alert>}
    <div className="flex gap-3"><Button type="button" loading={save.isPending} onClick={() => { setErr(null); save.mutate(); }}>{page ? 'Save' : 'Save as draft'}</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
  </Card>;
}
