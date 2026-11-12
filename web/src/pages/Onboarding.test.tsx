import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnboardingPage } from './Onboarding';
import { SubjectPicker } from '../components/SubjectPicker';
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
beforeEach(() => vi.restoreAllMocks());
describe('onboarding', () => {
  it('requires a region (16 Ghana regions) and a free-text school name before continuing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((u) => json({ items: String(u).includes('schools') ? [{ _id: 's1', name: 'Sample Academy (Sample)', active: true }] : [] }));
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OnboardingPage /></MemoryRouter></QueryClientProvider>);
    const region = await screen.findByLabelText('Region');
    expect(within(region).getAllByRole('option').slice(1).map((o) => o.textContent)).toHaveLength(16);
    const next = screen.getByRole('button', { name: 'Next' }); expect(next).toBeDisabled();
    fireEvent.change(region, { target: { value: 'Savannah' } }); expect(next).toBeDisabled();
    fireEvent.change(screen.getByLabelText('School name'), { target: { value: 'Damongo SHS' } }); expect(next).toBeEnabled();
  });
  it('subject picker shows separate core and elective sections without limits', () => {
    const on = vi.fn();
    render(<SubjectPicker subjects={[{ _id: 'a', name: 'English', category: 'core' }, { _id: 'b', name: 'Biology', category: 'elective' }, { _id: 'c', name: 'Economics', category: 'elective' }]} core={[]} electives={['b']} onChange={on} />);
    expect(screen.getByRole('group', { name: /Core subjects/ })).toBeInTheDocument();
    const el = screen.getByRole('group', { name: /Elective subjects/ });
    fireEvent.click(within(el).getByLabelText('Economics')); expect(on).toHaveBeenCalledWith([], ['b', 'c']);
  });
});
