// Local dashboard server. Serves the visual Compass and a tiny API over the same plan file.
// Security: listens on 127.0.0.1 only, every API call needs a random per-run key sent in a custom header
// (so other websites can't call it), the Host header must be local (blocks DNS rebinding), and a strict
// Content-Security-Policy is sent with every page. Never writes to stdout (the MCP server uses it).
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, update, today } from './store.js';
import { status, activeHabits, weekStreak } from './coach.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

let running = null;

export function startWeb({ port = Number(process.env.LIFE_COMPASS_PORT) || 4719 } = {}){
  if (running) return running;
  const key = randomBytes(24).toString('hex');
  const keyBuf = Buffer.from(key);
  const okKey = v => { const b = Buffer.from(String(v || '')); return b.length === keyBuf.length && timingSafeEqual(b, keyBuf); };

  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const readBody = req => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6){ reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('bad json')); } });
  });

  const server = http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host || '').toLowerCase();
      const actualPort = server.address().port;
      if (host !== `127.0.0.1:${actualPort}` && host !== `localhost:${actualPort}`) return send(res, 403, { error: 'forbidden host' });
      const url = new URL(req.url, `http://${host}`);

      if (url.pathname.startsWith('/api/')){
        if (!okKey(req.headers['x-life-compass-key'])) return send(res, 401, { error: 'missing or wrong key' });
        if (req.method === 'GET' && url.pathname === '/api/state'){
          const plan = await load();
          const habits = activeHabits(plan).map(h => ({ ...h, weekStreak: weekStreak(plan, h.id), loggedToday: plan.log.some(l => l.habitId === h.id && l.date === today()) }));
          return send(res, 200, { plan, status: status(plan), habits, today: today() });
        }
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
        const body = await readBody(req);
        if (url.pathname === '/api/log'){
          const out = await update(plan => {
            const ok = plan.goals.some(g => (g.habits || []).some(h => h.id === body.habitId));
            if (!ok) return { isError: true };
            plan.log.push({ date: today(), habitId: String(body.habitId), version: body.version === 'tiny' ? 'tiny' : 'full' });
            return { weekStreak: weekStreak(plan, body.habitId) };
          });
          return out.isError ? send(res, 404, { error: 'no such habit' }) : send(res, 200, out);
        }
        if (url.pathname === '/api/milestone'){
          const out = await update(plan => {
            for (const g of plan.goals){ const m = (g.milestones || []).find(x => x.id === body.milestoneId); if (m){ m.done = !!body.done; return { ok: true }; } }
            return { isError: true };
          });
          return out.isError ? send(res, 404, { error: 'no such milestone' }) : send(res, 200, out);
        }
        if (url.pathname === '/api/win'){
          const text = String(body.text || '').trim();
          if (!text) return send(res, 400, { error: 'empty' });
          await update(plan => { plan.wins.push({ date: today(), text, tag: String(body.tag || '') }); return {}; });
          return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: 'not found' });
      }

      // Static files: only names inside src/web, no traversal
      if (req.method !== 'GET') return send(res, 405, 'method not allowed', 'text/plain');
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.normalize(path.join(ROOT, rel));
      if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
      const type = TYPES[path.extname(file)];
      if (!type) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, await fs.readFile(file), type);
    } catch (e) {
      return send(res, e.code === 'ENOENT' ? 404 : 500, { error: e.code === 'ENOENT' ? 'not found' : 'server error' });
    }
  });

  running = new Promise((resolve, reject) => {
    server.once('error', err => {
      if (err.code === 'EADDRINUSE' && port !== 0){ running = null; resolve(startWeb({ port: 0 })); }
      else reject(err);
    });
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({ url: `http://127.0.0.1:${p}/#key=${key}`, port: p, close: () => new Promise(r => server.close(r)) });
    });
  });
  return running;
}
