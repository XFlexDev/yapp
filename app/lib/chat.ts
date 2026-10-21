import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { req } from './api';
import { get, set, type Chat, type ChatMsg } from './store';

const EMPTY: Chat = { messages: [], loaded: false, more: true, background: null, theirReadAt: 0, unread: 0 };
export const chatOf = (id: string) => get().chats[id] ?? EMPTY;
function patch(id: string, f: (c: Chat) => Partial<Chat>) {
  set((s) => { const c = s.chats[id] ?? EMPTY; return { chats: { ...s.chats, [id]: { ...c, ...f(c) } } }; });
}
const add = (list: ChatMsg[], m: ChatMsg) => (list.some((x) => x.id === m.id) ? list : [m, ...list.filter((x) => !(x.pending && x.from === m.from && x.body === m.body))]);

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

export async function sendMessage(id: string, body: string) {
  const me = get().me!.id;
  const tmp: ChatMsg = { id: `tmp-${Date.now()}`, from: me, to: id, kind: 'text', body, created_at: Date.now(), pending: true };
  patch(id, (c) => ({ messages: [tmp, ...c.messages] }));
  try {
    const m = await req<ChatMsg>(`/v1/chats/${id}/messages`, { method: 'POST', body: { body } });
    patch(id, (c) => ({ messages: add(c.messages.filter((x) => x.id !== tmp.id), m) }));
  } catch {
    patch(id, (c) => ({ messages: c.messages.map((x) => (x.id === tmp.id ? { ...x, pending: false, failed: true } : x)) }));
  }
}

export function retry(id: string, m: ChatMsg) {
  patch(id, (c) => ({ messages: c.messages.filter((x) => x.id !== m.id) }));
  return sendMessage(id, m.body);
}

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
