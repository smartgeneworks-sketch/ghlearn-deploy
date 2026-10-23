import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { GHANA_REGIONS } from '@ghlearn/shared';
import { api, post } from '../lib/api';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { SubjectPicker } from '../components/SubjectPicker';
type Item = { _id: string; name: string; [k: string]: any };
const list = (path: string, enabled = true) => ({ queryKey: [path], enabled, queryFn: () => api<{ items: Item[] }>(path).then((r) => r.items) });
const STEPS = ['Region & school', 'Level & Learning Area', 'Subjects', 'Review'];

export function OnboardingPage() {
  const nav = useNavigate(); const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [v, setV] = useState({ region: '', schoolName: '', levelId: '', yearOfStudy: 1, programmeId: '', coreSubjectIds: [] as string[], electiveSubjectIds: [] as string[] });
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const schools = useQuery(list('/api/config/schools'));
  const levels = useQuery(list('/api/config/levels'));
  const programmes = useQuery(list(`/api/config/programmes?levelId=${v.levelId}`, !!v.levelId));
  const subjects = useQuery(list(`/api/config/subjects?levelId=${v.levelId}`, !!v.levelId));
  const level = levels.data?.find((l) => l._id === v.levelId);
  // Pre-select the level's core subjects once they load (students may untick them); never overwrite a choice the student made.
  const prefilled = useRef('');
  useEffect(() => { if (v.levelId && subjects.data && prefilled.current !== v.levelId) { prefilled.current = v.levelId; set({ coreSubjectIds: subjects.data.filter((s) => s.category === 'core' && s.active).map((s) => s._id) }); } }, [v.levelId, subjects.data]);
  const usableLevels = (levels.data ?? []).filter((l) => l.enabled);
  const m = useMutation({ mutationFn: () => post('/api/onboarding', { ...v, programmeId: v.programmeId || undefined }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['me'] }); nav('/learn'); } });
  const picked = v.coreSubjectIds.length + v.electiveSubjectIds.length;
  const canNext = [!!(v.region && v.schoolName.trim().length >= 2), !!v.levelId, picked > 0, true][step];
  if (schools.isLoading || levels.isLoading) return <Spinner />;
  const name = (id: string) => subjects.data?.find((s) => s._id === id)?.name ?? id;
  const lname = programmes.data?.find((p) => p._id === v.programmeId)?.name;
  const chooseLevel = (levelId: string) => set({ levelId, programmeId: '', coreSubjectIds: [], electiveSubjectIds: [] });
  const next = () => setStep((s) => s + 1);
  return <div className="mx-auto max-w-2xl p-4">
    <h1 className="mb-2 text-2xl font-bold text-brand-900">Set up your learning space</h1>
    <ol className="mb-4 flex gap-2 text-sm" aria-label="Progress">{STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={`flex-1 rounded px-2 py-1 text-center ${i <= step ? 'bg-brand-700 text-white' : 'bg-slate-200'}`}>{i + 1}. {s}</li>)}</ol>
    <Card><AnimatePresence mode="wait"><motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.15 }} className="space-y-4">
      {step === 0 && <>
        <Select label="Region" required value={v.region} onChange={(e) => set({ region: e.target.value })}><option value="">Choose your region…</option>{GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}</Select>
        <Input label="School name" required list="school-suggestions" autoComplete="off" value={v.schoolName} onChange={(e) => set({ schoolName: e.target.value })} hint="Type the name of your school. If it is registered on GH Learn you will be linked to it automatically." />
        <datalist id="school-suggestions">{schools.data?.filter((s) => s.active).map((s) => <option key={s._id} value={s.name} />)}</datalist>
      </>}
      {step === 1 && <>
        <Select label="Level" value={v.levelId} onChange={(e) => chooseLevel(e.target.value)}><option value="">Choose…</option>{usableLevels.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select>
        <Select label="Year of study" value={v.yearOfStudy} onChange={(e) => set({ yearOfStudy: Number(e.target.value) })}>{Array.from({ length: level?.years ?? 3 }, (_, i) => <option key={i} value={i + 1}>Year {i + 1}</option>)}</Select>
        {!!programmes.data?.length && <Select label="Learning Area (optional)" value={v.programmeId} onChange={(e) => set({ programmeId: e.target.value })}><option value="">Not specified</option>{programmes.data.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</Select>}
      </>}
      {step === 2 && (subjects.isLoading ? <Spinner /> : <SubjectPicker subjects={(subjects.data ?? []) as any} core={v.coreSubjectIds} electives={v.electiveSubjectIds} onChange={(c, e) => set({ coreSubjectIds: c, electiveSubjectIds: e })} />)}
      {step === 3 && <dl className="grid grid-cols-3 gap-2 text-sm">
        <dt className="font-semibold">Region</dt><dd className="col-span-2">{v.region}</dd>
        <dt className="font-semibold">School</dt><dd className="col-span-2">{v.schoolName}</dd>
        <dt className="font-semibold">Level</dt><dd className="col-span-2">{level?.name}, Year {v.yearOfStudy}</dd>
        {lname && <><dt className="font-semibold">Learning Area</dt><dd className="col-span-2">{lname}</dd></>}
        <dt className="font-semibold">Core subjects</dt><dd className="col-span-2">{v.coreSubjectIds.map(name).join(', ') || 'None'}</dd>
        <dt className="font-semibold">Elective subjects</dt><dd className="col-span-2">{v.electiveSubjectIds.map(name).join(', ') || 'None'}</dd>
        <dd className="col-span-3"><Alert tone="info">You can change your subjects later from My profile.</Alert></dd>
      </dl>}
      {m.error && <Alert>{m.error.message}</Alert>}
    </motion.div></AnimatePresence>
    <div className="mt-6 flex justify-between">
      <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>Back</Button>
      {step < 3 ? <Button onClick={next} disabled={!canNext}>Next</Button> : <Button loading={m.isPending} onClick={() => m.mutate()}>Confirm</Button>}
    </div></Card></div>;
}
