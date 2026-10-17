import { config } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
if (config.isProd && !config.MONGODB_URI) { logger.fatal('MONGODB_URI is required in production'); process.exit(1); }
await connectDb(config.MONGODB_URI || undefined);
await (await import('./services/migrations.js')).migrate();
if (!config.MONGODB_URI && process.env.SEED_ON_START === 'true') {
  const { seed } = await import('./seed.js');
  const r = await seed();
  logger.warn(`Seeded SAMPLE data into in-memory DB. Password for *@sample.ghlearn.test users: ${r.password}`);
}
const { startWorker } = await import('./services/queue.js');
await import('./services/ingest/pipeline.js');
await import('./services/announcements.js');
await import('./services/retention.js');
await import('./services/meetingReminders.js');
startWorker();
await (await import('./services/platformSettings.js')).loadSettings().catch(() => undefined);
if (config.WORKER_ENABLED === 'true') await (await import('./services/eventNotifications.js')).ensureRecurringJobs();
if (config.WORKER_ENABLED === 'true') await (await import('./services/retention.js')).ensureRetentionJob();
if (config.WORKER_ENABLED === 'true') await (await import('./services/meetingReminders.js')).ensureReminderJob();
createApp().listen(config.PORT, () => logger.info(`ghlearn api on :${config.PORT}`));
if (config.MONGODB_URI && config.BOOTSTRAP_ON_START === 'true') (await import('./bootstrap.js')).bootstrapInBackground();
