import * as Updates from 'expo-updates';
import { AppState } from 'react-native';

let pending = false;

// An update fetched within a few seconds of launch applies right away; later ones apply on the next foreground.
async function pull(launchedAt?: number) {
  try {
    if (!(await Updates.checkForUpdateAsync()).isAvailable) return;
    if (!(await Updates.fetchUpdateAsync()).isNew) return;
    if (launchedAt && Date.now() - launchedAt < 3500) await Updates.reloadAsync();
    else pending = true;
  } catch {}
}

export function startUpdates() {
  if (__DEV__ || !Updates.isEnabled) return;
  pull(Date.now());
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') return;
    if (pending) Updates.reloadAsync().catch(() => {});
    else pull();
  });
}
