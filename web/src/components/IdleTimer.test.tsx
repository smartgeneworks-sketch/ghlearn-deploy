import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({ user: { id: 'u1', roles: ['student'] } as any, logout: vi.fn(async (_o?: unknown) => { auth.user = null; }), setUser: vi.fn() }));
const api = vi.hoisted(() => ({ post: vi.fn(async (..._a: unknown[]) => ({})), put: vi.fn(async () => ({})) }));
vi.mock('../lib/auth', () => ({ useAuth: () => auth }));
vi.mock('../lib/platform', () => ({ usePlatform: () => ({ idle: { userSeconds: 120, adminSeconds: 60, warnSeconds: 30 }, features: { selfRegistration: true }, legal: { terms: false, privacy: false } }), Brand: () => 'GH Learn' }));
vi.mock('../lib/api', () => ({ post: api.post, put: api.put, api: vi.fn() }));
import { IdleTimer } from './IdleTimer';
import { LoginPage } from '../pages/Auth';
import { _resetIdleForTest, IDLE_KEY, registerBeforeIdleLogout, safeNext, trackBusy, onIdleMessage, broadcastLogout, idleMs } from '../lib/idle';

const Where = () => { const l = useLocation(); return <output data-testid="loc">{l.pathname + l.search}</output>; };
const app = (path = '/learn/maths?tab=2') => render(<MemoryRouter initialEntries={[path]}><IdleTimer /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const loc = () => screen.getByTestId('loc').textContent;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-17T10:00:00Z') }); localStorage.clear(); _resetIdleForTest(Date.now());
  auth.user = { id: 'u1', roles: ['student'] }; auth.logout.mockClear(); api.post.mockClear(); api.put.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('IdleTimer', () => {
  it('warns before the timeout with a countdown in an accessible dialog', async () => {
    app(); await advance(89_000);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await advance(2000);
    const dlg = screen.getByRole('alertdialog', { name: 'Are you still there?' });
    expect(dlg).toHaveAttribute('aria-modal', 'true'); expect(dlg).toHaveAccessibleDescription(/signed out because of inactivity in 0:29/);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stay signed in' }));
    await advance(10_000); expect(screen.getByRole('timer')).toHaveTextContent('0:19');
    // Passive movement does not dismiss the warning.
    fireEvent.mouseMove(window); await advance(1000); expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
  it('"Stay signed in" closes the warning, restarts the timer and pings the server', async () => {
    app(); await advance(95_000);
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(api.post).toHaveBeenCalledWith('/api/auth/activity', {});
    await advance(80_000); expect(screen.queryByRole('alertdialog')).toBeNull(); expect(auth.logout).not.toHaveBeenCalled();
    await advance(15_000); expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
  it('activity before the warning keeps the session; admin roles use the shorter limit', async () => {
    app(); await advance(60_000); fireEvent.keyDown(window, { key: 'a' }); await advance(60_000);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    cleanup(); _resetIdleForTest(Date.now()); auth.user = { id: 'a1', roles: ['curriculum_editor'] }; app();
    await advance(31_000); expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
  it('on timeout saves drafts, signs out with reason idle and redirects to the login page with a safe next', async () => {
    const saver = vi.fn(async () => undefined); registerBeforeIdleLogout(saver);
    app('/learn/maths/practice/abc?x=1'); await advance(121_000);
    expect(saver).toHaveBeenCalledOnce(); expect(auth.logout).toHaveBeenCalledWith({ reason: 'idle' });
    expect(loc()).toBe('/login?reason=idle&next=%2Flearn%2Fmaths%2Fpractice%2Fabc%3Fx%3D1');
  });
  it('a tutor stream or upload in progress counts as activity', async () => {
    let done!: () => void; const p = trackBusy(new Promise<void>((r) => { done = r; }));
    app(); expect(idleMs()).toBe(0); await advance(300_000);
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(auth.logout).not.toHaveBeenCalled();
    done(); await p; await advance(91_000); expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
  it('activity in another tab (shared last-activity time) keeps this tab alive', async () => {
    app(); await advance(95_000); expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    localStorage.setItem(IDLE_KEY, String(Date.now())); await advance(1000);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await advance(60_000); expect(auth.logout).not.toHaveBeenCalled();
  });
  it('the server ending the session for inactivity triggers the same sign-out', async () => {
    app(); await act(async () => { window.dispatchEvent(new CustomEvent('gl:idle-expired')); await vi.advanceTimersByTimeAsync(10); });
    expect(auth.logout).toHaveBeenCalledWith({ reason: 'idle' }); expect(loc()).toMatch(/^\/login\?reason=idle&next=/);
  });
});

describe('cross-tab sign-out', () => {
  it('a sign-out broadcast from another tab reaches this tab', async () => {
    vi.useRealTimers(); _resetIdleForTest();
    const got: any[] = []; const off = onIdleMessage((m) => got.push(m));
    const other = new BroadcastChannel('gl-idle'); other.postMessage({ type: 'logout', reason: 'idle' });
    await new Promise((r) => setTimeout(r, 50)); off(); other.close();
    expect(got).toContainEqual({ type: 'logout', reason: 'idle' });
    const seen: any[] = []; const listener = new BroadcastChannel('gl-idle'); listener.onmessage = (e) => seen.push(e.data);
    broadcastLogout('manual'); await new Promise((r) => setTimeout(r, 50)); listener.close();
    expect(seen).toContainEqual({ type: 'logout', reason: 'manual' });
  });
});

describe('safe next and the login page', () => {
  it('accepts only same-site paths', () => {
    expect(safeNext('/learn/x?y=1#z')).toBe('/learn/x?y=1#z');
    for (const bad of ['https://evil.test/', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '/javascript:alert(1)', 'learn', '/login?next=/x', '', null, '/a\nb']) expect(safeNext(bad)).toBeNull();
  });
  it('shows the inactivity message and returns to next after signing in', async () => {
    vi.useRealTimers(); auth.user = null; api.post.mockResolvedValueOnce({ user: { id: 'u1', roles: ['student'] } });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/login?reason=idle&next=%2Flearn%2Fmaths%3Ftab%3D2']}><Routes><Route path="/login" element={<LoginPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText('You were signed out after a period of inactivity.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Email or phone number/), { target: { value: 'ama@sample.ghlearn.test' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'SamplePass2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('loc')).toHaveTextContent('/learn/maths?tab=2');
  });
  it('ignores an unsafe next', async () => {
    vi.useRealTimers(); auth.user = null; api.post.mockResolvedValueOnce({ user: { id: 'u1', roles: ['student'] } });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/login?next=https%3A%2F%2Fevil.test']}><Routes><Route path="/login" element={<LoginPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByText(/period of inactivity/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Email or phone number/), { target: { value: 'ama@sample.ghlearn.test' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'SamplePass2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('loc')).toHaveTextContent(/^\/$/);
  });
});
