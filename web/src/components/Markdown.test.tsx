import { describe, it, expect } from 'vitest';
import { toHtml, texToText } from './Markdown';
describe('tutor Markdown: maths and lists', () => {
  it('turns simple LaTeX into readable text', () => {
    expect(texToText('2x + 3 - 3 = 11 - 3')).toBe('2x + 3 - 3 = 11 - 3');
    expect(texToText('\\frac{a+b}{2} \\times x^{2}')).toBe('(a+b)/2 × x²');
    expect(texToText('\\sqrt{16} \\le \\pi r^2')).toBe('√16 ≤ π r²');
    expect(texToText('H_{2}O, \\frac{1}{x}')).toBe('H₂O, 1/x');
  });
  it('renders $…$ and $$…$$ without dollar signs, keeps prices, escapes HTML', () => {
    const h = toHtml('Subtract $3$ from $2x$:\n\n$$2x + 3 - 3 = 11 - 3$$\n\nIt costs $5 and $10. <b>x</b>');
    expect(h).toContain('<p class="my-2">Subtract <span class="katex">'); expect(h).toContain('katex-display'); expect(h).toContain('annotation encoding="application/x-tex">2x + 3 - 3 = 11 - 3<');
    expect(h).toContain('It costs $5 and $10.'); expect(h).toContain('&lt;b&gt;');
  });
  it('keeps the numbering of a list split by paragraphs', () => {
    const h = toHtml('1. **First**\n\nText\n\n2. **Second**');
    expect(h).toContain('<ol class="list-decimal pl-6 space-y-1" start="2">');
  });
});
