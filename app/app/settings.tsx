import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, clear, logout, nameOf, req, type Me } from '../lib/api';
import { pickAndUploadPhoto } from '../lib/photo';
import { set, useStore } from '../lib/store';
import { C, F } from '../lib/theme';
import { Avatar, Button, ErrorText, Field } from '../lib/ui';
import { signOutLocal } from './_layout';

export default function Settings() {
  const insets = useSafeAreaInsets();
  const me = useStore((s) => s.me)!;
  const [name, setName] = useState(me.display_name);
  const [error, setError] = useState('');

  const saveName = () => {
    if (!name.trim() || name === me.display_name) return;
    req<Me>('/v1/me', { method: 'PATCH', body: { display_name: name } }).then((m) => set({ me: m })).catch((e) => setError(e instanceof ApiError ? e.message : 'Couldn’t save'));
  };
  const setDnd = (dnd: boolean) => {
    set({ me: { ...me, dnd } });
    req<Me>('/v1/status', { method: 'PUT', body: { dnd } }).then((m) => set({ me: m })).catch(() => set({ me: { ...me, dnd: !dnd } }));
  };
  const del = () => Alert.alert('Delete your account?', 'Your friends and profile are removed for good.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { await req('/v1/me', { method: 'DELETE' }).catch(() => {}); await clear(); signOutLocal(); } },
  ]);

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, gap: 14 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 28 }}>settings</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={{ color: C.red, fontFamily: F.black, fontSize: 17 }}>Done</Text></Pressable>
      </View>
      <Pressable onPress={() => pickAndUploadPhoto().catch((e) => setError(e?.message ?? 'Upload failed'))} style={{ alignSelf: 'center', alignItems: 'center', gap: 10, marginVertical: 12 }}>
        <Avatar user={me} size={112} ring />
        <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 15 }}>Change photo</Text>
      </Pressable>
      <Field value={name} onChangeText={setName} onBlur={saveName} onSubmitEditing={saveName} placeholder="Your name" maxLength={32} returnKeyType="done" />
      <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 15, paddingHorizontal: 4 }}>@{me.username} · {me.email}</Text>
      <ErrorText>{error}</ErrorText>
      <View style={{ backgroundColor: C.surface, borderRadius: 18, borderCurve: 'continuous', padding: 18, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 17 }}>Do not disturb</Text>
          <Text style={{ color: C.dim, fontFamily: F.regular, fontSize: 14 }}>Friends can't talk to you</Text>
        </View>
        <Switch value={me.dnd} onValueChange={setDnd} trackColor={{ true: C.red, false: C.line }} />
      </View>
      <View style={{ height: 20 }} />
      <Button title="Sign out" kind="ghost" onPress={async () => { await logout(); signOutLocal(); }} />
      <Button title="Delete account" kind="danger" onPress={del} />
      <Text style={{ color: C.faint, fontFamily: F.regular, fontSize: 13, textAlign: 'center' }}>yapp · {nameOf(me)}</Text>
    </ScrollView>
  );
}
