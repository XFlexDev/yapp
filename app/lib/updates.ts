import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { AppState } from 'react-native';
import { useStore } from './store';

let pending = false;
let fetched: string | null = null;
let busy = false;
let hiddenAt = 0;
const TRIED = 'update-tried';

async function pull() {
  if (busy || pending) return;
  busy = true;
  try {
    if (!(await Updates.checkForUpdateAsync()).isAvailable) return;
    const r = await Updates.fetchUpdateAsync();
    if (r.isNew) { pending = true; fetched = (r.manifest as { id?: string } | undefined)?.id ?? null; }
  } catch {} finally { busy = false; }
}

const idle = () => {
  const s = useStore.getState();
  return !s.call && !Object.values(s.talkingTo).some(Boolean) && !Object.values(s.groupTalk).some(Boolean);
};

// Android keeps Yapp running in the background to listen, so it may not cold start for days.
// While nobody is looking and nobody is talking, a fetched update is applied right there.
async function quiet() {
  if (AppState.currentState === 'active') return;
  await pull();
  if (!pending || AppState.currentState === 'active' || !idle()) return;
  try {
    // One silent try per update, so an update that fails to launch can not reload in a loop.
    if (fetched && (await SecureStore.getItemAsync(TRIED)) === fetched) return;
    if (fetched) await SecureStore.setItemAsync(TRIED, fetched);
    await Updates.reloadAsync();
  } catch {}
}

// Never reload while someone is looking at the app: a fetched update applies in the background,
// on the next cold start, or when returning after being away for a while.
export function startUpdates() {
  if (__DEV__ || !Updates.isEnabled) return;
  pull();
  setInterval(quiet, 15 * 60_000);
  AppState.addEventListener('change', (s) => {
    if (s === 'background') { hiddenAt = Date.now(); quiet(); }
    if (s !== 'active') return;
    if (pending && hiddenAt && Date.now() - hiddenAt > 30_000) Updates.reloadAsync().catch(() => {});
    else pull();
  });
}
