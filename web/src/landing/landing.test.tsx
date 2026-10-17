import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LANDING_DEFAULTS, landingSchema } from '@ghlearn/shared/src/landing';
import { AuthProvider } from '../lib/auth';
import { App } from '../App';
import { FAQAccordion, SampleQuiz, QUIZ } from './Sections';
import { LearningSearch } from './Discovery';
import { telHref } from './api';
import { LiveSessionsSection, liveSessionsCta, STUDENT_PHOTO_ALT } from './LiveSessions';

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const LANDING = { content: LANDING_DEFAULTS, version: 0, branding: { appName: 'GH Learn', tagline: '', logo: null, supportEmail: '' }, levels: [], features: { selfRegistration: true, tutor: true, practice: true, games: true, assessments: true }, legal: { terms: false, privacy: false } };
const wrap = (ui: React.ReactNode, path = '/') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><AuthProvider>{ui}</AuthProvider></MemoryRouter></QueryClientProvider>);
function mockApi(user: unknown = null, extra: (u: string) => Promise<Response> | undefined = () => undefined) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => { const u = String(input);
    return extra(u) ?? (u.includes('/api/auth/session') ? json({ user, refresh: false }) : u.includes('/api/public/landing') ? json(LANDING) : u.includes('/api/public/subjects') ? json({ items: [], filter: null, levelClosed: null }) : json({ items: [] })); });
}
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('landing content defaults', () => {
  it('are valid, use the spec copy verbatim and seed the organisation details', () => {
    expect(landingSchema.safeParse(LANDING_DEFAULTS).success).toBe(true);
    expect(LANDING_DEFAULTS.hero.title).toBe('Your Curriculum. Your AI Tutor. Your Path to Success.');
    expect(LANDING_DEFAULTS.hero.note).toBe('Built around approved curriculum materials. Designed for active learning.');
    expect(LANDING_DEFAULTS.search.placeholder).toBe('Search a subject, topic or concept...');
    expect(LANDING_DEFAULTS.faqs).toHaveLength(13);
    expect(LANDING_DEFAULTS.liveSessions.title).toBe('Learn live with your teachers');
    // honest wording: no built-in video calling, no teachers from other schools
    const live = JSON.stringify([LANDING_DEFAULTS.liveSessions, LANDING_DEFAULTS.faqs.find((f) => /meet my teachers/.test(f.q))]);
    expect(live).toMatch(/your own school/); expect(live).toMatch(/does not host the video call/); expect(live).not.toMatch(/any teacher|other schools|built-in video|video calling/i);
    expect(LANDING_DEFAULTS.organisation).toEqual({ poweredByLabel: '', name: 'SmartGene Solutions', address: 'P. O. Box AH1237, Achimota, Accra, Ghana', email: 'info@smartgenesolutions.com', phone: '+233 53 050 6573', hashtag: '#smartgene' });
    expect(telHref(LANDING_DEFAULTS.organisation.phone)).toBe('tel:+233530506573');
  });
  it('reject unsafe links', () => {
    for (const href of ['javascript:alert(1)', 'http://x.example', '//evil.example', 'data:text/html,x']) expect(landingSchema.safeParse({ ...LANDING_DEFAULTS, hero: { ...LANDING_DEFAULTS.hero, primaryCta: { label: 'Go', href } } }).success, href).toBe(false);
  });
});

describe('landing components', () => {
  it('FAQ accordion: one open at a time, aria-expanded and hidden panels', async () => {
    mockApi(); wrap(<FAQAccordion />);
    const btns = await screen.findAllByRole('button', { expanded: false }); const first = screen.getByRole('button', { name: 'What is this learning platform?' });
    expect(first).toHaveAttribute('aria-expanded', 'true'); expect(btns.length).toBe(12);
    const q2 = screen.getByRole('button', { name: 'Is the platform free?' }); fireEvent.click(q2);
    expect(q2).toHaveAttribute('aria-expanded', 'true'); expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', { name: 'Is the platform free?' })).toHaveTextContent(/costs nothing/);
    fireEvent.click(q2); expect(q2).toHaveAttribute('aria-expanded', 'false');
  });
  it('sample quiz: select, explanatory feedback, next, score and reset', () => {
    mockApi(); wrap(<SampleQuiz />);
    fireEvent.click(screen.getByRole('button', { name: 'Oxygen' }));
    expect(screen.getByText(/Not quite. The answer is “Carbon dioxide”/)).toBeInTheDocument(); expect(screen.getByText(/^Why:/)).toHaveTextContent(QUIZ[0].why);
    fireEvent.click(screen.getByRole('button', { name: 'Next question' })); fireEvent.click(screen.getByRole('button', { name: '15' }));
    expect(screen.getByText('Correct!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next question' })); fireEvent.click(screen.getByRole('button', { name: /Planting trees/ }));
    expect(screen.getByRole('status')).toHaveTextContent('You scored 2 of 3.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(screen.getByText(/Question 1 of 3/)).toBeInTheDocument(); expect(screen.queryByText(/^Why:/)).toBeNull();
  });
  it('search is debounced, needs 2 characters, shows grouped results and an empty state, and clears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = mockApi(null, (u) => (u.includes('/api/public/search') ? json(u.includes('zzz') ? { q: 'zzz', subjects: [], topics: [], lessons: [] }
      : { q: 'photo', subjects: [], topics: [{ title: 'Photosynthesis in green plants', subject: { id: 'a'.repeat(24), name: 'Biology', level: 'SHS' } }], lessons: [{ id: 'b'.repeat(24), title: 'Photosynthesis basics', topic: null, subject: { id: 'a'.repeat(24), name: 'Biology', level: 'SHS' } }] }) : undefined));
    wrap(<LearningSearch />); const box = await screen.findByRole('searchbox');
    const calls = () => f.mock.calls.filter((c) => String(c[0]).includes('/api/public/search')).length;
    fireEvent.change(box, { target: { value: 'p' } }); expect(screen.getByText('Type at least 2 characters.')).toBeInTheDocument();
    for (const v of ['ph', 'pho', 'phot', 'photo']) fireEvent.change(box, { target: { value: v } });
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(await screen.findByRole('link', { name: /Photosynthesis basics/ })).toHaveAttribute('href', `/preview/${'b'.repeat(24)}`);
    expect(screen.getByRole('link', { name: /Photosynthesis in green plants/ })).toHaveAttribute('href', `/subjects/${'a'.repeat(24)}#topics`);
    expect(calls()).toBe(1);
    fireEvent.change(box, { target: { value: 'zzz' } }); await act(async () => { vi.advanceTimersByTime(350); });
    expect(await screen.findByText(/No public results for “zzz”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' })); expect(box).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Photosynthesis' })); expect(box).toHaveValue('Photosynthesis');
  });
});

describe('live sessions section', () => {
  it('CTA: visitors register, students book under Meetings, hosts manage, others get no CTA', () => {
    expect(liveSessionsCta(null, true)).toEqual({ to: '/register', kind: 'visitor' });
    expect(liveSessionsCta(null, false)).toEqual({ to: '/login', kind: 'visitor' });
    expect(liveSessionsCta({ roles: ['student'] }, true)).toEqual({ to: '/meetings', kind: 'student' });
    expect(liveSessionsCta({ roles: ['teacher'] }, true)).toEqual({ to: '/meetings', kind: 'host' });
    expect(liveSessionsCta({ roles: ['counselor'] }, true)).toEqual({ to: '/meetings', kind: 'host' });
    expect(liveSessionsCta({ roles: ['super_admin'] }, true)).toBeNull();
  });
  it('renders the benefits, a labelled example booking and a lazy responsive photo with alt text', async () => {
    mockApi(); wrap(<LiveSessionsSection />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Learn live with your teachers' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(4);
    expect(screen.getByText('Example')).toBeInTheDocument(); expect(screen.getByText(/Example booking/)).toBeInTheDocument();
    const img = screen.getByRole('img', { name: STUDENT_PHOTO_ALT });
    expect(img).toHaveAttribute('loading', 'lazy'); expect(img.getAttribute('srcset')).toMatch(/480w.*800w.*1200w/);
    expect(img.closest('picture')!.querySelector('source[type="image/avif"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: /Sign up to book a session/ })).toHaveAttribute('href', '/register');
    expect(screen.queryByRole('link', { name: /Join online meeting/ })).toBeNull(); // the example is not a live link
  });
  it('is hidden when meetings are switched off', async () => {
    mockApi(null, (u) => (u.includes('/api/public/landing') ? json({ ...LANDING, features: { ...LANDING.features, meetings: false } }) : undefined));
    const { container } = wrap(<LiveSessionsSection />);
    await waitFor(() => expect(container.querySelector('#live-sessions')).toBeNull());
  });
});

describe('auth-aware navigation', () => {
  it('visitors see Log In and Start Learning Free; the logo goes home', async () => {
    mockApi(); wrap(<App />, '/');
    const nav = await screen.findByRole('banner');
    expect(within(nav).getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/login');
    expect(within(nav).getByRole('link', { name: 'Start Learning Free' })).toHaveAttribute('href', '/register');
    expect(within(nav).getByRole('link', { name: 'GH Learn home' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: /Admin panel/ })).toBeNull();
  });
  it('signed-in students get Continue Learning to /learn, no admin link, logo goes to the dashboard', async () => {
    const student = { id: '1', email: 'a@b.c', fullName: 'A', roles: ['student'], onboarded: true };
    mockApi(student); wrap(<App />, '/teachers');
    await screen.findByRole('heading', { level: 1 }); const nav = screen.getAllByRole('banner')[0];
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'Continue Learning' })).toHaveAttribute('href', '/learn'));
    expect(within(nav).getByRole('link', { name: /go to your dashboard/ })).toHaveAttribute('href', '/learn');
    expect(screen.queryByRole('link', { name: /Admin panel/ })).toBeNull(); expect(within(nav).queryByRole('link', { name: 'Log In' })).toBeNull();
  });
  it('admins get the admin panel; teachers who are also admins get both', async () => {
    mockApi({ id: '2', email: 't@b.c', fullName: 'T', roles: ['teacher', 'school_admin'], onboarded: true }); wrap(<App />, '/schools');
    await screen.findByRole('heading', { level: 1 }); const nav = screen.getAllByRole('banner')[0];
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'Continue Learning' })).toHaveAttribute('href', '/admin'));
    expect(within(nav).getByRole('link', { name: /Teacher workspace/ })).toHaveAttribute('href', '/teach');
  });
});
