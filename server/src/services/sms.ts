import { config } from '../config.js';
import { SmsCounter, SmsLog } from '../models/index.js';
import { getSettings } from './platformSettings.js';
import { maskPhone, normalizeGhPhone } from './phone.js';
import { logger } from '../lib/logger.js';

/**
 * Provider-independent SMS. Adapter: BMS Africa / mNotify v2 (https://developer.bms.africa/, BMS_API_KEY in the environment
 * only). SMS_PROVIDER=test is an in-memory fake allowed only under NODE_ENV=test.
 * Every attempt is logged with a masked number and never the message body. A daily cap (System settings → SMS) is enforced
 * with an atomic per-day counter before the provider is called, so the wallet cannot be drained by a burst.
 */
export type SmsKind = 'otp' | 'reset' | 'notification' | 'test';
export interface SendReq { to: string[]; sender: string; message: string; otp: boolean }
export type ProviderResult = { ok: true; campaignId?: string; credits?: number; code?: string } | { ok: false; error: string; code?: string; httpStatus?: number };
export interface SmsAdapter {
  name: string;
  send(r: SendReq): Promise<ProviderResult>;
  balance(): Promise<{ ok: true; smsCredits: number | null; bonus: number | null; wallet: string | null } | { ok: false; error: string }>;
  senderStatus(name: string): Promise<{ ok: true; status: string } | { ok: false; error: string; notFound?: boolean }>;
  registerSender(name: string, purpose: string): Promise<{ ok: true; status: string } | { ok: false; error: string }>;
  report(campaignId: string): Promise<{ ok: true; statuses: string[] } | { ok: false; error: string }>;
}
type Fetch = typeof fetch; let fetchImpl: Fetch = (...a) => fetch(...a);
export const setSmsFetchForTest = (f: Fetch | null) => { fetchImpl = f ?? ((...a) => fetch(...a)); };

/** mNotify v2: POST {base}/sms/quick?key=… {recipient[], sender, message, is_schedule, schedule_date[, sms_type:'otp']}; success = code 2000. */
export function mnotifyAdapter(key: string, base = config.SMS_API_BASE): SmsAdapter {
  const scrub = (s: unknown) => String(s ?? '').split(key).join('[key]').slice(0, 300);
  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const url = `${base}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
    try {
      const r = await fetchImpl(url, { method, headers: { 'content-type': 'application/json', accept: 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
      const t = await r.text(); let json: any = null; try { json = JSON.parse(t); } catch { json = { message: t.slice(0, 200) }; }
      return { status: r.status, json };
    } catch (e: any) { return { status: 0, json: { status: 'error', message: scrub(e?.name === 'TimeoutError' ? 'timed out' : e?.message ?? e) } }; }
  }
  const okCode = (j: any) => j && j.status === 'success' && (j.code === undefined || String(j.code) === '2000');
  const err = (x: { status: number; json: any }) => scrub(x.json?.message ?? `HTTP ${x.status}`) + (x.status ? ` (HTTP ${x.status})` : '');
  return {
    name: 'mnotify',
    async send(r) {
      const x = await call('POST', '/sms/quick', { recipient: r.to, sender: r.sender, message: r.message, is_schedule: false, schedule_date: '', ...(r.otp && config.SMS_OTP_ROUTE === 'true' ? { sms_type: 'otp' } : {}) });
      if (x.status === 200 && okCode(x.json)) return { ok: true, campaignId: x.json.summary?._id ? String(x.json.summary._id) : undefined, credits: Number(x.json.summary?.credit_used) || undefined, code: String(x.json.code ?? '2000') };
      return { ok: false, error: err(x), code: x.json?.code != null ? String(x.json.code) : undefined, httpStatus: x.status };
    },
    async balance() {
      const x = await call('GET', '/balance/sms');
      if (x.status === 200 && x.json?.status === 'success') return { ok: true, smsCredits: x.json.balance ?? null, bonus: x.json.bonus ?? null, wallet: x.json.wallet != null ? String(x.json.wallet) : null };
      return { ok: false, error: err(x) };
    },
    async senderStatus(name) {
      const x = await call('POST', '/senderid/status', { sender_name: name });
      if (x.status === 200 && okCode(x.json)) return { ok: true, status: String(x.json.summary?.status ?? 'unknown').toLowerCase() };
      return { ok: false, error: err(x), notFound: x.status === 404 };
    },
    async registerSender(name, purpose) {
      const x = await call('POST', '/senderid/register', { sender_name: name, purpose });
      if (x.status === 200 && okCode(x.json)) return { ok: true, status: String(x.json.summary?.status ?? 'pending').toLowerCase() };
      return { ok: false, error: err(x) };
    },
    async report(id) {
      const x = await call('GET', `/campaign/${encodeURIComponent(id)}`);
      if (x.status === 200 && x.json?.status === 'success') { const rep = x.json.report; const list = Array.isArray(rep) ? rep : rep ? [rep] : [];
        return { ok: true, statuses: list.map((r: any) => String(r.status ?? 'unknown').toLowerCase()) }; }
      return { ok: false, error: err(x) };
    },
  };
}
/** Test fake: records messages (including the body, test runs only) and answers like an approved account. */
export const testOutbox: { to: string[]; sender: string; message: string; otp: boolean; at: Date }[] = [];
export const testControl = { fail: null as null | string, senderStatus: 'approved', balance: 120 };
export function testAdapter(): SmsAdapter {
  return {
    name: 'test',
    async send(r) { if (testControl.fail) return { ok: false, error: testControl.fail, code: '1004' }; testOutbox.push({ ...r, at: new Date() }); return { ok: true, campaignId: `TEST-${testOutbox.length}`, credits: 1, code: '2000' }; },
    async balance() { return { ok: true, smsCredits: testControl.balance, bonus: 0, wallet: '0' }; },
    async senderStatus() { return { ok: true, status: testControl.senderStatus }; },
    async registerSender() { return { ok: true, status: 'pending' }; },
    async report() { return { ok: true, statuses: ['delivered'] }; },
  };
}
let override: SmsAdapter | null | undefined;
export const setSmsAdapterForTest = (a: SmsAdapter | null | undefined) => { override = a; };
export function smsAdapter(): SmsAdapter | null {
  if (override !== undefined) return override;
  if (config.SMS_PROVIDER === 'test') return config.NODE_ENV === 'test' ? testAdapter() : null;
  // Tests and the E2E server never reach the real provider, even if a key happens to be in the environment.
  if (config.NODE_ENV === 'test') return null;
  if (config.BMS_API_KEY && (config.SMS_PROVIDER ?? 'mnotify') === 'mnotify') return mnotifyAdapter(config.BMS_API_KEY);
  return null;
}
export const smsConfigured = () => !!smsAdapter();
export async function smsSender() { const s = (await getSettings()).sms; return (s.senderId || config.SMS_SENDER_ID || '').trim(); }
/** SMS can actually be sent: provider configured, switched on, sender ID set. (Approval is the provider's call; failures are logged.) */
export async function smsAvailable() { if (!smsConfigured()) return false; const s = (await getSettings()).sms; return s.enabled && !!(await smsSender()) && s.dailyCap > 0; }

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
export async function sentToday() { return (await SmsCounter.findOne({ day: utcDay() }).lean())?.n ?? 0; }
/** Claims one unit of today's cap; false when the cap is reached. */
async function claim(cap: number) {
  const day = utcDay();
  const r = await SmsCounter.findOneAndUpdate({ day }, { $inc: { n: 1 } }, { upsert: true, new: true }).lean();
  if (r!.n <= cap) return true;
  await SmsCounter.updateOne({ day }, { $inc: { n: -1 } }); return false;
}
/** GSM-7-friendly, single segment: collapses whitespace, replaces smart quotes/dashes, trims to 160. */
export function smsText(s: string, max = 160) {
  const t = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 3).trimEnd() + '...';
}
export type SmsOutcome = { status: 'sent'; logId: string; campaignId?: string } | { status: 'failed'; logId: string; error: string } | { status: 'not_configured' | 'disabled' | 'cap_reached' | 'no_sender' | 'invalid_number'; logId?: string };
/**
 * Sends one SMS. OTP/reset messages use BMS OTP routing (sms_type "otp") only when SMS_OTP_ROUTE=true: that route is paid from the
 * GHS main wallet and failed with HTTP 500 on live while the wallet was 0 (credits are used otherwise). Never throws. The message body is not stored.
 */
export async function sendSms(o: { to: string; message: string; kind: SmsKind; userId?: any; by?: any; ref?: string }): Promise<SmsOutcome> {
  try {
    const ph = normalizeGhPhone(o.to); if (!ph) return { status: 'invalid_number' };
    const a = smsAdapter(); const st = (await getSettings()).sms; const sender = await smsSender();
    const base = { kind: o.kind, to: maskPhone(ph.local), network: ph.network, userId: o.userId, by: o.by, ref: o.ref, provider: a?.name, senderId: sender || undefined };
    const log = async (x: Record<string, unknown>) => String(((await SmsLog.create({ ...base, ...x } as any)) as any)._id);
    if (!a) return { status: 'not_configured', logId: await log({ status: 'not_configured' }) };
    if (!st.enabled) return { status: 'disabled', logId: await log({ status: 'disabled' }) };
    if (!sender) return { status: 'no_sender', logId: await log({ status: 'no_sender' }) };
    if (!(await claim(st.dailyCap))) { logger.warn({ cap: st.dailyCap }, 'sms daily cap reached'); return { status: 'cap_reached', logId: await log({ status: 'cap_reached' }) }; }
    const message = smsText(o.message);
    const r = await a.send({ to: [ph.local], sender, message, otp: o.kind === 'otp' || o.kind === 'reset' });
    if (r.ok) return { status: 'sent', campaignId: r.campaignId, logId: await log({ status: 'sent', chars: message.length, campaignId: r.campaignId, providerCode: r.code, credits: r.credits }) };
    return { status: 'failed', error: r.error, logId: await log({ status: 'failed', chars: message.length, providerCode: r.code, error: r.error }) };
  } catch (e: any) { logger.warn({ err: String(e?.message ?? e).slice(0, 200) }, 'sms send failed'); return { status: 'failed', logId: '', error: 'internal error' }; }
}
