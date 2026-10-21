import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nameOf } from '../lib/api';
import { createGroup } from '../lib/groups';
import { useStore, type ChatMsg } from '../lib/store';
import { C, F } from '../lib/theme';
import { Squish } from '../lib/tt';
import { Avatar } from '../lib/ui';
import { Glyph } from './chat';

const out = Easing.bezier(0.23, 1, 0.32, 1);
const preview = (m: ChatMsg | null | undefined, me?: string) => (m ? `${m.from === me ? 'you: ' : ''}${m.kind === 'image' ? 'photo' : m.body}` : 'say hi');

function Row({ title, sub, unread, left, onPress }: { title: string; sub: string; unread: number; left: React.ReactNode; onPress: () => void }) {
  return (
    <Squish onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
      {left}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 17 }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: unread ? '#fff' : 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 14 }}>{sub}</Text>
      </View>
      {unread ? <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}><Text style={{ color: '#fff', fontFamily: F.black, fontSize: 12 }}>{unread}</Text></View> : null}
    </Squish>
  );
}

function Stack3({ users }: { users: any[] }) {
  return (
    <View style={{ width: 48, height: 48 }}>
      {users.slice(0, 2).map((u, i) => (
        <View key={u.id} style={{ position: 'absolute', left: i * 14, top: i * 14, borderRadius: 18, borderWidth: 2, borderColor: '#000' }}><Avatar user={u} size={32} /></View>
      ))}
    </View>
  );
}

export default function Inbox() {
  const insets = useSafeAreaInsets();
  const { friends, chats, groups, me } = useStore();
  const [make, setMake] = useState(false);
  const [name, setName] = useState('');
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const items = [
    ...Object.values(groups).map((g) => ({ key: `g:${g.id}`, at: g.last?.created_at ?? 0, node: (
      <Row key={`g:${g.id}`} title={g.name} sub={preview(g.last, me?.id)} unread={g.unread} left={<Stack3 users={g.members.filter((u) => u.id !== me?.id)} />} onPress={() => router.push({ pathname: '/group', params: { id: g.id } })} />
    ) })),
    ...friends.map((f) => { const c = chats[f.id]; const last = c?.messages.find((m) => !m.pending); return { key: f.id, at: last?.created_at ?? 0, node: (
      <Row key={f.id} title={nameOf(f)} sub={preview(last, me?.id)} unread={c?.unread ?? 0} left={<Avatar user={f} size={48} />} onPress={() => router.push({ pathname: '/chat', params: { id: f.id } })} />
    ) }; }),
  ].sort((a, b) => b.at - a.at);
  const create = async () => {
    if (busy || !name.trim() || !pick.length) return;
    setBusy(true);
    try { const id = await createGroup(name.trim(), pick); setMake(false); setName(''); setPick([]); router.push({ pathname: '/group', params: { id } }); }
    catch { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 8, paddingBottom: 6, flexDirection: 'row', alignItems: 'center' }}>
        <Squish onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="back" size={22} /></Squish>
        <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 22 }}>chats</Text>
        <Squish onPress={() => { Haptics.selectionAsync(); setMake(true); }} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Glyph g="people" size={15} /><Text style={{ color: '#fff', fontFamily: F.black, fontSize: 14 }}>new group</Text>
        </Squish>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>{items.map((i) => i.node)}</ScrollView>
      {make ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(180)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]}><Pressable style={{ flex: 1 }} onPress={() => setMake(false)} /></Animated.View>
          <Animated.View entering={SlideInDown.duration(320).easing(out)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, maxHeight: '75%', borderRadius: 30, borderCurve: 'continuous', backgroundColor: '#1C1C1E', paddingTop: 20, paddingBottom: 14 }}>
            <TextInput value={name} onChangeText={setName} placeholder="group name" placeholderTextColor="rgba(255,255,255,0.35)" maxLength={40} keyboardAppearance="dark" selectionColor={C.red} style={{ marginHorizontal: 18, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.1)', color: '#fff', fontFamily: F.black, fontSize: 17, paddingHorizontal: 18 }} />
            <ScrollView style={{ marginTop: 10 }}>
              {friends.map((f) => { const on = pick.includes(f.id); return (
                <Squish key={f.id} onPress={() => { Haptics.selectionAsync(); setPick((p) => (on ? p.filter((x) => x !== f.id) : [...p, f.id])); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 8 }}>
                  <Avatar user={f} size={40} />
                  <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 16 }}>{nameOf(f)}</Text>
                  <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? C.red : 'rgba(255,255,255,0.3)', backgroundColor: on ? C.red : 'transparent' }} />
                </Squish>
              ); })}
            </ScrollView>
            <Squish onPress={create} disabled={busy || !name.trim() || !pick.length} style={{ marginHorizontal: 18, marginTop: 10, height: 52, borderRadius: 26, backgroundColor: name.trim() && pick.length ? '#fff' : 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: name.trim() && pick.length ? '#000' : 'rgba(255,255,255,0.5)', fontFamily: F.black, fontSize: 17 }}>{busy ? 'creating…' : 'create group'}</Text>
            </Squish>
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}
