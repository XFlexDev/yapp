import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { AppState } from 'react-native';
import { accessToken, avatarUrl, req, type Friend, type FriendRequest, type Me } from './api';
import { get, patchFriend, patchUser, removeFriend, set, upsertFriend } from './store';
import { API } from './theme';
import { remoteEnded } from './voice';
import { loadChats, onBackground, onMessage, onRead } from './chat';

let ws: WebSocket | null = null;
let stopped = true;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function syncAll() {
  const [me, friends, rq] = await Promise.all([
    req<Me>('/v1/me'),
    req<Friend[]>('/v1/friends'),
    req<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>('/v1/friends/requests'),
  ]);
  Image.prefetch([me, ...friends].map(avatarUrl).filter((u): u is string => !!u), 'memory-disk').catch(() => {});
  set((s) => ({
    me, friends, incoming: rq.incoming, outgoing: rq.outgoing,
    selectedId: friends.some((f) => f.id === s.selectedId) ? s.selectedId : friends[0]?.id ?? null,
  }));
}

function onEvent(e: any) {
  switch (e.type) {
    case 'friend_status_updated': patchFriend(e.user_id, { online: e.online, dnd: e.dnd }); break;
    case 'friend_profile_updated': patchUser(e.user); break;
    case 'friendship_created':
      upsertFriend(e.friend);
      set((s) => ({ incoming: s.incoming.filter((r) => r.user.id !== e.friend.id), outgoing: s.outgoing.filter((r) => r.user.id !== e.friend.id) }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case 'friendship_deleted': removeFriend(e.user_id); break;
    case 'friend_request_received':
      set((s) => ({ incoming: [e.request, ...s.incoming.filter((r) => r.id !== e.request.id)] }));
      break;
    case 'friend_request_canceled':
      set((s) => ({ incoming: s.incoming.filter((r) => r.id !== e.id), outgoing: s.outgoing.filter((r) => r.id !== e.id) }));
      break;
    case 'ptt_started':
      set((s) => ({ talkingTo: { ...s.talkingTo, [e.from.id]: true } }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'ptt_stopped':
      set((s) => ({ talkingTo: { ...s.talkingTo, [e.from_id]: false } }));
      break;
    case 'poke':
      set((s) => ({ pokedAt: { ...s.pokedAt, [e.from.id]: Date.now() }, pokeCount: { ...s.pokeCount, [e.from.id]: e.count || 1 } }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case 'message': onMessage(e.message); break;
    case 'chat_read': onRead(e.user_id, e.at); break;
    case 'chat_background': onBackground(e.user_id === get().me?.id ? e.friend_id : e.user_id, e.background); break;
    case 'call_ringing':
      if (!get().call) { set({ call: { friendId: e.from.id, state: 'incoming', since: Date.now() }, selectedId: e.from.id }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
      break;
    case 'call_accepted':
      if (get().call?.friendId === e.from_id) { set({ call: { friendId: e.from_id, state: 'active', since: Date.now() } }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
      break;
    case 'call_ended':
      if (get().call?.friendId === e.from_id) { remoteEnded(e.from_id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
      break;
  }
}

function connect() {
  if (stopped || ws) return;
  const t = accessToken();
  if (!t) return;
  const sock = new WebSocket(`${API.replace('https', 'wss')}/v1/stream?access_token=${encodeURIComponent(t)}`);
  ws = sock;
  sock.onopen = () => { retry = 0; set({ connected: true }); syncAll().catch(() => {}); loadChats().catch(() => {}); };
  sock.onmessage = (m) => { try { onEvent(JSON.parse(String(m.data))); } catch {} };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    set({ connected: false });
    if (stopped) return;
    // A stale access token closes the socket immediately: refresh via a cheap call first.
    timer = setTimeout(() => { req('/v1/me').catch(() => {}).finally(connect); }, Math.min(1000 * 2 ** retry++, 15000));
  };
}

export function startRealtime() {
  stopped = false;
  connect();
}
export function stopRealtime() {
  stopped = true;
  if (timer) clearTimeout(timer);
  ws?.close();
  ws = null;
}

AppState.addEventListener('change', (s) => {
  if (s === 'active' && !stopped) {
    if (!ws) { retry = 0; connect(); } else syncAll().catch(() => {});
  }
});
