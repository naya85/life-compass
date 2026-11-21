// Dashboard server security and API checks
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
process.env.LIFE_COMPASS_DIR = mkdtempSync(path.join(tmpdir(), 'lc-web-'));
const { startWeb } = await import('../src/web.js');
const { url, port, close } = await startWeb({ port: 0 });
const key = new URL(url).hash.split('key=')[1];
const req = (p, { method = 'GET', headers = {}, body } = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: d })); });
  r.on('error', rej); if (body) r.write(body); r.end();
});
let n = 0; const ok = m => console.log(`  ✓ ${++n}. ${m}`);
assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/#key=[0-9a-f]{48}$/); ok('private link uses 127.0.0.1 and a 48-character key in the # (never sent to the server)');
assert.equal((await req('/api/state')).status, 401); ok('API refuses calls without the key');
assert.equal((await req('/api/state', { headers: { 'x-life-compass-key': 'wrong' } })).status, 401); ok('API refuses a wrong key');
assert.equal((await req('/api/state', { headers: { 'x-life-compass-key': key, host: 'evil.example:' + port } })).status, 403); ok('foreign Host header refused (DNS rebinding)');
const st = await req('/api/state', { headers: { 'x-life-compass-key': key } });
assert.equal(st.status, 200); assert.ok(JSON.parse(st.body).plan); ok('API works with the key');
const page = await req('/');
assert.equal(page.status, 200); assert.match(page.headers['content-security-policy'], /script-src 'self'/); assert.equal(page.headers['x-content-type-options'], 'nosniff'); ok('page served with a strict Content-Security-Policy');
const trav = await req('/%2e%2e/store.js'); assert.ok([403, 404].includes(trav.status)); ok('path traversal outside the web folder refused');
const big = await req('/api/win', { method: 'POST', headers: { 'x-life-compass-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(2e6) }) }).catch(() => ({ status: 'closed' }));
assert.ok(big.status !== 200); ok('request bodies over 1 MB refused');
const win = await req('/api/win', { method: 'POST', headers: { 'x-life-compass-key': key }, body: JSON.stringify({ text: 'Shipped it' }) });
assert.equal(win.status, 200); ok('adding a win works');
await close(); console.log(`\nAll ${n} dashboard checks passed.`);
