import { Alert, Linking } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import * as Haptics from 'expo-haptics';
import { present } from './sheet';

/** Yes/no question in yapp's own sheet. `danger` makes the button red; the system alert is only a fallback. */
export function confirm(title: string, message: string, action: string, onYes: () => void, danger = true) {
  Haptics.notificationAsync(danger ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
  if (present({ title, message, options: [action], destructive: danger ? 0 : undefined, onPick: onYes })) return;
  Alert.alert(title, message, [
    { text: 'cancel', style: 'cancel' },
    { text: action, style: danger ? 'destructive' : 'default', onPress: onYes },
  ], { cancelable: true, userInterfaceStyle: 'dark' });
}

/** List of options in yapp's own sheet. Returns false when no screen can show it, so callers keep their own list. */
export function choose(title: string, options: readonly string[], onPick: (i: number) => void, destructive?: number, chain?: boolean): boolean {
  if (!present({ title, options, destructive, chain, onPick })) return false;
  Haptics.selectionAsync();
  return true;
}

/** In-app browser: SFSafariViewController on iOS, Custom Tabs on Android. */
export async function openLink(url: string) {
  if (!requireOptionalNativeModule('ExpoWebBrowser')) return Linking.openURL(url);
  const WebBrowser = await import('expo-web-browser');
  return WebBrowser.openBrowserAsync(url, { controlsColor: '#FF1F1F', toolbarColor: '#000000', presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }).catch(() => Linking.openURL(url));
}
