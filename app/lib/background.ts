import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { useStore } from './store';

type Bg = { start(title: string, text: string): boolean; stop(): void; setActive(active: boolean): void; isBatteryExcluded(): boolean; excludeBattery(): boolean };
// Missing on iOS and on Android builds made before the module existed; every call is then a no-op.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<Bg>('YappBackground') : null;

let selfTalking = false;
let unsub: (() => void) | null = null;
let lastActive = false;

function sync() {
  const s = useStore.getState();
  const active = selfTalking || !!s.call || Object.values(s.talkingTo).some(Boolean);
  if (active !== lastActive) { lastActive = active; native?.setActive(active); }
}

/** Keep the app alive in the background so friends' voice plays with the screen off. */
export function startBackground() {
  if (!native) return;
  native.start('Yapp is on', 'Friends can talk to you anytime');
  unsub ??= useStore.subscribe(sync);
}

export function stopBackground() {
  unsub?.(); unsub = null;
  lastActive = false; selfTalking = false;
  native?.stop();
}

export function setSelfTalking(v: boolean) { selfTalking = v; sync(); }

/** True when Android has exempted Yapp from battery optimization (Android only, else true). */
export function batteryExcluded(): boolean {
  return native ? native.isBatteryExcluded() : true;
}

/** Opens the system dialog to exempt Yapp from battery optimization. Returns false if unavailable. */
export function excludeBattery(): boolean {
  return native ? native.excludeBattery() : false;
}
