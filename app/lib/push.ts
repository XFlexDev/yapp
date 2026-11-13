import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { req } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

const CHANNEL = 'yap_quiet';

export async function registerPush() {
  if (!Device.isDevice) return;
  if (Platform.OS === 'android') {
    // A channel's sound is fixed once Android creates it, so vibrate-only needs its own channel.
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Talk', importance: Notifications.AndroidImportance.MAX, sound: null, enableVibrate: true, vibrationPattern: [0, 250, 200, 250] });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await req('/v1/devices', { method: 'POST', body: { token: data, platform: Platform.OS, channel: Platform.OS === 'android' ? CHANNEL : undefined } });
    if (Platform.OS === 'android') await Notifications.deleteNotificationChannelAsync('yap').catch(() => {});
  } catch {
    // No push credentials for this build yet: live talk still works while the app is open.
  }
}
