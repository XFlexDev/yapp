import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, req, type Me } from '../lib/api';
import { pickAndUploadPhoto } from '../lib/photo';
import { set, useStore } from '../lib/store';
import { C, F } from '../lib/theme';
import { Avatar, Button, ErrorText, Field, Sub, Title } from '../lib/ui';

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const me = useStore((s) => s.me)!;
  const [name, setName] = useState(me.display_name);
  const [username, setUsername] = useState(me.username ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError('');
    try { set({ me: await req<Me>('/v1/me', { method: 'PATCH', body: { display_name: name, username } }) }); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 16, paddingHorizontal: 24, gap: 12 }}>
      <Title>who are you?</Title>
      <Sub>Friends find you by your username.</Sub>
      <Pressable onPress={() => pickAndUploadPhoto().catch((e) => setError(e?.message ?? 'Upload failed'))} style={{ alignSelf: 'center', marginVertical: 20, alignItems: 'center', gap: 10 }}>
        <Avatar user={{ ...me, display_name: name || '?' }} size={112} ring />
        <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 15 }}>{me.avatar ? 'Change photo' : 'Add a photo'}</Text>
      </Pressable>
      <Field value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" maxLength={32} textContentType="givenName" />
      <Field value={username} onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} placeholder="username" prefix="@" autoCapitalize="none" autoCorrect={false} maxLength={20} />
      <ErrorText>{error}</ErrorText>
      <View style={{ flex: 1 }} />
      <Button title="Let's go" onPress={save} loading={busy} disabled={!name.trim() || username.length < 3} />
    </KeyboardAvoidingView>
  );
}
