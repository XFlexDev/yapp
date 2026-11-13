import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { req } from './api';

Notifications.setNotificationHandler({
  // An incoming call already fills the screen when the app is open.
  handleNotification: async (n) => {
    const inApp = n.request.content.data?.type === 'call' && AppState.currentState === 'active';
    return { shouldShowBanner: false, shouldShowList: !inApp, shouldPlaySound: false, shouldSetBadge: false };
  },
});

const CHANNEL = 'yap_quiet';
const CALL_CHANNEL = 'yap_call';
// About 25 seconds of ringing, as vibration only.
const RING = [0, ...Array.from({ length: 15 }, () => [900, 800]).flat()];

export async function registerPush() {
  if (!Device.isDevice) return;
  if (Platform.OS === 'android') {
    // A channel's sound is fixed once Android creates it, so vibrate-only needs its own channel.
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Talk', importance: Notifications.AndroidImportance.MAX, sound: null, enableVibrate: true, vibrationPattern: [0, 250, 200, 250] });
    await Notifications.setNotificationChannelAsync(CALL_CHANNEL, {
      name: 'Calls', importance: Notifications.AndroidImportance.MAX, sound: null, enableVibrate: true, vibrationPattern: RING,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  await Notifications.setNotificationCategoryAsync('call', [
    { identifier: 'answer', buttonTitle: 'answer', options: { opensAppToForeground: true } },
    { identifier: 'decline', buttonTitle: 'decline', options: { opensAppToForeground: false, isDestructive: true } },
  ]).catch(() => {});
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await req('/v1/devices', { method: 'POST', body: { token: data, platform: Platform.OS, ...(Platform.OS === 'android' ? { channel: CHANNEL, call_channel: CALL_CHANNEL } : {}) } });
    if (Platform.OS === 'android') await Notifications.deleteNotificationChannelAsync('yap').catch(() => {});
  } catch {
    // No push credentials for this build yet: live talk still works while the app is open.
  }
}
