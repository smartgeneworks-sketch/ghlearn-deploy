import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const auth = vi.hoisted(() => ({ setUser: vi.fn(), user: null, logout: vi.fn() }));
vi.mock('../lib/auth', () => ({ useAuth: () => auth }));
import { TeacherApplyPage } from './TeacherApply';
import { SetPasswordPage } from './SetPassword';

const res = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const TOKEN = 'B'.repeat(43);
const S1 = 'a'.repeat(24), S2 = 'b'.repeat(24), SCH = 'c'.repeat(24);
type Call = { url: string; body: any };
function mockApi(routes: Record<string, (b: any) => [unknown, number?]>) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((u: any, init: any) => {
    const url = String(u); const body = init?.body ? JSON.parse(init.body) : undefined; calls.push({ url, body });
    if (url.includes('/api/auth/csrf')) return res({ csrfToken: 'csrf' });
    const k = Object.keys(routes).sort((a, b) => b.length - a.length).find((r) => url.includes(r)); if (!k) return res({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
    const [b, s] = routes[k](body); return res(b, s ?? 200);
  });
  return calls;
}
const settings = { branding: { appName: 'GH Learn' }, features: { selfRegistration: true }, legal: {}, passwordReset: { email: true, staffAssisted: true } };
const options = { regions: ['Ashanti', 'Greater Accra'], levels: ['JHS 1', 'SHS 1', 'SHS 2'], subjects: [{ id: S1, name: 'Biology', level: 'SHS' }, { id: S2, name: 'Physics', level: 'SHS' }],
  schools: [{ id: SCH, name: 'Sample Academy', region: 'Greater Accra' }] };
const Where = () => { const l = useLocation(); return <output data-testid="loc">{l.pathname}{(l.state as any)?.welcome ? ' welcome' : ''}</output>; };
const wrap = (ui: React.ReactNode, at: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <MemoryRouter initialEntries={[at]}><Routes><Route path={at.split('?')[0]} element={ui} /><Route path="*" element={<Where />} /></Routes></MemoryRouter></QueryClientProvider>);
beforeEach(() => { vi.restoreAllMocks(); auth.setUser.mockClear(); });
afterEach(cleanup);

describe('teacher application page', () => {
  it('has no password field, shows field errors, and sends a valid application', async () => {
    const calls = mockApi({ '/api/settings/public': () => [settings], '/api/public/teacher-applications/options': () => [options], '/api/public/teacher-applications': () => [{ ok: true, message: 'Thank you. Your application has been received.' }, 202] });
    wrap(<TeacherApplyPage />, '/register/teacher');
    expect(await screen.findByLabelText('Full name')).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findByText('Enter your full name')).toBeInTheDocument(); expect(screen.getByText('Choose at least one subject')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/api/public/teacher-applications') && c.body)).toBe(false);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Efua Mensah' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'Efua@School.test' } });
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'Greater Accra' } });
    fireEvent.change(screen.getByLabelText('School'), { target: { value: SCH } });
    fireEvent.click(screen.getByLabelText('Biology')); fireEvent.click(screen.getByLabelText('SHS 2'));
    fireEvent.click(screen.getByLabelText(/I confirm these details/));
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findByText('Thank you. Your application has been received.')).toBeInTheDocument();
    const sent = calls.find((c) => c.url.endsWith('/api/public/teacher-applications') && c.body)!.body;
    expect(sent).toMatchObject({ fullName: 'Efua Mensah', email: 'Efua@School.test', region: 'Greater Accra', schoolId: SCH, subjectIds: [S1], levels: ['SHS 2'], consent: true });
    expect(sent.website).toBeUndefined(); expect(sent.password).toBeUndefined();
  });
  it('a school that is not listed is typed as free text', async () => {
    const calls = mockApi({ '/api/settings/public': () => [settings], '/api/public/teacher-applications/options': () => [options], '/api/public/teacher-applications': () => [{ ok: true, message: 'Received.' }, 202] });
    wrap(<TeacherApplyPage />, '/register/teacher');
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Kofi Boateng' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kofi@school.test' } });
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'Ashanti' } });
    fireEvent.change(screen.getByLabelText('School'), { target: { value: '__other' } });
    fireEvent.change(screen.getByLabelText('School name'), { target: { value: 'Brand New Hills College' } });
    fireEvent.click(screen.getByLabelText('Physics')); fireEvent.click(screen.getByLabelText('SHS 1')); fireEvent.click(screen.getByLabelText(/I confirm these details/));
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    await screen.findByText('Received.');
    expect(calls.find((c) => c.url.endsWith('/api/public/teacher-applications') && c.body)!.body).toMatchObject({ schoolId: '', schoolName: 'Brand New Hills College' });
  });
  it('with no schools listed for the region, the school name field appears straight away', async () => {
    mockApi({ '/api/settings/public': () => [settings], '/api/public/teacher-applications/options': () => [{ ...options, schools: [] }] });
    wrap(<TeacherApplyPage />, '/register/teacher');
    fireEvent.change(await screen.findByLabelText('Region'), { target: { value: 'Greater Accra' } });
    expect((screen.getByLabelText('School') as HTMLSelectElement).value).toBe('__other');
    expect(screen.getByLabelText('School name')).toBeInTheDocument();
    expect(screen.getByText(/No schools are listed for this region yet/)).toBeInTheDocument();
  });
});

describe('set password page', () => {
  it('shows the sign-in email, checks the policy and the confirmation, then signs in to a welcome', async () => {
    const calls = mockApi({ '/api/settings/public': () => [settings], '/api/auth/set-password/check': () => [{ valid: true, email: 'efua@school.test', fullName: 'Efua Mensah' }],
      '/api/auth/set-password': () => [{ ok: true, signedIn: true, user: { id: 'u', email: 'efua@school.test', fullName: 'Efua Mensah', roles: ['teacher'], onboarded: true } }] });
    wrap(<SetPasswordPage />, `/set-password?token=${TOKEN}`);
    expect(await screen.findByText('efua@school.test')).toBeInTheDocument(); expect(screen.getByText(/Welcome to GH Learn, Efua/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password and sign in' }));
    expect(await screen.findByText('At least 10 characters')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'MyTeaching2027' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'MyTeaching2028' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password and sign in' }));
    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'MyTeaching2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password and sign in' }));
    expect(await screen.findByTestId('loc')).toHaveTextContent('/ welcome');
    expect(auth.setUser).toHaveBeenCalledWith(expect.objectContaining({ roles: ['teacher'] }));
    expect(calls.find((c) => c.url.endsWith('/api/auth/set-password'))!.body).toEqual({ token: TOKEN, newPassword: 'MyTeaching2027' });
  });
  it('an expired or used link explains itself and can ask the admins for a new one', async () => {
    const calls = mockApi({ '/api/settings/public': () => [settings], '/api/auth/set-password/check': () => [{ valid: false, message: 'expired' }],
      '/api/auth/set-password/request-new': () => [{ ok: true, message: 'We have asked the administrators to send you a new one by email.' }] });
    wrap(<SetPasswordPage />, `/set-password?token=${TOKEN}`);
    expect(await screen.findByText(/expired or has already been used/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request a new link' }));
    expect(await screen.findByText(/asked the administrators/)).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.url.includes('request-new'))!.body).toEqual({ token: TOKEN }));
  });
});
