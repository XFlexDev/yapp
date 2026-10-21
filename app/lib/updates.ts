import * as Updates from 'expo-updates';
import { AppState } from 'react-native';

let pending = false;
let hiddenAt = 0;

// Never reload while someone is looking at the app: a fetched update applies on the next cold
// start, or when returning after being away for a while.
async function pull() {
  try {
    if (!(await Updates.checkForUpdateAsync()).isAvailable) return;
    if ((await Updates.fetchUpdateAsync()).isNew) pending = true;
  } catch {}
}

export function startUpdates() {
  if (__DEV__ || !Updates.isEnabled) return;
  pull();
  AppState.addEventListener('change', (s) => {
    if (s === 'background') hiddenAt = Date.now();
    if (s !== 'active') return;
    if (pending && hiddenAt && Date.now() - hiddenAt > 30_000) Updates.reloadAsync().catch(() => {});
    else pull();
  });
}
