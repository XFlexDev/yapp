import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, { LayoutAnimationConfig, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { ApiError, confirmLogin, startLogin } from '../lib/api';
import { set } from '../lib/store';
import { F } from '../lib/theme';
import { bigInput, Collapse, FILL, GHOST, Heading, Label, Logo, Pill, pop, popOut, RedScreen, rise, slide, slideOut, SPRING, Squish, Swap, useShake } from '../lib/tt';

type Step = 'welcome' | 'age' | 'email' | 'code';

function Box({ ch, active }: { ch?: string; active: boolean }) {
  const s = useSharedValue(1);
  const b = useSharedValue(active ? 1 : 0);
  useEffect(() => { if (ch) s.value = withSequence(withTiming(1.05, { duration: 90 }), withSpring(1, SPRING)); }, [ch]);
  useEffect(() => { b.value = withSpring(active ? 1 : 0, SPRING); }, [active]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], borderColor: `rgba(255,255,255,${0.9 * b.value})` }));
  return (
    <Animated.View style={[{ width: 46, height: 56, borderRadius: 10, borderCurve: 'continuous', backgroundColor: FILL, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }, a]}>
      {ch ? <Animated.Text entering={pop() as any} exiting={popOut() as any} style={{ color: '#fff', fontFamily: F.black, fontSize: 26 }}>{ch}</Animated.Text> : null}
    </Animated.View>
  );
}

export default function SignIn() {
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
  const { style: shakeStyle, shake } = useShake();
  const inset = useSharedValue(16);
  useEffect(() => { inset.value = withSpring(step === 'welcome' ? 16 : 0, SPRING); }, [step]);
  const insetStyle = useAnimatedStyle(() => ({ paddingLeft: inset.value, paddingRight: inset.value }));

  const go = (s: Step, d = 1) => { setDir(d); setError(''); setStep(s); };
  const back = () => go(step === 'code' ? 'email' : step === 'email' && creating ? 'age' : 'welcome', -1);
  const fail = (e: unknown) => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); shake(); setError(e instanceof ApiError ? e.message.toLowerCase() : 'something went wrong'); };

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
    : step === 'age' ? { title: 'continue', disabled: !age, onPress: () => (Number(age) < 13 ? (Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning), setTooYoung(true)) : go('email')) }
    : step === 'email' ? { title: 'send code', disabled: !/^\S+@\S+\.\S+$/.test(email.trim()), loading: busy, onPress: send }
    : { title: 'can’t find the mail?', ghost: true, loading: busy, onPress: send };

  return (
    <View style={{ flex: 1 }}>
      <RedScreen onBack={back} help={step === 'email' || step === 'code'} bar={step !== 'welcome'}>
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <LayoutAnimationConfig skipEntering>
          <Animated.View key={step} entering={slide(dir) as any} exiting={slideOut(dir) as any} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {step === 'welcome' ? (
              <Animated.View entering={pop() as any}>
                <Squish onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}><Logo /></Squish>
              </Animated.View>
            ) : step === 'age' ? (
              <View style={{ alignItems: 'center', gap: 28 }}>
                <Animated.View entering={rise(40)}><Heading>how old are you?</Heading></Animated.View>
                <Animated.View entering={rise(110)}>
                  <TextInput value={age} onChangeText={(t) => setAge(t.replace(/\D/g, '').slice(0, 3))} placeholder="13" placeholderTextColor={GHOST} keyboardType="number-pad" keyboardAppearance="dark" autoFocus selectionColor="#fff" style={bigInput} />
                </Animated.View>
              </View>
            ) : step === 'email' ? (
              <View style={{ alignItems: 'center', gap: 28, alignSelf: 'stretch' }}>
                <Animated.View entering={rise(40)}><Label>email</Label></Animated.View>
                <Animated.View entering={rise(110)} style={[{ alignSelf: 'stretch' }, shakeStyle]}>
                  <TextInput value={email} onChangeText={setEmail} placeholder="rachel@gmail.com" placeholderTextColor={GHOST} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" keyboardAppearance="dark" autoFocus selectionColor="#fff" returnKeyType="send" onSubmitEditing={() => !pill.disabled && send()} style={bigInput} />
                </Animated.View>
                <Swap text={error} style={{ color: '#fff', fontFamily: F.bold, fontSize: 15, height: 20 }} />
              </View>
            ) : (
              <View style={{ alignItems: 'center', gap: 22 }}>
                <Animated.View entering={pop(60) as any} style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 16, height: 9, borderLeftWidth: 3, borderBottomWidth: 3, borderColor: '#fff', transform: [{ rotate: '-45deg' }, { translateY: -2 }] }} />
                </Animated.View>
                <Animated.View entering={rise(100)}><Heading>{'an email has\nbeen sent'}</Heading></Animated.View>
                <Animated.View style={shakeStyle}>
                  <Pressable onPress={() => codeRef.current?.focus()} style={{ flexDirection: 'row', gap: 8 }}>
                    {Array.from({ length: 6 }, (_, i) => (
                      <Animated.View key={i} entering={rise(160 + i * 35)}>
                        <Box ch={code[i]} active={i === Math.min(code.length, 5) && !busy} />
                      </Animated.View>
                    ))}
                  </Pressable>
                </Animated.View>
                <TextInput ref={codeRef} value={code} onChangeText={(t) => { const d = t.replace(/\D/g, '').slice(0, 6); if (d.length > code.length) Haptics.selectionAsync(); setCode(d); if (d.length === 6) confirm(d); }} keyboardType="number-pad" keyboardAppearance="dark" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} caretHidden style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
                <Animated.View entering={rise(260)} style={{ alignItems: 'center', gap: 4 }}>
                  <Swap text={error || `code sent to ${email.trim()}`} style={{ color: error ? '#fff' : 'rgba(255,255,255,0.6)', fontFamily: F.bold, fontSize: 15 }} />
                  <Pressable hitSlop={10} onPress={() => go('email', -1)}><Text style={{ color: '#fff', fontFamily: F.black, fontSize: 15 }}>change</Text></Pressable>
                </Animated.View>
              </View>
            )}
          </Animated.View>
          </LayoutAnimationConfig>
          <Animated.View style={insetStyle}><Pill {...pill} /></Animated.View>
          <Collapse open={step === 'welcome'} height={60}>
            <Pressable onPress={() => { setCreating(false); go('email'); }} hitSlop={10} style={({ pressed }) => ({ height: 60, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
              <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 17 }}>log in</Text>
            </Pressable>
          </Collapse>
        </View>
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
