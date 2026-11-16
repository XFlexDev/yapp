import { requireOptionalNativeModule } from 'expo';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

type State = 'ask' | 'on' | 'off' | 'denied';
type Awake = { start(): Promise<State>; stop(): Promise<void>; state(): Promise<State> };
// Missing on Android and on iOS builds made before the module existed; every call is then a no-op.
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<Awake>('YappAwake') : null;

const ASKED_KEY = 'awake-asked';
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

/** Keep yapp awake on iOS. Returns true when the user has to be asked first. */
export async function startAwake(): Promise<boolean> {
  if (!native) return false;
  try {
    const st = await native.state();
    if (st === 'denied') return false;
    if (st === 'ask') return !(await SecureStore.getItemAsync(ASKED_KEY));
    await native.start();
    arm();
  } catch {}
  return false;
}

/** The user agreed: iOS shows its location prompt, and yapp stays awake once they allow it. */
export async function allowAwake() {
  if (!native) return;
  try {
    await SecureStore.setItemAsync(ASKED_KEY, '1');
    await native.start();
    arm();
  } catch {}
}

export function skipAwake() {
  SecureStore.setItemAsync(ASKED_KEY, '1').catch(() => {});
}

export function stopAwake() {
  if (!native) return;
  if (timer) { clearInterval(timer); timer = null; }
  Notifications.cancelScheduledNotificationAsync(ASLEEP).catch(() => {});
  native.stop().catch(() => {});
}
