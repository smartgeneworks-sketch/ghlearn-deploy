import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/db.js';
import { seed } from '../src/seed.js';
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('Set MONGODB_URI'); process.exit(1); }
await connectDb(uri);
if (process.argv.includes('--reset-sample')) for (const m of Object.values(mongoose.models)) await m.deleteMany({ isSample: true }, { maintenance: true } as any);
const r = await seed();
console.log(`Seeded SAMPLE data. Logins (password: ${r.password}):`, Object.values(r.users).map((u: any) => u.email).join(', '));
await disconnectDb();
