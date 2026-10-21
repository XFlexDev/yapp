import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, { Easing, LayoutAnimationConfig, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { ApiError, confirmLogin, googleLogin, startLogin } from '../lib/api';
import { set } from '../lib/store';
import { F } from '../lib/theme';
import { bigInput, FILL, GHOST, Heading, Label, Logo, Pill, pop, popOut, RedScreen, slide, slideOut, SPRING, Squish, Swap, useShake } from '../lib/tt';

type Step = 'welcome' | 'age' | 'email' | 'code';

// Digits rise in without scaling: scaled text gets rasterized small on iOS and looks pixelated.
const digitIn = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 8 }] },
    animations: { opacity: withTiming(1, { duration: 140 }), transform: [{ translateY: withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) }) }] },
  };
};

function Box({ ch, active }: { ch?: string; active: boolean }) {
  const b = useSharedValue(active ? 1 : 0);
  useEffect(() => { b.value = withSpring(active ? 1 : 0, SPRING); }, [active]);
  const a = useAnimatedStyle(() => ({ borderColor: `rgba(255,255,255,${0.9 * b.value})` }));
  return (
    <Animated.View style={[{ width: 46, height: 56, borderRadius: 10, borderCurve: 'continuous', backgroundColor: FILL, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }, a]}>
      {ch ? <Animated.Text entering={digitIn as any} exiting={FadeOut.duration(100)} style={{ color: '#fff', fontFamily: F.black, fontSize: 26 }}>{ch}</Animated.Text> : null}
    </Animated.View>
  );
}

export default function SignIn() {
  const [step, setStep] = useState<Step>('welcome');
  const [dir, setDir] = useState(1);
  const [creating, setCreating] = useState(false);
  const [google, setGoogle] = useState(false);
  const [age, setAge] = useState('');
  const [tooYoung, setTooYoung] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef<any>(null);
  const { style: shakeStyle, shake } = useShake();

  const go = (s: Step, d = 1) => { setDir(d); setError(''); setStep(s); };
  const back = () => { if (step === 'age') setGoogle(false); go(step === 'code' ? 'email' : step === 'email' && creating ? 'age' : 'welcome', -1); };
  const fail = (e: unknown) => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); shake(); setError(e instanceof ApiError ? e.message.toLowerCase() : 'something went wrong'); };

  const withGoogle = async () => {
    setBusy(true); setError('');
    try { const me = await googleLogin(); if (me) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); set({ status: 'in', me }); } }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setError('');
    try { await startLogin(email.trim()); setCode(''); if (step !== 'code') go('code'); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  };
  const confirm = async (c: string) => {
    setBusy(true); setError('');
    try { const me = await confirmLogin(email.trim(), c); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); set({ status: 'in', me }); }
    catch (e) { fail(e); setCode(''); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (step === 'code') setTimeout(() => codeRef.current?.focus(), 350); }, [step]);

  const pill = step === 'welcome' ? { title: 'create account', onPress: () => { setCreating(true); go('age'); } }
    : step === 'age' ? { title: 'continue', disabled: !age, onPress: () => (Number(age) < 13 ? (Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning), setTooYoung(true)) : google ? withGoogle() : go('email')) }
    : step === 'email' ? { title: 'send code', disabled: !/^\S+@\S+\.\S+$/.test(email.trim()), loading: busy, onPress: send }
    : { title: 'can’t find the mail?', ghost: true, loading: busy, onPress: send };

  return (
    <View style={{ flex: 1 }}>
      <RedScreen onBack={back} help={step === 'email' || step === 'code'} bar={step !== 'welcome'}>
        <LayoutAnimationConfig skipEntering>
          <Animated.View key={step} entering={slide(dir) as any} exiting={slideOut(dir) as any} style={{ flex: 1, paddingHorizontal: 16 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {step === 'welcome' ? (
              <Squish onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}><Logo /></Squish>
            ) : step === 'age' ? (
              <View style={{ alignItems: 'center', gap: 28 }}>
                <Heading>how old are you?</Heading>
                <View>
                  <TextInput value={age} onChangeText={(t) => setAge(t.replace(/\D/g, '').slice(0, 3))} placeholder="13" placeholderTextColor={GHOST} keyboardType="number-pad" keyboardAppearance="dark" autoFocus selectionColor="#fff" style={bigInput} />
                </View>
              </View>
            ) : step === 'email' ? (
              <View style={{ alignItems: 'center', gap: 28, alignSelf: 'stretch' }}>
                <Label>email</Label>
                <Animated.View style={[{ alignSelf: 'stretch' }, shakeStyle]}>
                  <TextInput value={email} onChangeText={setEmail} placeholder="rachel@gmail.com" placeholderTextColor={GHOST} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" keyboardAppearance="dark" autoFocus selectionColor="#fff" returnKeyType="send" onSubmitEditing={() => !pill.disabled && send()} style={bigInput} />
                </Animated.View>
                <Swap text={error} style={{ color: '#fff', fontFamily: F.bold, fontSize: 15, height: 20 }} />
              </View>
            ) : (
              <View style={{ alignItems: 'center', gap: 22 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 16, height: 9, borderLeftWidth: 3, borderBottomWidth: 3, borderColor: '#fff', transform: [{ rotate: '-45deg' }, { translateY: -2 }] }} />
                </View>
                <Heading>{'an email has\nbeen sent'}</Heading>
                <Animated.View style={shakeStyle}>
                  <Pressable onPress={() => codeRef.current?.focus()} style={{ flexDirection: 'row', gap: 8 }}>
                    {Array.from({ length: 6 }, (_, i) => (
                      <View key={i}>
                        <Box ch={code[i]} active={i === Math.min(code.length, 5) && !busy} />
                      </View>
                    ))}
                  </Pressable>
                </Animated.View>
                <TextInput ref={codeRef} value={code} onChangeText={(t) => { const d = t.replace(/\D/g, '').slice(0, 6); if (d.length > code.length) Haptics.selectionAsync(); setCode(d); if (d.length === 6) confirm(d); }} keyboardType="number-pad" keyboardAppearance="dark" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} caretHidden style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
                <Animated.View style={{ alignItems: 'center', gap: 4 }}>
                  <Swap text={error || `code sent to ${email.trim()}`} style={{ color: error ? '#fff' : 'rgba(255,255,255,0.6)', fontFamily: F.bold, fontSize: 15 }} />
                  <Pressable hitSlop={10} onPress={() => go('email', -1)}><Text style={{ color: '#fff', fontFamily: F.black, fontSize: 15 }}>change</Text></Pressable>
                </Animated.View>
              </View>
            )}
          </View>
          <View style={{ paddingHorizontal: step === 'welcome' ? 16 : 0 }}><Pill {...pill} /></View>
          {step === 'welcome' ? (
            <View style={{ paddingHorizontal: 16, marginTop: 10 }}><Pill ghost title="continue with google" onPress={() => { setCreating(true); setGoogle(true); go('age'); }} /></View>
          ) : null}
          {step === 'welcome' ? (
            <Pressable onPress={() => { setCreating(false); go('email'); }} hitSlop={10} style={({ pressed }) => ({ height: 60, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
              <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 17 }}>log in</Text>
            </Pressable>
          ) : null}
          </Animated.View>
        </LayoutAnimationConfig>
      </RedScreen>
      {tooYoung ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View entering={pop() as any} exiting={popOut() as any} style={{ width: 280, borderRadius: 26, borderCurve: 'continuous', backgroundColor: '#1C1C1E', padding: 20, gap: 6, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 18, textAlign: 'center' }}>you’re not old enough{'\n'}to use yapp</Text>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.regular, fontSize: 13, textAlign: 'center', marginBottom: 12 }}>you need to be at least 13 years old</Text>
            <Squish onPress={() => { setTooYoung(false); setAge(''); }} style={{ alignSelf: 'stretch', width: 240, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#000', fontFamily: F.black, fontSize: 15 }}>cancel</Text>
            </Squish>
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}
