/**
 * Ghana mobile numbers. Stored in national form 0XXXXXXXXX; +233XXXXXXXXX for display/E.164.
 * Prefixes (NCA numbering): MTN 024 025 053 054 055 059; Telecel 020 050; AirtelTigo 026 027 056 057.
 */
export const NETWORKS: Record<string, 'MTN' | 'Telecel' | 'AirtelTigo'> = {
  '024': 'MTN', '025': 'MTN', '053': 'MTN', '054': 'MTN', '055': 'MTN', '059': 'MTN',
  '020': 'Telecel', '050': 'Telecel',
  '026': 'AirtelTigo', '027': 'AirtelTigo', '056': 'AirtelTigo', '057': 'AirtelTigo',
};
export interface GhPhone { local: string; e164: string; network: 'MTN' | 'Telecel' | 'AirtelTigo' }
/** Accepts 0XXXXXXXXX, +233XXXXXXXXX, 233XXXXXXXXX, 00233…, or the 9 digits, with spaces, dashes, dots or brackets. Null if not a Ghana mobile number. */
export function normalizeGhPhone(input: unknown): GhPhone | null {
  if (typeof input !== 'string' || input.length > 30) return null;
  let d = input.trim().replace(/[\s().-]/g, '');
  if (d.startsWith('+')) d = d.slice(1); if (d.startsWith('00')) d = d.slice(2);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith('233') && d.length === 12) d = '0' + d.slice(3);
  else if (d.length === 9) d = '0' + d;
  if (!/^0\d{9}$/.test(d)) return null;
  const network = NETWORKS[d.slice(0, 3)]; if (!network) return null;
  return { local: d, e164: '+233' + d.slice(1), network };
}
/** 0530506573 -> 053****573. Anything else keeps only its last 2 characters. */
export const maskPhone = (p?: string | null) => (!p ? '' : /^0\d{9}$/.test(p) ? `${p.slice(0, 3)}****${p.slice(7)}` : `****${p.slice(-2)}`);
/** Treats an identifier as a phone number only when it has no @ and normalises. */
export const phoneIdentifier = (s: string) => (s.includes('@') ? null : normalizeGhPhone(s));
