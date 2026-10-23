import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
afterEach(cleanup);
import { MemoryRouter } from 'react-router-dom';
import { ChartCard, fmt } from './OverviewCharts';

const buckets = ['2026-10-01', '2026-10-02', '2026-10-03'];
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
describe('overview charts are accessible', () => {
  it('line chart: labelled figure, text summary, legend and a data table', () => {
    wrap(<ChartCard unit="day" buckets={buckets} c={{ key: 'lessons', title: 'Lessons generated vs published', type: 'line', valueUnit: 'count', link: '/admin/lessons?subjectId=x',
      series: [{ name: 'Generated', values: [1, 4, 0] }, { name: 'Published', values: [0, 1, 2] }] }} />);
    const fig = screen.getByRole('figure', { name: 'Lessons generated vs published' });
    const img = within(fig).getByRole('img'); expect(img.getAttribute('aria-label')).toMatch(/Generated: total 5, peak 4 on .*; Published: total 3, peak 2/);
    expect(within(fig).getByRole('list', { name: 'Legend' })).toHaveTextContent('Generated');
    const table = within(fig).getByRole('table', { name: /Lessons generated vs published by day/ });
    expect(within(table).getAllByRole('row')).toHaveLength(4); expect(within(table).getByRole('rowheader', { name: '2026-10-02' })).toBeInTheDocument();
    expect(within(fig).getByRole('link', { name: 'Open Lessons generated vs published' })).toHaveAttribute('href', '/admin/lessons?subjectId=x');
  });
  it('estimates are labelled; empty series say so instead of drawing', () => {
    wrap(<ChartCard unit="day" buckets={buckets} c={{ key: 'aiCost', title: 'Estimated AI cost (USD)', type: 'line', valueUnit: 'usd', estimate: true, note: 'Estimate, not a bill', series: [{ name: 'Estimated cost', values: [0, 0, 0] }] }} />);
    expect(screen.getByText('Estimate')).toBeInTheDocument(); expect(screen.getByText('No data in this period.')).toBeInTheDocument(); expect(screen.queryByRole('img')).toBeNull();
    expect(fmt(0.0123, 'usd')).toBe('$0.0123'); expect(fmt(12.5, 'usd')).toBe('$12.50'); expect(fmt(75, 'percent')).toBe('75%');
  });
  it('bar chart: each bar is a list item with a text value and optional link', () => {
    wrap(<ChartCard unit="day" buckets={buckets} c={{ key: 'performance', title: 'Average score by subject', type: 'bar', valueUnit: 'percent', items: [{ label: 'Biology', value: 70, n: 2, link: '/admin/analytics?subjectId=b' }, { label: 'Economics', value: 50, n: 1 }] }} />);
    const items = screen.getAllByRole('listitem'); expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Biology70% (n=2)'); expect(within(items[0]).getByRole('link', { name: 'Biology' })).toHaveAttribute('href', '/admin/analytics?subjectId=b');
  });
});
