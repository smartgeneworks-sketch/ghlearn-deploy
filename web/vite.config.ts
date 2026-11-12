import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
/** Writes /asset-manifest.json (all hashed build files) so the service worker can precache every lazy chunk for offline use. */
const assetManifest = { name: 'asset-manifest', apply: 'build' as const, generateBundle(_o: unknown, bundle: Record<string, unknown>) {
  (this as any).emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify(Object.keys(bundle).filter((f) => f.startsWith('assets/')).map((f) => '/' + f)) }); } };
export default defineConfig({
  plugins: [react(), tailwindcss(), assetManifest],
  build: { rollupOptions: { output: { manualChunks(id: string) {
    if (!id.includes('node_modules')) return;
    if (/[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return 'react';
    if (id.includes('@tanstack')) return 'query';
    if (/[\\/](zod|react-hook-form|@hookform)[\\/]/.test(id)) return 'forms';
    if (id.includes('framer-motion') || id.includes('motion-')) return 'motion';
    if (id.includes('lucide-react')) return 'icons';
  } } } },
  server: { proxy: { '/api': 'http://localhost:8080' } },
  preview: { port: 4173, proxy: { '/api': process.env.E2E_API ?? 'http://localhost:8787' } },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
} as any);
