import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { config } from '../src/config.js';
import { fetchRemote } from '../src/services/storage.js';

/** Remote manual fetch (imported curriculumresources.edu.gh files): slow servers, redirects, size cap, allow-list. */
describe('fetchRemote', () => {
  let srv: http.Server; let base = ''; const hosts = [...config.remoteHosts];
  beforeAll(async () => {
    srv = http.createServer((req, res) => {
      if (req.url === '/slow') return void setTimeout(() => res.end('%PDF-slow'), 1500); // slower than a short connect budget
      if (req.url === '/redir') { res.writeHead(302, { Location: '/ok' }); return void res.end(); }
      if (req.url === '/ok') return void res.end('%PDF-ok');
      if (req.url === '/big') return void res.end(Buffer.alloc(2048));
      res.writeHead(404); res.end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`; config.remoteHosts.push('127.0.0.1');
  });
  afterAll(() => { config.remoteHosts.splice(0, config.remoteHosts.length, ...hosts); srv.close(); });

  it('waits for a slow server, follows redirects, and names the cause of failures', async () => {
    expect((await fetchRemote(`${base}/slow`)).toString()).toBe('%PDF-slow');
    expect((await fetchRemote(`${base}/redir`)).toString()).toBe('%PDF-ok');
    await expect(fetchRemote(`${base}/slow`, undefined, { connectMs: 300 })).rejects.toThrow(/no response from 127.0.0.1 within/);
    await expect(fetchRemote(`${base}/missing`)).rejects.toThrow('Download failed: HTTP 404');
    await expect(fetchRemote(`${base}/big`, 1024)).rejects.toThrow('exceeds size limit');
    await expect(fetchRemote('http://127.0.0.1:1/x')).rejects.toThrow(/Download failed: ECONNREFUSED/);
    await expect(fetchRemote('https://example.com/x.pdf')).rejects.toThrow('Remote host not allowed');
  });
});
