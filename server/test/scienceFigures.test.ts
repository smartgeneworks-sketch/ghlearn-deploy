import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { validateDiagram, renderDiagram } from '../src/services/lessons/svg.js';
import { prepareDiagram } from '../src/services/lessons/generator.js';
import { validateModule, isScience, moduleSectionsFor } from '../src/services/lessons/modules.js';

const cell = { kind: 'structure', title: 'Plant cell', subject: 'plant cell', parts: [{ name: 'Cell wall' }, { name: 'Cell membrane' }, { name: 'Nucleus' }, { name: 'Vacuole' }, { name: 'Chloroplasts' }, { name: 'Cytoplasm' }] };
const circuit = { kind: 'circuit', title: 'Simple circuit', components: [{ type: 'cell' }, { type: 'switch_closed' }, { type: 'lamp' }, { type: 'ammeter' }], parallel: [{ type: 'voltmeter', across: 2 }] };
const web = { kind: 'foodweb', title: 'Food chain', organisms: [{ name: 'Grass', role: 'producer' }, { name: 'Grasshopper', role: 'primary consumer' }, { name: 'Lizard', role: 'secondary consumer' }, { name: 'Hawk', role: 'tertiary consumer' }],
  links: [{ from: 'Grass', to: 'Grasshopper' }, { from: 'Grasshopper', to: 'Lizard' }, { from: 'Lizard', to: 'Hawk' }] };
export const specs: any[] = [cell, circuit, web,
  { kind: 'structure', title: 'Animal cell', subject: 'animal cell', parts: [{ name: 'cell membrane' }, { name: 'nucleus' }, { name: 'mitochondria' }, { name: 'cytoplasm' }] },
  { kind: 'structure', title: 'Flowering plant', subject: 'flowering plant', parts: [{ name: 'flower' }, { name: 'leaves' }, { name: 'stem' }, { name: 'roots' }] },
  { kind: 'structure', title: 'Heating water', subject: 'apparatus', parts: [{ name: 'Beaker', note: 'holds the water' }, { name: 'Tripod stand' }, { name: 'Thermometer' }] },
  { kind: 'cyclediagram', title: 'Water cycle', stages: [{ label: 'Water in seas' }, { label: 'Water vapour' }, { label: 'Clouds' }, { label: 'Rain' }], processes: ['evaporation', 'condensation', 'precipitation', 'run-off'] },
  { kind: 'process', title: 'Photosynthesis', inputs: ['carbon dioxide', 'water'], steps: [{ label: 'Light absorbed by chlorophyll' }, { label: 'Glucose made' }], outputs: ['glucose', 'oxygen'] },
  { kind: 'datagraph', title: 'Cooling', type: 'line', x: { label: 'Time', unit: 'min' }, y: { label: 'Temperature', unit: '°C' }, points: [{ x: 0, y: 80 }, { x: 2, y: 64 }, { x: 4, y: 52 }] },
  { kind: 'datagraph', title: 'Germination', type: 'bar', x: { label: 'Condition' }, y: { label: 'Seeds germinated', unit: '' }, points: [{ x: 'Wet', y: 9 }, { x: 'Dry', y: 0 }] },
  { kind: 'datatable', title: 'Results', columns: [{ label: 'Time', unit: 'min' }, { label: 'Temperature', unit: '°C' }], rows: [[0, 80], [2, 64]] }];

describe('Science figures', () => {
  it('validate and render as safe accessible SVG', () => {
    mkdirSync('/tmp/scifig', { recursive: true });
    for (const s of specs) { expect(validateDiagram(s), s.kind).toBeNull(); const svg = renderDiagram(s); expect(svg.startsWith('<svg')).toBe(true); expect(svg).toContain('role="img"'); expect(svg).not.toMatch(/NaN|undefined|Infinity|<script/); writeFileSync(`/tmp/scifig/${s.title.replace(/\W+/g, '_')}.svg`, svg); }
  });
  it('rejects scientifically wrong specs', () => {
    expect(validateDiagram({ ...cell, subject: 'animal cell' })).toMatch(/Cell wall.*not parts? of a animal cell/);
    expect(validateDiagram({ ...circuit, components: [{ type: 'lamp' }, { type: 'switch_open' }] })).toMatch(/cell or battery/);
    expect(validateDiagram({ ...circuit, components: [{ type: 'cell' }, { type: 'voltmeter' }] })).toMatch(/parallel/);
    expect(validateDiagram({ ...circuit, parallel: [{ type: 'ammeter', across: 1 }] })).toMatch(/ammeter goes in series/);
    expect(validateDiagram({ ...circuit, components: [{ type: 'cell' }, { type: 'transistorx' }] })).toMatch(/unknown component/);
    expect(validateDiagram({ ...web, links: [{ from: 'Hawk', to: 'Lizard' }, ...web.links] })).toMatch(/food to the feeder/);
    expect(validateDiagram({ ...web, links: [{ from: 'Grasshopper', to: 'Grass' }] })).toMatch(/producer/);
    expect(validateDiagram({ ...web, links: web.links.slice(0, 2) })).toMatch(/Hawk is a consumer but nothing feeds it/);
    expect(validateDiagram({ kind: 'datagraph', title: 't', type: 'line', x: { label: 'Time', unit: 's' }, y: { label: 'Distance' }, points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] })).toMatch(/y.unit/);
    expect(validateDiagram({ kind: 'datagraph', title: 't', type: 'line', x: { label: 'Time', unit: 's' }, y: { label: 'D', unit: 'm' }, points: [{ x: 2, y: 1 }, { x: 1, y: 2 }] })).toMatch(/increase/);
    expect(validateDiagram({ kind: 'cyclediagram', title: 't', stages: [{ label: 'a' }, { label: 'b' }, { label: 'c' }], processes: ['x'] })).toMatch(/one arrow label .* per stage/);
  });
  it('escapes text and describes figures for screen readers and voice', () => {
    const svg = renderDiagram({ ...cell, subject: 'apparatus', parts: [{ name: 'Beaker <b>' }, { name: 'Tripod' }] } as any); expect(svg).toContain('&lt;b&gt;'); expect(svg).not.toContain('<b>');
    expect(prepareDiagram({ ...circuit, alt: undefined }).alt).toMatch(/cell, switch \(closed\), lamp, ammeter in series, and voltmeter across lamp/);
    expect(prepareDiagram(web).alt).toMatch(/Grass is eaten by Grasshopper/);
  });
  it('detects the subject and uses science guides', () => {
    expect(isScience({ code: 'S-GENSCI', name: 'General Science' })).toBe(true); expect(isScience({ code: 'S-AGRIC', name: 'Agricultural Science' })).toBe(false);
    const F = moduleSectionsFor(false, true).find((s) => s.key === 'F')!; expect(F.guide).toMatch(/circuit/); expect(F.guide).toMatch(/never invent readings/);
  });
  it('grounds figure labels and data in the notes or the learner manual', () => {
    const base = (diagrams: any[]) => [{ key: 'C', content: 'A plant cell has a cell wall, cell membrane, nucleus, vacuole, chloroplasts and cytoplasm. The water cooled from 80 °C to 64 °C in 2 min.', citations: [{}] }, { key: 'F', data: { diagrams } }];
    const ps = [{ chunkId: 'c', text: 'Temperature readings: time 0, 2 minutes.' }] as any;
    const ok = validateModule(base([prepareDiagram({ ...cell, alt: 'a', caption: 'c' }), prepareDiagram({ ...specs[10], alt: 'a', caption: 'c' })]), ps, { science: true });
    expect(ok.errors.filter((e) => e.startsWith('F.'))).toEqual([]); expect(ok.checks.find((c) => c.id === 'science_grounding')?.ok).toBe(true);
    const bad = validateModule(base([prepareDiagram({ ...cell, parts: [...cell.parts, { name: 'Ribosome' }], alt: 'a', caption: 'c' }), prepareDiagram({ ...specs[10], rows: [[0, 81]], alt: 'a', caption: 'c' })]), ps, { science: true });
    expect(bad.errors.join('\n')).toMatch(/"Ribosome" is not in the notes/); expect(bad.errors.join('\n')).toMatch(/data value\(s\) 81 not in the notes/);
    expect(bad.checks.find((c) => c.id === 'science_grounding')?.ok).toBe(false);
  });
});
describe('Science grounding details', () => {
  it('accepts word forms and standard component names, rejects new terms', () => {
    const sec = [{ key: 'C', content: 'Scientists collect data and do analysis. A conductivity test uses a battery and a lamp.', citations: [{}] }];
    const v = (d: any) => validateModule([...sec, { key: 'F', data: { diagrams: [prepareDiagram({ ...d, alt: 'a', caption: 'c' })] } }], [{ chunkId: 'c', text: '' }] as any, { science: true }).errors.filter((e) => e.startsWith('F.'));
    expect(v({ kind: 'process', title: 't', steps: [{ label: 'Collect data' }, { label: 'Analyse data' }], outputs: ['Copper sulphate'] })).toEqual(['F.1: "Copper sulphate" is not in the notes or the learner manual']);
    // A longer output describes a result: a warning, not an error.
    expect(v({ kind: 'process', title: 't', steps: [{ label: 'Collect data' }, { label: 'Analyse data' }], outputs: ['Everyday applications in construction and wiring'] })).toEqual([]);
    expect(v({ kind: 'process', title: 't', steps: [{ label: 'Collect empirical data' }, { label: 'Analyse data' }] })).toEqual([]);
    expect(v({ kind: 'circuit', title: 't', components: [{ type: 'battery', label: 'Battery' }, { type: 'switch_closed', label: 'Switch' }, { type: 'lamp', label: 'Lamp' }] })).toEqual([]);
    expect(v({ kind: 'circuit', title: 't', components: [{ type: 'battery' }, { type: 'switch_open', label: 'Nichrome probe' }] })).toHaveLength(1);
  });
  it('wraps long process inputs and step labels inside their boxes (live check 2026-10-23)', () => {
    const svg = renderDiagram({ kind: 'process', title: 'Solar oven', inputs: ['Cardboard Box', 'Aluminium Foil', 'Plastic Wrap', 'Black Paper'], steps: [{ label: 'Seal the opening with plastic wrap and tape every edge firmly' }, { label: 'Cut flap' }] } as any);
    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(texts.some((s) => s.startsWith('In: '))).toBe(true);
    for (const s of texts) expect(s.length).toBeLessThanOrEqual(50);
  });
  it('draws flower parts on a half-flower and never cuts text silently (Y1 S2 lessons)', () => {
    const v = (d: any) => validateDiagram(d);
    const flower = { kind: 'structure', title: 'Parts of a flower', subject: 'flowering plant', parts: [{ name: 'Sepals' }, { name: 'Petals' }, { name: 'Anthers' }, { name: 'Filament' }, { name: 'Stigma' }, { name: 'Ovary', note: 'Holds ovules which develop into seeds after fertilisation in the flowering plant, then ripens into fruit' }] };
    expect(v(flower)).toBeNull();
    expect(v({ ...flower, parts: [{ name: 'Sepal' }, { name: 'Wing' }] })).toMatch(/Wing are not parts/);
    const svg = renderDiagram(flower as any); expect(svg).toContain('Anthers'); expect(svg).toMatch(/…|fruit/);
    expect(v({ kind: 'cyclediagram', title: 'c', stages: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], processes: ['Lining breakdown if unfertilised', '', ''] })).toBeNull();
  });
});

describe('circuit test gap and flower style', () => {
  it('draws a labelled test gap and a style leader to the ovary body', async () => {
    const m: any = { prepareDiagram };
    const c = m.prepareDiagram({ spec: { kind: 'circuit', title: 'Conductivity', components: [{ type: 'battery' }, { type: 'led' }, { type: 'test gap' }] } });
    expect(c.svg ?? JSON.stringify(c)).toContain('Test material');
    const fl = m.prepareDiagram({ spec: { kind: 'structure', title: 'Flower', subject: 'flowering plant', parts: [{ name: 'Style' }, { name: 'Ovary' }, { name: 'Stigma' }] } });
    expect(JSON.stringify(fl)).toContain('Style');
  });
});
