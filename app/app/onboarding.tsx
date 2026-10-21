import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ApiError, req, type Me } from '../lib/api';
import { pickAndUploadPhoto } from '../lib/photo';
import { set, useStore } from '../lib/store';
import { F } from '../lib/theme';
import { bigInput, Collapse, GHOST, Label, Pill, pop, RedScreen, rise, slide, slideOut, Squish, Swap, useShake } from '../lib/tt';
import { Avatar } from '../lib/ui';

type Step = 'name' | 'username' | 'photo';

export default function Onboarding() {
  const me = useStore((s) => s.me)!;
  const [step, setStep] = useState<Step>('name');
  const [dir, setDir] = useState(1);
  const [name, setName] = useState(me.display_name ?? '');
  const [username, setUsername] = useState(me.username ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { style: shakeStyle, shake } = useShake();
  const go = (s: Step, d = 1) => { setDir(d); setError(''); setStep(s); };
  const fail = (e: unknown) => { shake(); setError(e instanceof ApiError ? e.message.toLowerCase() : 'something went wrong'); };

  const saveUsername = async () => {
    setBusy(true); setError('');
    try { await req<Me>('/v1/me', { method: 'PATCH', body: { username } }); go('photo'); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  };
  const finish = async () => {
    setBusy(true);
    try { set({ me: await req<Me>('/v1/me', { method: 'PATCH', body: { display_name: name.trim(), username } }) }); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  };
  const pick = () => pickAndUploadPhoto().catch((e) => setError(e?.message ?? 'upload failed'));

  const pill = step === 'name' ? { title: 'continue', disabled: !name.trim(), onPress: () => go('username') }
    : step === 'username' ? { title: 'continue', disabled: username.length < 3, loading: busy, onPress: saveUsername }
    : { title: me.avatar ? 'continue' : 'choose photo', loading: busy, onPress: me.avatar ? finish : pick };

  return (
    <RedScreen onBack={step === 'name' ? undefined : () => go(step === 'photo' ? 'username' : 'name', -1)}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <Animated.View key={step} entering={slide(dir) as any} exiting={slideOut(dir) as any} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }}>
          {step === 'name' ? (
            <>
              <Animated.View entering={rise(40)}><Label>first name</Label></Animated.View>
              <Animated.View entering={rise(110)} style={{ alignSelf: 'stretch' }}>
                <TextInput value={name} onChangeText={setName} placeholder="rachel" placeholderTextColor={GHOST} autoCapitalize="words" autoCorrect={false} textContentType="givenName" maxLength={32} keyboardAppearance="dark" autoFocus selectionColor="#fff" returnKeyType="next" onSubmitEditing={() => !pill.disabled && pill.onPress()} style={bigInput} />
              </Animated.View>
            </>
          ) : step === 'username' ? (
            <>
              <Animated.View entering={rise(40)}><Label>username</Label></Animated.View>
              <Animated.View entering={rise(110)} style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }, shakeStyle]}>
                <Text style={[bigInput, { minWidth: 0, color: username ? '#fff' : GHOST }]}>@</Text>
                <TextInput value={username} onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} placeholder="rachel" placeholderTextColor={GHOST} autoCapitalize="none" autoCorrect={false} maxLength={20} keyboardAppearance="dark" autoFocus selectionColor="#fff" returnKeyType="next" onSubmitEditing={() => !pill.disabled && saveUsername()} style={[bigInput, { textAlign: 'left' }]} />
              </Animated.View>
              <Swap text={error} style={{ color: '#fff', fontFamily: F.bold, fontSize: 15, height: 20 }} />
            </>
          ) : (
            <>
              <Animated.View entering={rise(40)}><Label>add a photo</Label></Animated.View>
              <Animated.View entering={pop(90) as any}>
                <Squish onPress={pick} style={{ padding: 5, borderRadius: 100, borderWidth: 4, borderColor: '#fff' }}>
                  <Avatar user={{ ...me, display_name: name || '?' }} size={150} />
                </Squish>
              </Animated.View>
              <Animated.View entering={rise(170)}><Swap text={error || 'your friends see it when you talk'} style={{ color: error ? '#fff' : 'rgba(255,255,255,0.6)', fontFamily: F.bold, fontSize: 15, textAlign: 'center' }} /></Animated.View>
            </>
          )}
        </Animated.View>
        <Pill {...pill} />
        <Collapse open={step === 'photo' && !me.avatar} height={56}>
          <Pressable onPress={finish} hitSlop={10} style={({ pressed }) => ({ height: 56, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 17 }}>skip</Text>
          </Pressable>
        </Collapse>
      </View>
    </RedScreen>
  );
}
