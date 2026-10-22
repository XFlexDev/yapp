import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideInRight, SlideOutDown, interpolateColor, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { haptic } from '../lib/haptic';
import { focusGroup, leaveGroupTalk, pressGroup, releaseGroup } from '../lib/voice';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mediaUrl, nameOf } from '../lib/api';
import { BACKGROUNDS, pickBackgroundPhoto } from '../lib/chat';
import { addMember, leaveGroup, loadGroupMessages, markGroupRead, onGroupUpdated, sendGroup, setGroupBackground, retryGroup, sendGroupPhoto, deleteGroupMessage, sendGroupSticker } from '../lib/groups';
import { set, useStore } from '../lib/store';
import { C, F } from '../lib/theme';
import { Squish } from '../lib/tt';
import { Avatar } from '../lib/ui';
import { Backdrop, Bubble, Glyph, MuteRow, PhotoViewer, SectionLabel } from './chat';
import { req } from '../lib/api';
import { StickerPicker } from '../components/StickerPicker';

const out = Easing.bezier(0.23, 1, 0.32, 1);

const SPRING = { damping: 18, stiffness: 320, mass: 0.7 };

/** Settings row that opens its own page inside the sheet. */
function NavRow({ title, value, onPress }: { title: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => ({ marginHorizontal: 10, height: 52, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 16 }}>{title}</Text>
      {value ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 15, marginRight: 8 }}>{value}</Text> : null}
      <Text style={{ color: 'rgba(255,255,255,0.35)', fontFamily: F.black, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

/** Hold to talk to the whole group. */
function TalkButton({ onState }: { onState: (s: 'idle' | 'connecting' | 'live' | 'hint') => void }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const on = useSharedValue(0);
  const down = useRef(0);
  const seq = useRef(0);
  const a = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], ['rgba(255,255,255,0.12)', C.red]),
    transform: [{ scaleX: 1 + on.value * 0.18 }, { scaleY: 1 + on.value * 0.18 }],
  }));
  const start = () => {
    down.current = Date.now();
    const n = ++seq.current;
    on.value = withSpring(1, SPRING);
    haptic.press();
    onState('connecting');
    pressGroup(id!).then(() => { if (seq.current === n) { haptic.live(); onState('live'); } }).catch(() => onState('idle'));
  };
  const end = () => {
    seq.current++;
    on.value = withSpring(0, SPRING);
    releaseGroup(id!).catch(() => {});
    if (Date.now() - down.current < 250) onState('hint');
    else { haptic.release(); onState('idle'); }
  };
  return (
    <Pressable onPressIn={start} onPressOut={end} hitSlop={8}>
      <Animated.View style={[{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, a]}><Glyph g="mic" size={18} /></Animated.View>
    </Pressable>
  );
}

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const g = useStore((s) => s.groups[id!]);
  const { me, friends } = useStore();
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState<null | 'bg' | 'people'>(null);
  const [sure, setSure] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [open, setOpen] = useState<null | 'people' | 'add' | 'bg'>(null);
  const [talk, setTalk] = useState<'idle' | 'connecting' | 'live' | 'hint'>('idle');
  const [stickersVisible, setStickersVisible] = useState(false);
  const talker = useStore((s) => s.groupTalk[id!] ?? null);
  const opened = useRef(Date.now());
  const kb = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(kb.height.value, insets.bottom) + 8 }));

  useEffect(() => {
    set({ openChat: `g:${id}` });
    loadGroupMessages(id!).then(() => markGroupRead(id!)).catch(() => {});
    focusGroup(id!);
    return () => { set({ openChat: null }); leaveGroupTalk(); };
  }, [id]);
  useEffect(() => { if (talk === 'hint') { const t = setTimeout(() => setTalk('idle'), 1600); return () => clearTimeout(t); } }, [talk]);
  useEffect(() => { if (!g) router.back(); }, [!g]);
  if (!g) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  const msgs = g.messages;
  const who = (uid: string) => g.members.find((u) => u.id === uid);
  const lastMine = msgs.find((m) => m.from === me?.id && !m.pending && !m.failed);
  const seenBy = lastMine ? g.members.filter((u) => u.id !== me?.id && (g.reads[u.id] ?? 0) >= lastMine.created_at).map((u) => nameOf(u).toLowerCase()) : [];
  const others = friends.filter((f) => !g.members.some((u) => u.id === f.id));
  const send = () => { const b = text.trim(); if (!b) return; Haptics.selectionAsync(); setText(''); sendGroup(id!, b); };
  const close = () => { setSheet(null); setSure(false); setOpen(null); };
  const renameGroup = (name: string) => { const n = name.trim(); if (!n || n === g.name) return; req(`/v1/groups/${id}`, { method: 'PATCH', body: { name: n } }).catch(() => {}); };
  const removeMember = (uid: string) => { Haptics.selectionAsync(); req(`/v1/groups/${id}/members/${uid}`, { method: 'DELETE' }).catch(() => {}); };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Backdrop bg={g.background} photo={null} />
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Squish onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="back" size={22} /></Squish>
        <Pressable style={{ flex: 1 }} onPress={() => setSheet('people')}>
          <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 18 }}>{g.name}</Text>
          <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.bold, fontSize: 13 }}>{talk === 'live' ? 'everyone can hear you' : talk === 'connecting' ? 'connecting…' : talk === 'hint' ? 'hold to talk to everyone' : talker ? `${nameOf(who(talker) ?? ({ display_name: 'someone' } as any)).toLowerCase()} is talking` : `${g.members.length} people`}</Text>
        </Pressable>
        <Squish onPress={() => { Haptics.selectionAsync(); setSheet('people'); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="gear" /></Squish>
      </View>
      <Animated.View style={[{ flex: 1 }, lift]}>
        <FlatList inverted data={msgs} keyExtractor={(m) => m.id}
          renderItem={({ item, index }) => {
            const mine = item.from === me?.id;
            return <Bubble m={item} mine={mine} joined={msgs[index + 1]?.from === item.from} fresh={item.created_at > opened.current} author={mine ? undefined : nameOf(who(item.from) ?? { display_name: 'someone' } as any).toLowerCase()}
              seen={item.id === lastMine?.id && seenBy.length ? `seen by ${seenBy.length === g.members.length - 1 ? 'everyone' : seenBy.join(', ')}` : false} onRetry={() => retryGroup(id!, item)} onOpen={setView} onDelete={mine ? () => deleteGroupMessage(id!, item).catch(() => {}) : undefined} />;
          }}
          onEndReached={() => loadGroupMessages(id!, true).catch(() => {})} onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, flexGrow: 1 }} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 6 }}>
          <Squish onPress={() => { Haptics.selectionAsync(); sendGroupPhoto(id!).catch(() => {}); }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}><Glyph g="photo" size={19} /></Squish>
          <Squish onPress={() => { Haptics.selectionAsync(); setStickersVisible(true); }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}><Glyph g="sticker" size={20} /></Squish>
          <TextInput value={text} onChangeText={setText} placeholder={`message ${g.name}`} placeholderTextColor="rgba(255,255,255,0.35)" multiline maxLength={2000} keyboardAppearance="dark" selectionColor={C.red}
            style={{ flex: 1, minHeight: 44, maxHeight: 130, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: F.bold, fontSize: 16, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11 }} />
          {text.trim() ? (
            <Squish onPress={send} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' }}><Glyph g="send" size={18} /></Squish>
          ) : <TalkButton onState={setTalk} />}
        </View>
      </Animated.View>
      <StickerPicker
        visible={stickersVisible}
        onClose={() => setStickersVisible(false)}
        bottomInset={insets.bottom + 8}
        onPickEmoji={(emoji) => setText((prev) => prev + emoji)}
        onPickSticker={(stk) => {
          setStickersVisible(false);
          sendGroupSticker(id!, stk.id).catch(() => {});
        }}
      />
      {sheet ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(180)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}><Pressable style={{ flex: 1 }} onPress={close} /></Animated.View>
          <Animated.View entering={SlideInDown.duration(320).easing(out)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, maxHeight: '82%', borderRadius: 30, borderCurve: 'continuous', backgroundColor: '#1C1C1E', paddingVertical: 20, gap: 12 }}>
            {open ? (
              <Animated.View key={open} entering={SlideInRight.duration(260).easing(out)} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
                  <Squish onPress={() => setOpen(null)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="back" size={20} /></Squish>
                  <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 20, textAlign: 'center', marginRight: 44 }}>{open === 'people' ? 'people' : open === 'add' ? 'add people' : 'background'}</Text>
                </View>
                <ScrollView keyboardShouldPersistTaps="handled">
                  {open === 'people' ? (<>{g.members.map((u) => (
                  <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 7 }}>
                    <Avatar user={u} size={40} />
                    <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 16 }}>{u.id === me?.id ? 'you' : nameOf(u)}</Text>
                    {u.id === g.owner ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 13 }}>creator</Text>
                      : g.owner === me?.id ? <Squish onPress={() => removeMember(u.id)} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}><Glyph g="minus" size={18} color="rgba(255,255,255,0.6)" /></Squish> : null}
                  </View>
                ))}
</>) : open === 'add' ? (<>{others.map((f) => (
                    <Squish key={f.id} disabled={g.invited?.includes(f.id)} onPress={() => { Haptics.selectionAsync(); addMember(id!, f.id).catch(() => {}); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 7 }}>
                      <Avatar user={f} size={40} />
                      <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 16 }}>{nameOf(f)}</Text>
                      {g.invited?.includes(f.id) ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 13 }}>invited</Text> : <Glyph g="add" size={16} />}
                    </Squish>
                  ))}
</>) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 12, paddingVertical: 4 }}>
                  <Squish onPress={() => pickBackgroundPhoto(id!, `/v1/groups/${id}/background/photo`).then((r) => r && onGroupUpdated(r as any)).catch(() => {})} style={{ width: 58, height: 58, borderRadius: 29, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}><Glyph g="plus" /></Squish>
                  {g.background?.startsWith('b-') ? <View style={{ width: 58, height: 58, borderRadius: 29, overflow: 'hidden', borderWidth: 3, borderColor: '#fff' }}><Image source={mediaUrl(g.background)} style={StyleSheet.absoluteFill} /></View> : null}
                  {[null, ...BACKGROUNDS.map((b) => b.id)].map((b) => { const p = BACKGROUNDS.find((x) => x.id === b); const on = g.background === b; return (
                    <Squish key={b ?? 'none'} onPress={() => { Haptics.selectionAsync(); setGroupBackground(id!, b).catch(() => {}); }} style={{ width: 58, height: 58, borderRadius: 29, overflow: 'hidden', borderWidth: on ? 3 : 1, borderColor: on ? '#fff' : 'rgba(255,255,255,0.2)', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
                      {p ? <LinearGradient colors={p.colors} style={StyleSheet.absoluteFill} /> : <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.black, fontSize: 12 }}>none</Text>}
                    </Squish>
                  ); })}
                </ScrollView>
                  )}
                </ScrollView>
              </Animated.View>
            ) : (
              <Animated.View key="main" entering={FadeIn.duration(180)}>
            <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 20, textAlign: 'center' }}>group settings</Text>
              <SectionLabel>name</SectionLabel>
              <TextInput defaultValue={g.name} onEndEditing={(e) => renameGroup(e.nativeEvent.text)} maxLength={40} keyboardAppearance="dark" selectionColor={C.red} returnKeyType="done"
                style={{ marginHorizontal: 18, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.1)', color: '#fff', fontFamily: F.black, fontSize: 16, paddingHorizontal: 18 }} />
              <NavRow title="people" value={`${g.members.length}`} onPress={() => setOpen('people')} />
              {others.length ? <NavRow title="add people" value={g.invited?.length ? `${g.invited.length} invited` : ''} onPress={() => setOpen('add')} /> : null}
              <NavRow title="background" value="" onPress={() => setOpen('bg')} />
              <SectionLabel>notifications</SectionLabel>
              <MuteRow chat={`g:${id}`} />
              <Squish onPress={() => { if (!sure) { Haptics.selectionAsync(); setSure(true); return; } leaveGroup(id!).catch(() => {}); }} style={{ marginHorizontal: 18, marginTop: 4, height: 50, borderRadius: 25, backgroundColor: sure ? C.danger : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 16 }}>{sure ? 'tap again to leave' : 'leave group'}</Text>
              </Squish>
            </ScrollView>
              </Animated.View>
            )}
          </Animated.View>
        </View>
      ) : null}
      <PhotoViewer uri={view} onClose={() => setView(null)} />
    </View>
  );
}
