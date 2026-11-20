import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ForgotPasswordPage, ResetPasswordPage } from './Auth';
import { PhoneCard } from '../components/PhoneCard';
import { SmsPanel } from '../admin/sms';
const res = (body: unknown, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
type Call = { url: string; method: string; body: any };
function mockApi(routes: Record<string, (b: any, method: string) => [unknown, number?]>) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((u: any, init: any) => {
    const url = String(u); const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(init.body) : undefined; calls.push({ url, method, body });
    if (url.includes('/api/auth/csrf')) return res({ csrfToken: 'csrf' });
    const k = Object.keys(routes).sort((a, b) => b.length - a.length).find((r) => url.includes(r)); if (!k) return res({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
    const [b, s] = routes[k](body, method); return res(b, s ?? 200);
  });
  return calls;
}
const settings = (email: boolean, sms: boolean) => ({ branding: { appName: 'GH Learn' }, features: {}, legal: {}, passwordReset: { email, sms, staffAssisted: true } });
const wrap = (ui: React.ReactNode, at = '/') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[at]}>
  <Routes><Route path="/reset-password" element={<ResetPasswordPage />} /><Route path="*" element={ui} /></Routes></MemoryRouter></QueryClientProvider>);
beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

describe('forgot password by SMS', () => {
  it('offers email or phone, sends the phone number, then carries it to the code page', async () => {
    const calls = mockApi({ '/api/settings/public': () => [settings(true, true)], '/api/auth/forgot-password': () => [{ ok: true, channel: 'sms', smsAvailable: true, emailAvailable: true, message: 'If an account has verified that phone number, we have sent it a reset code by SMS.' }] });
    wrap(<ForgotPasswordPage />, '/forgot-password');
    fireEvent.change(await screen.findByLabelText('Email or phone number'), { target: { value: '024 111 0001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    expect(await screen.findByRole('heading', { name: 'Check your phone' })).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('forgot-password'))!.body).toEqual({ identifier: '024 111 0001' });
    fireEvent.click(screen.getByRole('link', { name: 'Enter the code' }));
    expect(await screen.findByRole('heading', { name: 'Reset with a code' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email or phone number')).toHaveValue('024 111 0001');
  });
  it('SMS only: asks for the phone number', async () => {
    mockApi({ '/api/settings/public': () => [settings(false, true)] });
    wrap(<ForgotPasswordPage />, '/forgot-password');
    expect(await screen.findByLabelText('Phone number')).toHaveAttribute('type', 'tel'); expect(screen.queryByLabelText('Email')).toBeNull();
  });
  it('reset with a phone number sends { phone, code }', async () => {
    const calls = mockApi({ '/api/settings/public': () => [settings(false, true)], '/api/auth/reset-password': () => [{ ok: true }] });
    wrap(<div />, '/reset-password');
    fireEvent.change(await screen.findByLabelText('Email or phone number'), { target: { value: '0241110001' } });
    fireEvent.change(screen.getByLabelText('Reset code'), { target: { value: 'ABCD-EFGH-JKLM' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass2027x' } }); fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass2027x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText(/Your password was changed/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/api/auth/reset-password'))!.body).toEqual({ phone: '0241110001', code: 'ABCD-EFGH-JKLM', newPassword: 'NewPass2027x' });
  });
});

describe('phone card on the Account page', () => {
  const prefs = (sms: boolean) => [{ categories: [{ key: 'meetings', label: 'Meetings', inApp: true, email: false, sms, smsCapable: true }], sms: { available: true, phoneVerified: true } }] as [unknown];
  it('says plainly when SMS is unavailable', async () => {
    mockApi({ '/api/account/phone': () => [{ phone: null, verifiedAt: null, smsAvailable: false, pending: null }], '/api/notifications/preferences': () => prefs(false) });
    wrap(<PhoneCard />); expect(await screen.findByText(/needs SMS, which is not available/)).toBeInTheDocument(); expect(screen.queryByLabelText('Mobile number')).toBeNull();
  });
  it('sends a code, then verifies it', async () => {
    let state: any = { phone: null, verifiedAt: null, smsAvailable: true, pending: null };
    const calls = mockApi({
      '/api/account/phone/verify': () => { state = { ...state, phone: '0241110001', verifiedAt: 'x', pending: null }; return [{ phone: '0241110001', verified: true }]; },
      '/api/account/phone': (_b, m) => { if (m === 'POST') { state = { ...state, pending: { phoneMasked: '024****001', expiresAt: 'x' } }; return [{ phoneMasked: '024****001' }]; } return [state]; },
      '/api/notifications/preferences': () => prefs(false),
    });
    wrap(<PhoneCard />);
    fireEvent.change(await screen.findByLabelText('Mobile number'), { target: { value: '024 111 0001' } }); fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText(/We texted a 6-digit code to 024\*\*\*\*001/)).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '12a3456' } }); expect(screen.getByLabelText('6-digit code')).toHaveValue('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Verified')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/api/account/phone') && c.method === 'POST')!.body).toEqual({ phone: '024 111 0001' });
    expect(calls.find((c) => c.url.includes('/verify'))!.body).toEqual({ code: '123456' });
    fireEvent.click(await screen.findByLabelText(/Text me about meetings/));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ categories: { meetings: { sms: true } } }));
  });
});

describe('admin SMS panel', () => {
  const status = { configured: true, provider: 'mnotify', keyPresent: true, available: true, settings: { enabled: true, senderId: '', dailyCap: 300 }, senderId: 'GHLearn', senderSource: 'environment', sentToday: 2, dailyCap: 300,
    live: { checkedAt: new Date().toISOString(), balance: { ok: true, smsCredits: 3, bonus: 0, wallet: '50' }, senderStatus: { ok: true, status: 'pending' } } };
  it('shows balance, pending sender, cap; test send shows a masked result; settings save through System settings', async () => {
    const calls = mockApi({ '/api/admin/sms/status': () => [status], '/api/admin/sms/log': () => [{ items: [{ _id: '1', createdAt: new Date().toISOString(), kind: 'test', to: '053****573', network: 'MTN', status: 'sent', campaignId: 'C1' }] }],
      '/api/admin/sms/test': () => [{ status: 'failed', to: '055****005', network: 'MTN', error: 'Sender ID not approved' }], '/api/admin/settings': () => [{ ok: true }],
      '/api/admin/email/status': () => [{ configured: true, provider: 'brevo', from: 'GH Learn <no-reply@ghlearn.com>' }], '/api/admin/email/test': () => [{ status: 'sent', to: 's***s@gmail.com', provider: 'brevo' }] });
    wrap(<SmsPanel />);
    expect(await screen.findByText(/3 SMS credits · wallet GHS 50/)).toBeInTheDocument();
    expect(screen.getByText(/Texts will fail until it is approved/)).toBeInTheDocument(); expect(screen.getByText('2 of 300')).toBeInTheDocument();
    expect(screen.getByText(/present \(environment\)/)).toBeInTheDocument(); expect(document.body.textContent).not.toMatch(/BMS_API_KEY=/);
    expect(await screen.findByText('053****573')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0551110005' } }); fireEvent.click(screen.getByRole('button', { name: 'Send test' }));
    expect(await screen.findByText(/Not sent to 055\*\*\*\*005: Sender ID not approved/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Register a sender ID' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Daily SMS cap'), { target: { value: '150' } }); fireEvent.click(screen.getByRole('button', { name: 'Save SMS settings' }));
    await waitFor(() => expect(calls.find((c) => c.url.includes('/api/admin/settings') && c.method === 'PATCH')?.body).toEqual({ sms: { enabled: true, senderId: '', dailyCap: 150 } }));
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'smartgeneworks@gmail.com' } }); fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByText('Sent to s***s@gmail.com via brevo.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/api/admin/email/test'))!.body).toEqual({ to: 'smartgeneworks@gmail.com' });
  });
  it('non-super admins get a clear message', async () => {
    mockApi({ '/api/admin/sms/status': () => [{ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403] });
    wrap(<SmsPanel />); expect(await screen.findByText('Only a Super Admin can manage SMS.')).toBeInTheDocument();
  });
});
