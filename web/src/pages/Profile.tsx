import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GHANA_REGIONS } from '@ghlearn/shared';
import { api, patch } from '../lib/api';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { SubjectPicker } from '../components/SubjectPicker';

/** Student self-service profile: region, school name, year, Learning Area and subjects. */
export function ProfilePage() {
  const qc = useQueryClient();
  const p = useQuery({ queryKey: ['my-profile'], queryFn: () => api<{ profile: any }>('/api/me/profile').then((r) => r.profile) });
  const levelId = p.data?.levelId?._id;
  const subjects = useQuery({ queryKey: ['/api/config/subjects', levelId], enabled: !!levelId, queryFn: () => api<{ items: any[] }>(`/api/config/subjects?levelId=${levelId}`).then((r) => r.items) });
  const programmes = useQuery({ queryKey: ['/api/config/programmes', levelId], enabled: !!levelId, queryFn: () => api<{ items: any[] }>(`/api/config/programmes?levelId=${levelId}`).then((r) => r.items) });
  const [v, setV] = useState<any>(null);
  useEffect(() => { if (p.data && !v) { const s = p.data.subjectIds ?? []; setV({ region: p.data.region ?? '', schoolName: p.data.schoolName ?? p.data.schoolId?.name ?? '', yearOfStudy: p.data.yearOfStudy, programmeId: p.data.programmeId?._id ?? '',
    core: s.filter((x: any) => x.category === 'core').map((x: any) => x._id), electives: s.filter((x: any) => x.category === 'elective').map((x: any) => x._id) }); } }, [p.data, v]);
  const m = useMutation({ mutationFn: () => patch('/api/me/profile', { ...(v.region ? { region: v.region } : {}), schoolName: v.schoolName.trim(), yearOfStudy: v.yearOfStudy, programmeId: v.programmeId || null, coreSubjectIds: v.core, electiveSubjectIds: v.electives }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-profile'] }); qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['my-subjects'] }); qc.invalidateQueries({ queryKey: ['/api/me/subjects'] }); } });
  if (p.isLoading || !v) return p.error ? <Alert>{p.error.message}</Alert> : <Spinner />;
  const set = (x: any) => { m.reset(); setV({ ...v, ...x }); };
  return <section className="mx-auto max-w-3xl space-y-4">
    <h1 className="text-2xl font-bold">My profile</h1>
    <Card><div className="grid gap-3 sm:grid-cols-2">
      <Select label="Region" value={v.region} onChange={(e) => set({ region: e.target.value })}>{!v.region && <option value="">Choose your region…</option>}{GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}</Select>
      <Input label="School name" value={v.schoolName} onChange={(e) => set({ schoolName: e.target.value })} hint={p.data.schoolId ? `Linked to ${p.data.schoolId.name}` : 'Not linked to a registered school yet'} />
      <Select label="Year of study" value={v.yearOfStudy} onChange={(e) => set({ yearOfStudy: Number(e.target.value) })}>{Array.from({ length: p.data.levelId?.years ?? 3 }, (_, i) => <option key={i} value={i + 1}>Year {i + 1}</option>)}</Select>
      {!!programmes.data?.length && <Select label="Learning Area" value={v.programmeId} onChange={(e) => set({ programmeId: e.target.value })}><option value="">Not specified</option>{programmes.data.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select>}
    </div></Card>
    <Card>{subjects.isLoading ? <Spinner /> : <SubjectPicker subjects={subjects.data ?? []} core={v.core} electives={v.electives} onChange={(core, electives) => set({ core, electives })} />}</Card>
    {m.error && <Alert>{m.error.message}</Alert>}{m.isSuccess && <Alert tone="success">Profile saved. Your subjects are updated.</Alert>}
    <Button loading={m.isPending} disabled={!v.core.length && !v.electives.length || v.schoolName.trim().length < 2} onClick={() => m.mutate()}>Save profile</Button>
  </section>;
}
