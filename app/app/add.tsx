import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { ApiError, nameOf, req, type FriendRequest, type User } from '../lib/api';
import { set, upsertFriend, useStore } from '../lib/store';
import { syncAll } from '../lib/realtime';
import { C, F } from '../lib/theme';
import { Avatar, ErrorText, Field } from '../lib/ui';

function Row({ r, actions }: { r: FriendRequest; actions: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 }}>
      <Pressable onPress={() => router.push({ pathname: '/user', params: { id: r.user.id } })} style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, opacity: pressed ? 0.6 : 1 })}>
        <Avatar user={r.user} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 17 }} numberOfLines={1}>{nameOf(r.user)}</Text>
          <Text style={{ color: C.dim, fontFamily: F.regular, fontSize: 14 }}>@{r.user.username}</Text>
        </View>
      </Pressable>
      {actions}
    </View>
  );
}

function Pill({ title, onPress, strong }: { title: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ height: 44, paddingHorizontal: 16, borderRadius: 22, borderCurve: 'continuous', justifyContent: 'center', backgroundColor: strong ? C.red : 'rgba(255,255,255,0.12)', opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 14 }}>{title}</Text>
    </Pressable>
  );
}

export default function Add() {
  const { incoming, outgoing, me } = useStore();
  const { u } = useLocalSearchParams<{ u?: string }>();
  const [username, setUsername] = useState(typeof u === 'string' ? u.toLowerCase().replace(/[^a-z0-9_.]/g, '') : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // An invite link (yapp://add?u=name) never adds anyone by itself: it shows who it is and asks first.
  const asked = useRef(false);
  useEffect(() => {
    const name = typeof u === 'string' ? u.toLowerCase().replace(/[^a-z0-9_.]/g, '') : '';
    if (!name || asked.current || name === me?.username) return;
    asked.current = true;
    req<User>(`/v1/users/${name}`)
      .then((who) => {
        Alert.alert(`add ${nameOf(who).toLowerCase()}?`, `send a friend request to @${name}. they can talk to you once they accept.`, [
          { text: 'cancel', style: 'cancel' },
          { text: 'add', onPress: () => { send(name); } },
        ]);
      })
      .catch((e) => setError((e instanceof ApiError ? e.message : 'couldn’t open this invite').toLowerCase()));
  }, [u]);

  const send = async (name: string = username) => {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await req<{ status: string }>('/v1/friends/requests', { method: 'POST', body: { username: name } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMsg(r.status === 'accepted' ? `you and @${name} are friends` : `request sent to @${name}`);
      setUsername('');
      syncAll().catch(() => {});
    } catch (e) { setError((e instanceof ApiError ? e.message : 'something went wrong').toLowerCase()); }
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
    <ScrollView style={{ backgroundColor: C.bg, flexGrow: 0 }} contentContainerStyle={{ padding: 24, paddingTop: 28, gap: 12 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 32 }}>add friends</Text>
      <View style={{ borderRadius: 24, borderCurve: 'continuous', backgroundColor: '#1C1C1E', padding: 20, gap: 14 }}>
        <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 14 }}>your username</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 28 }}>@{me?.username}</Text>
          <Pressable onPress={() => Share.share({ message: `add me on yapp https://yap.kreatix.dev/@${me?.username}` })} style={({ pressed }) => ({ height: 44, paddingHorizontal: 20, borderRadius: 22, borderCurve: 'continuous', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.72 : 1 })}>
            <Text style={{ color: '#000', fontFamily: F.black, fontSize: 14 }}>share</Text>
          </Pressable>
        </View>
      </View>
      <Field value={username} onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} placeholder="friend's username" prefix="@" autoCapitalize="none" autoCorrect={false} returnKeyType="send" onSubmitEditing={() => send()} />
      <ErrorText>{error}</ErrorText>
      {msg ? <Text style={{ color: C.online, fontFamily: F.bold, fontSize: 15 }}>{msg}</Text> : null}
      <Pressable disabled={busy || username.length < 3} onPress={() => { Haptics.selectionAsync(); send(); }} style={({ pressed }) => ({ height: 56, borderRadius: 28, borderCurve: 'continuous', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: busy || username.length < 3 ? 0.4 : pressed ? 0.72 : 1 })}>
        <Text style={{ color: '#000', fontFamily: F.black, fontSize: 18 }}>{busy ? 'sending…' : 'send request'}</Text>
      </Pressable>
      {incoming.length ? <Text style={{ color: C.dim, fontFamily: F.black, fontSize: 13, marginTop: 12 }}>wants to be friends</Text> : null}
      {incoming.map((r) => <Row key={r.id} r={r} actions={<View style={{ flexDirection: 'row', gap: 8 }}><Pill title="accept" strong onPress={() => accept(r)} /><Pill title="decline" onPress={() => drop(r)} /></View>} />)}
      {outgoing.length ? <Text style={{ color: C.dim, fontFamily: F.black, fontSize: 13, marginTop: 12 }}>sent</Text> : null}
      {outgoing.map((r) => <Row key={r.id} r={r} actions={<Pill title="cancel" onPress={() => drop(r)} />} />)}
    </ScrollView>
  );
}
