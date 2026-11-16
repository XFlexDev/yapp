import { requireOptionalNativeModule } from 'expo';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

export type AwakeState = 'ask' | 'on' | 'off' | 'denied';
type State = AwakeState;
type Awake = { start(): Promise<State>; stop(): Promise<void>; state(): Promise<State> };
// Missing on Android and on iOS builds made before the module existed; every call is then a no-op.
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<Awake>('YappAwake') : null;

const ASLEEP = 'asleep';
const LINES: [string, string][] = [
  ['yapp fell asleep', "your friends are talking to a wall right now. tap to wake it up"],
  ['zzz', 'yapp dozed off on the job. tap and it gets back to work'],
  ['yapp passed out', "iphone tucked it in. tap so you can hear your friends again"],
  ['yapp blinked', 'and now it hears nothing. tap to bring it back'],
  ['yapp went to get milk', 'tap and it comes back. promise'],
  ['hello? anyone?', "yapp can't hear your friends anymore. tap to fix that"],
];
let timer: ReturnType<typeof setInterval> | null = null;
let wanted = false;
// null until checked, and for good on builds without stay-awake.
let current: State | null = null;
let listener: ((s: State | null) => void) | null = null;

// A notification that is always three minutes away. While yapp is alive it keeps getting pushed back,
// so it only shows once iOS has put yapp to sleep or closed it.
async function postpone() {
  try {
    if ((await native!.state()) !== 'on') { await Notifications.cancelScheduledNotificationAsync(ASLEEP); return; }
    const [title, body] = LINES[Math.floor(Math.random() * LINES.length)];
    await Notifications.scheduleNotificationAsync({
      identifier: ASLEEP,
      content: { title, body, sound: false, data: { type: ASLEEP } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 180 },
    });
  } catch {}
}

function arm() {
  Notifications.dismissNotificationAsync(ASLEEP).catch(() => {});
  postpone();
  timer ??= setInterval(postpone, 45000);
}

async function refresh() {
  if (!native || !wanted) return;
  try {
    let st = await native.state();
    if (st !== 'ask' && st !== 'denied') { st = await native.start(); arm(); }
    if (st !== current) { current = st; listener?.(st); }
  } catch {}
}

// Coming back from the iOS location prompt or from Settings makes the app active again.
AppState.addEventListener('change', (st) => { if (st === 'active') refresh(); });

/** Hear about the stay-awake state: 'ask' and 'denied' mean it is missing and the user has to act. */
export function onAwake(fn: (s: State | null) => void) {
  listener = fn;
  fn(current);
  return () => { if (listener === fn) listener = null; };
}

/** True while the user still has to turn stay-awake on. Talking and calls are off until then. */
export function awakeMissing(): boolean {
  const missing = current === 'ask' || current === 'denied';
  if (missing) listener?.(current);
  return missing;
}

/** Keep yapp awake on iOS. */
export function startAwake() {
  wanted = true;
  refresh();
}

/** The user agreed: iOS shows its location prompt, and yapp stays awake once they allow it. */
export async function allowAwake() {
  if (!native) return;
  try { await native.start(); } catch {}
}

export function stopAwake() {
  if (!native) return;
  wanted = false;
  current = null;
  if (timer) { clearInterval(timer); timer = null; }
  Notifications.cancelScheduledNotificationAsync(ASLEEP).catch(() => {});
  native.stop().catch(() => {});
}
