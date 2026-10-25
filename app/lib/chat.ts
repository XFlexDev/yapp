import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { mediaUrl, req } from './api';
import { get, set, type Chat, type ChatMsg } from './store';

const EMPTY: Chat = { messages: [], loaded: false, more: true, background: null, theirReadAt: 0, unread: 0 };
export const chatOf = (id: string) => get().chats[id] ?? EMPTY;
function patch(id: string, f: (c: Chat) => Partial<Chat>) {
  set((s) => { const c = s.chats[id] ?? EMPTY; return { chats: { ...s.chats, [id]: { ...c, ...f(c) } } }; });
}
/** Adds `m`, replacing its optimistic copy; keeps the copy's key (`cid`) so the bubble doesn't re-mount. */
const add = (list: ChatMsg[], m: ChatMsg) => {
  if (list.some((x) => x.id === m.id)) return list;
  const twin = list.find((x) => x.pending && x.from === m.from && (x.body === m.body || (x.kind === 'image' && m.kind === 'image')));
  const next = twin ? { ...m, cid: twin.cid ?? twin.id } : m;
  return twin ? list.map((x) => (x === twin ? next : x)) : [next, ...list];
};

export async function loadChats() {
  const r = await req<{ chats: { friend_id: string; last: ChatMsg | null; unread: number; background: string | null }[] }>('/v1/chats');
  for (const c of r.chats) patch(c.friend_id, (o) => ({ unread: c.unread, background: c.background, messages: o.loaded || !c.last ? o.messages : [c.last] }));
}

export async function loadMessages(id: string, older = false) {
  const c = chatOf(id);
  if (older && (!c.more || !c.loaded)) return;
  const before = older ? c.messages.filter((m) => !m.pending).at(-1)?.created_at : undefined;
  const r = await req<{ messages: ChatMsg[]; background: string | null; their_read_at: number }>(`/v1/chats/${id}/messages?limit=40${before ? `&before=${before}` : ''}`);
  patch(id, (o) => ({
    messages: older ? [...o.messages, ...r.messages.filter((m) => !o.messages.some((x) => x.id === m.id))] : [...o.messages.filter((m) => m.pending), ...r.messages],
    loaded: true, more: r.messages.length === 40, background: r.background, theirReadAt: r.their_read_at,
  }));
}

export async function sendMessage(id: string, body: string, replyTo?: string, kind = 'text', meta?: string) {
  const me = get().me!.id;
  const tmp: ChatMsg = { id: `tmp-${Date.now()}`, from: me, to: id, kind, body, meta, created_at: Date.now(), pending: true };
  patch(id, (c) => ({ messages: [tmp, ...c.messages] }));
  try {
    const m = await req<ChatMsg>(`/v1/chats/${id}/messages`, { method: 'POST', body: { body, kind, meta, reply_to: replyTo } });
    patch(id, (c) => (c.messages.some((x) => x.id === m.id) ? { messages: c.messages.filter((x) => x.id !== tmp.id) } : { messages: c.messages.map((x) => (x.id === tmp.id ? { ...m, cid: tmp.id } : x)) }));
  } catch {
    patch(id, (c) => ({ messages: c.messages.map((x) => (x.id === tmp.id ? { ...x, pending: false, failed: true } : x)) }));
  }
}

export function retry(id: string, m: ChatMsg) {
  patch(id, (c) => ({ messages: c.messages.filter((x) => x.id !== m.id) }));
  if (m.kind === 'image') return photoFromMsg(m).then((p) => sendPhotoTo(id, p));
  return sendMessage(id, m.body);
}

export type Photo = { uri: string; w: number; h: number; thumb: string };
const ACCEPT = ImageManipulator.SaveFormat.WEBP;
/** Picks a photo and shrinks it on the phone: max 1600px WebP (~150-300 KB) plus a ~20px base64 preview for the blur-up. */
export async function pickPhoto(): Promise<Photo | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const a = r.assets?.[0];
  if (r.canceled || !a) return null;
  const wide = a.width >= a.height;
  const big = Math.max(a.width, a.height) > 1600;
  const out = await ImageManipulator.manipulateAsync(a.uri, big ? [{ resize: wide ? { width: 1600 } : { height: 1600 } }] : [], { compress: 0.75, format: ACCEPT });
  const t = await ImageManipulator.manipulateAsync(out.uri, [{ resize: wide ? { width: 20 } : { height: 20 } }], { compress: 0.5, format: ACCEPT, base64: true });
  return { uri: out.uri, w: out.width, h: out.height, thumb: t.base64 ?? '' };
}
export const photoMeta = (p: Photo) => `${p.w},${p.h},${p.thumb}`;
export async function photoFromMsg(m: ChatMsg): Promise<Photo> {
  const [w, h, thumb] = (m.meta ?? '0,0,').split(',');
  return { uri: m.body, w: +w, h: +h, thumb: thumb ?? '' };
}
/** Uploads a picked photo; the server stores each unique photo once. */
export async function uploadPhoto(path: string, p: Photo) {
  const blob = await (await fetch(p.uri)).blob();
  return req<ChatMsg>(`${path}?w=${p.w}&h=${p.h}&t=${encodeURIComponent(p.thumb)}`, { method: 'POST', raw: blob, ctype: 'image/webp' });
}

async function sendPhotoTo(id: string, p: Photo) {
  const me = get().me!.id;
  const tmp: ChatMsg = { id: `tmp-${Date.now()}`, from: me, to: id, kind: 'image', body: p.uri, meta: photoMeta(p), created_at: Date.now(), pending: true };
  patch(id, (c) => ({ messages: [tmp, ...c.messages] }));
  try {
    const m = await uploadPhoto(`/v1/chats/${id}/photo`, p);
    patch(id, (c) => (c.messages.some((x) => x.id === m.id) ? { messages: c.messages.filter((x) => x.id !== tmp.id) } : { messages: c.messages.map((x) => (x.id === tmp.id ? { ...m, cid: tmp.id } : x)) }));
  } catch {
    patch(id, (c) => ({ messages: c.messages.map((x) => (x.id === tmp.id ? { ...x, pending: false, failed: true } : x)) }));
  }
}
export async function sendPhoto(id: string) {
  const p = await pickPhoto();
  if (p) await sendPhotoTo(id, p);
}

/** Deletes my copy of the chat; the server wipes it for good once both sides have. */
export async function deleteChat(id: string) {
  patch(id, () => ({ messages: [], unread: 0, more: false }));
  await req(`/v1/chats/${id}`, { method: 'DELETE' });
}
export async function deleteMessage(id: string, m: ChatMsg) {
  patch(id, (c) => ({ messages: c.messages.filter((x) => x.id !== m.id) }));
  if (!m.id.startsWith('tmp-')) await req(`/v1/chats/${id}/messages/${m.id}`, { method: 'DELETE' });
}
export const onMessageDeleted = (id: string, mid: string) => patch(id, (c) => ({ messages: c.messages.filter((x) => x.id !== mid) }));
export const onCleared = (id: string) => patch(id, () => ({ messages: [], unread: 0, more: false }));
export const loadChatPhotos = (id: string) => req<ChatMsg[]>(`/v1/chats/${id}/photos`);

export function markRead(id: string) {
  const top = chatOf(id).messages.find((m) => !m.pending && !m.failed);
  patch(id, () => ({ unread: 0 }));
  if (top) req(`/v1/chats/${id}/read`, { method: 'POST', body: { at: top.created_at } }).catch(() => {});
}

export function onMessage(m: ChatMsg) {
  const me = get().me?.id;
  const id = m.from === me ? m.to : m.from;
  const open = get().openChat === id;
  patch(id, (c) => ({ messages: add(c.messages, m), unread: m.from !== me && !open ? c.unread + 1 : c.unread }));
  if (open && m.from !== me) markRead(id);
}

export const onRead = (id: string, at: number) => patch(id, (c) => ({ theirReadAt: Math.max(c.theirReadAt, at) }));
export const onBackground = (id: string, bg: string | null) => patch(id, () => ({ background: bg }));

export function setBackground(id: string, bg: string | null) {
  const prev = chatOf(id).background;
  onBackground(id, bg);
  req(`/v1/chats/${id}/background`, { method: 'PUT', body: { background: bg } }).catch(() => onBackground(id, prev));
}

/** Pick any photo as the chat background; it's shrunk to a ~100 KB WebP before upload. */
export async function pickBackgroundPhoto(id: string, path = `/v1/chats/${id}/background/photo`) {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const a = r.assets?.[0];
  if (r.canceled || !a) return;
  const out = await ImageManipulator.manipulateAsync(a.uri, a.width > 1080 ? [{ resize: { width: 1080 } }] : [], { compress: 0.72, format: ImageManipulator.SaveFormat.WEBP });
  const blob = await (await fetch(out.uri)).blob();
  const res = await req<{ background: string | null }>(path, { method: 'PUT', raw: blob, ctype: 'image/webp' });
  if (path.startsWith('/v1/chats/')) onBackground(id, res.background);
  return res;
}

export const BACKGROUNDS: { id: string; colors: [string, string, ...string[]] }[] = [
  { id: 'midnight', colors: ['#0B0B2A', '#000000'] },
  { id: 'ember', colors: ['#3A0A00', '#120000', '#000000'] },
  { id: 'ocean', colors: ['#00263A', '#000A12'] },
  { id: 'grape', colors: ['#2A0A3A', '#0A0012'] },
  { id: 'forest', colors: ['#06301A', '#000A04'] },
  { id: 'rose', colors: ['#3A0A22', '#0A0006'] },
  { id: 'gold', colors: ['#3A2A00', '#0A0700'] },
];

export async function sendSticker(id: string, stickerId: string, meta?: string, replyTo?: string) {
  const me = get().me!.id;
  const tmp: ChatMsg = { id: `tmp-${Date.now()}`, from: me, to: id, kind: 'sticker', body: stickerId, created_at: Date.now(), meta, pending: true };
  patch(id, (c) => ({ messages: [tmp, ...c.messages] }));
  try {
    const m = await req<ChatMsg>(`/v1/chats/${id}/messages`, { method: 'POST', body: { body: stickerId, kind: 'sticker', meta, reply_to: replyTo } });
    patch(id, (c) => (c.messages.some((x) => x.id === m.id) ? { messages: c.messages.filter((x) => x.id !== tmp.id) } : { messages: c.messages.map((x) => (x.id === tmp.id ? { ...m, cid: tmp.id } : x)) }));
  } catch {
    patch(id, (c) => ({ messages: c.messages.map((x) => (x.id === tmp.id ? { ...x, pending: false, failed: true } : x)) }));
  }
}


/** Update a message's reaction chips inside a chat or group entry. */
export function applyReactions(chatId: string, msgId: string, reactions: ChatMsg['reactions']) {
  const patchChat = (list: ChatMsg[]) => list.map((m) => (m.id === msgId ? { ...m, reactions } : m));
  const st = get();
  if (st.chats[chatId]) {
    patch(chatId, (c) => ({ messages: patchChat(c.messages) }));
  } else if (st.groups[chatId]) {
    set({ groups: { ...st.groups, [chatId]: { ...st.groups[chatId], messages: patchChat(st.groups[chatId].messages) } } });
  }
}

export async function react(id: string, msgId: string, emoji: string) {
  await req(`/v1/chats/${id}/messages/${msgId}/react`, { method: 'POST', body: { emoji } });
}

/** Save an image message to your sticker collection via the sticker pipeline. */
export async function saveImageAsSticker(body: string) {
  const url = body.startsWith('http') ? body : mediaUrl(body);
  const blob = await (await fetch(url)).blob();
  return req<unknown>('/v1/stickers/upload?is_emoji=false', { method: 'POST', raw: blob, ctype: 'image/webp' });
}
