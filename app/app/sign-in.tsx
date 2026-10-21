import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInLeft, SlideInRight, SlideOutLeft, SlideOutRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, confirmLogin, startLogin } from '../lib/api';
import { set } from '../lib/store';
import { F } from '../lib/theme';
import { bigInput, FILL, GHOST, Heading, Label, Logo, Pill, RED, RedScreen } from '../lib/tt';

type Step = 'welcome' | 'age' | 'email' | 'code';

export default function SignIn() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('welcome');
  const [dir, setDir] = useState(1);
  const [creating, setCreating] = useState(false);
  const [age, setAge] = useState('');
  const [tooYoung, setTooYoung] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef<any>(null);

  const go = (s: Step, d = 1) => { setDir(d); setError(''); setStep(s); };
  const back = () => go(step === 'code' ? 'email' : step === 'email' && creating ? 'age' : 'welcome', -1);

  const send = async () => {
    setBusy(true); setError('');
    try { await startLogin(email.trim()); setCode(''); go('code'); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'something went wrong'); }
    finally { setBusy(false); }
  };
  const confirm = async (c: string) => {
    setBusy(true); setError('');
    try { const me = await confirmLogin(email.trim(), c); set({ status: 'in', me }); }
    catch (e) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); setError(e instanceof ApiError ? e.message.toLowerCase() : 'something went wrong'); setCode(''); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (step === 'code') setTimeout(() => codeRef.current?.focus(), 350); }, [step]);

  const enter = (dir > 0 ? SlideInRight : SlideInLeft).duration(300);
  const exit = (dir > 0 ? SlideOutLeft : SlideOutRight).duration(300);

  if (step === 'welcome') {
    return (
      <Animated.View key="welcome" entering={dir < 0 ? enter : FadeIn.duration(250)} exiting={exit} style={{ flex: 1, backgroundColor: RED, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Logo /></View>
        <View style={{ paddingHorizontal: 8 }}><Pill title="create account" onPress={() => { setCreating(true); go('age'); }} /></View>
        <Pressable onPress={() => { setCreating(false); go('email'); }} hitSlop={10} style={({ pressed }) => ({ height: 56, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 17 }}>log in</Text>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View key={step} entering={enter} exiting={exit} style={{ flex: 1 }}>
      <RedScreen onBack={back} help={step !== 'age'}>
        {step === 'age' ? (
          <View style={{ flex: 1, paddingHorizontal: 16 }}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }}>
              <Heading>how old are you?</Heading>
              <TextInput value={age} onChangeText={(t) => setAge(t.replace(/\D/g, '').slice(0, 3))} placeholder="13" placeholderTextColor={GHOST} keyboardType="number-pad" keyboardAppearance="dark" autoFocus selectionColor="#fff" style={bigInput} />
            </View>
            <Pill title="continue" disabled={!age} onPress={() => (Number(age) < 13 ? setTooYoung(true) : go('email'))} />
          </View>
        ) : step === 'email' ? (
          <View style={{ flex: 1, paddingHorizontal: 16 }}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }}>
              <Label>email</Label>
              <TextInput value={email} onChangeText={setEmail} placeholder="rachel@gmail.com" placeholderTextColor={GHOST} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" keyboardAppearance="dark" autoFocus selectionColor="#fff" returnKeyType="send" onSubmitEditing={() => email.includes('@') && send()} style={[bigInput, { alignSelf: 'stretch' }]} />
              <Text style={{ color: '#fff', fontFamily: F.bold, fontSize: 15, height: 20 }}>{error}</Text>
            </View>
            <Pill title="send code" disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} loading={busy} onPress={send} />
          </View>
        ) : (
          <View style={{ flex: 1, paddingHorizontal: 16 }}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 16, height: 9, borderLeftWidth: 3, borderBottomWidth: 3, borderColor: '#fff', transform: [{ rotate: '-45deg' }, { translateY: -2 }] }} />
              </View>
              <Heading>{'an email has\nbeen sent'}</Heading>
              <Pressable onPress={() => codeRef.current?.focus()} style={{ flexDirection: 'row', gap: 8 }}>
                {Array.from({ length: 6 }, (_, i) => (
                  <View key={i} style={{ width: 46, height: 56, borderRadius: 10, borderCurve: 'continuous', backgroundColor: FILL, borderWidth: 2, borderColor: i === Math.min(code.length, 5) && !busy ? 'rgba(255,255,255,0.9)' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 26 }}>{code[i] ?? ''}</Text>
                  </View>
                ))}
              </Pressable>
              <TextInput ref={codeRef} value={code} onChangeText={(t) => { const d = t.replace(/\D/g, '').slice(0, 6); setCode(d); if (d.length === 6) confirm(d); }} keyboardType="number-pad" keyboardAppearance="dark" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} caretHidden style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text style={{ color: error ? '#fff' : 'rgba(255,255,255,0.6)', fontFamily: F.bold, fontSize: 15 }}>{error || `code sent to ${email.trim()}`}</Text>
                <Pressable hitSlop={10} onPress={() => go('email', -1)}><Text style={{ color: '#fff', fontFamily: F.black, fontSize: 15 }}>change</Text></Pressable>
              </View>
            </View>
            <Pill ghost title="can’t find the mail?" loading={busy} onPress={send} />
          </View>
        )}
      </RedScreen>
      {tooYoung ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(180)} style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 280, borderRadius: 26, borderCurve: 'continuous', backgroundColor: '#1C1C1E', padding: 20, gap: 6, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 18, textAlign: 'center' }}>you’re not old enough{'\n'}to use yapp</Text>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.regular, fontSize: 13, textAlign: 'center', marginBottom: 12 }}>you need to be at least 13 years old</Text>
            <Pressable onPress={() => { setTooYoung(false); setAge(''); }} style={({ pressed }) => ({ alignSelf: 'stretch', height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
              <Text style={{ color: '#000', fontFamily: F.black, fontSize: 15 }}>cancel</Text>
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
