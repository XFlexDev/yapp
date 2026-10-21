import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, cancelAnimation, interpolateColor, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, avatarUrl, nameOf, req, type Friend, type Me } from '../lib/api';
import { set, useStore } from '../lib/store';
import { C, F, SWATCH } from '../lib/theme';
import { Avatar, Button } from '../lib/ui';
import { focusFriend, pressTalk, releaseTalk } from '../lib/voice';

const AV = 52;
const SEL = 84;
const out = Easing.bezier(0.23, 1, 0.32, 1);
const spring = { damping: 26, stiffness: 320, mass: 0.9 };
const DND = '#FF9F0A';

const GLYPHS = {
  settings: ['gearshape.fill', 'cog'],
  add: ['person.badge.plus', 'account-plus'],
  sound: ['speaker.wave.2.fill', 'volume-high'],
  muted: ['speaker.slash.fill', 'volume-off'],
  wave: ['hand.wave.fill', 'hand-wave'],
} as const;

function Glyph({ g, size = 24 }: { g: keyof typeof GLYPHS; size?: number }) {
  const [sf, md] = GLYPHS[g];
  return <SymbolView name={sf as any} tintColor="#fff" size={size} weight="semibold" fallback={<MaterialCommunityIcons name={md as any} size={size} color="#fff" />} />;
}

function TopButton({ g, onPress, badge }: { g: keyof typeof GLYPHS; onPress: () => void; badge?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}>
      <Glyph g={g} />
      {badge ? (
        <View style={{ position: 'absolute', top: 5, right: 3, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 11 }}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Backdrop({ friend, talking }: { friend: Friend; talking: boolean }) {
  const url = avatarUrl(friend);
  const tint = useSharedValue(0);
  useEffect(() => { tint.value = withTiming(talking ? 1 : 0, { duration: talking ? 180 : 320, easing: out }); }, [talking]);
  const red = useAnimatedStyle(() => ({ opacity: tint.value * 0.42 }));
  return (
    <Animated.View key={friend.id} entering={FadeIn.duration(260)} style={[StyleSheet.absoluteFill, { backgroundColor: SWATCH[friend.color] ?? C.red }]}>
      {url ? <Image source={url} style={StyleSheet.absoluteFill} contentFit="cover" transition={220} /> : (
        <LinearGradient colors={['rgba(255,255,255,0.14)', 'rgba(255,255,255,0)']} style={StyleSheet.absoluteFill} />
      )}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.red }, red]} />
      <LinearGradient colors={['rgba(0,0,0,0.42)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', '#000']} locations={[0, 0.2, 0.42, 0.72, 1]} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

function Bars({ color }: { color: string }) {
  const v = [useSharedValue(0.35), useSharedValue(0.35), useSharedValue(0.35)];
  useEffect(() => {
    v.forEach((x, i) => { x.value = withDelay(i * 110, withRepeat(withSequence(withTiming(1, { duration: 260 + i * 40, easing: out }), withTiming(0.3, { duration: 300, easing: out })), -1)); });
    return () => v.forEach(cancelAnimation);
  }, []);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 14, width: 14 }}>
      {v.map((x, i) => <Animated.View key={i} style={[{ width: 3, height: 14, borderRadius: 1.5, backgroundColor: color }, useAnimatedStyle(() => ({ transform: [{ scaleY: x.value }] }))]} />)}
    </View>
  );
}

function TalkAvatar({ friend, talking, hearing }: { friend: Friend; talking: boolean; hearing: boolean }) {
  const press = useSharedValue(0);
  const ripple = useSharedValue(0);
  useEffect(() => { press.value = withSpring(talking ? 1 : 0, spring); }, [talking]);
  useEffect(() => {
    if (hearing) ripple.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);
    else { cancelAnimation(ripple); ripple.value = withTiming(0, { duration: 200 }); }
  }, [hearing]);
  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 + press.value * 0.08 }] }));
  const ring = useAnimatedStyle(() => ({ borderColor: interpolateColor(press.value, [0, 1], ['rgba(255,255,255,0.95)', C.red]), borderWidth: 2.5 + press.value * 1.5 }));
  const wave = useAnimatedStyle(() => ({ opacity: (1 - ripple.value) * 0.55, transform: [{ scale: 1 + ripple.value * 0.32 }] }));
  const size = SEL + 14;
  return (
    <Animated.View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, body]}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: '#fff' }, wave]} />
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2 }, ring]} />
      <Avatar user={friend} size={SEL} />
    </Animated.View>
  );
}

function Status({ friend, talking, hearing, note }: { friend: Friend; talking: boolean; hearing: boolean; note: string | null }) {
  const live = talking || hearing;
  const text = note ?? (talking ? 'talking' : hearing ? 'talking to you' : friend.dnd ? 'do not disturb' : friend.online ? 'hold to talk' : 'offline');
  const dot = friend.dnd ? DND : friend.online ? C.online : 'rgba(255,255,255,0.35)';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 22 }}>
      {live ? <Bars color={talking ? C.red : '#fff'} /> : note ? null : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />}
      <Animated.Text key={text} entering={FadeIn.duration(180)} style={{ color: live ? '#fff' : 'rgba(255,255,255,0.78)', fontFamily: F.bold, fontSize: 16 }}>{text}</Animated.Text>
    </View>
  );
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const { friends, selectedId, talkingTo, incoming, me, pokedAt } = useStore();
  const friend = useMemo(() => friends.find((f) => f.id === selectedId) ?? friends[0], [friends, selectedId]);
  const [talking, setTalking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { if (friend) focusFriend(friend.id); }, [friend?.id]);
  useEffect(() => {
    const id = Object.keys(talkingTo).find((k) => talkingTo[k]);
    if (id && !talking) set({ selectedId: id });
  }, [talkingTo]);
  useEffect(() => { if (note) { const t = setTimeout(() => setNote(null), 2200); return () => clearTimeout(t); } }, [note]);
  useEffect(() => {
    if (!friend || !pokedAt[friend.id] || Date.now() - pokedAt[friend.id] > 1000) return;
    setNote(`${nameOf(friend)} waved at you`);
  }, [friend && pokedAt[friend.id]]);

  const start = () => {
    if (!friend) return;
    if (friend.dnd) { setNote('they’re on do not disturb'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); return; }
    setTalking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    pressTalk(friend.id).catch((e) => { setTalking(false); setNote(e instanceof ApiError || e instanceof Error ? e.message : 'couldn’t connect'); });
  };
  const stop = () => {
    if (!friend || !talking) return;
    setTalking(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    releaseTalk(friend.id);
  };
  const hold = Gesture.LongPress().minDuration(80).maxDistance(4000).runOnJS(true).onStart(start).onFinalize(stop);

  const poke = () => {
    if (!friend) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    req('/v1/poke', { method: 'POST', body: { friend_id: friend.id } }).then(() => setNote('waved')).catch((e) => setNote(e.message));
  };

  const toggleDnd = () => {
    Haptics.selectionAsync();
    const next = !me?.dnd;
    set((s) => ({ me: s.me ? { ...s.me, dnd: next } : s.me }));
    req<Me>('/v1/status', { method: 'PUT', body: { dnd: next } }).then((m) => set({ me: m })).catch(() => set((s) => ({ me: s.me ? { ...s.me, dnd: !next } : s.me })));
  };

  if (!friend) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 4, paddingBottom: insets.bottom + 16, paddingHorizontal: 24 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -12 }}>
          <TopButton g="settings" onPress={() => router.push('/settings')} />
          <TopButton g="add" onPress={() => router.push('/add')} badge={incoming.length} />
        </View>
        <View style={{ flex: 1, justifyContent: 'flex-end', gap: 10, paddingBottom: 32 }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 44, lineHeight: 46, letterSpacing: -1 }}>add your{'\n'}friends</Text>
          <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 17 }}>then hold their photo to talk</Text>
        </View>
        <Button title="Add friends" onPress={() => router.push('/add')} />
      </View>
    );
  }

  const hearing = !!talkingTo[friend.id];
  const others = friends.filter((f) => f.id !== friend.id);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Backdrop friend={friend} talking={talking} />
      <View style={{ paddingTop: insets.top + 2, paddingHorizontal: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
        <TopButton g="settings" onPress={() => router.push('/settings')} />
        <View style={{ flexDirection: 'row' }}>
          <TopButton g="add" onPress={() => router.push('/add')} badge={incoming.length} />
          <TopButton g={me?.dnd ? 'muted' : 'sound'} onPress={toggleDnd} />
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ paddingHorizontal: 24, flexDirection: 'row', alignItems: 'flex-end', gap: 16 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: '#fff', fontFamily: F.black, fontSize: 44, letterSpacing: -1, lineHeight: 50 }}>{nameOf(friend)}</Text>
          <Status friend={friend} talking={talking} hearing={hearing} note={note} />
        </View>
        <Pressable onPress={poke} hitSlop={6} style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 2, transform: [{ scale: pressed ? 0.9 : 1 }] })}>
          <Glyph g="wave" size={24} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 22, marginBottom: insets.bottom + 14 }} contentContainerStyle={{ paddingHorizontal: 17, alignItems: 'center', gap: 12 }}>
        <GestureDetector gesture={hold}>
          <View collapsable={false}><TalkAvatar friend={friend} talking={talking} hearing={hearing} /></View>
        </GestureDetector>
        {others.map((f) => (
          <Pressable key={f.id} onPress={() => { Haptics.selectionAsync(); set({ selectedId: f.id }); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Avatar user={f} size={AV} ring={!!talkingTo[f.id]} />
            {f.online || f.dnd ? <View style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: f.dnd ? DND : C.online, borderWidth: 2.5, borderColor: '#000' }} /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
