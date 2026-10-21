// Usage: node load.mjs <base> <jwt_secret> <server_pid> [users] [seconds]
import crypto from 'node:crypto';
import fs from 'node:fs';
const [BASE, SECRET, PID, N = '500', SECS = '90'] = process.argv.slice(2);
const n = +N, secs = +SECS, FR = 5;
const id = (i) => `lt${String((i + n) % n).padStart(4, '0')}`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => { const t = Math.floor(Date.now() / 1000); const h = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, iat: t, exp: t + 7200, typ: 'access' })}`; return `${h}.${crypto.createHmac('sha256', SECRET).update(h).digest('base64url')}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lat = {}, deliver = { message: [], ptt: [] }, errs = {};
const rec = (k, v) => (lat[k] ??= []).push(v);
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
async function call(tok, method, path, body, key) {
  const t0 = performance.now();
  try {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
    await r.arrayBuffer();
    rec(key, performance.now() - t0);
    if (!r.ok) errs[`${key} ${r.status}`] = (errs[`${key} ${r.status}`] ?? 0) + 1;
  } catch (e) { errs[`${key} ${e.cause?.code ?? e.message}`] = (errs[`${key} ${e.cause?.code ?? e.message}`] ?? 0) + 1; }
}
const ticks = () => { const f = fs.readFileSync(`/proc/${PID}/stat`, 'utf8').split(') ')[1].split(' '); return +f[11] + +f[12]; };
const rss = () => +fs.readFileSync(`/proc/${PID}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1] / 1024;
const idle = rss();
const pttSent = new Map();
const users = Array.from({ length: n }, (_, i) => ({ i, id: id(i), tok: jwt(id(i)) }));
const tc = performance.now();
let open = 0, closed = 0;
await Promise.all(users.map((u) => new Promise((res) => {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/v1/stream?access_token=${u.tok}`);
  u.ws = ws;
  ws.onopen = () => { open++; res(); };
  ws.onerror = () => res();
  ws.onclose = () => { if (running) closed++; };
  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'message' && e.message.from !== u.id) { const t = +e.message.body.split(':')[1]; if (t) deliver.message.push(Date.now() - t); }
    if (e.type === 'ptt_started') { const t = pttSent.get(`${e.from.id}>${u.id}`); if (t) deliver.ptt.push(Date.now() - t); }
  };
})));
const connectMs = performance.now() - tc;
await sleep(2000);
const connRss = rss();
let running = true, peak = connRss, actions = 0;
const sampler = setInterval(() => { peak = Math.max(peak, rss()); }, 500);
const c0 = ticks(), t0 = performance.now();
const end = Date.now() + secs * 1000;
await Promise.all(users.map(async (u) => {
  await sleep(Math.random() * 4000);
  while (Date.now() < end) {
    const f = id(u.i + 1 + Math.floor(Math.random() * FR));
    const r = Math.random();
    actions++;
    if (r < 0.4) await call(u.tok, 'POST', `/v1/chats/${f}/messages`, { body: `t:${Date.now()}` }, 'chat send');
    else if (r < 0.7) { pttSent.set(`${u.id}>${f}`, Date.now()); await call(u.tok, 'POST', '/v1/ptt/start', { friend_id: f }, 'ptt start'); await sleep(1500); await call(u.tok, 'POST', '/v1/ptt/stop', { friend_id: f }, 'ptt stop'); }
    else if (r < 0.85) await call(u.tok, 'PUT', '/v1/status', { dnd: false }, 'presence');
    else await call(u.tok, 'GET', '/v1/friends', null, 'friends list');
    await sleep(2000 + Math.random() * 4000);
  }
}));
const wall = (performance.now() - t0) / 1000, cpu = (ticks() - c0) / 100 / wall * 100;
running = false; clearInterval(sampler);
const total = Object.values(lat).reduce((s, a) => s + a.length, 0);
console.log(`users ${n}, websockets open ${open}/${n} in ${connectMs.toFixed(0)} ms, dropped during test ${closed}`);
console.log(`activity ${wall.toFixed(0)} s, ${actions} actions, ${total} HTTP requests (${(total / wall).toFixed(0)} req/s)`);
console.log(`server RSS idle ${idle.toFixed(1)} MB, with ${n} sockets ${connRss.toFixed(1)} MB, peak ${peak.toFixed(1)} MB; CPU avg ${cpu.toFixed(1)}% of one core`);
for (const [k, a] of Object.entries(lat)) console.log(`${k.padEnd(13)} n=${String(a.length).padStart(5)} p50 ${pct(a, 50).toFixed(1)} ms  p95 ${pct(a, 95).toFixed(1)} ms  p99 ${pct(a, 99).toFixed(1)} ms`);
for (const [k, a] of Object.entries(deliver)) console.log(`deliver ${k.padEnd(7)} n=${String(a.length).padStart(5)} p50 ${pct(a, 50)} ms  p95 ${pct(a, 95)} ms  p99 ${pct(a, 99)} ms`);
console.log('errors', JSON.stringify(errs));
users.forEach((u) => u.ws.close());
process.exit(0);
