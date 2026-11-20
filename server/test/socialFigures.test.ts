import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { validateDiagram, renderDiagram } from '../src/services/lessons/svg.js';
import { validateModule, isSocial, moduleSectionsFor } from '../src/services/lessons/modules.js';

export const specs: any[] = [
  { kind: 'history_timeline', title: 'Road to independence', events: [{ date: '1874', label: 'Gold Coast colony' }, { date: '1949', label: 'CPP formed' }, { date: '6th March 1957', label: 'Independence' }] },
  { kind: 'conceptmap', title: 'Ethics', centre: 'Ethics', branches: [{ label: 'Honesty' }, { label: 'Respect' }, { label: 'Responsibility' }] },
  { kind: 'causeeffect', title: 'Road accidents', causes: [{ label: 'Speeding' }, { label: 'Drunk driving' }], event: 'Road accidents', effects: [{ label: 'Injuries' }, { label: 'Loss of life' }] },
  { kind: 'orgchart', title: 'Road safety agencies', root: { label: 'Road safety' }, children: [{ label: 'NRSA' }, { label: 'DVLA' }, { label: 'MTTD', children: ['Police'] }] },
  { kind: 'comparison', title: 'Needs and wants', columns: ['Needs', 'Wants'], rows: [{ aspect: 'Meaning', values: ['Necessary for life', 'Not necessary'] }] },
  { kind: 'locationtable', title: 'Rivers', columns: ['Feature', 'Type'], rows: [['Nile', 'River'], ['Volta', 'River']] },
  { kind: 'scene', title: 'Crossing', setting: 'road crossing', parts: [{ name: 'zebra crossing' }, { name: 'pedestrian' }, { name: 'traffic light' }] },
];
const notes = (extra = '') => [{ key: 'C', content: `Gold Coast colony 1874. CPP formed 1949. Independence 6th March 1957. Ethics honesty respect responsibility. Speeding drunk driving road accidents injuries loss of life. Road safety NRSA DVLA MTTD police. Needs wants meaning necessary for life not necessary. Rivers Nile Volta river. Crossing zebra pedestrian traffic light. ${extra}` }];

describe('social studies figures', () => {
  it('validates and renders every kind', () => {
    mkdirSync('/tmp/ssfig', { recursive: true });
    specs.forEach((s, i) => { expect(validateDiagram(s), s.kind).toBeNull(); const svg = renderDiagram(s); expect(svg).toContain('<svg'); writeFileSync(`/tmp/ssfig/${i}-${s.kind}.svg`, svg); });
  });
  it('rejects out-of-order timelines and unknown scene parts', () => {
    expect(validateDiagram({ ...specs[0], events: [{ date: '1957', label: 'a' }, { date: '1874', label: 'b' }] })).toBeTruthy();
    expect(validateDiagram({ ...specs[6], parts: [{ name: 'spaceship' }, { name: 'pedestrian' }] })).toBeTruthy();
  });
  it('grounds labels, dates and numbers', () => {
    const F = (spec: any) => ({ key: 'F', data: { diagrams: [{ spec, alt: 'Timeline of events', caption: 'Events in order.' }] } });
    const ok = validateModule([...notes(), F(specs[0])], [], { social: true });
    expect(ok.errors.filter((e: string) => e.startsWith('F.'))).toEqual([]);
    const bad = validateModule([...notes(), F({ ...specs[0], events: [...specs[0].events, { date: '1960', label: 'Republic' }] })], [], { social: true });
    expect(bad.errors.some((e: string) => /1960/.test(e))).toBe(true);
    expect(isSocial({ name: 'Social Studies' })).toBe(true);
    expect(moduleSectionsFor(false, false, true).find((s: any) => s.key === 'F')?.guide).toMatch(/maps are NOT drawn/);
  });
});
describe('social normalisation', () => {
  it('moves an aspect heading out of comparison columns', async () => {
    const { prepareDiagram } = await import('../src/services/lessons/generator.js');
    const r = prepareDiagram({ spec: { kind: 'comparison', title: 'T', columns: ['Route', 'Exports', 'Imports'], rows: [{ aspect: 'Trans-Saharan', values: ['Gold', 'Salt'] }] }, alt: 'a', caption: 'c' });
    expect(r.error).toBeUndefined(); expect(r.spec.columns).toEqual(['Exports', 'Imports']);
    expect(validateDiagram({ kind: 'scene', title: 'S', setting: 'road crossing', parts: [{ name: 'stop line' }, { name: 'pedestrian' }] })).toBeNull();
  });
});
describe('road-crossing scene', () => {
  it('draws leader lines that do not cross', async () => {
    const parts = ['road', 'zebra crossing', 'stop lines', 'road sign', 'speed bump', 'pedestrian', 'vehicle'].map((name) => ({ name, note: 'A short note' }));
    const r: any = (renderDiagram as any)({ kind: 'scene', title: 'S', setting: 'road crossing', parts }); const svg: string = typeof r === 'string' ? r : r.svg;
    const segs = [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#0f172a" stroke-width="1.4"/g)].map((m) => m.slice(1, 5).map(Number));
    expect(segs.length).toBe(parts.length);
    const cross = (a: number[], b: number[]) => { const d = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      const [p1, p2, p3, p4] = [[a[0], a[1]], [a[2], a[3]], [b[0], b[1]], [b[2], b[3]]]; return d(p3, p4, p1) * d(p3, p4, p2) < 0 && d(p1, p2, p3) * d(p1, p2, p4) < 0; };
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) expect(cross(segs[i], segs[j])).toBe(false);
    // No leader line runs through another labelled part (passes within 12px of its anchor).
    const dist = (s: number[], x: number, y: number) => { const [ax, ay, bx, by] = s; const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2))); return Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y); };
    for (const s of segs) for (const o of segs) if (o !== s) expect(dist(s, o[2], o[3])).toBeGreaterThan(12);
  });
});
