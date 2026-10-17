import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ForgotPasswordPage, ResetPasswordPage } from './Auth';
import { StaffResetSecret } from '../components/PasswordReset';
const res = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const TOKEN = 'A'.repeat(43);
type Call = { url: string; body: any };
function mockApi(routes: Record<string, (b: any) => [unknown, number?]>) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((u: any, init: any) => {
    const url = String(u); const body = init?.body ? JSON.parse(init.body) : undefined; calls.push({ url, body });
    if (url.includes('/api/auth/csrf')) return res({ csrfToken: 'csrf' });
    const k = Object.keys(routes).find((r) => url.includes(r)); if (!k) return res({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
    const [b, s] = routes[k](body); return res(b, s ?? 200);
  });
  return calls;
}
const settings = (email: boolean) => ({ branding: { appName: 'GH Learn' }, features: {}, legal: {}, passwordReset: { email, staffAssisted: true } });
const wrap = (ui: React.ReactNode, at = '/forgot-password') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter></QueryClientProvider>);
beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

describe('forgot password page', () => {
  it('says honestly that email reset is unavailable when no provider is configured, and offers the staff code route', async () => {
    const calls = mockApi({ '/api/settings/public': () => [settings(false)] });
    wrap(<ForgotPasswordPage />);
    expect(await screen.findByText(/Password reset by email is not available yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.getByRole('link', { name: 'Enter your reset code' })).toHaveAttribute('href', '/reset-password');
    expect(calls.some((c) => c.url.includes('forgot-password'))).toBe(false); // nothing pretends to send
  });
  it('with email configured, submits the address and shows the generic message', async () => {
    const calls = mockApi({ '/api/settings/public': () => [settings(true)], '/api/auth/forgot-password': () => [{ ok: true, emailAvailable: true, message: 'If an account uses that email address, we have sent it a reset link.' }] });
    wrap(<ForgotPasswordPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/^Enter your email address/)).toBeInTheDocument(); // client validation
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ama@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If an account uses that email address/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('forgot-password'))!.body).toEqual({ identifier: 'ama@example.com' });
  });
});

describe('reset password page', () => {
  it('link mode: checks the token, removes it from the address bar, validates and submits', async () => {
    const spy = vi.spyOn(window.history, 'replaceState');
    const calls = mockApi({ '/reset-password/check': () => [{ valid: true, expiresAt: new Date().toISOString() }], '/api/auth/reset-password': () => [{ ok: true }] });
    wrap(<ResetPasswordPage />, `/reset-password?token=${TOKEN}`);
    await screen.findByLabelText(/^New password/);
    expect(spy).toHaveBeenCalledWith(null, '', '/reset-password');
    expect(screen.queryByLabelText('Reset code')).toBeNull();
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'NewPass2027' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass2028' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('The new passwords do not match.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText(/signed out everywhere/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/api/auth/reset-password'))!.body).toEqual({ token: TOKEN, newPassword: 'NewPass2027' });
  });
  it('an invalid or used link explains what to do', async () => {
    mockApi({ '/reset-password/check': () => [{ valid: false, message: 'This reset link or code is not valid.' }] });
    wrap(<ResetPasswordPage />, `/reset-password?token=${TOKEN}`);
    expect(await screen.findByText('This reset link or code is not valid.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toBeInTheDocument();
  });
  it('code mode: email + staff code + policy check; server errors are shown', async () => {
    const calls = mockApi({ '/api/auth/reset-password': () => [{ error: { code: 'RESET_INVALID', message: 'This reset link or code is not valid.' } }, 400] });
    wrap(<ResetPasswordPage />, '/reset-password');
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'kofi@example.com' } });
    fireEvent.change(screen.getByLabelText('Reset code'), { target: { value: 'ABCD-EFGH-JKLM' } });
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'nodigits' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'nodigits' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('At least 10 characters')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'GoodPass2027' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'GoodPass2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('This reset link or code is not valid.')).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/api/auth/reset-password'))!.body).toEqual({ email: 'kofi@example.com', code: 'ABCD-EFGH-JKLM', newPassword: 'GoodPass2027' }));
  });
});

describe('staff reset secret', () => {
  it('shows the code and link once, and hides them on Done', () => {
    const done = vi.fn();
    render(<MemoryRouter><StaffResetSecret who="Ama" r={{ mode: 'link', code: 'ABCD-EFGH-JKLM', link: `https://ghlearn.com/reset-password?token=${TOKEN}`, expiresAt: new Date().toISOString() }} onDone={done} /></MemoryRouter>);
    expect(screen.getByLabelText('Reset code')).toHaveTextContent('ABCD-EFGH-JKLM'); expect(screen.getByLabelText('Reset link')).toHaveTextContent(TOKEN);
    fireEvent.click(screen.getByRole('button', { name: 'Done, hide it' })); expect(done).toHaveBeenCalled();
  });
});
