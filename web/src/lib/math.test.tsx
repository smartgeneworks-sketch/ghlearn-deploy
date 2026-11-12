import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { splitMath, MathText, tidyPlain, texHtml } from './math';
import { toHtml } from '../components/Markdown';

describe('maths rendering', () => {
  it('splits inline and display maths, not prices', () => {
    expect(splitMath('An angle of $45^\\circ$.').map((p) => p.t)).toEqual(['text', 'inline', 'text']);
    expect(splitMath('$$a^2+b^2=c^2$$').map((p) => p.t)).toEqual(['display']);
    expect(splitMath('It costs $5 and $10 today')).toEqual([{ t: 'text', v: 'It costs $5 and $10 today' }]);
    expect(splitMath('GH¢5.00')).toEqual([{ t: 'text', v: 'GH¢5.00' }]);
    expect(splitMath('\\sin \\theta = \\frac{4}{5}')[0].t).toBe('inline');
  });
  it('renders KaTeX with no raw $ left', () => {
    const { container } = render(<MathText text={"Angle $45^\\circ$ and $\\frac{3}{4}$"} />);
    expect(container.querySelectorAll('.katex').length).toBe(2);
    expect(container.textContent).not.toContain('$');
  });
  it('typesets maths in markdown notes and escapes text', () => {
    const h = toHtml('### Area\nArea is $\\frac{1}{2} b h$ <b>x</b>\n\n$$c^2 = a^2 + b^2$$');
    expect(h).toContain('katex'); expect(h).not.toContain('<b>x'); expect(h).toContain('katex-display');
  });
  it('typesets bare fragments in text', () => { expect(splitMath('Length: \\sqrt{45} (or 3\\sqrt{5}) units').map((p) => p.t)).toEqual(['text', 'inline', 'text', 'inline', 'text']); });
  it('tidies plain carets and stars', () => { expect(tidyPlain('a^2 + b^2 and 12 * 8')).toBe('a² + b² and 12 × 8'); });
  it('typesets science notation (formulas, units, mhchem)', () => {
    for (const tex of ['\\text{H}_2\\text{O}', '\\mathrm{CO_2}', '25^\\circ\\text{C}', '9.8\\,\\text{m/s}^2', '\\ce{CO2 + H2O -> H2CO3}']) { const h = texHtml(tex); expect(h, tex).toContain('katex'); expect(h, tex).not.toContain('katex-error'); }
    const { container } = render(<MathText text={'Water ($\\text{H}_2\\text{O}$) boils at 100 °C; CO₂ is a gas.'} />);
    expect(container.querySelectorAll('.katex').length).toBe(1); expect(container.textContent).toContain('100 °C; CO₂ is a gas.'); expect(container.textContent).not.toContain('$');
  });
});
