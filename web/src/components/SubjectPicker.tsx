type Subj = { _id: string; name: string; category: 'core' | 'elective'; active?: boolean };
/** Two clear sections; students may pick any subjects (no combination or elective limits). */
export function SubjectPicker({ subjects, core, electives, onChange }: { subjects: Subj[]; core: string[]; electives: string[]; onChange: (core: string[], electives: string[]) => void }) {
  const list = (cat: 'core' | 'elective') => subjects.filter((s) => s.category === cat && s.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (arr: string[], id: string, on: boolean) => (on ? [...new Set([...arr, id])] : arr.filter((x) => x !== id));
  const section = (cat: 'core' | 'elective', title: string, sel: string[], set: (v: string[]) => void) => {
    const items = list(cat);
    return <fieldset className="rounded-lg border border-slate-200 p-3"><legend className="px-1 font-semibold">{title} <span className="text-sm font-normal text-slate-600">({sel.length} selected)</span></legend>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">{items.map((s) => <label key={s._id} className="flex items-center gap-2 rounded border p-2"><input type="checkbox" checked={sel.includes(s._id)} onChange={(e) => set(toggle(sel, s._id, e.target.checked))} />{s.name}</label>)}
        {!items.length && <p className="text-sm text-slate-600">None configured for this level.</p>}</div></fieldset>;
  };
  return <div className="space-y-4">
    <p className="text-sm text-slate-600">Choose any subjects you study. You can change them later from your profile.</p>
    {section('core', 'Core subjects', core, (v) => onChange(v, electives))}
    {section('elective', 'Elective subjects', electives, (v) => onChange(core, v))}
  </div>;
}
