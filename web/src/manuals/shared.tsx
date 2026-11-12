import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as S from '@ghlearn/shared';
import { FileUp, X } from 'lucide-react';
import { api, post, sha256Hex, uploadWithProgress, HttpError } from '../lib/api';
import { Alert, Button } from '../components/ui';
import { Badge } from '../admin/common';

export const useSubjects = () => useQuery({ queryKey: ['/api/config/subjects', ''], queryFn: () => api<{ items: any[] }>('/api/config/subjects').then((r) => r.items) });
export const useLevels = () => useQuery({ queryKey: ['/api/config/levels', ''], queryFn: () => api<{ items: any[] }>('/api/config/levels').then((r) => r.items) });
export const useProgrammes = () => useQuery({ queryKey: ['/api/config/programmes', ''], queryFn: () => api<{ items: any[] }>('/api/config/programmes').then((r) => r.items) });
/** Curriculum versions that can take new links (draft or active), plus `keep` so an existing link still shows. */
export const useVersions = () => useQuery({ queryKey: ['cur-versions-all'], queryFn: () => api<{ items: any[] }>('/api/curriculum/versions?pageSize=200').then((r) => r.items) });
export const useUploadLimits = (enabled: boolean) => useQuery({ queryKey: ['upload-limits'], enabled, queryFn: () => api<{ maxMB: number; quotaMB: number; leftMB: number; formats: typeof S.MANUAL_FORMATS }>('/api/documents/upload-limits') });

export const PROC_TONE: Record<string, string> = { indexed: 'active', failed: 'failed', not_processed: 'archived', queued: 'pending' };
export const RUNNING = ['queued', 'extracting', 'ocr', 'structuring', 'chunking', 'embedding'];
export const ProcBadge = ({ v }: { v: string }) => <Badge v={PROC_TONE[v] ?? 'pending'} label={`processing: ${v.replace(/_/g, ' ')}`} />;
export const ApprovalBadge = ({ v }: { v: string }) => <Badge v={v === 'verified_official' ? 'active' : v === 'rejected' ? 'failed' : 'suspended'} label={v === 'verified_official' ? 'approved: verified official' : v === 'rejected' ? 'approval: rejected' : 'approval: unverified'} />;
export const OcrBadge = ({ v }: { v?: string | null }) => (v && v !== 'not_needed' ? <Badge v={v === 'done' ? 'active' : 'suspended'} label={(S.OCR_STATUS_LABELS as any)[v] ?? v} /> : null);
export const LicBadge = ({ v }: { v?: string }) => <Badge v={(S.DOWNLOADABLE_LICENSING as readonly string[]).includes(v ?? '') ? 'committed' : 'x'} label={`licence: ${(S.LICENSING_LABELS as any)[v ?? 'unknown'] ?? v}`} />;
export const fmtBytes = (n?: number) => (n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const ACCEPT = S.MANUAL_KINDS.flatMap((k) => [...S.MANUAL_FORMATS[k].ext, ...S.MANUAL_FORMATS[k].mimes.filter((m) => m !== 'text/plain' || k === 'txt')]).join(',');

/** Client-side checks mirror the server (which re-checks the bytes). */
export function checkFile(f: File, maxMB: number): string | null {
  const kind = S.manualKindOf(f.name);
  if (!kind) return `"${f.name}" is not a supported format. Use PDF, DOCX, TXT or CSV.`;
  if (f.type && !(S.MANUAL_FORMATS[kind].mimes as readonly string[]).includes(f.type) && f.type !== 'application/octet-stream') return `The file type (${f.type}) does not match a ${S.MANUAL_FORMATS[kind].label} file.`;
  if (f.size === 0) return 'The file is empty.';
  if (f.size > maxMB * 1048576) return `The file is ${fmtBytes(f.size)}; the maximum is ${maxMB} MB.`;
  return null;
}

/** Drag-and-drop zone around a real, labelled file input (keyboard and screen-reader accessible). */
export function DropZone({ id, label, file, onFile, disabled }: { id: string; label: string; file: File | null; onFile: (f: File | null) => void; disabled?: boolean }) {
  const [over, setOver] = useState(false); const input = useRef<HTMLInputElement>(null);
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (disabled) return; const f = e.dataTransfer.files?.[0]; if (f) onFile(f); };
  return <div onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop} data-testid={`${id}-zone`}
    className={`rounded-xl border-2 border-dashed p-4 text-sm ${over ? 'border-brand-600 bg-brand-50' : 'border-slate-300 bg-slate-50'}`}>
    <div className="flex flex-wrap items-center gap-3"><FileUp className="h-6 w-6 text-slate-500" aria-hidden />
      <div className="flex-1"><label htmlFor={id} className="block font-medium">{label}</label>
        <p className="text-slate-600">Drag a file here, or choose one.</p>
        <input ref={input} id={id} type="file" accept={ACCEPT} disabled={disabled} className="mt-1 text-sm" onChange={(e) => onFile(e.target.files?.[0] ?? null)} /></div>
      {file && <Button type="button" variant="ghost" className="px-2 py-1 text-xs" disabled={disabled} onClick={() => { onFile(null); if (input.current) input.current.value = ''; }}><X className="h-3 w-3" aria-hidden />Clear file</Button>}</div>
    {file && <p className="mt-2 text-slate-700">Selected: <strong>{file.name}</strong> ({fmtBytes(file.size)})</p>}
  </div>;
}

export function Progress({ sent, total, label }: { sent: number; total: number; label: string }) {
  const pct = total ? Math.round((sent / total) * 100) : 0;
  return <div className="space-y-1"><div className="flex justify-between text-sm"><span id="up-progress-label">{label}</span><span>{pct}% · {fmtBytes(sent)} of {fmtBytes(total)}</span></div>
    <div role="progressbar" aria-labelledby="up-progress-label" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 rounded bg-slate-200"><div className="h-2 rounded bg-brand-600 transition-all" style={{ width: `${pct}%` }} /></div></div>;
}

/**
 * File selection + duplicate pre-check (browser SHA-256 + server lookup) + XHR upload with real progress.
 * The server repeats every check (type sniffing, size, quota, SHA-256 duplicate).
 */
export function useManualUpload(maxMB: number) {
  const [file, setFileRaw] = useState<File | null>(null); const [problem, setProblem] = useState<string | null>(null);
  const [dup, setDup] = useState<{ id: string; title: string } | null>(null); const [hashing, setHashing] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null); const [error, setError] = useState<HttpError | Error | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const setFile = async (f: File | null) => {
    setFileRaw(f); setDup(null); setError(null); setProblem(f ? checkFile(f, maxMB) : null);
    if (!f || checkFile(f, maxMB)) return;
    setHashing(true);
    try { const sha = await sha256Hex(f); if (sha) { const r = await post<{ duplicate: { id: string; title: string } | null }>('/api/documents/check-duplicate', { sha256: sha }); setDup(r.duplicate); } }
    catch { /* the server checks again on upload */ } finally { setHashing(false); }
  };
  const send = async <T,>(path: string, fields: Record<string, string | undefined>): Promise<T | null> => {
    if (!file) return null; setError(null); setProgress({ sent: 0, total: file.size });
    const form = new FormData(); for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') form.append(k, v); form.append('file', file);
    const u = uploadWithProgress<T>(path, form, (sent, total) => setProgress({ sent, total })); abortRef.current = u.abort;
    try { const r = await u.promise; setFileRaw(null); setDup(null); return r; }
    catch (e: any) { if (e instanceof HttpError && e.code === 'DUPLICATE_DOCUMENT') setDup({ id: (e.details as any)?.existingId, title: '' }); if (e?.code !== 'ABORTED') setError(e); return null; }
    finally { setProgress(null); abortRef.current = null; }
  };
  return { file, setFile, problem, dup, hashing, progress, error, send, cancel: () => abortRef.current?.(), reset: () => { setFileRaw(null); setDup(null); setError(null); setProblem(null); } };
}
export const UploadError = ({ e }: { e: any }) => (e ? <Alert>{e.message}{e.code === 'STORAGE_QUOTA' ? ' Archive or remove old uploads, or configure external storage.' : ''}</Alert> : null);

/** §9 metadata as editable strings (controlled), shared by the upload form and the detail page. */
export type MetaForm = Record<'title' | 'subjectId' | 'levelId' | 'programmeId' | 'yearOfStudy' | 'curriculumVersionId' | 'docType' | 'audience' | 'publisher' | 'sourceUrl' | 'publicationYear' | 'language' | 'documentVersion' | 'licensingStatus' | 'tags', string>;
export const emptyMeta = (): MetaForm => ({ title: '', subjectId: '', levelId: '', programmeId: '', yearOfStudy: '', curriculumVersionId: '', docType: 'learner_manual', audience: 'learner', publisher: '', sourceUrl: '', publicationYear: '', language: 'en', documentVersion: '', licensingStatus: 'unknown', tags: '' });
export const metaFromDoc = (d: any): MetaForm => ({
  title: d.title ?? '', subjectId: d.subjectId?._id ?? d.subjectId ?? '', levelId: d.levelId?._id ?? d.levelId ?? '', programmeId: d.programmeId?._id ?? d.programmeId ?? '', yearOfStudy: d.yearOfStudy ? String(d.yearOfStudy) : '',
  curriculumVersionId: d.curriculumVersionId?._id ?? d.curriculumVersionId ?? '', docType: d.docType ?? 'other', audience: d.audience ?? 'unknown', publisher: d.publisher ?? d.provenance?.publisher ?? '', sourceUrl: d.sourceUrl ?? d.provenance?.sourceUrl ?? '',
  publicationYear: d.publicationYear ? String(d.publicationYear) : '', language: d.language ?? 'en', documentVersion: d.documentVersion ?? '', licensingStatus: d.licensingStatus ?? 'unknown', tags: (d.tags ?? []).join(', ') });
/** JSON patch body (blank = cleared/null for references). */
export const metaToJson = (m: MetaForm) => ({
  title: m.title.trim(), subjectId: m.subjectId || null, levelId: m.levelId || null, programmeId: m.programmeId || null, yearOfStudy: m.yearOfStudy ? Number(m.yearOfStudy) : null,
  curriculumVersionId: m.curriculumVersionId || null, docType: m.docType, audience: m.audience, publisher: m.publisher.trim(), sourceUrl: m.sourceUrl.trim(),
  publicationYear: m.publicationYear ? Number(m.publicationYear) : null, language: m.language.trim() || 'en', documentVersion: m.documentVersion.trim(), licensingStatus: m.licensingStatus,
  tags: m.tags.split(',').map((t) => t.trim()).filter(Boolean) });
/** Multipart fields for an upload (blank fields are omitted so server defaults apply). */
export const metaToFields = (m: MetaForm): Record<string, string> => Object.fromEntries(Object.entries(m).filter(([, v]) => v.trim() !== ''));

export function MetaFields({ m, set, disabled, compact, keepVersionId }: { m: MetaForm; set: (m: MetaForm) => void; disabled?: boolean; compact?: boolean; keepVersionId?: string }) {
  const subjects = useSubjects(); const levels = useLevels(); const programmes = useProgrammes(); const versions = useVersions();
  const f = (k: keyof MetaForm) => ({ value: m[k], disabled, onChange: (e: { target: { value: string } }) => set({ ...m, [k]: e.target.value }) });
  const vOpts = (versions.data ?? []).filter((v) => v.status !== 'archived' || v._id === keepVersionId);
  const yearOk = !m.publicationYear || (/^\d{4}$/.test(m.publicationYear) && +m.publicationYear >= 1950 && +m.publicationYear <= 2100);
  const urlOk = !m.sourceUrl || /^https?:\/\/\S+$/i.test(m.sourceUrl.trim());
  const L = ({ k, label, children }: { k: keyof MetaForm; label: string; children: ReactNode }) => <label className="block space-y-1 text-sm"><span className="block font-medium">{label}</span>
    <select {...f(k)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{children}</select></label>;
  const T = ({ k, label, type = 'text', err, hint }: { k: keyof MetaForm; label: string; type?: string; err?: string | false; hint?: string }) => <label className="block space-y-1 text-sm"><span className="block font-medium">{label}</span>
    <input type={type} {...f(k)} aria-invalid={!!err} className={`w-full rounded-lg border px-3 py-2 ${err ? 'border-red-600' : 'border-slate-300'}`} />{hint && !err && <span className="block text-xs text-slate-500">{hint}</span>}{err && <span role="alert" className="block text-red-700">{err}</span>}</label>;
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {T({ k: 'title', label: compact ? 'Title (optional)' : 'Title', err: !compact && m.title.trim().length < 3 && 'At least 3 characters' })}
    {L({ k: 'subjectId', label: compact ? 'Subject (optional)' : 'Subject', children: <><option value="">Not mapped yet</option>{subjects.data?.map((s) => <option key={s._id} value={s._id}>{s.name} ({s.code})</option>)}</> })}
    {L({ k: 'curriculumVersionId', label: 'Curriculum version', children: <><option value="">None</option>{vOpts.map((v) => <option key={v._id} value={v._id}>{v.code} · {v.name}{v.status !== 'active' ? ` (${v.status})` : ''}</option>)}</> })}
    {L({ k: 'docType', label: 'Document type', children: S.DOC_TYPES.map((t) => <option key={t} value={t}>{S.DOC_TYPE_LABELS[t]}</option>) })}
    {L({ k: 'licensingStatus', label: 'Licensing status', children: S.LICENSING_STATUSES.map((t) => <option key={t} value={t}>{S.LICENSING_LABELS[t]}</option>) })}
    {L({ k: 'levelId', label: 'Level', children: <><option value="">Any</option>{levels.data?.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</> })}
    {L({ k: 'programmeId', label: S.LEARNING_AREA, children: <><option value="">Any</option>{programmes.data?.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</> })}
    {L({ k: 'yearOfStudy', label: 'Class / year of study', children: <><option value="">Any</option>{[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>Year {y}</option>)}</> })}
    {L({ k: 'audience', label: 'Audience', children: ['learner', 'teacher', 'both', 'unknown'].map((t) => <option key={t} value={t}>{t}</option>) })}
    {T({ k: 'publisher', label: 'Source / publisher' })}
    {T({ k: 'sourceUrl', label: 'Source URL', type: 'url', err: !urlOk && 'Use a full http(s) address' })}
    {T({ k: 'publicationYear', label: 'Publication year', type: 'number', err: !yearOk && 'A year between 1950 and 2100' })}
    {T({ k: 'language', label: 'Language', hint: 'e.g. en, tw, ee' })}
    {T({ k: 'documentVersion', label: 'Document version', hint: 'Edition or revision, e.g. 2.1' })}
    {T({ k: 'tags', label: 'Tags', hint: 'Comma-separated' })}
  </div>;
}
export const metaValid = (m: MetaForm, requireTitle: boolean) => (!requireTitle || m.title.trim().length >= 3) && (!m.title.trim() || m.title.trim().length >= 3)
  && (!m.publicationYear || (/^\d{4}$/.test(m.publicationYear) && +m.publicationYear >= 1950 && +m.publicationYear <= 2100)) && (!m.sourceUrl || /^https?:\/\/\S+$/i.test(m.sourceUrl.trim()));
