import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ApiError, exchangeGoogle } from '../lib/api';
import { haptic } from '../lib/haptic';
import { set } from '../lib/store';
import { F } from '../lib/theme';

/** `yapp://auth?code=…`: the Google sign-in page hands the app a one-time code. */
export default function Auth() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (typeof code !== 'string' || !code) { router.replace('/'); return; }
    exchangeGoogle(code)
      .then((me) => { haptic.success(); set({ status: 'in', me }); router.replace('/'); })
      .catch((e) => { haptic.error(); setError((e instanceof ApiError ? e.message : 'sign in failed').toLowerCase()); });
  }, [code]);
  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 }}>
      <Text style={{ color: error ? '#fff' : 'rgba(255,255,255,0.55)', fontFamily: F.black, fontSize: 18, textAlign: 'center' }}>{error || 'signing in…'}</Text>
      {error ? (
        <Pressable onPress={() => router.replace('/')} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 17 }}>back</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
