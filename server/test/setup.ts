import { beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import request from 'supertest';
export const ctx: { app: ReturnType<typeof createApp>; data: Awaited<ReturnType<typeof seed>> } = {} as any;
export function useDb() {
  beforeAll(async () => {
    await connectDb();
    for (const m of Object.values(mongoose.models)) await m.deleteMany({}, { maintenance: true } as any);
    ctx.app = createApp(); ctx.data = await seed('SamplePass2026');
  });
  afterAll(disconnectDb);
}
/** Agent that has fetched a CSRF token and sends it on every request (like the SPA). */
export async function anon() {
  const agent = request.agent(ctx.app);
  const { body } = await agent.get('/api/auth/csrf');
  agent.set('X-CSRF-Token', body.csrfToken);
  return Object.assign(agent, { csrf: body.csrfToken as string });
}
export async function loginAs(email: string, password = 'SamplePass2026') {
  const agent = await anon();
  const r = await agent.post('/api/auth/login').send({ email, password });
  if (r.status !== 200) throw new Error(`login ${email} failed ${r.status} ${JSON.stringify(r.body)}`);
  return agent;
}
