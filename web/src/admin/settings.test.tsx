import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SystemSettingsPage } from './settings';
const res = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const S = {
  branding: { appName: 'GH Learn', tagline: 't', logo: null, supportEmail: '' }, theme: { preset: 'green' }, review: { remindersEnabled: true, reminderAfterHours: 24 },
  uploads: { maxUploadMb: 60, formats: ['pdf', 'docx', 'txt', 'csv'], ocrEnabled: true, ocrMaxPages: 40 }, notifications: { emailEnabled: true, announcementMaxDays: 180 },
  retention: { notificationDays: 365, aiUsageDays: 400, jobDays: 90, auditDays: 730, tutorDays: 180, purgeEnabled: true },
  sessions: { accessMinutes: 15, sessionDays: 14, lockoutAttempts: 8, lockoutMinutes: 15 }, offline: { bundleEnabled: true, saveLessonsEnabled: true, bundleMaxResources: 200 },
  features: { selfRegistration: true, tutor: true, practice: true, games: true, meetings: true, assessments: true }, maintenance: { enabled: false, message: '', until: null }, legal: { terms: '', privacy: '' },
};
const data = (canEdit: boolean) => ({ settings: S, version: 3, updatedAt: null, updatedBy: null, legal: { version: 0, updatedAt: null }, canEdit,
  limits: { uploadMaxMbEnv: 60, ocrMaxPagesEnv: 40, selfRegistrationEnv: true, emailConfigured: false },
  themes: [{ key: 'green', label: 'Forest green (default)', 900: '#064e3b', 700: '#047857', 100: '#d1fae5' }, { key: 'blue', label: 'Royal blue', 900: '#1e3a8a', 700: '#1d4ed8', 100: '#dbeafe' }],
  features: { selfRegistration: 'Self-registration', tutor: 'AI tutor', practice: 'Practice', games: 'Learning games', meetings: 'Meetings', assessments: 'Teacher assessments' },
  academic: { years: [{ _id: 'y1', label: '2026/2027', current: true }], levels: [{ _id: 'l1', name: 'SHS', kind: 'shs', years: 3, enabled: true }] },
  review: { mandatoryReview: true, selfApproval: false, note: 'Every item is reviewed before publishing.' },
  ai: { platformDailyRequests: 40, perUserDailyRequests: 30, schoolDailyRequests: 200, allowedFeatures: ['tutor'], llmModel: null, maxRetries: 3, timeoutSec: 180 },
  retention: { notifications: { days: 365, due: 2 }, aiUsage: { days: 400, due: 0 }, jobs: { days: 90, due: 0 }, tutorConversations: { days: 180, due: 0 }, auditLogs: { days: 730, due: 0 } } });
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><SystemSettingsPage /></MemoryRouter></QueryClientProvider>);
beforeEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('System settings page', () => {
  it('a high-impact change opens the confirmation dialog with the server\'s reasons, then re-sends with confirm', async () => {
    const calls: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((u, init) => {
      const url = String(u);
      if (url.includes('/api/auth/csrf')) return res({ csrfToken: 't' });
      if (url.endsWith('/api/admin/settings') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)); calls.push(body);
        return body.confirm ? res({ settings: S, changed: ['features.games'], version: 4 }) : res({ error: { code: 'CONFIRM_REQUIRED', message: 'These changes need confirmation', details: { changes: [{ key: 'features.games', reason: 'Switches off Learning games for every school' }] } } }, 409);
      }
      return res(data(true));
    });
    wrap();
    const box = (await screen.findByRole('heading', { name: 'Feature flags' })).closest('section')!;
    fireEvent.click(within(box).getByLabelText('Learning games'));
    fireEvent.click(within(box).getByRole('button', { name: 'Save' }));
    const dlg = await screen.findByRole('alertdialog', { name: 'Confirm high-impact change' });
    expect(within(dlg).getByText('Switches off Learning games for every school')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toEqual({ features: { games: false } }); expect(calls[1]).toEqual({ features: { games: false }, confirm: true });
    expect(screen.getByText(/Email is not configured on the server/)).toBeInTheDocument();
  });
  it('is read-only without edit rights and has a Status tab', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((u) => (String(u).includes('/api/admin/system') ? res({ error: { message: 'x' } }, 500) : res(data(false))));
    wrap();
    expect(await screen.findByText('You can view these settings. Only a Super Admin can change them.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull(); expect(screen.getByLabelText('App name')).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Status' })); expect(screen.getByRole('tab', { name: 'Status' })).toHaveAttribute('aria-selected', 'true');
  });
});
