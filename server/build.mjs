import { build } from 'esbuild';
const ext = { name: 'ext', setup(b) { b.onResolve({ filter: /^[^./]/ }, (a) => (a.path.startsWith('@ghlearn/') ? undefined : { path: a.path, external: true })); } };
await build({ entryPoints: ['src/index.ts', 'src/bootstrap-cli.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node20', outdir: 'dist', sourcemap: true, splitting: true, plugins: [ext] });
