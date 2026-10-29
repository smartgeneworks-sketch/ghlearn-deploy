import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import { App } from './App';
import { navFor } from './components/Layout';
import { adminNavFor, ADMIN_SECTIONS, crumbsFor } from './admin/nav';
const renderAt = (path: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></QueryClientProvider>);
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
beforeEach(() => vi.restoreAllMocks());
describe('web app', () => {
  it('redirects unauthenticated users to sign in', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    renderAt('/learn');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
  it('validates the registration form client-side', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    renderAt('/register');
    fireEvent.click(await screen.findByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(1));
  });
  it('sends un-onboarded students to onboarding', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((u) => String(u).includes('/api/auth/session') ? json(200, { refresh: false, user: { id: '1', email: 'a@b.c', fullName: 'A', roles: ['student'], onboarded: false } }) : json(200, { items: [] }));
    renderAt('/learn');
    expect(await screen.findByText('Set up your learning space')).toBeInTheDocument();
  });
  it('builds role-specific navigation', () => {
    expect(navFor(['student']).map((n) => n.to)).toEqual(['/learn', '/progress', '/meetings']);
    expect(navFor(['counselor']).map((n) => n.to)).toEqual(['/meetings']);
    expect(navFor(['school_admin']).map((n) => n.to)).toEqual(['/admin']);
    expect(navFor(['teacher']).map((n) => n.to)).toEqual(['/teach', '/teach/assess', '/meetings']);
    expect(navFor(['content_reviewer']).map((n) => n.to)).toEqual(['/admin']);
    expect(navFor(['teacher', 'school_admin']).map((n) => n.to)).toEqual(['/teach', '/teach/assess', '/meetings', '/admin']);
    expect(navFor(['super_admin']).map((n) => n.to)).toEqual(['/admin']); // no student/teacher-only entries for super admins
  });
  it('admin sidebar: spec order, permission-filtered, no unbuilt sections', () => {
    const labels = (r: any[]) => adminNavFor(r).map((s) => s.label);
    expect(ADMIN_SECTIONS.map((s) => s.n)).toEqual([...Array(18).keys()].map((i) => i + 1)); // 16 spec sections + Public Website + Curriculum LMS
    expect(labels(['super_admin'])).toEqual(['Overview', 'Schools and Institutions', 'Users and Permissions', 'Academic Structure', 'Curriculum Management', 'Learner Manuals', 'AI Content Generation',
      'Content Review and Publishing', 'Question Bank and Assessments', 'Educational Games', 'Classes and Enrolments', 'Learning Analytics', 'AI Usage and Costs', 'Notifications', 'Audit Logs', 'System Settings', 'Public Website', 'Curriculum LMS Modules']);
    expect(labels(['school_admin'])).toEqual(['Overview', 'Schools and Institutions', 'Users and Permissions', 'Academic Structure', 'Learner Manuals', 'Classes and Enrolments', 'Learning Analytics', 'AI Usage and Costs', 'Notifications', 'Audit Logs']);
    expect(labels(['curriculum_admin'])).toEqual(['Overview', 'Academic Structure', 'Curriculum Management', 'Learner Manuals', 'AI Content Generation', 'Question Bank and Assessments', 'Educational Games', 'Learning Analytics', 'AI Usage and Costs', 'Curriculum LMS Modules']);
    expect(labels(['content_reviewer'])).toEqual(['Overview', 'Learner Manuals', 'AI Content Generation', 'Content Review and Publishing', 'Question Bank and Assessments', 'Educational Games', 'Learning Analytics', 'AI Usage and Costs', 'Curriculum LMS Modules']);
    expect(labels(['system_operator'])).toEqual(['Overview', 'AI Usage and Costs', 'System Settings']);
    expect(labels(['teacher'])).toEqual([]); expect(labels(['student'])).toEqual([]);
    expect(adminNavFor(['super_admin']).every((s) => s.to)).toBe(true);
  });
  it('admin breadcrumbs', () => {
    expect(crumbsFor('/admin').map((c) => c.label)).toEqual(['Admin', 'Overview']);
    expect(crumbsFor('/admin/users').map((c) => c.label)).toEqual(['Admin', 'Users and Permissions']);
    expect(crumbsFor('/admin/games/abc').map((c) => c.label)).toEqual(['Admin', 'Educational Games', 'Game']);
    expect(crumbsFor('/admin/questions/abc').map((c) => c.label)).toEqual(['Admin', 'Question Bank and Assessments', 'Question']);
    expect(crumbsFor('/admin/users/abc').map((c) => c.label)).toEqual(['Admin', 'Users and Permissions', 'User']);
    expect(crumbsFor('/admin/classes/import').map((c) => c.label)).toEqual(['Admin', 'Classes and Enrolments', 'Import enrolments']);
    expect(crumbsFor('/admin/classes/abc').map((c) => c.label)).toEqual(['Admin', 'Classes and Enrolments', 'Class']);
    expect(crumbsFor('/admin/lessons/abc')).toEqual([{ label: 'Admin', to: '/admin' }, { label: 'AI Content Generation', to: '/admin/lessons' }, { label: 'Lesson' }]);
    expect(crumbsFor('/admin/account').map((c) => c.label)).toEqual(['Admin', 'Account settings']);
    expect(crumbsFor('/admin/ai-usage').map((c) => c.label)).toEqual(['Admin', 'AI Usage and Costs']);
    expect(crumbsFor('/admin/notifications').map((c) => c.label)).toEqual(['Admin', 'Notifications']);
  });

  it('sends the CSRF token on unsafe requests and retries once when it is stale', async () => {
    const { post } = await import('./lib/api');
    let n = 0; const seen: (string | undefined)[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((u, init) => {
      if (String(u).endsWith('/api/auth/csrf')) return json(200, { csrfToken: `tok${++n}` });
      seen.push((init?.headers as any)?.['X-CSRF-Token']);
      return seen.length === 1 ? json(403, { error: { code: 'CSRF_INVALID', message: 'x' } }) : json(200, { ok: true });
    });
    expect(await post('/api/x', {})).toEqual({ ok: true });
    expect(seen).toEqual(['tok1', 'tok2']);
  });
});
