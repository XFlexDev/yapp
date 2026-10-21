import { Image } from 'expo-image';
import { AppState } from 'react-native';
import { accessToken, avatarUrl, req, type Friend, type FriendRequest, type Me } from './api';
import { clearPokeCount, get, patchFriend, patchUser, removeFriend, set, upsertFriend } from './store';
import { API } from './theme';
import { remoteEnded } from './voice';
import { haptic } from './haptic';
import { loadChats, onBackground, onMessage, onRead } from './chat';
import { loadNotifs } from './notifs';
import { loadClips, onClip } from './clips';
import { loadGroups, onGroupMessage, onGroupRead, onGroupUpdated, onLeft } from './groups';

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
    case 'streak_updated': patchFriend(e.user_id, { streak: e.streak, last_talked_at: e.last_talked_at }); break;
    case 'friendship_created':
      upsertFriend(e.friend);
      set((s) => ({ incoming: s.incoming.filter((r) => r.user.id !== e.friend.id), outgoing: s.outgoing.filter((r) => r.user.id !== e.friend.id) }));
      haptic.celebrate();
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
      haptic.incomingTalk();
      break;
    case 'ptt_stopped':
      set((s) => ({ talkingTo: { ...s.talkingTo, [e.from_id]: false } }));
      break;
    case 'poke': {
      const selected = (get().call?.friendId ?? get().selectedId) === e.from.id;
      set((s) => {
        const pokeCount = { ...s.pokeCount };
        if (selected) delete pokeCount[e.from.id];
        else pokeCount[e.from.id] = (pokeCount[e.from.id] ?? 0) + (e.count || 1);
        return {
          pokedAt: selected ? { ...s.pokedAt, [e.from.id]: Math.max(Date.now(), (s.pokedAt[e.from.id] ?? 0) + 1) } : s.pokedAt,
          pokedCount: { ...s.pokedCount, [e.from.id]: e.count || 1 },
          pokeCount,
        };
      });
      if (selected) haptic.poked();
      break;
    }
    case 'talk_clip': onClip(e.clip); break;
    case 'achievement': haptic.celebrate(); set({ trophy: e.title }); break;
    case 'group_talk_started':
      if (e.from.id !== get().me?.id) { set((s) => ({ groupTalk: { ...s.groupTalk, [e.group_id]: e.from.id } })); haptic.incomingTalk(); }
      break;
    case 'group_talk_stopped':
      set((s) => ({ groupTalk: { ...s.groupTalk, [e.group_id]: null }, talkingTo: { ...s.talkingTo, [e.from_id]: false } }));
      break;
    case 'message': onMessage(e.message); break;
    case 'group_updated': onGroupUpdated(e.group); break;
    case 'group_message': onGroupMessage(e.group_id, e.message); break;
    case 'group_read': onGroupRead(e.group_id, e.user_id, e.at); break;
    case 'group_left': onLeft(e.group_id); break;
    case 'chat_read': onRead(e.user_id, e.at); break;
    case 'chat_background': onBackground(e.user_id === get().me?.id ? e.friend_id : e.user_id, e.background); break;
    case 'call_ringing':
      if (!get().call) { set({ call: { friendId: e.from.id, state: 'incoming', since: Date.now() }, selectedId: e.from.id }); clearPokeCount(e.from.id); }
      break;
    case 'call_accepted':
      if (get().call?.friendId === e.from_id) { set({ call: { friendId: e.from_id, state: 'active', since: Date.now() } }); haptic.connected(); }
      break;
    case 'call_ended':
      if (get().call?.friendId === e.from_id) { remoteEnded(e.from_id); haptic.hangup(); }
      break;
  }
}

function connect() {
  if (stopped || ws) return;
  const t = accessToken();
  if (!t) return;
  const sock = new WebSocket(`${API.replace('https', 'wss')}/v1/stream?access_token=${encodeURIComponent(t)}`);
  ws = sock;
  sock.onopen = () => { retry = 0; set({ connected: true }); syncAll().catch(() => {}); loadChats().catch(() => {}); loadGroups().catch(() => {}); loadNotifs().catch(() => {}); loadClips().catch(() => {}); };
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
    if (!ws) { retry = 0; connect(); } else { syncAll().catch(() => {}); loadClips().catch(() => {}); }
  }
});
