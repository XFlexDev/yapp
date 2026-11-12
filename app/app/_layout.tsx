import { BlurBackdrop } from '../lib/blur';
import * as Notifications from 'expo-notifications';
import { Nunito_600SemiBold, Nunito_800ExtraBold, Nunito_900Black, useFonts } from '@expo-google-fonts/nunito';
import { router, Stack, type ErrorBoundaryProps, DarkTheme, ThemeProvider } from 'expo-router';
import { requireOptionalNativeModule } from 'expo';
import { AppState, Appearance, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { restore, setSignedOutHandler } from '../lib/api';
import { batteryExcluded, excludeBattery, openAppSettings, startBackground, stopBackground } from '../lib/background';
import { registerPush } from '../lib/push';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { startRealtime, stopRealtime } from '../lib/realtime';
import { set, useStore } from '../lib/store';
import { C, F } from '../lib/theme';
import { RED, Squish } from '../lib/tt';
import { Intro } from '../lib/intro';
import { startUpdates } from '../lib/updates';
import { startListening, stopVoice } from '../lib/voice';

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 200 });
startUpdates();
// Forces iOS dark mode for the whole window, so anything behind the screens is black, not the light-mode grey.
Appearance.setColorScheme('dark');
// Black window behind screens (needs a build with expo-system-ui; older builds skip it).
if (requireOptionalNativeModule('ExpoSystemUI')) import('expo-system-ui').then((m) => m.setBackgroundColorAsync('#000')).catch(() => {});

const darkNavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#000000',
    card: '#000000',
  },
};

export function signOutLocal() {
  stopRealtime();
  stopVoice();
  stopBackground();
  set({ status: 'out', me: null, friends: [], incoming: [], outgoing: [], selectedId: null, call: null });
}

/** Shows what broke instead of a blank screen. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>something broke</Text>
      <Text selectable style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center' }}>{String(error?.message ?? error).slice(0, 400)}</Text>
      <Pressable onPress={retry} hitSlop={12} style={({ pressed }) => ({ marginTop: 10, opacity: pressed ? 0.5 : 1 })}>
        <Text style={{ color: '#fff', fontSize: 17, fontWeight: '900' }}>try again</Text>
      </Pressable>
    </View>
  );
}

export default function Root() {
  const [fonts] = useFonts({ Nunito_600SemiBold, Nunito_800ExtraBold, Nunito_900Black });
  const status = useStore((s) => s.status);
  const [askBattery, setAskBattery] = useState(false);
  const battery = useRef<{ snooze: () => void }>({ snooze: () => {} });
  const me = useStore((s) => s.me);

  useEffect(() => {
    setSignedOutHandler(signOutLocal);
    restore()
      .then((m) => set(m ? { status: 'in', me: m } : { status: 'out' }))
      .catch(() => set({ status: 'out' }));
  }, []);

  useEffect(() => {
    if (status !== 'in') return;
    let snoozed = false;
    const check = () => { if (Platform.OS === 'android' && !snoozed && !batteryExcluded()) setAskBattery(true); else if (batteryExcluded()) setAskBattery(false); };
    battery.current = { snooze: () => { snoozed = true; } };
    check();
    const bsub = AppState.addEventListener('change', (st) => { if (st === 'active') setTimeout(check, 400); });
    startRealtime();
    startListening().catch(() => {});
    startBackground();
    registerPush();
    const open = (d: any) => {
      if (d?.type === 'group_message' && d.group_id) router.push({ pathname: '/group', params: { id: d.group_id } });
      else if (d?.type === 'message' && d.from) router.push({ pathname: '/chat', params: { id: d.from } });
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => { sub.remove(); bsub.remove(); };
  }, [status]);

  const ready = fonts && status !== 'loading';
  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return null;

  const onboarded = !!me?.username && !!me?.display_name;
  const base = status === 'in' && onboarded ? C.bg : RED;
  return (
    <ThemeProvider value={darkNavTheme}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: base }}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: base }, animation: 'fade' }}>
          <Stack.Protected guard={status === 'out'}>
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="auth" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'in' && !onboarded}>
            <Stack.Screen name="onboarding" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'in' && onboarded}>
            <Stack.Screen name="index" />
            <Stack.Screen name="add" options={{ presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true, sheetCornerRadius: 28, contentStyle: { backgroundColor: C.bg } }} />
            <Stack.Screen name="user" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, sheetCornerRadius: 28, contentStyle: { backgroundColor: C.surface } }} />
            <Stack.Screen name="packs" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, sheetCornerRadius: 28, contentStyle: { backgroundColor: C.surface } }} />
            <Stack.Screen name="order" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, sheetCornerRadius: 28, contentStyle: { backgroundColor: C.surface } }} />
            <Stack.Screen name="chat" options={({ route }) => ({ animation: (route.params as any)?.ax ? 'fade' : 'default', animationDuration: 220, fullScreenGestureEnabled: true, fullScreenGestureShadowEnabled: false })} />
            <Stack.Screen name="group" options={{ animation: 'default', fullScreenGestureEnabled: true, fullScreenGestureShadowEnabled: false }} />
            <Stack.Screen name="inbox" options={{ animation: 'default', fullScreenGestureEnabled: true, fullScreenGestureShadowEnabled: false }} />
            <Stack.Screen name="settings" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack.Protected>
          <Stack.Protected guard={status === 'in'}>
            <Stack.Screen name="crop" options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
          </Stack.Protected>
        </Stack>
        <Intro />
      </GestureHandlerRootView>
      {askBattery ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill}><BlurBackdrop dim={0.5} /></Animated.View>
          <Animated.View entering={SlideInDown.duration(300)} style={{ position: 'absolute', left: 10, right: 10, bottom: 30, borderRadius: 28, borderCurve: 'continuous', backgroundColor: '#1C1C1E', padding: 24, gap: 12 }}>
            <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 22 }}>let yapp run in the background</Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontFamily: F.bold, fontSize: 15, lineHeight: 21 }}>
              android puts apps to sleep to save battery. if yapp sleeps, friends can't talk to you or call you while your screen is off or the app is closed.
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontFamily: F.bold, fontSize: 15, lineHeight: 21 }}>
              tap allow, then pick allow on the next popup. if it shows a list instead, choose "unrestricted". skip it and yapp only works while it's open.
            </Text>
            <Squish onPress={() => { if (!excludeBattery()) openAppSettings(); setAskBattery(false); }} style={{ height: 50, borderRadius: 25, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 16 }}>allow</Text>
            </Squish>
            <Pressable onPress={() => { battery.current.snooze(); setAskBattery(false); }} style={{ alignSelf: 'center', padding: 6 }}>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.bold, fontSize: 14 }}>not now</Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </ThemeProvider>
  );
}
