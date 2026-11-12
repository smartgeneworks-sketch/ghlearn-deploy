import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Markdown } from './markdown';

const r = (s: string) => render(<MemoryRouter><Markdown source={s} /></MemoryRouter>);
describe('Markdown (admin-written pages)', () => {
  it('renders headings, lists, notes, bold and safe links', () => {
    r('## Apply\n\n1. Open [the form](/register/teacher)\n2. Wait for **approval**\n\n- one\n- two\n\n> Tip: [email us](mailto:info@example.com)\n\nSee [docs](https://example.com/x).');
    expect(screen.getByRole('heading', { level: 2, name: 'Apply' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the form' })).toHaveAttribute('href', '/register/teacher');
    expect(screen.getByText('approval').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'email us' })).toHaveAttribute('href', 'mailto:info@example.com');
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('renders simple tables with header cells', () => {
    r('| A | B |\n| --- | --- |\n| 1 | **2** |');
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['A', 'B']);
    expect(screen.getAllByRole('cell')).toHaveLength(2);
  });
  it('never renders HTML or unsafe links', () => {
    const { container } = r('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](//evil.test) [z](http://plain.test)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

import { toHtml } from '../components/Markdown';
describe('heading levels (axe heading-order)', () => {
  it('shallowest content heading becomes h3, relative depth kept', () => {
    expect(toHtml('### A\n#### B')).toMatch(/<h3[^>]*>A<\/h3><h4[^>]*>B<\/h4>/);
    expect(toHtml('# Top')).toMatch(/<h3/);
  });
});
