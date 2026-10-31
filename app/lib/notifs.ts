import { useEffect, useState } from 'react';
import { req } from './api';
import { get, set, useStore, type NotifPrefs } from './store';

export async function loadNotifs() {
  const response = await req<{ prefs: NotifPrefs; muted: string[]; mute_until?: Record<string, number> }>('/v1/notifications');
  const muteUntil = { ...(response.mute_until ?? {}) };
  for (const chat of response.muted) {
    if (!Object.prototype.hasOwnProperty.call(muteUntil, chat)) muteUntil[chat] = 0;
  }
  set({ notif: { prefs: response.prefs, muted: response.muted }, muteUntil });
}
export function setPref(k: keyof NotifPrefs, v: boolean) {
  const n = get().notif;
  if (!n) return;
  const prefs = { ...n.prefs, [k]: v };
  set({ notif: { ...n, prefs } });
  req('/v1/notifications', { method: 'PUT', body: prefs }).catch(() => set({ notif: { ...get().notif!, prefs: n.prefs } }));
}
export const isMuted = (chat: string) => {
  const until = get().muteUntil[chat];
  return until === 0 || (until !== undefined && until > Date.now());
};
export function useMuted(chat: string) {
  const until = useStore((s) => s.muteUntil[chat]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (until === undefined || until === 0 || until <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(60_000, until - now));
    return () => clearTimeout(timer);
  }, [until, now]);
  return until === 0 || (until !== undefined && until > now);
}
function updateMute(chat: string, muted: boolean, minutes: number | null = null) {
  const before = get();
  const previousNotif = before.notif ?? { prefs: { messages: true, talk: true, calls: true, friends: true }, muted: [] };
  const hadMute = previousNotif.muted.includes(chat);
  const previousUntil = before.muteUntil[chat];
  const nextUntil = muted ? (minutes === null ? 0 : Date.now() + Math.max(1, Math.min(525_600, Math.trunc(minutes))) * 60_000) : undefined;
  const nextMuted = muted
    ? [...previousNotif.muted.filter((c) => c !== chat), chat]
    : previousNotif.muted.filter((c) => c !== chat);
  const nextMuteUntil = { ...before.muteUntil };
  if (nextUntil === undefined) delete nextMuteUntil[chat];
  else nextMuteUntil[chat] = nextUntil;
  set({ notif: { ...previousNotif, muted: nextMuted }, muteUntil: nextMuteUntil });
  req('/v1/notifications/mute', { method: 'PUT', body: { chat, muted, minutes: muted ? minutes : null } }).catch(() => set((s) => {
    if (s.muteUntil[chat] !== nextUntil) return {};
    const muteUntil = { ...s.muteUntil };
    if (previousUntil === undefined) delete muteUntil[chat];
    else muteUntil[chat] = previousUntil;
    const currentNotif = s.notif ?? previousNotif;
    const currentMuted = currentNotif.muted.filter((c) => c !== chat);
    if (hadMute) currentMuted.push(chat);
    return { notif: { ...currentNotif, muted: currentMuted }, muteUntil };
  }));
}
export function muteFriend(id: string, minutes: number | null) {
  updateMute(id, true, minutes);
}
export function unmuteFriend(id: string) {
  updateMute(id, false);
}
export function setMuted(chat: string, muted: boolean) {
  updateMute(chat, muted);
}
