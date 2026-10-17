import { hasPermission, type Permission, type Role } from '@ghlearn/shared';
import { LayoutDashboard, School, Users, Layers, BookMarked, FileText, Sparkles, ClipboardCheck, ListChecks, Gamepad2, UsersRound, BarChart3, Cpu, Bell, ScrollText, Settings, Globe, type LucideIcon } from 'lucide-react';

/**
 * The 16 admin sections in spec §3 order. `to` is set only for sections that are built; unbuilt sections are
 * never rendered (no dead buttons). `any` = the user needs at least one of these permissions. The server
 * enforces the same permissions on every endpoint (menu visibility is never relied on, spec §4).
 */
export interface AdminSection { n: number; key: string; label: string; to?: string; any: Permission[]; icon: LucideIcon; phase?: number }
export const ADMIN_SECTIONS: AdminSection[] = [
  { n: 1, key: 'overview', label: 'Overview', to: '/admin', any: ['admin:access'], icon: LayoutDashboard },
  { n: 2, key: 'schools', label: 'Schools and Institutions', to: '/admin/schools', any: ['school:create', 'school:manage'], icon: School },
  { n: 3, key: 'users', label: 'Users and Permissions', to: '/admin/users', any: ['users:manage'], icon: Users },
  { n: 4, key: 'structure', label: 'Academic Structure', to: '/admin/structure', any: ['config:manage', 'curriculum:manage'], icon: Layers },
  { n: 5, key: 'curriculum', label: 'Curriculum Management', to: '/admin/curriculum', any: ['curriculum:manage'], icon: BookMarked },
  { n: 6, key: 'manuals', label: 'Learner Manuals', to: '/admin/documents', any: ['documents:upload', 'documents:map', 'content:review'], icon: FileText },
  { n: 7, key: 'generation', label: 'AI Content Generation', to: '/admin/lessons', any: ['content:edit'], icon: Sparkles },
  { n: 8, key: 'review', label: 'Content Review and Publishing', to: '/admin/review', any: ['content:review'], icon: ClipboardCheck },
  { n: 9, key: 'questions', label: 'Question Bank and Assessments', to: '/admin/questions', any: ['content:edit', 'content:review'], icon: ListChecks },
  { n: 10, key: 'games', label: 'Educational Games', to: '/admin/games', any: ['content:edit', 'content:review'], icon: Gamepad2 },
  { n: 11, key: 'classes', label: 'Classes and Enrolments', to: '/admin/classes', any: ['users:manage'], icon: UsersRound },
  { n: 12, key: 'analytics', label: 'Learning Analytics', to: '/admin/analytics', any: ['analytics:view'], icon: BarChart3 },
  { n: 13, key: 'ai-usage', label: 'AI Usage and Costs', to: '/admin/ai-usage', any: ['analytics:view', 'system:health'], icon: Cpu },
  { n: 14, key: 'notifications', label: 'Notifications', to: '/admin/notifications', any: ['users:manage'], icon: Bell },
  { n: 15, key: 'audit', label: 'Audit Logs', to: '/admin/audit', any: ['audit:view'], icon: ScrollText },
  { n: 16, key: 'system', label: 'System Settings', to: '/admin/system', any: ['system:health'], icon: Settings },
  { n: 17, key: 'website', label: 'Public Website', to: '/admin/website', any: ['platform:manage'], icon: Globe },
];
export const can = (roles: readonly Role[], any: Permission[]) => any.some((p) => hasPermission(roles, p));
/** Sidebar items for these roles: built sections the user may use, in spec order. */
export const adminNavFor = (roles: readonly Role[]) => ADMIN_SECTIONS.filter((s) => s.to && can(roles, s.any)) as (AdminSection & { to: string })[];

/** Breadcrumb trail for an admin path: Admin › Section › page. */
const EXTRA: Record<string, string> = { '/admin/classes/import': 'Import enrolments', '/admin/account': 'Account settings', '/admin/search': 'Search results', '/admin/processing': 'Document processing monitor' };
/** Who may open the processing monitor (spec §10: System Operator, Curriculum Admin). */
export const MONITOR_PERMS: Permission[] = ['system:health', 'curriculum:manage'];
export function crumbsFor(path: string): { label: string; to?: string }[] {
  const p = path.replace(/\/+$/, '') || '/admin';
  const trail: { label: string; to?: string }[] = [{ label: 'Admin', to: '/admin' }];
  if (p === '/admin') return [...trail, { label: 'Overview' }];
  if (p === '/admin/classes/import') return [...trail, { label: 'Classes and Enrolments', to: '/admin/classes' }, { label: EXTRA[p] }];
  if (EXTRA[p]) return [...trail, { label: EXTRA[p] }];
  if (p.startsWith('/admin/processing/')) return [...trail, { label: EXTRA['/admin/processing'], to: '/admin/processing' }, { label: 'Job' }];
  const s = ADMIN_SECTIONS.filter((x) => x.to && x.to !== '/admin' && (p === x.to || p.startsWith(x.to + '/'))).sort((a, b) => b.to!.length - a.to!.length)[0];
  if (!s) return [...trail, { label: 'Page' }];
  if (p === s.to) return [...trail, { label: s.label }];
  const leaf = ({ curriculum: 'Curriculum version', manuals: 'Document', generation: 'Lesson', users: 'User', schools: 'School', classes: 'Class', questions: 'Question', games: 'Game' } as Record<string, string>)[s.key] ?? 'Detail';
  return [...trail, { label: s.label, to: s.to }, { label: leaf }];
}
