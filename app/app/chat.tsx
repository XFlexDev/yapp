import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { setMuted } from '../lib/notifs';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, SlideInDown, SlideInRight, SlideOutDown, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { avatarUrl, mediaUrl, nameOf, req } from '../lib/api';
import { block, REASONS, report } from '../lib/safety';
import { BACKGROUNDS, chatOf, deleteChat, loadChatPhotos, loadMessages, markRead, pickBackgroundPhoto, retry, sendMessage, sendPhoto, setBackground } from '../lib/chat';
import { removeFriend, set, useStore, type ChatMsg } from '../lib/store';
import { C, F } from '../lib/theme';
import { Squish } from '../lib/tt';
import { Avatar } from '../lib/ui';

const out = Easing.bezier(0.23, 1, 0.32, 1);
export const G = { back: ['chevron.left', 'chevron-left'], palette: ['paintpalette.fill', 'palette'], send: ['arrow.up', 'arrow-up'], mic: ['mic.fill', 'microphone'], gear: ['gearshape.fill', 'cog'], minus: ['minus.circle.fill', 'minus-circle'], people: ['person.2.fill', 'account-multiple'], add: ['plus', 'plus'], plus: ['photo.badge.plus', 'image-plus'], photo: ['photo.fill', 'image'] } as const;
export function MuteRow({ chat }: { chat: string }) {
  const muted = useStore((s) => !!s.notif?.muted.includes(chat));
  return (
    <Squish onPress={() => { Haptics.selectionAsync(); setMuted(chat, !muted); }} style={{ marginHorizontal: 18, height: 48, borderRadius: 24, backgroundColor: muted ? '#fff' : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: muted ? '#000' : '#fff', fontFamily: F.black, fontSize: 16 }}>{muted ? 'muted · tap to unmute' : 'mute notifications'}</Text>
    </Squish>
  );
}

export function SettingRow({ title, onPress, more, danger }: { title: string; onPress: () => void; more?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => ({ marginHorizontal: 10, height: 52, borderRadius: 22, backgroundColor: danger ? C.danger : 'rgba(255,255,255,0.06)', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 16 }}>{title}</Text>
      {more ? <Text style={{ color: 'rgba(255,255,255,0.35)', fontFamily: F.black, fontSize: 18 }}>›</Text> : null}
    </Pressable>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.black, fontSize: 13, paddingHorizontal: 24, marginTop: 4 }}>{children}</Text>;
}

export function Glyph({ g, size = 20, color = '#fff' }: { g: keyof typeof G; size?: number; color?: string }) {
  return <SymbolView name={G[g][0] as any} tintColor={color} size={size} weight="bold" fallback={<MaterialCommunityIcons name={G[g][1] as any} size={size + 4} color={color} />} />;
}

export function Backdrop({ bg, photo }: { bg: string | null; photo: string | null }) {
  const preset = BACKGROUNDS.find((b) => b.id === bg);
  return (
    <Animated.View key={bg ?? 'none'} entering={FadeIn.duration(260)} exiting={FadeOut.duration(260)} style={StyleSheet.absoluteFill}>
      {bg?.startsWith('b-') ? (
        <>
          <Image source={mediaUrl(bg)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
        </>
      ) : bg === 'photo' && photo ? (
        <>
          <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
        </>
      ) : preset ? <LinearGradient colors={preset.colors} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />}
    </Animated.View>
  );
}

function sxy(v: number) {
  'worklet';
  return [{ scaleX: v }, { scaleY: v }];
}
const AV = 38;
const MORPH = { damping: 24, stiffness: 260, mass: 0.8 };

/** Photo bubble: exact aspect from the start, blurred preview until the WebP arrives from the CDN. */
function PhotoBubble({ m, onOpen, onRetry }: { m: ChatMsg; onOpen?: (uri: string) => void; onRetry: () => void }) {
  const [w, h, thumb] = (m.meta ?? '').split(',');
  const ratio = +w && +h ? Math.min(1.5, Math.max(0.6, +h / +w)) : 1;
  const src = m.body.startsWith('c-') ? mediaUrl(m.body) : m.body;
  return (
    <Pressable onPress={() => (m.failed ? onRetry() : onOpen?.(src))} style={({ pressed }) => ({ transform: [{ scaleX: pressed ? 0.98 : 1 }, { scaleY: pressed ? 0.98 : 1 }] })}>
      <Image source={src} placeholder={thumb ? { uri: `data:image/webp;base64,${thumb}` } : undefined} placeholderContentFit="cover" contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={m.cid ?? m.id}
        style={{ width: 230, height: 230 * ratio, borderRadius: 20, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.08)', opacity: m.pending ? 0.6 : 1 }} />
    </Pressable>
  );
}

export function PhotoViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  if (!uri) return null;
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 20 }]}>
      <Pressable style={{ flex: 1 }} onPress={onClose}><Image source={uri} style={{ flex: 1 }} contentFit="contain" cachePolicy="memory-disk" /></Pressable>
    </Animated.View>
  );
}

export function Bubble({ m, mine, joined, fresh, seen, onRetry, onOpen, author }: { m: ChatMsg; mine: boolean; joined: boolean; fresh: boolean; seen: boolean | string; onRetry: () => void; onOpen?: (uri: string) => void; author?: string }) {
  return (
    <Animated.View entering={fresh ? FadeInDown.duration(220).easing(out) : undefined} style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: joined ? 2 : 10 }}>
      {author && !joined ? <Text style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.bold, fontSize: 12, marginBottom: 3, marginLeft: 12 }}>{author}</Text> : null}
      {m.kind === 'image' ? <PhotoBubble m={m} onOpen={onOpen} onRetry={onRetry} /> : <Pressable disabled={!m.failed} onPress={onRetry} style={{ maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderCurve: 'continuous', backgroundColor: mine ? C.red : 'rgba(255,255,255,0.13)', opacity: m.pending ? 0.6 : 1 }}>
        <Text style={{ color: '#fff', fontFamily: F.bold, fontSize: 16, lineHeight: 21 }}>{m.body}</Text>
      </Pressable>}
      {m.failed ? <Text style={{ color: C.danger, fontFamily: F.bold, fontSize: 12, marginTop: 3 }}>not sent · tap to retry</Text> : seen ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 12, marginTop: 3 }}>{typeof seen === 'string' ? seen : 'seen'}</Text> : null}
    </Animated.View>
  );
}

export default function ChatScreen() {
  const { id, ax, ay, as } = useLocalSearchParams<{ id: string; ax?: string; ay?: string; as?: string }>();
  const insets = useSafeAreaInsets();
  // Avatar morph: flies from where it sat in the chat list up into the header.
  const from = useRef(ax && ay && as ? { x: +ax, y: +ay, s: +as } : null).current;
  const avRef = useRef<React.ComponentRef<typeof View>>(null);
  const [land, setLand] = useState<{ x: number; y: number } | null>(null);
  const morph = useSharedValue(from ? 0 : 1);
  const onAvLayout = () => {
    if (!from || land) return;
    avRef.current?.measureInWindow((x, y) => { setLand({ x, y }); morph.value = withSpring(1, MORPH); });
  };
  const avStyle = useAnimatedStyle(() => {
    if (!from) return {};
    if (!land) return { opacity: 0 };
    const p = morph.value, k = from.s / AV;
    return {
      opacity: 1,
      transform: [
        { translateX: (from.x - land.x + (from.s - AV) / 2) * (1 - p) },
        { translateY: (from.y - land.y + (from.s - AV) / 2) * (1 - p) },
        ...sxy(k + (1 - k) * p),
      ],
    };
  });
  const textIn = useAnimatedStyle(() => ({ opacity: morph.value, transform: [{ translateX: (1 - morph.value) * -12 }] }));
  const friend = useStore((s) => s.friends.find((f) => f.id === id));
  const chat = useStore((s) => s.chats[id!]) ?? chatOf(id!);
  const meId = useStore((s) => s.me?.id);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [page, setPage] = useState<null | 'bg' | 'photos' | 'report'>(null);
  const [photos, setPhotos] = useState<ChatMsg[] | null>(null);
  const [sure, setSure] = useState<null | 'delete' | 'remove' | 'block'>(null);
  const [reported, setReported] = useState(false);
  const close = () => { setPicker(false); setPage(null); setSure(null); };
  const arm = (k: 'delete' | 'remove' | 'block', go: () => void) => { if (sure !== k) { Haptics.selectionAsync(); setSure(k); return; } Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); go(); };
  const opened = useRef(Date.now());
  const kb = useAnimatedKeyboard();
  const [kbPad, setKbPad] = useState(0);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardWillShow', (e) => setKbPad(Math.max(0, e.endCoordinates.height - insets.bottom)));
    const b = Keyboard.addListener('keyboardDidHide', () => setKbPad(0));
    return () => { a.remove(); b.remove(); };
  }, [insets.bottom]);
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(kb.height.value - insets.bottom, 0) }] }));

  useEffect(() => {
    set({ openChat: id });
    loadMessages(id!).then(() => markRead(id!)).catch(() => {});
    return () => set({ openChat: null });
  }, [id]);

  if (!friend) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  const msgs = chat.messages;
  const lastMine = msgs.find((m) => m.from === meId && !m.pending && !m.failed);
  const send = () => {
    const b = text.trim();
    if (!b) return;
    Haptics.selectionAsync();
    setText('');
    sendMessage(id!, b);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Backdrop bg={chat.background} photo={avatarUrl(friend)} />
      <View style={{ zIndex: 2, paddingTop: insets.top + 4, paddingHorizontal: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Squish onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="back" size={22} /></Squish>
        <Animated.View ref={avRef} onLayout={onAvLayout} style={avStyle}><Avatar user={friend} size={AV} /></Animated.View>
        <Animated.View style={[{ flex: 1 }, textIn]}>
          <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 18 }}>{nameOf(friend)}</Text>
          <Text style={{ color: friend.online ? C.online : 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 13 }}>{friend.dnd ? 'do not disturb' : friend.online ? 'online' : 'offline'}</Text>
        </Animated.View>
        <Squish onPress={() => { Haptics.selectionAsync(); setPicker(true); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="gear" /></Squish>
      </View>
      <View style={{ flex: 1, overflow: 'hidden' }}>
      <Animated.View entering={FadeIn.duration(260)} style={[{ flex: 1, paddingBottom: insets.bottom + 8 }, lift]}>
        <Animated.FlatList
          itemLayoutAnimation={LinearTransition.duration(220).easing(out)}
          windowSize={9}
          maxToRenderPerBatch={12}
          inverted
          data={msgs}
          keyExtractor={(m) => m.cid ?? m.id}
          renderItem={({ item, index }) => (
            <Bubble m={item} mine={item.from === meId} joined={msgs[index + 1]?.from === item.from} fresh={item.created_at > opened.current}
              seen={item.id === lastMine?.id && chat.theirReadAt >= item.created_at} onRetry={() => retry(id!, item)} onOpen={setView} />
          )}
          onEndReached={() => loadMessages(id!, true).catch(() => {})}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 + kbPad, flexGrow: 1 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={chat.loaded && !msgs.length ? <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.bold, fontSize: 15, textAlign: 'center', marginTop: 40 }}>say hi to {nameOf(friend).toLowerCase()}</Text> : undefined}
        />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 6 }}>
          <Squish onPress={() => { Haptics.selectionAsync(); sendPhoto(id!).catch(() => {}); }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}><Glyph g="photo" size={19} /></Squish>
          <TextInput value={text} onChangeText={setText} placeholder="message" placeholderTextColor="rgba(255,255,255,0.35)" multiline maxLength={2000} keyboardAppearance="dark" selectionColor={C.red}
            style={{ flex: 1, minHeight: 44, maxHeight: 130, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: F.bold, fontSize: 16, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11 }} />
          <Squish onPress={send} disabled={!text.trim()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() ? C.red : 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}><Glyph g="send" size={18} /></Squish>
        </View>
      </Animated.View>
      </View>
      {picker ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(180)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}><Pressable style={{ flex: 1 }} onPress={close} /></Animated.View>
          <Animated.View entering={SlideInDown.duration(320).easing(out)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, borderRadius: 30, borderCurve: 'continuous', backgroundColor: '#1C1C1E', paddingVertical: 20, gap: 14, maxHeight: '85%' }}>
            {page ? (
              <Animated.View key={page} entering={SlideInRight.duration(260).easing(out)} style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
                  <Squish onPress={() => setPage(null)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="back" size={20} /></Squish>
                  <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 20, textAlign: 'center', marginRight: 44 }}>{page === 'bg' ? 'background' : page === 'photos' ? 'photos' : 'report'}</Text>
                </View>
                {page === 'bg' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 12 }}>
              <Squish onPress={() => { Haptics.selectionAsync(); pickBackgroundPhoto(id!).catch(() => {}); }} style={{ width: 58, height: 58, borderRadius: 29, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                <Glyph g="plus" size={20} />
              </Squish>
              {chat.background?.startsWith('b-') ? (
                <View style={{ width: 58, height: 58, borderRadius: 29, overflow: 'hidden', borderWidth: 3, borderColor: '#fff' }}><Image source={mediaUrl(chat.background)} style={StyleSheet.absoluteFill} /></View>
              ) : null}
              {[null, 'photo', ...BACKGROUNDS.map((b) => b.id)].map((b) => {
                const p = BACKGROUNDS.find((x) => x.id === b);
                const on = chat.background === b;
                return (
                  <Squish key={b ?? 'none'} onPress={() => { Haptics.selectionAsync(); setBackground(id!, b); }} style={{ width: 58, height: 58, borderRadius: 29, overflow: 'hidden', borderWidth: on ? 3 : 1, borderColor: on ? '#fff' : 'rgba(255,255,255,0.2)', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
                    {p ? <LinearGradient colors={p.colors} style={StyleSheet.absoluteFill} /> : b === 'photo' && avatarUrl(friend) ? <Image source={avatarUrl(friend)} style={StyleSheet.absoluteFill} blurRadius={8} /> : null}
                    {!b ? <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.black, fontSize: 12 }}>none</Text> : null}
                  </Squish>
                );
              })}
            </ScrollView>
                ) : page === 'photos' ? (
                  <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 12 }}>
                    {photos === null ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 15, padding: 12 }}>loading…</Text>
                      : !photos.length ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 15, padding: 12 }}>no photos yet</Text>
                      : photos.map((p) => { const [, , t] = (p.meta ?? '').split(','); const src = mediaUrl(p.body); return (
                        <Pressable key={p.id} onPress={() => setView(src)} style={{ width: '32.4%', aspectRatio: 1 }}>
                          <Image source={src} placeholder={t ? { uri: `data:image/webp;base64,${t}` } : undefined} contentFit="cover" cachePolicy="memory-disk" transition={150} style={{ flex: 1, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' }} />
                        </Pressable>
                      ); })}
                  </ScrollView>
                ) : (
                  <View style={{ gap: 8 }}>
                    {REASONS.map((r) => (
                      <SettingRow key={r} title={r} onPress={() => { report(friend.id, r).catch(() => {}); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setPage(null); setReported(true); }} />
                    ))}
                  </View>
                )}
              </Animated.View>
            ) : (
              <Animated.View key="main" entering={FadeIn.duration(180)} style={{ gap: 12 }}>
                <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 20, textAlign: 'center' }}>chat settings</Text>
                <SectionLabel>notifications</SectionLabel>
                <MuteRow chat={id!} />
                <SettingRow title="background" onPress={() => setPage('bg')} more />
                <SettingRow title="photos" onPress={() => { setPage('photos'); setPhotos(null); loadChatPhotos(id!).then(setPhotos).catch(() => setPhotos([])); }} more />
                <SettingRow title={sure === 'delete' ? 'tap again to delete chat' : 'delete chat'} danger={sure === 'delete'} onPress={() => arm('delete', () => { deleteChat(id!).catch(() => {}); close(); router.back(); })} />
                <SectionLabel>{nameOf(friend).toLowerCase()}</SectionLabel>
                <SettingRow title={sure === 'remove' ? 'tap again to remove friend' : 'remove friend'} danger={sure === 'remove'} onPress={() => arm('remove', () => { req(`/v1/friends/${friend.id}`, { method: 'DELETE' }).then(() => removeFriend(friend.id)).catch(() => {}); close(); router.back(); })} />
                <SettingRow title={sure === 'block' ? 'tap again to block' : 'block'} danger={sure === 'block'} onPress={() => arm('block', () => { block(friend.id).catch(() => {}); close(); router.back(); })} />
                <SettingRow title={reported ? 'reported, thanks' : 'report'} onPress={() => !reported && setPage('report')} more={!reported} />
              </Animated.View>
            )}
          </Animated.View>
        </View>
      ) : null}
      <PhotoViewer uri={view} onClose={() => setView(null)} />
    </View>
  );
}
