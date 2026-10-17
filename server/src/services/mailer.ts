import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

/**
 * Provider-independent email (spec §18). Adapters, first configured wins:
 *  1. SMTP: SMTP_URL (smtp://user:pass@host:587), or SMTP_HOST + SMTP_PORT (+ SMTP_USER/SMTP_PASS/SMTP_SECURE).
 *     SMTP_URL=json is a test transport (builds the message, sends nothing) and is refused outside NODE_ENV=test.
 *  2. HTTP API: EMAIL_API_PROVIDER=brevo|resend with EMAIL_API_KEY.
 * EMAIL_FROM ("GH Learn <no-reply@ghlearn.com>") is required for real providers.
 * Nothing configured => every delivery returns `not_configured`; nothing pretends to be sent.
 */
export interface Mail { to: string; subject: string; text: string; html?: string }
export type SendResult = { status: 'sent'; messageId?: string } | { status: 'not_configured' } | { status: 'failed'; error: string };
interface Adapter { name: string; send(m: Mail & { from: string }): Promise<void | { messageId?: string }> }
export const sentForTest: any[] = [];

function smtpAdapter(): Adapter | null {
  if (config.SMTP_URL === 'json') return config.NODE_ENV === 'test' ? jsonAdapter() : null;
  let tx: Transporter | null = null;
  if (config.SMTP_URL) tx = nodemailer.createTransport(config.SMTP_URL);
  else if (config.SMTP_HOST) {
    const port = config.SMTP_PORT ?? 587;
    tx = nodemailer.createTransport({ host: config.SMTP_HOST, port, secure: config.SMTP_SECURE ? config.SMTP_SECURE === 'true' : port === 465,
      ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS ?? '' } } : {}) });
  }
  if (!tx || !config.EMAIL_FROM) return null;
  const t = tx; return { name: 'smtp', send: async (m) => { await t.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) }); } };
}
function jsonAdapter(): Adapter {
  const t = nodemailer.createTransport({ jsonTransport: true });
  return { name: 'test-json', send: async (m) => { const info = await t.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text }); sentForTest.push(JSON.parse((info as any).message)); } };
}
/** "Name <addr>" or "addr" -> parts. */
export function parseFrom(s: string) { const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(s); return m ? { name: m[1].replace(/^"|"$/g, '') || undefined, email: m[2].trim() } : { email: s.trim() }; }
type Fetch = typeof fetch; let fetchImpl: Fetch = (...a) => fetch(...a);
export const setFetchForTest = (f: Fetch | null) => { fetchImpl = f ?? ((...a) => fetch(...a)); resetMailer(); };
function httpAdapter(): Adapter | null {
  if (!config.EMAIL_API_PROVIDER || !config.EMAIL_API_KEY || !config.EMAIL_FROM) return null;
  const key = config.EMAIL_API_KEY, provider = config.EMAIL_API_PROVIDER;
  const check = async (r: Response) => { if (!r.ok) throw new Error(`${provider} HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`); };
  if (provider === 'brevo') return { name: 'brevo', send: async (m) => {
    const f = parseFrom(m.from);
    const r = await fetchImpl('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: f, to: [{ email: m.to }], subject: m.subject, textContent: m.text, ...(m.html ? { htmlContent: m.html } : {}) }), signal: AbortSignal.timeout(15_000) });
    await check(r); const j: any = await r.json().catch(() => null); return { messageId: j?.messageId ? String(j.messageId) : undefined };
  } };
  return { name: 'resend', send: async (m) => {
    await check(await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) }), signal: AbortSignal.timeout(15_000) }));
  } };
}
let adapter: Adapter | null | undefined;
function current() { if (adapter === undefined) adapter = smtpAdapter() ?? httpAdapter(); return adapter; }
export const resetMailer = () => { adapter = undefined; };
export function emailConfigured() { return !!current(); }
export function emailProvider() { return current()?.name ?? null; }
export async function sendMail(m: Mail): Promise<SendResult> {
  const a = current(); if (!a) return { status: 'not_configured' };
  try { const r = await a.send({ ...m, subject: m.subject.slice(0, 200), from: config.EMAIL_FROM || 'GH Learn <no-reply@ghlearn.invalid>' }); return { status: 'sent', ...(r && r.messageId ? { messageId: r.messageId } : {}) }; }
  catch (e: any) { return { status: 'failed', error: String(e?.message ?? e).slice(0, 300) }; }
}
/** Back-compatible plain-text helper used by notifications and enquiries. */
export const sendEmail = (to: string, subject: string, text: string) => sendMail({ to, subject, text });
