import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
const API = 'http://127.0.0.1:8498', LK = 'ws://127.0.0.1:7880';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [email, code] = process.env.QA.split(':');
let tok;
const api = async (p, m = 'GET', b) => { const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
tok = (await api('/v1/auth/confirm', 'POST', { email, code })).j.access_token;
const bot = (await api('/v1/users/test')).j;
console.log('lookup @test:', bot.username, bot.display_name);
console.log('send request:', (await api('/v1/friends/requests', 'POST', { username: 'test' })).s);
await sleep(2500);
const fr = (await api('/v1/friends')).j;
const f = (fr.friends ?? fr).find((x) => (x.user?.id ?? x.id) === bot.id);
console.log('friend entry:', JSON.stringify(f));
let got = 0, loud = 0;
const inbox = new Room();
inbox.on(RoomEvent.TrackSubscribed, async (t, _p, p) => {
  if (t.kind !== TrackKind.KIND_AUDIO || p.identity !== bot.id) return;
  for await (const fr of new AudioStream(t, 48000, 1)) { got++; let s = 0; for (const v of fr.data) s += v * v; if (Math.sqrt(s / fr.data.length) > 500) loud++; }
});
await inbox.connect(LK, (await api('/v1/rtc/listen', 'POST')).j.token, { autoSubscribe: true, dynacast: false });
const ws = new WebSocket(`ws://127.0.0.1:8498/v1/stream?access_token=${tok}`);
ws.onmessage = (m) => { const e = JSON.parse(m.data); if (e.type?.startsWith('ptt')) console.log('event from bot:', e.type); };
const talk = new Room();
await talk.connect(LK, (await api('/v1/rtc/focus', 'POST', { friend_id: bot.id })).j.token, { autoSubscribe: false, dynacast: false });
const src = new AudioSource(48000, 1);
const o = new TrackPublishOptions(); o.source = TrackSource.SOURCE_MICROPHONE;
await talk.localParticipant.publishTrack(LocalAudioTrack.createAudioTrack('mic', src), o);
await sleep(800);
console.log('ptt start:', (await api('/v1/ptt/start', 'POST', { friend_id: bot.id })).s);
let n = 0;
for (let i = 0; i < 200; i++) { const d = new Int16Array(480); for (let k = 0; k < 480; k++, n++) d[k] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * n) / 48000)); await src.captureFrame(new AudioFrame(d, 48000, 1, 480)); }
await src.waitForPlayout();
console.log('ptt stop:', (await api('/v1/ptt/stop', 'POST', { friend_id: bot.id })).s);
await talk.disconnect();
await sleep(6000);
console.log(`echo received: ${got} frames, ${loud} loud (~${(loud / 100).toFixed(1)}s of tone)`);
console.log('unfriend qa1:', (await api(`/v1/friends/${bot.id}`, 'DELETE')).s);
await inbox.disconnect(); ws.close(); process.exit(0);
