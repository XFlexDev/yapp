import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, { SlideInLeft, SlideInRight, SlideOutLeft, SlideOutRight } from 'react-native-reanimated';
import { ApiError, req, type Me } from '../lib/api';
import { pickAndUploadPhoto } from '../lib/photo';
import { set, useStore } from '../lib/store';
import { F } from '../lib/theme';
import { bigInput, GHOST, Label, Pill, RedScreen } from '../lib/tt';
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
  const go = (s: Step, d = 1) => { setDir(d); setError(''); setStep(s); };

  const saveUsername = async () => {
    setBusy(true); setError('');
    try { await req<Me>('/v1/me', { method: 'PATCH', body: { username } }); go('photo'); }
    catch (e) { setError(e instanceof ApiError ? e.message.toLowerCase() : 'something went wrong'); }
    finally { setBusy(false); }
  };
  const finish = async () => {
    setBusy(true);
    try { set({ me: await req<Me>('/v1/me', { method: 'PATCH', body: { display_name: name.trim(), username } }) }); }
    catch (e) { setError(e instanceof ApiError ? e.message.toLowerCase() : 'something went wrong'); }
    finally { setBusy(false); }
  };

  const enter = (dir > 0 ? SlideInRight : SlideInLeft).duration(300);
  const exit = (dir > 0 ? SlideOutLeft : SlideOutRight).duration(300);

  return (
    <Animated.View key={step} entering={enter} exiting={exit} style={{ flex: 1 }}>
      <RedScreen onBack={step === 'name' ? undefined : () => go(step === 'photo' ? 'username' : 'name', -1)}>
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          {step === 'name' ? (
            <>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }}>
                <Label>first name</Label>
                <TextInput value={name} onChangeText={setName} placeholder="rachel" placeholderTextColor={GHOST} autoCapitalize="words" autoCorrect={false} textContentType="givenName" maxLength={32} keyboardAppearance="dark" autoFocus selectionColor="#fff" returnKeyType="next" onSubmitEditing={() => name.trim() && go('username')} style={[bigInput, { alignSelf: 'stretch' }]} />
              </View>
              <Pill title="continue" disabled={!name.trim()} onPress={() => go('username')} />
            </>
          ) : step === 'username' ? (
            <>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }}>
                <Label>username</Label>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={[bigInput, { minWidth: 0, color: username ? '#fff' : GHOST }]}>@</Text>
                  <TextInput value={username} onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} placeholder="rachel" placeholderTextColor={GHOST} autoCapitalize="none" autoCorrect={false} maxLength={20} keyboardAppearance="dark" autoFocus selectionColor="#fff" returnKeyType="next" onSubmitEditing={() => username.length >= 3 && saveUsername()} style={[bigInput, { textAlign: 'left' }]} />
                </View>
                <Text style={{ color: '#fff', fontFamily: F.bold, fontSize: 15, height: 20 }}>{error}</Text>
              </View>
              <Pill title="continue" disabled={username.length < 3} loading={busy} onPress={saveUsername} />
            </>
          ) : (
            <>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }}>
                <Label>add a photo</Label>
                <Pressable onPress={() => pickAndUploadPhoto().catch((e) => setError(e?.message ?? 'upload failed'))} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}>
                  <View style={{ padding: 5, borderRadius: 100, borderWidth: 4, borderColor: '#fff' }}><Avatar user={{ ...me, display_name: name || '?' }} size={150} /></View>
                </Pressable>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.bold, fontSize: 15, textAlign: 'center' }}>{error || 'your friends see it when you talk'}</Text>
              </View>
              <Pill title={me.avatar ? 'continue' : 'choose photo'} loading={busy} onPress={() => (me.avatar ? finish() : pickAndUploadPhoto().catch((e) => setError(e?.message ?? 'upload failed')))} />
              {me.avatar ? null : (
                <Pressable onPress={finish} hitSlop={10} style={({ pressed }) => ({ height: 52, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                  <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 17 }}>skip</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      </RedScreen>
    </Animated.View>
  );
}
