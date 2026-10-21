import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { ApiError, nameOf, req, type FriendRequest } from '../lib/api';
import { set, upsertFriend, useStore } from '../lib/store';
import { syncAll } from '../lib/realtime';
import { C, F } from '../lib/theme';
import { Avatar, Button, ErrorText, Field } from '../lib/ui';

function Row({ r, actions }: { r: FriendRequest; actions: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 }}>
      <Avatar user={r.user} size={48} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 17 }} numberOfLines={1}>{nameOf(r.user)}</Text>
        <Text style={{ color: C.dim, fontFamily: F.regular, fontSize: 14 }}>@{r.user.username}</Text>
      </View>
      {actions}
    </View>
  );
}

function Pill({ title, onPress, strong }: { title: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ height: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: 'center', backgroundColor: strong ? C.red : C.surface2, opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 14 }}>{title}</Text>
    </Pressable>
  );
}

export default function Add() {
  const { incoming, outgoing, me } = useStore();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const send = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await req<{ status: string }>('/v1/friends/requests', { method: 'POST', body: { username } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMsg(r.status === 'accepted' ? `You and @${username} are friends` : `Request sent to @${username}`);
      setUsername('');
      syncAll().catch(() => {});
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };
  const accept = async (r: FriendRequest) => {
    set((s) => ({ incoming: s.incoming.filter((x) => x.id !== r.id) }));
    try { upsertFriend(await req(`/v1/friends/requests/${r.id}/accept`, { method: 'POST' })); } catch { syncAll().catch(() => {}); }
  };
  const drop = (r: FriendRequest) => {
    set((s) => ({ incoming: s.incoming.filter((x) => x.id !== r.id), outgoing: s.outgoing.filter((x) => x.id !== r.id) }));
    req(`/v1/friends/requests/${r.id}`, { method: 'DELETE' }).catch(() => syncAll().catch(() => {}));
  };

  return (
    <ScrollView style={{ backgroundColor: C.surface }} contentContainerStyle={{ padding: 24, paddingTop: 28, gap: 12 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 28 }}>add friends</Text>
      <Field value={username} onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} placeholder="username" prefix="@" autoCapitalize="none" autoCorrect={false} returnKeyType="send" onSubmitEditing={send} />
      <ErrorText>{error}</ErrorText>
      {msg ? <Text style={{ color: C.online, fontFamily: F.bold, fontSize: 15 }}>{msg}</Text> : null}
      <Button title="Send request" onPress={send} loading={busy} disabled={username.length < 3} />
      <Pressable onPress={() => Share.share({ message: `add me on yapp: @${me?.username}` })} style={{ paddingVertical: 8 }}>
        <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 15, textAlign: 'center' }}>You're @{me?.username}. Share it</Text>
      </Pressable>
      {incoming.length ? <Text style={{ color: C.dim, fontFamily: F.black, fontSize: 13, marginTop: 12, letterSpacing: 0.5 }}>WANTS TO BE FRIENDS</Text> : null}
      {incoming.map((r) => <Row key={r.id} r={r} actions={<View style={{ flexDirection: 'row', gap: 8 }}><Pill title="Accept" strong onPress={() => accept(r)} /><Pill title="✕" onPress={() => drop(r)} /></View>} />)}
      {outgoing.length ? <Text style={{ color: C.dim, fontFamily: F.black, fontSize: 13, marginTop: 12, letterSpacing: 0.5 }}>SENT</Text> : null}
      {outgoing.map((r) => <Row key={r.id} r={r} actions={<Pill title="Cancel" onPress={() => drop(r)} />} />)}
    </ScrollView>
  );
}
