import mongoose from 'mongoose';
import { logger } from './lib/logger.js';
let memServer: { stop: () => Promise<boolean>; getUri: () => string } | null = null;
export async function connectDb(uri?: string) {
  mongoose.set('strictQuery', true);
  let target = uri;
  if (!target) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memServer = await MongoMemoryServer.create();
    target = memServer.getUri();
    logger.warn('MONGODB_URI not set: using in-memory MongoDB (data is NOT persisted)');
  }
  await mongoose.connect(target, { autoIndex: true, ...(uri && process.env.MONGODB_DB ? { dbName: process.env.MONGODB_DB } : {}) });
  // One failing index (e.g. a new unique index over legacy duplicates) must not stop the server; migrations repair and re-sync.
  const r = await Promise.allSettled(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  r.forEach((x, i) => { if (x.status === 'rejected') logger.error({ model: Object.values(mongoose.models)[i].modelName, err: String(x.reason?.message ?? x.reason) }, 'index sync failed'); });
}
export async function disconnectDb() { await mongoose.disconnect(); if (memServer) await memServer.stop(); memServer = null; }
