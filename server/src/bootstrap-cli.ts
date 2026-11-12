/** One-off: `node dist/bootstrap-cli.js` (e.g. Render shell / one-off job). Needs MONGODB_URI (+ MONGODB_DB). */
import { connectDb, disconnectDb } from './db.js';
import { bootstrap } from './bootstrap.js';
if (!process.env.MONGODB_URI) { console.error('Set MONGODB_URI'); process.exit(1); }
await connectDb(process.env.MONGODB_URI);
console.log(JSON.stringify(await bootstrap(), null, 1));
await disconnectDb();
