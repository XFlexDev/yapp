import { req } from './api';
import { get, set, type NotifPrefs } from './store';

export async function loadNotifs() {
  set({ notif: await req<{ prefs: NotifPrefs; muted: string[] }>('/v1/notifications') });
}
export function setPref(k: keyof NotifPrefs, v: boolean) {
  const n = get().notif;
  if (!n) return;
  const prefs = { ...n.prefs, [k]: v };
  set({ notif: { ...n, prefs } });
  req('/v1/notifications', { method: 'PUT', body: prefs }).catch(() => set({ notif: { ...get().notif!, prefs: n.prefs } }));
}
export const isMuted = (chat: string) => !!get().notif?.muted.includes(chat);
export function setMuted(chat: string, muted: boolean) {
  const n = get().notif ?? { prefs: { messages: true, talk: true, calls: true, friends: true }, muted: [] };
  set({ notif: { ...n, muted: muted ? [...n.muted.filter((c) => c !== chat), chat] : n.muted.filter((c) => c !== chat) } });
  req('/v1/notifications/mute', { method: 'PUT', body: { chat, muted } }).catch(() => set({ notif: n }));
}
