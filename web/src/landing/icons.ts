import { Atom, BookOpen, Briefcase, Calculator, Cpu, FlaskConical, Globe2, Languages, Leaf, Music, Palette, Scale, Dumbbell, Wrench, Church, Landmark, type LucideIcon } from 'lucide-react';
/** Picks an icon and tint for a subject from its name (presentation only). */
const RULES: [RegExp, LucideIcon, string][] = [
  [/math/i, Calculator, 'bg-sky-50 text-sky-700'], [/physics|aviation|aerospace/i, Atom, 'bg-indigo-50 text-indigo-700'],
  [/chem|science|biomedical/i, FlaskConical, 'bg-emerald-50 text-emerald-700'], [/biolog|agric/i, Leaf, 'bg-lime-50 text-lime-800'],
  [/english|french|arabic|spanish|language|literature/i, Languages, 'bg-amber-50 text-amber-800'], [/social|geograph/i, Globe2, 'bg-violet-50 text-violet-700'],
  [/history|government/i, Landmark, 'bg-orange-50 text-orange-800'], [/econom|business|account|management/i, Briefcase, 'bg-teal-50 text-teal-800'],
  [/comput|ict|information|robot/i, Cpu, 'bg-cyan-50 text-cyan-800'], [/engineer|technolog|construction|manufactur|automotive|electr/i, Wrench, 'bg-slate-100 text-slate-700'],
  [/music|perform/i, Music, 'bg-pink-50 text-pink-700'], [/art|design|clothing|textile/i, Palette, 'bg-rose-50 text-rose-700'],
  [/physical|health/i, Dumbbell, 'bg-red-50 text-red-700'], [/relig|moral|christian|islam/i, Church, 'bg-yellow-50 text-yellow-800'], [/law|civic/i, Scale, 'bg-stone-100 text-stone-700'],
];
export function subjectLook(name: string): { icon: LucideIcon; tint: string } {
  const r = RULES.find(([rx]) => rx.test(name)); return r ? { icon: r[1], tint: r[2] } : { icon: BookOpen, tint: 'bg-navy-50 text-navy-800' };
}
