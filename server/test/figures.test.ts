import { describe, it, expect } from 'vitest';
import { prepareDiagram } from '../src/services/lessons/generator.js';
import { validateModule } from '../src/services/lessons/modules.js';

const ok = (s: any) => { const r: any = prepareDiagram({ caption: 'c', ...s }); expect(r.error).toBeUndefined(); expect(r.svg).toMatch(/^<svg[^>]+style="max-width:100%;height:auto"[^>]+role="img"/); expect(r.svg).not.toMatch(/NaN|undefined|<script/); expect(r.alt.length).toBeGreaterThan(10); return r; };
const bad = (s: any, re: RegExp) => expect((prepareDiagram(s) as any).error).toMatch(re);

describe('lesson figures (code-drawn SVG)', () => {
  it('renders every figure kind with alt text', () => {
    ok({ kind: 'angle', title: 'Straight line', degrees: 180, parts: [{ degrees: 60 }, { degrees: null, label: 'x' }] });
    ok({ kind: 'angle', title: 'Right', degrees: 90 }); ok({ kind: 'angle', title: 'Reflex', degrees: 250 });
    expect(ok({ kind: 'polygon', title: 'T', vertices: ['A', 'B', 'C'], sides: ['6 cm', '8 cm', '10 cm'], rightAngles: ['B'] }).alt).toMatch(/AB = 6 cm.*right angle at B/);
    for (const shape of ['rectangle', 'square', 'parallelogram', 'rhombus', 'trapezium', 'kite']) ok({ kind: 'polygon', title: shape, shape, vertices: ['A', 'B', 'C', 'D'], sides: shape === 'square' || shape === 'rhombus' ? ['4'] : ['6', '4'] });
    ok({ kind: 'polygon', title: 'Hex', shape: 'regular', vertices: ['A', 'B', 'C', 'D', 'E', 'F'] });
    for (const shape of ['cube', 'cuboid', 'triangular_prism', 'cylinder', 'cone', 'square_pyramid']) expect(ok({ kind: 'solid', title: shape, shape, dimensions: shape === 'cube' ? { length: 5 } : { length: 5, width: 3, height: 4, radius: 2, base: 4 } }).alt).toMatch(/net/);
    ok({ kind: 'coordinate', title: 'G', x: [-5, 5], y: [-5, 5], points: [{ label: 'A', x: 1, y: 2 }, { label: 'B', x: -3, y: 4 }], segments: [['A', 'B']] });
    ok({ kind: 'numberline', title: 'N', min: -5, max: 5, step: 1, ranges: [{ from: -2, to: 3, toOpen: true }] });
    ok({ kind: 'bar', title: 'B', categories: ['a', 'b'], values: [3, 7] });
    expect(ok({ kind: 'table', title: 'T', headers: ['Angle type', 'Range'], rows: [['Partially open pair of scissors and more words', 'x']] }).svg).toContain('scissors');
  });
  it('rejects inconsistent measurements', () => {
    bad({ kind: 'polygon', title: 'x', vertices: ['A', 'B', 'C'], angles: [50, 70, 70] }, /add up to 190/);
    bad({ kind: 'polygon', title: 'x', vertices: ['A', 'B', 'C'], sides: [6, 8, 11], rightAngles: ['B'] }, /≠ 11²/);
    bad({ kind: 'polygon', title: 'x', vertices: ['A', 'B', 'C'], sides: [1, 2, 5] }, /triangle inequality/);
    bad({ kind: 'polygon', title: 'x', shape: 'rectangle', vertices: ['A', 'B', 'C', 'D'], sides: [6, 4, 7, 4] }, /opposite sides/);
    bad({ kind: 'polygon', title: 'x', vertices: ['A', 'B', 'C', 'D'], angles: [90, 90, 90, 100] }, /360/);
    bad({ kind: 'angle', title: 'x', degrees: 180, parts: [{ degrees: 60 }, { degrees: 100 }] }, /160° , ?not|160°, not/);
    bad({ kind: 'solid', title: 'x', shape: 'cube', dimensions: { length: 3, height: 4 } }, /cube/);
    bad({ kind: 'coordinate', title: 'x', x: [0, 5], y: [0, 5], points: [{ label: 'A', x: 7, y: 1 }] }, /outside/);
    bad({ kind: 'bar', title: 'x', categories: ['a'], values: [1, 2] }, /one non-negative/);
  });
  it('module validation: figure numbers must match the worked example it draws', () => {
    const fig = (sides: string[]) => prepareDiagram({ kind: 'polygon', title: 'T', vertices: ['A', 'B', 'C'], sides, rightAngles: ['B'], caption: 'c', example: 1 });
    const secs = (d: any) => [{ key: 'E', data: { examples: [{ problem: 'AB = 6 cm and BC = 8 cm. Find AC.', steps: ['6² + 8² = 100'], answer: 'AC = 10 cm' }] } }, { key: 'F', data: { diagrams: [d] } }];
    expect(validateModule(secs(fig(['6 cm', '8 cm', '10 cm']))).errors.filter((e: string) => e.startsWith('F'))).toEqual([]);
    expect(validateModule(secs(fig(['9 cm', '12 cm', '15 cm']))).errors.join()).toMatch(/F\.1: shows 9, 12, 15, which do not appear in worked example E\.1/);
  });
});
