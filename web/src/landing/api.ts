import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hasPermission } from '@ghlearn/shared';
import { LANDING_DEFAULTS, withName, type LandingContent, type EnquiryInput } from '@ghlearn/shared/src/landing';
import { api, post, type PublicUser } from '../lib/api';
import { navFor } from '../components/Layout';
/** Data layer for the public site (UI components never call fetch directly). */
export interface PublicLevel { id: string; name: string; kind: string; enabled: boolean }
export interface LandingData {
  content: LandingContent; version: number; branding: { appName: string; tagline: string; logo: string | null; supportEmail: string }; levels: PublicLevel[];
  features: { selfRegistration: boolean; tutor: boolean; practice: boolean; games: boolean; assessments: boolean; meetings?: boolean }; legal: { terms: boolean; privacy: boolean };
}
export interface SubjectCardData { id: string; name: string; code: string; category: string; level: { name: string; kind: string }; documents: number | null; publishedLessons: number }
export interface SearchResult { q: string; subjects: SubjectCardData[]; topics: { title: string; subject: { id: string; name: string; level: string } }[]; lessons: { id: string; title: string; topic: string | null; subject: { id: string; name: string; level: string } }[] }
export interface PreviewSection { key: string; kind: string; title: string; content: string; data: any }
export interface PreviewLesson { id: string; title: string; topic: string | null; yearOfStudy: number | null; subject: { id: string; name: string; level: string }; sections: PreviewSection[]; sources: { title: string; approvalStatus: string }[] }

/** Fallback while the API wakes up: the defaults (real copy, no data) so the page renders at once. */
const FALLBACK: LandingData = { content: LANDING_DEFAULTS, version: 0, branding: { appName: 'GH Learn', tagline: '', logo: null, supportEmail: '' }, levels: [],
  features: { selfRegistration: true, tutor: true, practice: true, games: true, assessments: true, meetings: true }, legal: { terms: false, privacy: false } };
export function useLanding(): LandingData & { ready: boolean; t: (s: string) => string } {
  const q = useQuery({ queryKey: ['public-landing'], queryFn: () => api<LandingData>('/api/public/landing'), staleTime: 60_000, retry: 2 });
  const d = q.data ?? FALLBACK;
  return { ...d, ready: !!q.data, t: (s: string) => withName(s, d.branding.appName) };
}
export const useSubjects = (filter: string | null, featured = false) => useQuery({ queryKey: ['public-subjects', filter, featured],
  queryFn: () => api<{ items: SubjectCardData[]; filter: { id: string; label: string } | null; levelClosed: string | null }>(`/api/public/subjects?${new URLSearchParams({ ...(filter ? { filter } : {}), ...(featured ? { featured: '1' } : {}) })}`), staleTime: 60_000, retry: 2 });
export const usePublicSubject = (id: string) => useQuery({ queryKey: ['public-subject', id], queryFn: () => api<{ subject: SubjectCardData; topics: { title: string; type: string }[]; previews: { id: string; title: string; topic: string | null }[] }>(`/api/public/subjects/${id}`), retry: 1 });
export const usePreviewLesson = (id: string) => useQuery({ queryKey: ['public-lesson', id], queryFn: () => api<{ lesson: PreviewLesson }>(`/api/public/lessons/${id}`), retry: 1, enabled: !!id });
export function useDebounced<T>(v: T, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }
export function useSearch(term: string) {
  const q = useDebounced(term.trim(), 300);
  return { debounced: q, ...useQuery({ queryKey: ['public-search', q], queryFn: () => api<SearchResult>(`/api/public/search?q=${encodeURIComponent(q)}`), enabled: q.length >= 2, staleTime: 30_000, retry: 1 }) };
}
export const sendEnquiry = (b: Omit<EnquiryInput, 'website'> & { website?: string }) => post<{ reference: string; received: true }>('/api/public/enquiries', b);

/** Where a signed-in user's "Continue Learning" goes: admins → admin panel, otherwise the first area of their role. */
export function homeFor(user: PublicUser, features: Record<string, boolean> = {}) {
  if (hasPermission(user.roles, 'admin:access')) return '/admin';
  return navFor(user.roles, features)[0]?.to ?? '/';
}
/** Telephone link from a displayed number: keeps + and digits. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^+0-9]/g, '')}`;
