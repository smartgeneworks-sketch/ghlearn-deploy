import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResourcePage } from './Learn';
const res = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const wrap = (el: ReactElement, path: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes><Route path="/learn/:subjectId/r/:resourceId" element={el} /></Routes></MemoryRouter></QueryClientProvider>);
const locked = (details?: unknown) => (u: RequestInfo | URL) => String(u).includes('/api/resources/')
  ? res(403, { error: { code: 'MODULE_LOCKED', message: 'Complete the previous module first.', ...(details ? { details } : {}) } }) : res(200, {});
beforeEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('locked module (API 403 MODULE_LOCKED)', () => {
  it("shows the server's message and links to the previous module, not a 'not found' error", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(locked({ requires: 'r1' }) as any);
    wrap(<ResourcePage />, '/learn/s1/r/r2');
    expect(await screen.findByRole('heading', { name: 'This module is locked' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Complete the previous module first.');
    expect(screen.queryByText(/not found/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to the previous module' })).toHaveAttribute('href', '/learn/s1/r/r1');
    expect(screen.getByRole('link', { name: 'Back to the subject' })).toHaveAttribute('href', '/learn/s1');
  });
  it('still explains the lock when the server gives no previous module', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(locked() as any);
    wrap(<ResourcePage />, '/learn/s1/r/r2');
    expect(await screen.findByText('Complete the previous module first.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Go to the previous module' })).toBeNull();
  });
  it('keeps other errors as a plain alert', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(((u: any) => String(u).includes('/api/resources/') ? res(404, { error: { code: 'NOT_FOUND', message: 'Resource not found' } }) : res(200, {})) as any);
    wrap(<ResourcePage />, '/learn/s1/r/zz');
    expect(await screen.findByText('Resource not found')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'This module is locked' })).toBeNull();
  });
});
