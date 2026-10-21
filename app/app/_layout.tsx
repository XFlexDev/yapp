import * as Notifications from 'expo-notifications';
import { Nunito_600SemiBold, Nunito_800ExtraBold, Nunito_900Black, useFonts } from '@expo-google-fonts/nunito';
import { router, Stack, type ErrorBoundaryProps } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { restore, setSignedOutHandler } from '../lib/api';
import { startBackground, stopBackground } from '../lib/background';
import { registerPush } from '../lib/push';
import { startRealtime, stopRealtime } from '../lib/realtime';
import { set, useStore } from '../lib/store';
import { C } from '../lib/theme';
import { RED } from '../lib/tt';
import { Intro } from '../lib/intro';
import { startUpdates } from '../lib/updates';
import { startListening, stopVoice } from '../lib/voice';

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 200 });
startUpdates();

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
  const me = useStore((s) => s.me);

  useEffect(() => {
    setSignedOutHandler(signOutLocal);
    restore()
      .then((m) => set(m ? { status: 'in', me: m } : { status: 'out' }))
      .catch(() => set({ status: 'out' }));
  }, []);

  useEffect(() => {
    if (status !== 'in') return;
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
    return () => sub.remove();
  }, [status]);

  const ready = fonts && status !== 'loading';
  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return null;

  const onboarded = !!me?.username && !!me?.display_name;
  const base = status === 'in' && onboarded ? C.bg : RED;
  return (
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
          <Stack.Screen name="add" options={{ presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true, sheetCornerRadius: 28, contentStyle: { backgroundColor: C.surface } }} />
          <Stack.Screen name="order" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, sheetCornerRadius: 28, contentStyle: { backgroundColor: C.surface } }} />
          <Stack.Screen name="chat" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="group" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="inbox" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'in'}>
          <Stack.Screen name="crop" options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
        </Stack.Protected>
      </Stack>
      <Intro />
    </GestureHandlerRootView>
  );
}
