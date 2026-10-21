import { AudioSession } from '@livekit/react-native';
import { Room, RoomEvent } from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';
import { req } from './api';
import { set } from './store';

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
    const talking: Record<string, boolean> = {};
    speakers.forEach((p) => { if (p.identity !== room.localParticipant.identity) talking[p.identity] = true; });
    set((s) => ({ talkingTo: { ...Object.fromEntries(Object.keys(s.talkingTo).map((k) => [k, false])), ...talking } }));
  });
  room.on(RoomEvent.Disconnected, () => { if (inbox === room) inbox = null; });
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

async function micPermission() {
  if (Platform.OS !== 'android') return true;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export async function pressTalk(friendId: string) {
  pressed = true;
  if (!(await micPermission())) throw new Error('Yap needs your microphone to talk');
  focusFriend(friendId);
  const t = talk!;
  await Promise.all([t.ready, req('/v1/ptt/start', { method: 'POST', body: { friend_id: friendId } })]);
  if (!pressed) return;
  await t.room.localParticipant.setMicrophoneEnabled(true);
  if (!pressed) await t.room.localParticipant.setMicrophoneEnabled(false);
}

export async function releaseTalk(friendId: string) {
  pressed = false;
  await talk?.room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
  await req('/v1/ptt/stop', { method: 'POST', body: { friend_id: friendId } }).catch(() => {});
}

export async function stopVoice() {
  pressed = false;
  talk?.room.disconnect();
  talk = null;
  await stopListening();
}
