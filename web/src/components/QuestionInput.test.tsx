import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { QuestionInput, ResultBox } from './QuestionInput';
import { BarChart } from './Charts';
const Q: Record<string, any> = {
  mcq: { id: '1', type: 'mcq', options: ['Nucleus', 'Membrane'] }, true_false: { id: '2', type: 'true_false' }, short_answer: { id: '3', type: 'short_answer' },
  gap_fill: { id: '4', type: 'gap_fill', text: 'Plants make {{1}} from {{2}}.', blanks: 2 }, matching: { id: '5', type: 'matching', left: ['A', 'B'], right: ['x', 'y'] },
  ordering: { id: '6', type: 'ordering', items: ['Second', 'First', 'Third'] }, diagram_labelling: { id: '7', type: 'diagram_labelling', svg: '<svg><text>(1) ?</text></svg>', alt: 'cell', labels: [1, 2] },
  numerical: { id: '8', type: 'numerical', requireUnit: true }, essay: { id: '9', type: 'essay', wordLimit: 100, rubric: [{ criterion: 'Knowledge', maxMarks: 4 }] },
  case_study: { id: '10', type: 'case_study', scenario: 'Ama sells kenkey.', parts: [{ prompt: 'Which law?', type: 'mcq', options: ['Demand', 'Supply'], marks: 1 }, { prompt: 'Explain', type: 'essay', marks: 3 }] },
};
function Harness({ q, spy }: { q: any; spy: (v: any) => void }) { const [v, setV] = useState<any>(null); return <QuestionInput q={q} value={v} onChange={(x) => { setV(x); spy(x); }} />; }
describe('QuestionInput', () => {
  it('renders an accessible input for every question type', () => {
    for (const q of Object.values(Q)) { const { unmount } = render(<Harness q={q} spy={() => {}} />); expect(document.body.textContent).not.toMatch(/Unsupported/); unmount(); }
  });
  it('ordering works with keyboard buttons (no drag needed)', () => {
    const spy = vi.fn(); render(<Harness q={Q.ordering} spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move "First" up' })); expect(spy).toHaveBeenLastCalledWith([1, 0, 2]);
  });
  it('gap fill and numerical produce structured answers', () => {
    const spy = vi.fn(); render(<Harness q={Q.gap_fill} spy={spy} />); fireEvent.change(screen.getByLabelText('Blank 2'), { target: { value: 'light' } }); expect(spy).toHaveBeenLastCalledWith([undefined, 'light']);
    const s2 = vi.fn(); render(<Harness q={Q.numerical} spy={s2} />); fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'm' } }); expect(s2).toHaveBeenLastCalledWith({ unit: 'm' });
  });
  it('result box labels provisional AI marks and teacher marks', () => {
    render(<ResultBox r={{ score: 3, maxScore: 6, markedBy: 'ai_provisional', needsReview: true, feedback: 'ok', criteria: [{ criterion: 'K', marks: 3, maxMarks: 4 }] }} />);
    expect(screen.getByText(/provisional AI mark/)).toBeInTheDocument();
  });
  it('charts expose data to screen readers', () => {
    render(<BarChart label="Mastery" data={[{ label: 'Cells', value: 40 }]} />); expect(screen.getByRole('img', { name: 'Mastery: Cells 40%' })).toBeInTheDocument();
  });
});
