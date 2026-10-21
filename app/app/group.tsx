import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mediaUrl, nameOf } from '../lib/api';
import { BACKGROUNDS, pickBackgroundPhoto } from '../lib/chat';
import { addMember, leaveGroup, loadGroupMessages, markGroupRead, onGroupUpdated, sendGroup, setGroupBackground } from '../lib/groups';
import { set, useStore } from '../lib/store';
import { C, F } from '../lib/theme';
import { Squish } from '../lib/tt';
import { Avatar } from '../lib/ui';
import { Backdrop, Bubble, Glyph } from './chat';

const out = Easing.bezier(0.23, 1, 0.32, 1);

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const g = useStore((s) => s.groups[id!]);
  const { me, friends } = useStore();
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState<null | 'bg' | 'people'>(null);
  const [sure, setSure] = useState(false);
  const opened = useRef(Date.now());
  const kb = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(kb.height.value, insets.bottom) + 8 }));

  useEffect(() => {
    set({ openChat: `g:${id}` });
    loadGroupMessages(id!).then(() => markGroupRead(id!)).catch(() => {});
    return () => set({ openChat: null });
  }, [id]);
  useEffect(() => { if (!g) router.back(); }, [!g]);
  if (!g) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  const msgs = g.messages;
  const who = (uid: string) => g.members.find((u) => u.id === uid);
  const lastMine = msgs.find((m) => m.from === me?.id && !m.pending && !m.failed);
  const seenBy = lastMine ? g.members.filter((u) => u.id !== me?.id && (g.reads[u.id] ?? 0) >= lastMine.created_at).map((u) => nameOf(u).toLowerCase()) : [];
  const others = friends.filter((f) => !g.members.some((u) => u.id === f.id));
  const send = () => { const b = text.trim(); if (!b) return; Haptics.selectionAsync(); setText(''); sendGroup(id!, b); };
  const close = () => { setSheet(null); setSure(false); };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Backdrop bg={g.background} photo={null} />
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Squish onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="back" size={22} /></Squish>
        <Pressable style={{ flex: 1 }} onPress={() => setSheet('people')}>
          <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 18 }}>{g.name}</Text>
          <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.bold, fontSize: 13 }}>{g.members.length} people</Text>
        </Pressable>
        <Squish onPress={() => setSheet('people')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="people" /></Squish>
        <Squish onPress={() => setSheet('bg')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="palette" /></Squish>
      </View>
      <Animated.View style={[{ flex: 1 }, lift]}>
        <FlatList inverted data={msgs} keyExtractor={(m) => m.id}
          renderItem={({ item, index }) => {
            const mine = item.from === me?.id;
            return <Bubble m={item} mine={mine} joined={msgs[index + 1]?.from === item.from} fresh={item.created_at > opened.current} author={mine ? undefined : nameOf(who(item.from) ?? { display_name: 'someone' } as any).toLowerCase()}
              seen={item.id === lastMine?.id && seenBy.length ? `seen by ${seenBy.length === g.members.length - 1 ? 'everyone' : seenBy.join(', ')}` : false} onRetry={() => sendGroup(id!, item.body)} />;
          }}
          onEndReached={() => loadGroupMessages(id!, true).catch(() => {})} onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, flexGrow: 1 }} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 6 }}>
          <TextInput value={text} onChangeText={setText} placeholder={`message ${g.name}`} placeholderTextColor="rgba(255,255,255,0.35)" multiline maxLength={2000} keyboardAppearance="dark" selectionColor={C.red}
            style={{ flex: 1, minHeight: 44, maxHeight: 130, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: F.bold, fontSize: 16, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11 }} />
          <Squish onPress={send} disabled={!text.trim()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() ? C.red : 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}><Glyph g="send" size={18} /></Squish>
        </View>
      </Animated.View>
      {sheet ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(180)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}><Pressable style={{ flex: 1 }} onPress={close} /></Animated.View>
          <Animated.View entering={SlideInDown.duration(320).easing(out)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, maxHeight: '75%', borderRadius: 30, borderCurve: 'continuous', backgroundColor: '#1C1C1E', paddingVertical: 20, gap: 12 }}>
            {sheet === 'bg' ? (
              <>
                <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 18, textAlign: 'center' }}>group background</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 12 }}>
                  <Squish onPress={() => pickBackgroundPhoto(id!, `/v1/groups/${id}/background/photo`).then((r) => r && onGroupUpdated(r as any)).catch(() => {})} style={{ width: 58, height: 58, borderRadius: 29, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}><Glyph g="plus" /></Squish>
                  {g.background?.startsWith('b-') ? <View style={{ width: 58, height: 58, borderRadius: 29, overflow: 'hidden', borderWidth: 3, borderColor: '#fff' }}><Image source={mediaUrl(g.background)} style={StyleSheet.absoluteFill} /></View> : null}
                  {[null, ...BACKGROUNDS.map((b) => b.id)].map((b) => { const p = BACKGROUNDS.find((x) => x.id === b); const on = g.background === b; return (
                    <Squish key={b ?? 'none'} onPress={() => { Haptics.selectionAsync(); setGroupBackground(id!, b).catch(() => {}); }} style={{ width: 58, height: 58, borderRadius: 29, overflow: 'hidden', borderWidth: on ? 3 : 1, borderColor: on ? '#fff' : 'rgba(255,255,255,0.2)', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
                      {p ? <LinearGradient colors={p.colors} style={StyleSheet.absoluteFill} /> : <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.black, fontSize: 12 }}>none</Text>}
                    </Squish>
                  ); })}
                </ScrollView>
              </>
            ) : (
              <ScrollView>
                {g.members.map((u) => (
                  <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 7 }}>
                    <Avatar user={u} size={40} />
                    <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 16 }}>{u.id === me?.id ? 'you' : nameOf(u)}</Text>
                    {u.id === g.owner ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 13 }}>creator</Text> : null}
                  </View>
                ))}
                {others.map((f) => (
                  <Squish key={f.id} onPress={() => { Haptics.selectionAsync(); addMember(id!, f.id).catch(() => {}); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 7, opacity: 0.75 }}>
                    <Avatar user={f} size={40} />
                    <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 16 }}>{nameOf(f)}</Text>
                    <Glyph g="add" size={16} />
                  </Squish>
                ))}
                <Squish onPress={() => { if (!sure) { Haptics.selectionAsync(); setSure(true); return; } leaveGroup(id!).catch(() => {}); }} style={{ marginHorizontal: 18, marginTop: 12, height: 50, borderRadius: 25, backgroundColor: sure ? C.danger : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 16 }}>{sure ? 'tap again to leave' : 'leave group'}</Text>
                </Squish>
              </ScrollView>
            )}
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}
