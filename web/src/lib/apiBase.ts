/**
 * API origin for this page.
 * - On ghlearn.com / www.ghlearn.com → api.ghlearn.com (first-party cookies, SameSite=Lax once flipped).
 * - On the Firebase default host → the URL baked in at build time (ghlearn-api.onrender.com).
 * - Locally → VITE_API_URL, or same-origin /api via the Vite proxy when unset.
 */
export function apiBase(): string {
  if (typeof location !== 'undefined') {
    const h = location.hostname;
    if (h === 'ghlearn.com' || h === 'www.ghlearn.com') return 'https://api.ghlearn.com';
  }
  return (import.meta.env.VITE_API_URL as string | undefined) ?? '';
}
