import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage, RegisterPage } from './Auth';
import { AuthProvider } from '../lib/auth';
const res = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
type Call = { url: string; method: string; body: any };
function mockApi(routes: Record<string, (b: any) => [unknown, number?]>) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((u: any, init: any) => {
    const url = String(u); const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(init.body) : undefined; calls.push({ url, method, body });
    if (url.includes('/api/auth/csrf')) return res({ csrfToken: 'csrf' });
    if (url.includes('/api/auth/session')) return res({ user: null, refresh: false });
    const k = Object.keys(routes).sort((a, b) => b.length - a.length).find((r) => url.includes(r)); if (!k) return res({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
    const [b, s] = routes[k](body); return res(b, s ?? 200);
  });
  return calls;
}
const pub = { branding: { appName: 'GH Learn' }, theme: { preset: 'green', colors: null }, maintenance: { enabled: false }, features: { selfRegistration: true }, offline: {}, legal: { terms: false, privacy: false } };
const user = { id: 'u1', email: 'new@ex.test', fullName: 'New Student', roles: ['student'], onboarded: false };
const wrap = (at: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthProvider><MemoryRouter initialEntries={[at]}>
  <Routes><Route path="/login" element={<LoginPage />} /><Route path="/register" element={<RegisterPage />} /><Route path="/onboarding" element={<h1>Onboarding</h1>} /><Route path="/" element={<h1>Home</h1>} /></Routes></MemoryRouter></AuthProvider></QueryClientProvider>);
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

describe('sign in with email or phone', () => {
  it('one field accepts a phone number and sends it as typed', async () => {
    const calls = mockApi({ '/api/settings/public': () => [pub], '/api/auth/login': () => [{ user: { ...user, onboarded: true } }] });
    wrap('/login');
    fill(await screen.findByLabelText('Email or phone number').then(() => 'Email or phone number'), '024 222 0001'); fill('Password', 'Secret2027x');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(calls.find((c) => c.url.includes('/api/auth/login'))?.body).toEqual({ email: '024 222 0001', password: 'Secret2027x' }));
  });
  it('shows the server error unchanged', async () => {
    mockApi({ '/api/settings/public': () => [pub], '/api/auth/login': () => [{ error: { code: 'UNAUTHORIZED', message: 'Invalid email, phone number or password' } }, 401] });
    wrap('/login'); fill(await screen.findByLabelText('Email or phone number').then(() => 'Email or phone number'), '0249990000'); fill('Password', 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); expect(await screen.findByText('Invalid email, phone number or password')).toBeInTheDocument();
  });
});

describe('sign-up with an optional phone', () => {
  const fillForm = async (phone?: string) => {
    await screen.findByLabelText('Full name'); fill('Full name', 'New Student'); fill(/^Email$/, 'new@ex.test'); fill('Password', 'NewStudent2027');
    if (phone !== undefined) fill('Mobile number (optional)', phone);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  };
  it('rejects a non-mobile number before sending', async () => {
    const calls = mockApi({ '/api/settings/public': () => [pub] }); wrap('/register'); await fillForm('0302123456');
    expect(await screen.findByText(/Enter a Ghana mobile/)).toBeInTheDocument(); expect(calls.some((c) => c.url.includes('/register'))).toBe(false);
  });
  it('without a phone goes straight to onboarding', async () => {
    mockApi({ '/api/settings/public': () => [pub], '/api/auth/register': () => [{ user }, 201] }); wrap('/register'); await fillForm();
    expect(await screen.findByRole('heading', { name: 'Onboarding' })).toBeInTheDocument();
  });
  it('with a phone: code step with resend, verify and skip', async () => {
    const calls = mockApi({ '/api/settings/public': () => [pub], '/api/auth/register': () => [{ user, phone: { phoneMasked: '024****001', verified: false, codeSent: true } }, 201],
      '/api/account/phone/verify': () => [{ error: { code: 'OTP_INVALID', message: 'That code is not right. 4 tries left.' } }, 400], '/api/account/phone': () => [{ phoneMasked: '024****001' }] });
    wrap('/register'); await fillForm('024 222 0001');
    expect(await screen.findByRole('heading', { name: 'Verify your phone' })).toBeInTheDocument(); expect(screen.getByText(/texted a 6-digit code to 024\*\*\*\*001/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/register'))!.body).toMatchObject({ phone: '024 222 0001', email: 'new@ex.test' });
    fill('6-digit code', '123456'); fireEvent.click(screen.getByRole('button', { name: 'Verify phone' })); expect(await screen.findByText('That code is not right. 4 tries left.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' })); await waitFor(() => expect(calls.find((c) => c.url.endsWith('/api/account/phone') && c.method === 'POST')?.body).toEqual({ phone: '024 222 0001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' })); expect(await screen.findByRole('heading', { name: 'Onboarding' })).toBeInTheDocument();
  });
  it('SMS unavailable: honest message, then continue', async () => {
    mockApi({ '/api/settings/public': () => [pub], '/api/auth/register': () => [{ user, phone: { phoneMasked: '024****001', verified: false, codeSent: false, reason: 'sms_unavailable', message: 'SMS is not available on GH Learn yet, so we saved your number without verifying it.' } }, 201] });
    wrap('/register'); await fillForm('0242220001');
    expect(await screen.findByText(/saved your number without verifying it/)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Onboarding' })).toBeInTheDocument();
  });
});
