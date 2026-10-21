import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const S = Haptics.ImpactFeedbackStyle;
type Style = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid' | 'tick';
type Beat = [ms: number, style: Style];

const ANDROID: Record<Style, Haptics.AndroidHaptics> = {
  light: Haptics.AndroidHaptics.Keyboard_Tap,
  medium: Haptics.AndroidHaptics.Virtual_Key,
  heavy: Haptics.AndroidHaptics.Long_Press,
  soft: Haptics.AndroidHaptics.Context_Click,
  rigid: Haptics.AndroidHaptics.Clock_Tick,
  tick: Haptics.AndroidHaptics.Segment_Tick
};
const IOS: Record<Exclude<Style, 'tick'>, Haptics.ImpactFeedbackStyle> = { light: S.Light, medium: S.Medium, heavy: S.Heavy, soft: S.Soft, rigid: S.Rigid };

function hit(s: Style) {
  if (Platform.OS === 'android') Haptics.performAndroidHapticsAsync(ANDROID[s]).catch(() => {});
  else if (s === 'tick') Haptics.selectionAsync().catch(() => {});
  else Haptics.impactAsync(IOS[s]).catch(() => {});
}

function play(beats: Beat[]) {
  for (const [ms, s] of beats) ms ? setTimeout(() => hit(s), ms) : hit(s);
}

let ringing: ReturnType<typeof setInterval> | null = null;

export const haptic = {
  /** carousel detent, toggles */
  tick: () => hit('tick'),
  /** buttons */
  tap: () => hit('light'),
  /** heavy but cushioned, like pressing into rubber */
  softHeavy: () => hit('soft'),
  heavy: () => hit('heavy'),
  /** crisp high-pitched click */
  click: () => hit('rigid'),
  /** finger lands on the avatar and holds */
  press: () => hit('soft'),
  /** mic is live: cushioned press then a hard latch */
  live: () => play([[0, 'soft'], [55, 'heavy']]),
  /** let go of talk */
  release: () => play([[0, 'rigid'], [70, 'soft']]),
  /** detents while sliding up to lock */
  notch: () => hit('rigid'),
  /** locked into a call: two-stage latch */
  lock: () => play([[0, 'heavy'], [80, 'rigid'], [150, 'rigid']]),
  /** sending a poke */
  poke: () => play([[0, 'rigid'], [40, 'light']]),
  /** being poked: knock knock */
  poked: () => play([[0, 'heavy'], [110, 'medium'], [260, 'heavy'], [370, 'medium']]),
  /** friend starts talking to you */
  incomingTalk: () => play([[0, 'soft'], [90, 'medium']]),
  /** phone-ring cadence until stopped */
  ring: () => {
    haptic.stopRing();
    const burst = () => play([[0, 'heavy'], [90, 'heavy'], [180, 'heavy'], [270, 'heavy'], [520, 'heavy'], [610, 'heavy'], [700, 'heavy'], [790, 'heavy']]);
    burst();
    let n = 0;
    ringing = setInterval(() => { if (++n > 20) haptic.stopRing(); else burst(); }, 2000);
  },
  stopRing: () => { if (ringing) clearInterval(ringing); ringing = null; },
  /** call connected: rising build */
  connected: () => play([[0, 'soft'], [70, 'medium'], [140, 'heavy']]),
  /** hang up: thud that decays */
  hangup: () => play([[0, 'heavy'], [80, 'medium'], [170, 'light']]),
  /** new friend */
  celebrate: () => play([[0, 'rigid'], [70, 'rigid'], [160, 'heavy'], [300, 'soft']]),
  success: () => (Platform.OS === 'android' ? hit('rigid') : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})),
  warning: () => (Platform.OS === 'android' ? hit('heavy') : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})),
  error: () => (Platform.OS === 'android' ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject).catch(() => {}) : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}))
};
