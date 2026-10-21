import { Nunito_600SemiBold, Nunito_800ExtraBold, Nunito_900Black, useFonts } from '@expo-google-fonts/nunito';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { restore, setSignedOutHandler } from '../lib/api';
import { registerPush } from '../lib/push';
import { startRealtime, stopRealtime } from '../lib/realtime';
import { set, useStore } from '../lib/store';
import { C } from '../lib/theme';
import { startUpdates } from '../lib/updates';
import { startListening, stopVoice } from '../lib/voice';

SplashScreen.preventAutoHideAsync();
startUpdates();

export function signOutLocal() {
  stopRealtime();
  stopVoice();
  set({ status: 'out', me: null, friends: [], incoming: [], outgoing: [], selectedId: null });
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
    registerPush();
  }, [status]);

  const ready = fonts && status !== 'loading';
  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return null;

  const onboarded = !!me?.username && !!me?.display_name;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }}>
        <Stack.Protected guard={status === 'out'}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'in' && !onboarded}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'in' && onboarded}>
          <Stack.Screen name="index" />
          <Stack.Screen name="add" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, sheetCornerRadius: 28, contentStyle: { backgroundColor: C.surface } }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack.Protected>
      </Stack>
    </GestureHandlerRootView>
  );
}
