// @test: always-online Yapp friend that auto-accepts requests and plays your talk back to you.
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';

const { BOT_EMAIL, BOT_CODE, YAP_API, LK_URL } = process.env;
const RATE = 48000;
const MAX_FRAMES = 3000; // ~30s of 10ms frames
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let access = null;
let me = null;
async function login() {
  const r = await fetch(`${YAP_API}/v1/auth/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: BOT_EMAIL, code: BOT_CODE }) });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const j = await r.json();
  access = j.access_token;
  me = j.user;
}
async function api(path, method = 'GET', body) {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(YAP_API + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && i === 0) { await login(); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${path} ${r.status} ${j.error ?? ''}`);
    return j;
  }
}

async function acceptAll() {
  const { incoming } = await api('/v1/friends/requests');
  for (const rq of incoming) {
    await api(`/v1/friends/requests/${rq.id}/accept`, 'POST').catch((e) => log('accept failed', e.message));
    log('accepted', rq.user.username);
  }
}

// Per-sender recording state, fed by their mic track in my inbox room.
const recording = new Map(); // identity -> AudioFrame[] while they hold to talk
const readers = new Set();

async function readTrack(track, identity) {
  if (readers.has(track.sid)) return;
  readers.add(track.sid);
  try {
    for await (const f of new AudioStream(track, RATE, 1)) {
      const buf = recording.get(identity);
      if (buf && buf.length < MAX_FRAMES) buf.push(new AudioFrame(new Int16Array(f.data), f.sampleRate, f.channels, f.samplesPerChannel));
    }
  } catch (e) { log('stream ended', identity, e.message); }
  readers.delete(track.sid);
}

let inbox = null;
async function joinInbox() {
  const g = await api('/v1/rtc/listen', 'POST');
  const room = new Room();
  room.on(RoomEvent.TrackSubscribed, (track, _pub, p) => { if (track.kind === TrackKind.KIND_AUDIO) readTrack(track, p.identity); });
  room.on(RoomEvent.Disconnected, () => { log('inbox disconnected'); if (inbox === room) { inbox = null; setTimeout(() => joinInbox().catch((e) => log('rejoin', e.message)), 2000); } });
  await room.connect(LK_URL, g.token, { autoSubscribe: true, dynacast: false });
  inbox = room;
  log('listening in', g.room);
}

const replaying = new Set();
async function replay(friendId) {
  const frames = recording.get(friendId) ?? [];
  recording.delete(friendId);
  if (frames.length < 20 || replaying.has(friendId)) return;
  replaying.add(friendId);
  const room = new Room();
  try {
    await sleep(700);
    const g = await api('/v1/rtc/focus', 'POST', { friend_id: friendId });
    await room.connect(LK_URL, g.token, { autoSubscribe: false, dynacast: false });
    const source = new AudioSource(RATE, 1);
    const track = LocalAudioTrack.createAudioTrack('echo', source);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant.publishTrack(track, opts);
    await api('/v1/ptt/start', 'POST', { friend_id: friendId });
    await sleep(400);
    for (const f of frames) await source.captureFrame(f);
    await source.waitForPlayout();
    log('echoed', friendId, `${(frames.length / 100).toFixed(1)}s`);
  } catch (e) {
    log('echo failed', friendId, e.message);
  } finally {
    await api('/v1/ptt/stop', 'POST', { friend_id: friendId }).catch(() => {});
    await room.disconnect().catch(() => {});
    replaying.delete(friendId);
  }
}

function onEvent(e) {
  switch (e.type) {
    case 'friend_request_received': acceptAll().catch((x) => log('accept', x.message)); break;
    case 'ptt_started': if (!replaying.has(e.from.id)) recording.set(e.from.id, []); break;
    case 'ptt_stopped': setTimeout(() => replay(e.from_id), 300); break; // let the last frames drain
    case 'poke': api('/v1/poke', 'POST', { friend_id: e.from.id }).catch(() => {}); break;
  }
}

async function stream() {
  for (;;) {
    try {
      await new Promise((resolve) => {
        const ws = new WebSocket(`${YAP_API.replace('http', 'ws')}/v1/stream?access_token=${encodeURIComponent(access)}`);
        ws.onopen = () => { log('stream open'); acceptAll().catch(() => {}); };
        ws.onmessage = (m) => { try { onEvent(JSON.parse(String(m.data))); } catch {} };
        ws.onclose = () => resolve();
        ws.onerror = () => {};
      });
    } catch {}
    log('stream closed, reconnecting');
    await sleep(2000);
    await login().catch((e) => log('relogin', e.message));
  }
}

await login();
if (me.username !== 'test' || me.display_name !== 'Test') await api('/v1/me', 'PATCH', { username: 'test', display_name: 'Test' });
await api('/v1/status', 'PUT', { dnd: false });
await joinInbox();
setInterval(() => login().catch((e) => log('refresh', e.message)), 45 * 60 * 1000);
stream();
