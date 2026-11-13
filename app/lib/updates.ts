import * as Updates from 'expo-updates';
import { AppState } from 'react-native';
import { useStore } from './store';

let pending = false;
let busy = false;
let hiddenAt = 0;

async function pull() {
  if (busy || pending) return;
  busy = true;
  try {
    if (!(await Updates.checkForUpdateAsync()).isAvailable) return;
    if ((await Updates.fetchUpdateAsync()).isNew) pending = true;
  } catch {} finally { busy = false; }
}

const idle = () => {
  const s = useStore.getState();
  return !s.call && !Object.values(s.talkingTo).some(Boolean) && !Object.values(s.groupTalk).some(Boolean);
};

// Android keeps Yapp running in the background to listen, so it may not cold start for days.
// Updates are therefore fetched while it sits there and applied the moment it is opened again.
// Reloading in the background itself is not an option: voice stays unstable until the next open.
export function startUpdates() {
  if (__DEV__ || !Updates.isEnabled) return;
  pull();
  setInterval(() => { if (AppState.currentState !== 'active') pull(); }, 15 * 60_000);
  AppState.addEventListener('change', (s) => {
    if (s === 'background') { hiddenAt = Date.now(); pull(); }
    if (s !== 'active') return;
    // A short trip to the photo picker or a permission prompt must not restart the app.
    if (pending && idle() && hiddenAt && Date.now() - hiddenAt > 30_000) Updates.reloadAsync().catch(() => {});
    else pull();
  });
}
