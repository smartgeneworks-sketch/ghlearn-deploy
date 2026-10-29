import { defineConfig, devices } from '@playwright/test';
/** Browser E2E: in-memory API with scripted test LLM (port 8787) + production build served by `vite preview` (port 4173, proxies /api). */
const API_ENV = 'NODE_ENV=test LLM_PROVIDER=test-llm MONGODB_URI= GEMINI_API_KEY= EMBEDDING_PROVIDER= PORT=8787 LOG_LEVEL=warn WORKER_POLL_MS=300 AI_USER_DAILY_REQUESTS=1000 AI_SCHOOL_DAILY_REQUESTS=10000 CORS_ORIGINS=http://localhost:4173 JWT_ACCESS_SECRET=e2e-access-secret-0123456789abcdef JWT_REFRESH_SECRET=e2e-refresh-secret-0123456789abcdef';
export default defineConfig({
  testDir: 'e2e', timeout: 90_000, expect: { timeout: 15_000 }, fullyParallel: false, workers: 1, retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', contextOptions: { reducedMotion: 'reduce' }, screenshot: 'only-on-failure' },
  webServer: [
    { command: `cd ../server && env ${API_ENV} npx tsx scripts/e2e-server.ts`, url: 'http://localhost:8787/api/health', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive/ },
    { name: 'responsive', use: { ...devices['Desktop Chrome'] }, testMatch: /responsive/ },
  ],
});
