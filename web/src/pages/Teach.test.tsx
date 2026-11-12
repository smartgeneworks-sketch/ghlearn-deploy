import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ClassPage } from './Teach';
import { LearningAnalyticsPage } from '../admin/insights';
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
const wrap = (el: ReactElement, path: string, route: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter></QueryClientProvider>);
beforeEach(() => vi.restoreAllMocks());
const overview = { class: { _id: 'c1', name: '1 Sci A', subjectId: { name: 'Biology' } }, summary: { students: 1, avgMastery: 40, needingSupport: 1, attempts: 2, pendingReview: 0 },
  students: [{ userId: 'u1', name: 'Yaw', overall: 40, recentPct: 30, completed: 1, missed: [], weakTopics: [{ topic: 'Cells', pct: 40 }], needsSupport: true, reasons: ['Overall mastery 40% (below 50%)'], lastActive: null }],
  support: [{ userId: 'u1', name: 'Yaw', reasons: ['Overall mastery 40% (below 50%)'], weakTopics: [{ topic: 'Cells', pct: 40 }] }],
  topics: [{ topic: 'Cells', avgPct: 40, students: 1, struggling: 1 }], misconceptions: [{ questionId: 'q1', stem: 'What controls the cell?', topic: 'Cells', wrongPct: 100, wrong: 2, responses: 2, commonWrongAnswers: [{ answer: 'wall', count: 2 }], correctAnswer: 'Nucleus' }],
  remedial: [{ topic: 'Cells', students: 1, names: ['Yaw'], suggestion: 'Set a remedial assignment' }], assignments: [], method: 'rules' };
describe('teacher class view', () => {
  it('shows support reasons and misconceptions in accessible tabs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => json(overview));
    wrap(<ClassPage />, '/teach/classes/c1', '/teach/classes/:id');
    expect(await screen.findByRole('heading', { name: /1 Sci A/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Needs support/ }));
    expect(screen.getByText('Overall mastery 40% (below 50%)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Misconceptions' }));
    const panel = screen.getByRole('tabpanel'); expect(within(panel).getByText(/“wall” ×2/)).toBeInTheDocument(); expect(within(panel).getByText('Correct: Nucleus')).toBeInTheDocument();
  });
});
describe('learning analytics', () => {
  it('labels measured data and suggestions, hides the school filter for school admins, and notes hidden small groups', async () => {
    const reports = { scope: 'school', filters: { from: '2026-09-15T00:00:00Z', to: '2026-10-15T00:00:00Z' }, minGroup: 5, reports: [
      { key: 'topic_performance', title: 'Topic performance', kind: 'measured', description: 'd', method: 'Mastery is the running share', columns: [{ key: 'topic', label: 'Topic' }, { key: 'mastery', label: 'Average mastery', type: 'percent' }], rows: [{ topic: 'Cells', mastery: 40 }, { topic: 'Atoms', mastery: null }], suppressedRows: 1, chart: { label: 'Mastery', labelKey: 'topic', valueKey: 'mastery', unit: '%' } },
      { key: 'remediation', title: 'Objectives needing remediation', kind: 'suggestion', description: 'd', method: 'Rule', columns: [{ key: 'objective', label: 'Objective' }], rows: [] }] };
    vi.spyOn(globalThis, 'fetch').mockImplementation((u) => String(u).includes('/filters') ? json({ scope: 'school', schools: [], levels: [], subjects: [], classes: [], academicYears: [], programmes: [], topics: [], canSeeStudents: true, reports: [] }) : json(reports));
    wrap(<LearningAnalyticsPage />, '/a', '/a');
    expect(await screen.findByRole('heading', { name: /Topic performance/ })).toBeInTheDocument();
    expect(screen.getAllByText('Measured').length).toBeGreaterThan(0); expect(screen.getAllByText('Rule-based suggestion').length).toBeGreaterThan(0);
    expect(screen.getByText(/1 row\(s\) have figures hidden/)).toBeInTheDocument();
    expect(screen.queryByLabelText('School')).toBeNull(); expect(screen.getByLabelText('Learning Area')).toBeInTheDocument(); expect(screen.getByLabelText('Academic year')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Excel' }).length).toBe(2);
    expect(screen.getByRole('button', { name: 'Show students' })).toBeInTheDocument();
  });
});
