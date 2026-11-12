import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

/** How a chat's background is shown on this phone: 0..1 each. Unset values fall back to the background's own default. */
export type Look = { blur?: number; bright?: number };

const KEY = 'yap.looks';
let looks: Record<string, Look> = {};
const watchers = new Set<() => void>();
let saving: ReturnType<typeof setTimeout> | null = null;

SecureStore.getItemAsync(KEY).then((raw) => { if (raw) { looks = { ...JSON.parse(raw), ...looks }; watchers.forEach((fn) => fn()); } }).catch(() => {});

const NONE: Look = {};
export function useLook(chat: string): Look {
  return useSyncExternalStore((fn) => { watchers.add(fn); return () => { watchers.delete(fn); }; }, () => looks[chat] ?? NONE);
}
export function setLook(chat: string, change: Look) {
  looks = { ...looks, [chat]: { ...looks[chat], ...change } };
  watchers.forEach((fn) => fn());
  if (saving) clearTimeout(saving);
  saving = setTimeout(() => { SecureStore.setItemAsync(KEY, JSON.stringify(looks)).catch(() => {}); }, 400);
}
