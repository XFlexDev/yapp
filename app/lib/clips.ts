import { AppState } from 'react-native';
import { req, type Clip } from './api';
import { haptic } from './haptic';
import { get, set } from './store';
import { heardAt, startListening } from './voice';

export async function loadClips() {
  const by: Record<string, Clip[]> = {};
  for (const c of await req<Clip[]>('/v1/clips')) (by[c.from] ??= []).push(c);
  set({ clips: by });
}

/** A talk just finished. If I heard it live with the app open, drop it; otherwise keep it as missed. */
export function onClip(c: Clip) {
  const heard = AppState.currentState === 'active' && Date.now() - (heardAt[c.from] ?? 0) < c.ms + 8000;
  if (heard) { req(`/v1/clips/${c.id}/seen`, { method: 'POST' }).catch(() => {}); return; }
  set((s) => ({ clips: { ...s.clips, [c.from]: [...(s.clips[c.from] ?? []).filter((x) => x.id !== c.id), c] } }));
}

/** Plays the oldest missed talk from this friend through my inbox room. */
export function playClip(friendId: string) {
  const [c, ...rest] = get().clips[friendId] ?? [];
  if (!c) return;
  haptic.tap();
  set((s) => ({ clips: { ...s.clips, [friendId]: rest } }));
  startListening().catch(() => {});
  req(`/v1/clips/${c.id}/play`, { method: 'POST' }).catch(() => loadClips().catch(() => {}));
}
