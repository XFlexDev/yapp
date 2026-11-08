import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import * as Haptics from 'expo-haptics';

/** Native destructive confirm: UIAlertController on iOS, Material dialog on Android. */
export function confirm(title: string, message: string, action: string, onYes: () => void) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  Alert.alert(title, message, [
    { text: 'cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onYes },
  ], { cancelable: true, userInterfaceStyle: 'dark' });
}

/** Native action sheet on iOS. Returns false on Android so callers keep their own list. */
export function choose(title: string, options: readonly string[], onPick: (i: number) => void, destructive?: number): boolean {
  if (Platform.OS !== 'ios') return false;
  Haptics.selectionAsync();
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options: [...options, 'cancel'], cancelButtonIndex: options.length, destructiveButtonIndex: destructive, userInterfaceStyle: 'dark' },
    (i) => { if (i < options.length) onPick(i); },
  );
  return true;
}

/** In-app browser: SFSafariViewController on iOS, Custom Tabs on Android. */
export async function openLink(url: string) {
  if (!requireOptionalNativeModule('ExpoWebBrowser')) return Linking.openURL(url);
  const WebBrowser = await import('expo-web-browser');
  return WebBrowser.openBrowserAsync(url, { controlsColor: '#FF1F1F', toolbarColor: '#000000', presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }).catch(() => Linking.openURL(url));
}
