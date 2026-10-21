import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, confirmLogin, startLogin } from '../lib/api';
import { set } from '../lib/store';
import { C, F } from '../lib/theme';
import { Button, ErrorText, Field, Sub, Title } from '../lib/ui';

export default function SignIn() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef<any>(null);

  const send = async () => {
    setBusy(true); setError('');
    try { await startLogin(email.trim()); setStep('code'); setTimeout(() => codeRef.current?.focus(), 250); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };
  const confirm = async (c = code) => {
    setBusy(true); setError('');
    try { const me = await confirmLogin(email.trim(), c); set({ status: 'in', me }); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong'); setCode(''); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 56, paddingBottom: insets.bottom + 16, paddingHorizontal: 24 }}>
      <Text style={{ color: C.red, fontFamily: F.black, fontSize: 56, letterSpacing: -1.5 }}>yapp</Text>
      {step === 'email' ? (
        <Animated.View key="email" entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)} style={{ flex: 1, marginTop: 40, gap: 12 }}>
          <Title>your friends,{'\n'}on tap</Title>
          <Sub>Enter your email. We'll send you a code.</Sub>
          <View style={{ height: 12 }} />
          <Field value={email} onChangeText={setEmail} placeholder="you@email.com" autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" autoFocus returnKeyType="go" onSubmitEditing={send} />
          <ErrorText>{error}</ErrorText>
          <View style={{ flex: 1 }} />
          <Button title="Continue" onPress={send} loading={busy} disabled={!email.includes('@')} />
        </Animated.View>
      ) : (
        <Animated.View key="code" entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)} style={{ flex: 1, marginTop: 40, gap: 12 }}>
          <Title>check your email</Title>
          <Sub>We sent a 6-digit code to {email.trim()}</Sub>
          <View style={{ height: 12 }} />
          <Field ref={codeRef} value={code} placeholder="000000" keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6}
            style={{ letterSpacing: 10, fontVariant: ['tabular-nums'] }}
            onChangeText={(t) => { const d = t.replace(/\D/g, ''); setCode(d); if (d.length === 6) confirm(d); }} />
          <ErrorText>{error}</ErrorText>
          <Pressable onPress={() => { setStep('email'); setCode(''); setError(''); }} hitSlop={12}>
            <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 15 }}>Use a different email</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Button title="Sign in" onPress={() => confirm()} loading={busy} disabled={code.length !== 6} />
        </Animated.View>
      )}
    </KeyboardAvoidingView>
  );
}
