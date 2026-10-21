// Talk recorder: records every hold-to-talk into the receiver's inbox room so a talk they missed
// (app closed, suspended, offline) can be replayed later. Clips live on local disk until heard or 7 days.
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const { LK_URL = 'ws://127.0.0.1:7880', LIVEKIT_API_KEY, LIVEKIT_API_SECRET, YAP_API = 'http://127.0.0.1:8498', RECORDER_SECRET, CLIP_DIR = '/var/lib/yap-clips', PORT = '8499' } = process.env;
const RATE = 48000;
const FRAME = 480;
const MAX_MS = 60_000;
const TTL_MS = 8 * 24 * 3600 * 1000;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function token(identity, name, room, grants) {
  const n = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: LIVEKIT_API_KEY, sub: identity, name, nbf: n - 10, exp: n + 900, video: { room, roomJoin: true, canPublishData: false, ...grants } })}`;
  return `${body}.${crypto.createHmac('sha256', LIVEKIT_API_SECRET).update(body).digest('base64url')}`;
}

function ffmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = []; let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${c}: ${err.slice(0, 200)}`))));
    p.stdin.end(input ?? null);
  });
}

const fileOf = (id) => path.join(CLIP_DIR, `${id.replace(/[^a-zA-Z0-9-]/g, '')}.ogg`);
const live = new Map(); // `${from}>${to}` -> session

async function start(from, to) {
  const key = `${from}>${to}`;
  if (live.has(key)) return;
  const s = { id: crypto.randomUUID(), from, to, room: new Room(), frames: [], samples: 0, done: false };
  live.set(key, s);
  s.cap = setTimeout(() => stop(from, to).catch((e) => log('cap stop', e.message)), MAX_MS + 1000);
  s.room.on(RoomEvent.TrackSubscribed, (track, _pub, p) => { if (p.identity === from && track.kind === TrackKind.KIND_AUDIO) read(s, track); });
  try {
    await s.room.connect(LK_URL, token(`rec_${s.id}`, 'recorder', `u_${to}`, { canPublish: false, canSubscribe: true, hidden: true }), { autoSubscribe: true, dynacast: false });
  } catch (e) {
    log('join failed', key, e.message);
    clearTimeout(s.cap);
    if (live.get(key) === s) live.delete(key);
  }
}

async function read(s, track) {
  try {
    for await (const f of new AudioStream(track, RATE, 1)) {
      if (s.done) break;
      if (s.samples >= (MAX_MS / 1000) * RATE) continue;
      s.frames.push(Buffer.from(new Int16Array(f.data).buffer));
      s.samples += f.samplesPerChannel;
    }
  } catch {}
}

function loud(pcm) {
  const v = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  let n = 0;
  for (let i = 0; i < v.length; i += 4) if (Math.abs(v[i]) > 900) n++;
  return n > 200;
}

async function stop(from, to) {
  const key = `${from}>${to}`;
  const s = live.get(key);
  if (!s) return;
  live.delete(key);
  clearTimeout(s.cap);
  await sleep(350);
  s.done = true;
  await s.room.disconnect().catch(() => {});
  const pcm = Buffer.concat(s.frames);
  const ms = Math.round((pcm.length / 2 / RATE) * 1000);
  if (ms < 600 || !loud(pcm)) return;
  const file = fileOf(s.id);
  await fs.writeFile(file, await ffmpeg(['-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg', 'pipe:1'], pcm));
  const r = await fetch(`${YAP_API}/internal/clips`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-recorder-secret': RECORDER_SECRET }, body: JSON.stringify({ id: s.id, from, to, ms }) }).catch(() => null);
  if (!r?.ok) { await fs.unlink(file).catch(() => {}); log('clip rejected', key, r?.status); return; }
  log('saved', key, `${(ms / 1000).toFixed(1)}s`);
}

async function play({ id, from, to, name }) {
  const file = fileOf(id);
  const pcm = await ffmpeg(['-i', file, '-f', 's16le', '-ar', String(RATE), '-ac', '1', 'pipe:1']);
  const room = new Room();
  try {
    await room.connect(LK_URL, token(`clip:${from}`, name || 'friend', `u_${to}`, { canPublish: true, canSubscribe: false, canPublishSources: ['microphone'] }), { autoSubscribe: false, dynacast: false });
    const source = new AudioSource(RATE, 1);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant.publishTrack(LocalAudioTrack.createAudioTrack('clip', source), opts);
    await sleep(500);
    const v = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
    for (let i = 0; i + FRAME <= v.length; i += FRAME) await source.captureFrame(new AudioFrame(v.slice(i, i + FRAME), RATE, 1, FRAME));
    await source.waitForPlayout();
    await sleep(300);
    log('played', id, `${(v.length / RATE).toFixed(1)}s`);
  } finally {
    await room.disconnect().catch(() => {});
    await fs.unlink(file).catch(() => {});
  }
}

// Group walkie-talkie relay: subscribe to the talker in `g_<group>` and re-publish into each member's inbox.
// Member connections stay warm for a few minutes so back-and-forth talks start instantly.
const relays = new Map(); // `${group}:${from}` -> relay
const outs = new Map(); // `${group}:${from}>${member}` -> { room, source, idle }

async function outFor(group, from, member, name) {
  const key = `${group}:${from}>${member}`;
  const o = outs.get(key);
  if (o && o.room.isConnected) { clearTimeout(o.idle); return o; }
  outs.delete(key);
  const room = new Room();
  await room.connect(LK_URL, token(`grp:${group}:${from}`, name || 'friend', `u_${member}`, { canPublish: true, canSubscribe: false, canPublishSources: ['microphone'] }), { autoSubscribe: false, dynacast: false });
  const source = new AudioSource(RATE, 1);
  const opts = new TrackPublishOptions();
  opts.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(LocalAudioTrack.createAudioTrack('group', source), opts);
  const n = { room, source, idle: null };
  room.on(RoomEvent.Disconnected, () => { if (outs.get(key) === n) outs.delete(key); });
  outs.set(key, n);
  return n;
}

async function gstart({ group, from, to = [], name }) {
  const key = `${group}:${from}`;
  if (relays.has(key)) return;
  const r = { room: new Room(), done: false, members: to };
  relays.set(key, r);
  r.cap = setTimeout(() => gstop({ group, from }).catch(() => {}), 5 * 60_000);
  const ready = Promise.all(to.map((m) => outFor(group, from, m, name).catch((e) => { log('relay out', m, e.message); return null; })));
  r.room.on(RoomEvent.TrackSubscribed, async (track, _pub, p) => {
    if (p.identity !== from || track.kind !== TrackKind.KIND_AUDIO) return;
    const targets = (await ready).filter(Boolean);
    try {
      for await (const f of new AudioStream(track, RATE, 1)) {
        if (r.done) break;
        await Promise.all(targets.map((o) => o.source.captureFrame(f).catch(() => {})));
      }
    } catch {}
  });
  await r.room.connect(LK_URL, token(`relay_${crypto.randomUUID()}`, 'relay', `g_${group}`, { canPublish: false, canSubscribe: true, hidden: true }), { autoSubscribe: true, dynacast: false });
}

async function gstop({ group, from }) {
  const key = `${group}:${from}`;
  const r = relays.get(key);
  if (!r) return;
  relays.delete(key);
  clearTimeout(r.cap);
  await sleep(350);
  r.done = true;
  await r.room.disconnect().catch(() => {});
  for (const m of r.members) {
    const o = outs.get(`${group}:${from}>${m}`);
    if (o) o.idle = setTimeout(() => { outs.delete(`${group}:${from}>${m}`); o.room.disconnect().catch(() => {}); }, 3 * 60_000);
  }
}

async function sweep() {
  for (const f of await fs.readdir(CLIP_DIR).catch(() => [])) {
    const p = path.join(CLIP_DIR, f);
    const st = await fs.stat(p).catch(() => null);
    if (st && Date.now() - st.mtimeMs > TTL_MS) await fs.unlink(p).catch(() => {});
  }
}

const routes = {
  '/start': (b) => start(b.from, b.to),
  '/stop': (b) => stop(b.from, b.to),
  '/play': (b) => play(b),
  '/gstart': (b) => gstart(b),
  '/gstop': (b) => gstop(b),
  '/delete': (b) => Promise.all((b.ids ?? []).map((id) => fs.unlink(fileOf(id)).catch(() => {}))),
};

http.createServer((req, res) => {
  const fn = routes[req.url];
  if (req.method !== 'POST' || !fn || req.headers['x-recorder-secret'] !== RECORDER_SECRET) { res.writeHead(404).end(); return; }
  let raw = '';
  req.on('data', (d) => { raw += d; if (raw.length > 1e5) req.destroy(); });
  req.on('end', () => {
    res.writeHead(202).end();
    let b; try { b = JSON.parse(raw); } catch { return; }
    Promise.resolve(fn(b)).catch((e) => log(req.url, 'failed', e.message));
  });
}).listen(Number(PORT), '127.0.0.1', () => log('recorder on', PORT));

await fs.mkdir(CLIP_DIR, { recursive: true });
sweep();
setInterval(sweep, 3600_000);
