import { mathTextToSpeech } from '../lib/mathSpeech';
import { socialToSpeech } from '../lib/socialSpeech';
import { useEffect, useState } from 'react';
import { Volume2, Square } from 'lucide-react';
/**
 * "Listen" voice tags using the browser's built-in speech synthesis (free, on-device; no audio is sent anywhere).
 * Prefers a British English (en-GB) voice at a slowed rate for learners; falls back to any English voice, and the
 * button is not shown at all where the browser has no speech synthesis. One utterance plays at a time.
 */
export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof (window as any).SpeechSynthesisUtterance === 'function';
let voicesCache: SpeechSynthesisVoice[] = [];
function pickVoice(): SpeechSynthesisVoice | undefined {
  if (!speechSupported()) return undefined; const vs = window.speechSynthesis.getVoices(); if (vs.length) voicesCache = vs;
  const v = voicesCache; return v.find((x) => /^en[-_]GB$/i.test(x.lang) && /google|natural|neural/i.test(x.name)) ?? v.find((x) => /^en[-_]GB$/i.test(x.lang)) ?? v.find((x) => /^en[-_](GH|NG|ZA|IE|AU)$/i.test(x.lang)) ?? v.find((x) => /^en\b/i.test(x.lang));
}
let current: { stop: () => void } | null = null; let session = 0;
/** Plain text for speech: markdown, formulas and symbols removed; long text is split into sentence-sized chunks (some engines stop after ~15 s). */
export function speakable(text: string) {
  return mathTextToSpeech(socialToSpeech(String(text ?? '').replace(/```[\s\S]*?```/g, ' '))).replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^\s*[-*+]\s+/gm, '').replace(/[*_`>|#]/g, ' ').replace(/\s+/g, ' ').trim();
}
const chunks = (t: string) => (t.match(/[^.!?;:]+[.!?;:]*/g) ?? [t]).reduce<string[]>((a, s) => { const l = a[a.length - 1]; if (l && (l + s).length < 220) a[a.length - 1] = l + s; else a.push(s.trim()); return a; }, []).filter(Boolean);
export function Listen({ text, label, word = false, rate }: { text: string; label: string; word?: boolean; rate?: number }) {
  const [on, setOn] = useState(false); const [ok, setOk] = useState(false);
  useEffect(() => { if (!speechSupported()) return; setOk(true); const h = () => pickVoice(); window.speechSynthesis.addEventListener?.('voiceschanged', h); h(); return () => { window.speechSynthesis.removeEventListener?.('voiceschanged', h); if (on) window.speechSynthesis.cancel(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ok) return null;
  const say = speakable(text); if (!say) return null;
  const stop = () => { session++; current = null; window.speechSynthesis.cancel(); setOn(false); };
  const start = () => {
    current?.stop(); const me = ++session; window.speechSynthesis.cancel(); const v = pickVoice(); const parts = word ? [say] : chunks(say); let i = 0;
    const next = () => { if (me !== session) return; if (i >= parts.length) { setOn(false); current = null; return; } const u = new SpeechSynthesisUtterance(parts[i++]); if (v) u.voice = v; u.lang = v?.lang ?? 'en-GB'; u.rate = rate ?? (word ? 0.75 : 0.9); u.pitch = 1;
      u.onend = next; u.onerror = () => { if (me === session) { setOn(false); current = null; } }; window.speechSynthesis.speak(u); };
    current = { stop: () => setOn(false) }; setOn(true); next();
  };
  const Icon = on ? Square : Volume2;
  return <button type="button" onClick={on ? stop : start} aria-pressed={on} aria-label={on ? `Stop reading ${label}` : word ? `Pronounce ${label}` : `Listen to ${label}`} title={on ? 'Stop' : word ? 'Pronounce' : 'Listen'}
    className={`inline-flex items-center gap-1 rounded-full border border-brand-700 text-brand-800 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${word ? 'h-7 w-7 justify-center align-middle' : 'px-2.5 py-1 text-sm'}`}>
    <Icon aria-hidden="true" className={word ? 'h-4 w-4' : 'h-4 w-4'} />{!word && <span>{on ? 'Stop' : 'Listen'}</span>}</button>;
}
/** Text read for a whole section: its notes plus the readable parts of its data (terms, examples, summary). */
export function sectionSpeech(s: any) {
  const d = s.data ?? {}; const out: string[] = [s.title ? `${s.title}.` : '', s.content ?? ''];
  for (const o of d.objectives ?? []) out.push(String(o));
  for (const c of d.concepts ?? []) out.push(`${c.name}. ${c.explanation}`);
  for (const t of d.terms ?? []) out.push(`${t.term}. ${t.definition}`);
  (d.examples ?? []).forEach((e: any, i: number) => out.push(`Example ${i + 1}. ${e.problem}. ${(e.steps ?? []).join('. ')}. Answer: ${e.answer}`));
  for (const m of d.mistakes ?? []) out.push(`Mistake: ${m.mistake}. Correction: ${m.correction}`);
  for (const g of d.diagrams ?? []) { const f = figureSpeech(g); if (f) out.push(f); }
  return out.filter(Boolean).join(' ');
}
/** Short spoken description of a figure: its title and caption, or the alt text when there is no caption. */
export function figureSpeech(g: any) {
  const t = String(g?.title ?? g?.spec?.title ?? '').trim(); const c = String(g?.caption ?? '').trim(); const a = String(g?.alt ?? '').trim();
  const body = c && c !== t ? c : a; return [t && `Figure: ${t}.`, body && (t ? body : `Figure: ${body}`)].filter(Boolean).join(' ');
}
