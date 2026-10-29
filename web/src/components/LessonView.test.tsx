import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Section } from './LessonView';
describe('lesson sections: maths in term and concept names', () => {
  beforeEach(() => cleanup());
  it('renders $…$ in C concept names and J/vocabulary terms as maths, not raw markup', () => {
    const { container } = render(<div>
      <Section s={{ key: 'C', title: 'Key concepts', content: '', data: { concepts: [{ name: 'General term ($U_n$)', explanation: 'The $n$th term.' }] } }} />
      <Section s={{ key: 'J', title: 'Key terms', content: '', data: { terms: [{ term: 'Common difference ($d$)', definition: 'Gap.' }], vocabulary: [{ term: 'Sample space ($S$)', definition: 'All outcomes.' }] } }} />
    </div>);
    const dts = [...container.querySelectorAll('dt')];
    expect(dts).toHaveLength(3);
    for (const dt of dts) { expect(dt.textContent).not.toMatch(/\$/); expect(dt.querySelector('.katex')).not.toBeNull(); }
  });
});
