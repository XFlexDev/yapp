// Usage: YAP_CODES="email:code,email:code" node tests/e2e.mjs [base]
const BASE = process.argv[2] ?? 'https://yap.kreatix.dev';
const [[e1, c1], [e2, c2]] = process.env.YAP_CODES.split(',').map((p) => p.split(':'));
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) fails++; };
async function call(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = (await call('/v1/auth/confirm', { method: 'POST', body: { email: e1, code: c1 } })).json;
const B = (await call('/v1/auth/confirm', { method: 'POST', body: { email: e2, code: c2 } })).json;
ok(A?.access_token && B?.access_token, 'review accounts sign in');
ok((await call('/v1/auth/confirm', { method: 'POST', body: { email: e1, code: '000000x' } })).status === 400, 'wrong code rejected');
ok((await call('/v1/me')).status === 401, 'no token -> 401');

// clean slate
for (const t of [A.access_token, B.access_token]) {
  for (const f of (await call('/v1/friends', { token: t })).json) await call(`/v1/friends/${f.id}`, { method: 'DELETE', token: t });
  const rq = (await call('/v1/friends/requests', { token: t })).json;
  for (const r of [...rq.incoming, ...rq.outgoing]) await call(`/v1/friends/requests/${r.id}`, { method: 'DELETE', token: t });
}
ok((await call('/v1/me', { method: 'PATCH', token: A.access_token, body: { username: 'qa_alpha', display_name: 'Alpha' } })).status === 200, 'A sets profile');
ok((await call('/v1/me', { method: 'PATCH', token: B.access_token, body: { username: 'qa_bravo', display_name: 'Bravo' } })).status === 200, 'B sets profile');
ok((await call('/v1/me', { method: 'PATCH', token: B.access_token, body: { username: 'qa_alpha' } })).json?.error === 'AlreadyTaken', 'duplicate username -> AlreadyTaken');

const events = [];
const ws = new WebSocket(`${BASE.replace('http', 'ws')}/v1/stream?access_token=${B.access_token}`);
ws.onmessage = (m) => events.push(JSON.parse(m.data));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await sleep(500);

ok((await call('/v1/friends/requests', { method: 'POST', token: A.access_token, body: { username: '@qa_bravo' } })).json?.status === 'sent', 'A requests B');
await sleep(400);
const inc = (await call('/v1/friends/requests', { token: B.access_token })).json.incoming;
ok(inc.length === 1 && inc[0].user.username === 'qa_alpha', 'B sees incoming request');
ok((await call(`/v1/friends/requests/${inc[0].id}/accept`, { method: 'POST', token: B.access_token })).status === 200, 'B accepts');
const fa = (await call('/v1/friends', { token: A.access_token })).json;
ok(fa.length === 1 && fa[0].username === 'qa_bravo' && fa[0].online === true, 'A sees B as online friend');

const listen = (await call('/v1/rtc/listen', { method: 'POST', token: B.access_token })).json;
const focus = (await call('/v1/rtc/focus', { method: 'POST', token: A.access_token, body: { friend_id: B.user.id } })).json;
ok(listen.room === focus.room && listen.room === `u_${B.user.id}`, 'talk room == friend inbox room');
for (const [n, t] of [['listen', listen.token], ['focus', focus.token]]) {
  const v = await fetch(`https://yaprtc.kreatix.dev/rtc/validate?access_token=${t}`);
  ok(v.status === 200, `LiveKit accepts ${n} token (${v.status})`);
}
ok((await call('/v1/ptt/start', { method: 'POST', token: A.access_token, body: { friend_id: B.user.id } })).json?.delivered_live === true, 'ptt start delivered live');
await call('/v1/ptt/stop', { method: 'POST', token: A.access_token, body: { friend_id: B.user.id } });
await call('/v1/poke', { method: 'POST', token: A.access_token, body: { friend_id: B.user.id } });
ok((await call('/v1/poke', { method: 'POST', token: A.access_token, body: { friend_id: B.user.id } })).status === 429, 'poke rate limited');
await sleep(600);
const types = events.map((e) => e.type);
for (const t of ['hello', 'friend_request_received', 'friendship_created', 'ptt_started', 'ptt_stopped', 'poke']) ok(types.includes(t), `B stream got ${t}`);

await call('/v1/status', { method: 'PUT', token: B.access_token, body: { dnd: true } });
ok((await call('/v1/ptt/start', { method: 'POST', token: A.access_token, body: { friend_id: B.user.id } })).json?.error === 'FriendUnavailable', 'DND -> FriendUnavailable');
await call('/v1/status', { method: 'PUT', token: B.access_token, body: { dnd: false } });

const r1 = await call('/v1/auth/refresh', { method: 'POST', body: { refresh_token: A.refresh_token } });
ok(r1.status === 200 && r1.json.refresh_token !== A.refresh_token, 'refresh rotates');
ok((await call('/v1/auth/refresh', { method: 'POST', body: { refresh_token: A.refresh_token } })).status === 401, 'old refresh token dead');

ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
