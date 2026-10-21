import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { setMuted } from '../lib/notifs';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, SlideInDown, SlideOutDown, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { avatarUrl, mediaUrl, nameOf } from '../lib/api';
import { BACKGROUNDS, chatOf, loadMessages, markRead, pickBackgroundPhoto, retry, sendMessage, setBackground } from '../lib/chat';
import { set, useStore, type ChatMsg } from '../lib/store';
import { C, F } from '../lib/theme';
import { Squish } from '../lib/tt';
import { Avatar } from '../lib/ui';

const out = Easing.bezier(0.23, 1, 0.32, 1);
export const G = { back: ['chevron.left', 'chevron-left'], palette: ['paintpalette.fill', 'palette'], send: ['arrow.up', 'arrow-up'], people: ['person.2.fill', 'account-multiple'], add: ['plus', 'plus'], plus: ['photo.badge.plus', 'image-plus'] } as const;
export function MuteRow({ chat }: { chat: string }) {
  const muted = useStore((s) => !!s.notif?.muted.includes(chat));
  return (
    <Squish onPress={() => { Haptics.selectionAsync(); setMuted(chat, !muted); }} style={{ marginHorizontal: 18, height: 48, borderRadius: 24, backgroundColor: muted ? '#fff' : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: muted ? '#000' : '#fff', fontFamily: F.black, fontSize: 16 }}>{muted ? 'muted · tap to unmute' : 'mute notifications'}</Text>
    </Squish>
  );
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

export function Bubble({ m, mine, joined, fresh, seen, onRetry, author }: { m: ChatMsg; mine: boolean; joined: boolean; fresh: boolean; seen: boolean | string; onRetry: () => void; author?: string }) {
  return (
    <Animated.View entering={fresh ? FadeInDown.duration(220).easing(out) : undefined} style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: joined ? 2 : 10 }}>
      {author && !joined ? <Text style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.bold, fontSize: 12, marginBottom: 3, marginLeft: 12 }}>{author}</Text> : null}
      <Pressable disabled={!m.failed} onPress={onRetry} style={{ maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderCurve: 'continuous', backgroundColor: mine ? C.red : 'rgba(255,255,255,0.13)', opacity: m.pending ? 0.6 : 1 }}>
        <Text style={{ color: '#fff', fontFamily: F.bold, fontSize: 16, lineHeight: 21 }}>{m.body}</Text>
      </Pressable>
      {m.failed ? <Text style={{ color: C.danger, fontFamily: F.bold, fontSize: 12, marginTop: 3 }}>not sent · tap to retry</Text> : seen ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 12, marginTop: 3 }}>{typeof seen === 'string' ? seen : 'seen'}</Text> : null}
    </Animated.View>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const friend = useStore((s) => s.friends.find((f) => f.id === id));
  const chat = useStore((s) => s.chats[id!]) ?? chatOf(id!);
  const meId = useStore((s) => s.me?.id);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const opened = useRef(Date.now());
  const kb = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(kb.height.value, insets.bottom) + 8 }));

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
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Squish onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="back" size={22} /></Squish>
        <Avatar user={friend} size={38} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 18 }}>{nameOf(friend)}</Text>
          <Text style={{ color: friend.online ? C.online : 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 13 }}>{friend.dnd ? 'do not disturb' : friend.online ? 'online' : 'offline'}</Text>
        </View>
        <Squish onPress={() => { Haptics.selectionAsync(); setPicker(true); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="palette" /></Squish>
      </View>
      <Animated.View style={[{ flex: 1 }, lift]}>
        <FlatList
          inverted
          data={msgs}
          keyExtractor={(m) => m.id}
          renderItem={({ item, index }) => (
            <Bubble m={item} mine={item.from === meId} joined={msgs[index + 1]?.from === item.from} fresh={item.created_at > opened.current}
              seen={item.id === lastMine?.id && chat.theirReadAt >= item.created_at} onRetry={() => retry(id!, item)} />
          )}
          onEndReached={() => loadMessages(id!, true).catch(() => {})}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, flexGrow: 1 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={chat.loaded && !msgs.length ? <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.bold, fontSize: 15, textAlign: 'center', marginTop: 40 }}>say hi to {nameOf(friend).toLowerCase()}</Text> : undefined}
        />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 6 }}>
          <TextInput value={text} onChangeText={setText} placeholder="message" placeholderTextColor="rgba(255,255,255,0.35)" multiline maxLength={2000} keyboardAppearance="dark" selectionColor={C.red}
            style={{ flex: 1, minHeight: 44, maxHeight: 130, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', fontFamily: F.bold, fontSize: 16, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11 }} />
          <Squish onPress={send} disabled={!text.trim()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() ? C.red : 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}><Glyph g="send" size={18} /></Squish>
        </View>
      </Animated.View>
      {picker ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(180)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}><Pressable style={{ flex: 1 }} onPress={() => setPicker(false)} /></Animated.View>
          <Animated.View entering={SlideInDown.duration(320).easing(out)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, borderRadius: 30, borderCurve: 'continuous', backgroundColor: '#1C1C1E', paddingVertical: 20, gap: 14 }}>
            <MuteRow chat={id!} />
            <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 18, textAlign: 'center' }}>chat background</Text>
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
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}
