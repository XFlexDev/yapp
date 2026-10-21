import { AudioSession } from '@livekit/react-native';
import { Room, RoomEvent, Track, type LocalVideoTrack, type Participant } from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';
import { req } from './api';
import { setSelfTalking, startBackground } from './background';
import { get, set } from './store';

type Grant = { url: string; room: string; token: string };
let inbox: Room | null = null;
let talk: { friendId: string; room: Room; ready: Promise<void> } | null = null;
let pressed = false;
let sessionStarted = false;

async function ensureSession() {
  if (sessionStarted) return;
  sessionStarted = true;
  await AudioSession.configureAudio({
    android: { preferredOutputList: ['speaker'], audioTypeOptions: { manageAudioFocus: true, audioMode: 'normal', audioFocusMode: 'gain', audioStreamType: 'music', audioAttributesUsageType: 'media', audioAttributesContentType: 'speech' } },
    ios: { defaultOutput: 'speaker' },
  });
  await AudioSession.startAudioSession();
}

/** Join my own inbox room; anything friends publish there plays automatically. */
export async function startListening() {
  if (inbox) return;
  await ensureSession();
  const g = await req<Grant>('/v1/rtc/listen', { method: 'POST' });
  const room = new Room({ adaptiveStream: false, dynacast: false });
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    // Only ever turn "talking" on here; ptt_stopped turns it off. Speaker detection drops out on pauses.
    const on: Record<string, boolean> = {};
    speakers.forEach((p) => { if (p.identity !== room.localParticipant.identity) on[p.identity] = true; });
    if (Object.keys(on).length) set((s) => ({ talkingTo: { ...s.talkingTo, ...on } }));
  });
  for (const ev of [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted] as const) {
    room.on(ev, (...a: any[]) => syncRemote(a.find((x) => x?.identity && x?.getTrackPublication)));
  }
  room.on(RoomEvent.ParticipantDisconnected, (p) => dropRemote(p.identity));
  room.on(RoomEvent.Disconnected, () => { if (inbox === room) inbox = null; set((s) => ({ cams: { ...s.cams, remote: {} } })); });
  inbox = room;
  await room.connect(g.url, g.token, { autoSubscribe: true });
}

export async function stopListening() {
  const r = inbox; inbox = null;
  await r?.disconnect();
}

/** Pre-connect to the selected friend's inbox so pressing talk is instant. */
export function focusFriend(friendId: string) {
  if (talk?.friendId === friendId) return;
  const prev = talk;
  prev?.room.disconnect();
  const room = new Room();
  const ready = (async () => {
    await ensureSession();
    const g = await req<Grant>('/v1/rtc/focus', { method: 'POST', body: { friend_id: friendId } });
    await room.connect(g.url, g.token, { autoSubscribe: false });
  })();
  talk = { friendId, room, ready };
  ready.catch(() => { if (talk?.room === room) talk = null; });
}

function dropRemote(id: string) {
  if (!get().cams.remote[id]) return;
  set((s) => { const remote = { ...s.cams.remote }; delete remote[id]; return { cams: { ...s.cams, remote } }; });
}

function syncRemote(p?: Participant) {
  if (!p) return;
  const pub = p.getTrackPublication(Track.Source.Camera);
  if (pub?.track && !pub.isMuted) set((s) => ({ cams: { ...s.cams, remote: { ...s.cams.remote, [p.identity]: { participant: p, publication: pub, source: Track.Source.Camera } } } }));
  else dropRemote(p.identity);
}

async function camPermission() {
  if (Platform.OS !== 'android') return true;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

/** Camera on/off during an active call. Video goes into the friend's inbox room next to the voice. */
export async function setCamera(on: boolean) {
  const t = talk;
  if (!t) return;
  if (on && !(await camPermission())) throw new Error('Yapp needs your camera for video');
  await t.ready;
  const lp = t.room.localParticipant;
  await lp.setCameraEnabled(on, on ? { facingMode: get().cams.front ? 'user' : 'environment', resolution: { width: 720, height: 1280, frameRate: 24 } } : undefined);
  const pub = lp.getTrackPublication(Track.Source.Camera);
  set((s) => ({ cams: { ...s.cams, local: on && pub ? { participant: lp, publication: pub, source: Track.Source.Camera } : null } }));
}

export async function flipCamera() {
  const pub = talk?.room.localParticipant.getTrackPublication(Track.Source.Camera);
  const track = pub?.videoTrack as LocalVideoTrack | undefined;
  if (!track) return;
  const front = !get().cams.front;
  await track.restartTrack({ facingMode: front ? 'user' : 'environment' });
  set((s) => ({ cams: { ...s.cams, front, local: s.cams.local ? { ...s.cams.local } : null } }));
}

async function micPermission() {
  if (Platform.OS !== 'android') return true;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export async function pressTalk(friendId: string) {
  pressed = true;
  if (!(await micPermission())) throw new Error('Yapp needs your microphone to talk');
  startBackground();
  setSelfTalking(true);
  focusFriend(friendId);
  const t = talk!;
  await Promise.all([t.ready, req('/v1/ptt/start', { method: 'POST', body: { friend_id: friendId } })]);
  if (!pressed) return;
  await t.room.localParticipant.setMicrophoneEnabled(true);
  if (!pressed) await t.room.localParticipant.setMicrophoneEnabled(false);
}

export async function releaseTalk(friendId: string) {
  pressed = false;
  setSelfTalking(false);
  await talk?.room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
  await req('/v1/ptt/stop', { method: 'POST', body: { friend_id: friendId } }).catch(() => {});
}

export async function stopVoice() {
  pressed = false;
  talk?.room.disconnect();
  talk = null;
  await stopListening();
}

/** While holding to talk, lock it: keep the mic open and ring the friend so they can pick up. */
export async function lockCall(friendId: string) {
  set({ call: { friendId, state: 'outgoing', since: Date.now() } });
  await req('/v1/call/start', { method: 'POST', body: { friend_id: friendId } }).catch((e) => { set({ call: null }); throw e; });
}

export async function acceptCall() {
  const c = get().call;
  if (!c || c.state !== 'incoming') return;
  set({ call: { ...c, state: 'active', since: Date.now() } });
  await req('/v1/call/accept', { method: 'POST', body: { friend_id: c.friendId } }).catch(() => {});
  await pressTalk(c.friendId);
}

export function setMuted(muted: boolean) {
  return talk?.room.localParticipant.setMicrophoneEnabled(!muted);
}

async function hangUp(friendId: string, notify: boolean) {
  set({ call: null });
  if (get().cams.local) await setCamera(false).catch(() => {});
  set((s) => ({ cams: { ...s.cams, front: true } }));
  if (notify) req('/v1/call/end', { method: 'POST', body: { friend_id: friendId } }).catch(() => {});
  await releaseTalk(friendId);
}

export function endCall() {
  const c = get().call;
  if (c) return hangUp(c.friendId, true);
}

export function remoteEnded(friendId: string) {
  return hangUp(friendId, false);
}
