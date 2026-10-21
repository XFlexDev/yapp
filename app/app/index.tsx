import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, SlideInDown, SlideOutDown, cancelAnimation, interpolateColor, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, avatarUrl, nameOf, req, type Friend, type Me } from '../lib/api';
import { removeFriend, set, useStore } from '../lib/store';
import { C, F, SWATCH } from '../lib/theme';
import { Logo, SPRING, Squish, Swap } from '../lib/tt';
import { Avatar, Button } from '../lib/ui';
import { focusFriend, pressTalk, releaseTalk } from '../lib/voice';

const W = Dimensions.get('window').width;
const AV = 54;
const SEL = 76;
const PLUS = 48;
const GAP = 14;
const out = Easing.bezier(0.23, 1, 0.32, 1);
const DND = '#FF9F0A';
const MOVE = LinearTransition.springify().damping(SPRING.damping).stiffness(SPRING.stiffness);

const GLYPHS = {
  settings: ['gearshape.fill', 'cog'],
  plus: ['plus', 'plus'],
  sound: ['speaker.wave.2.fill', 'volume-high'],
  muted: ['speaker.slash.fill', 'volume-off'],
  down: ['chevron.down', 'chevron-down'],
} as const;

function Glyph({ g, size = 24 }: { g: keyof typeof GLYPHS; size?: number }) {
  const [sf, md] = GLYPHS[g];
  return <SymbolView name={sf as any} tintColor="#fff" size={size} weight="bold" fallback={<MaterialCommunityIcons name={md as any} size={size + 2} color="#fff" />} />;
}

function TopButton({ g, onPress }: { g: keyof typeof GLYPHS; onPress: () => void }) {
  return (
    <Squish onPress={onPress} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Glyph g={g} />
    </Squish>
  );
}

function Backdrop({ friend, talking }: { friend: Friend; talking: boolean }) {
  const url = avatarUrl(friend);
  const hue = SWATCH[friend.color] ?? C.red;
  const tint = useSharedValue(0);
  useEffect(() => { tint.value = withTiming(talking ? 1 : 0, { duration: talking ? 180 : 320, easing: out }); }, [talking]);
  const red = useAnimatedStyle(() => ({ opacity: tint.value * 0.42 }));
  return (
    <Animated.View key={friend.id} entering={FadeIn.duration(220)} exiting={FadeOut.duration(220)} style={[StyleSheet.absoluteFill, { backgroundColor: url ? '#000' : hue }]}>
      {url ? <Image source={url} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} cachePolicy="memory-disk" priority="high" /> : (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingBottom: '30%' }]}>
          <Logo ch={nameOf(friend).slice(0, 1).toLowerCase()} size={190} />
        </View>
      )}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.red }, red]} />
      <LinearGradient colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']} locations={[0, 0.14, 0.55, 0.8, 1]} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

function Bubble({ text }: { text: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ height: 34, paddingHorizontal: 16, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <Swap text={text} style={{ color: '#000', fontFamily: F.black, fontSize: 15 }} />
      </View>
      <View style={{ width: 12, height: 12, backgroundColor: '#fff', borderRadius: 2, marginTop: -8, transform: [{ rotate: '45deg' }] }} />
    </View>
  );
}

function Dot({ friend, size = 14 }: { friend: Friend; size?: number }) {
  if (!friend.online && !friend.dnd) return null;
  return <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={{ position: 'absolute', right: 1, top: 1, width: size, height: size, borderRadius: size / 2, backgroundColor: friend.dnd ? DND : C.online, borderWidth: 2.5, borderColor: '#000' }} />;
}

function TalkAvatar({ friend, talking, hearing }: { friend: Friend; talking: boolean; hearing: boolean }) {
  const press = useSharedValue(0);
  const ripple = useSharedValue(0);
  useEffect(() => { press.value = withSpring(talking ? 1 : 0, SPRING); }, [talking]);
  useEffect(() => {
    if (hearing) ripple.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);
    else { cancelAnimation(ripple); ripple.value = withTiming(0, { duration: 200 }); }
  }, [hearing]);
  const body = useAnimatedStyle(() => ({ transform: [{ scale: 1 + press.value * 0.1 }] }));
  const ring = useAnimatedStyle(() => ({ borderColor: interpolateColor(press.value, [0, 1], ['#ffffff', C.red]) }));
  const wave = useAnimatedStyle(() => ({ opacity: (1 - ripple.value) * 0.6, transform: [{ scale: 1 + ripple.value * 0.25 }] }));
  const size = SEL + 14;
  return (
    <Animated.View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, body]}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: '#fff' }, wave]} />
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 3.5 }, ring]} />
      <Avatar user={friend} size={SEL} />
      <Dot friend={friend} size={18} />
    </Animated.View>
  );
}

function FriendSheet({ friend, onClose, onWave }: { friend: Friend; onClose: () => void; onWave: () => void }) {
  const insets = useSafeAreaInsets();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!sure) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); setSure(true); return; }
    setBusy(true);
    try { await req(`/v1/friends/${friend.id}`, { method: 'DELETE' }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); removeFriend(friend.id); onClose(); }
    catch { setBusy(false); setSure(false); }
  };
  const row = (t: string, on: () => void, color = '#fff') => (
    <Pressable onPress={on} disabled={busy} style={({ pressed }) => ({ height: 54, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
      <Swap text={t} style={{ color, fontFamily: F.bold, fontSize: 17 }} />
    </Pressable>
  );
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(200)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <Animated.View entering={SlideInDown.springify().damping(32).stiffness(320)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, borderRadius: 32, borderCurve: 'continuous', backgroundColor: '#1C1C1E', paddingTop: 24, paddingBottom: 6, alignItems: 'stretch' }}>
        <View style={{ alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Avatar user={friend} size={64} />
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 20 }}>{nameOf(friend)}</Text>
            {friend.username ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 14 }}>@{friend.username}</Text> : null}
          </View>
        </View>
        {row('wave', () => { onClose(); onWave(); })}
        {row(sure ? 'tap again to remove' : 'remove friend', remove, C.danger)}
        {row('close', onClose, 'rgba(255,255,255,0.5)')}
      </Animated.View>
    </View>
  );
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const { friends, selectedId, talkingTo, incoming, me, pokedAt } = useStore();
  const friend = useMemo(() => friends.find((f) => f.id === selectedId) ?? friends[0], [friends, selectedId]);
  const [talking, setTalking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const scroll = useRef<any>(null);
  const wiggle = useSharedValue(0);
  const wiggleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${wiggle.value}deg` }] }));

  useEffect(() => { if (friend) focusFriend(friend.id); }, [friend?.id]);
  useEffect(() => {
    const id = Object.keys(talkingTo).find((k) => talkingTo[k]);
    if (id && !talking) set({ selectedId: id });
  }, [talkingTo]);
  useEffect(() => { if (note) { const t = setTimeout(() => setNote(null), 2200); return () => clearTimeout(t); } }, [note]);
  useEffect(() => {
    if (!friend || !pokedAt[friend.id] || Date.now() - pokedAt[friend.id] > 1000) return;
    wave();
    setNote(`${nameOf(friend).toLowerCase()} waved at you`);
  }, [friend && pokedAt[friend.id]]);

  const wave = () => { wiggle.value = withSequence(withTiming(-18, { duration: 90 }), withTiming(16, { duration: 120 }), withTiming(-10, { duration: 110 }), withSpring(0, SPRING)); };

  const start = () => {
    if (!friend) return;
    if (friend.dnd) { setNote('do not disturb'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); return; }
    setTalking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    pressTalk(friend.id).catch((e) => { setTalking(false); setNote((e instanceof ApiError || e instanceof Error ? e.message : 'couldn’t connect').toLowerCase()); });
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
    wave();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    req('/v1/poke', { method: 'POST', body: { friend_id: friend.id } }).then(() => setNote('waved')).catch((e) => setNote(String(e.message).toLowerCase()));
  };

  const toggleDnd = () => {
    Haptics.selectionAsync();
    const next = !me?.dnd;
    set((s) => ({ me: s.me ? { ...s.me, dnd: next } : s.me }));
    req<Me>('/v1/status', { method: 'PUT', body: { dnd: next } }).then((m) => set({ me: m })).catch(() => set((s) => ({ me: s.me ? { ...s.me, dnd: !next } : s.me })));
  };

  const plus = (
    <Squish onPress={() => router.push('/add')} style={{ width: PLUS, height: PLUS, borderRadius: PLUS / 2, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
      <Glyph g="plus" size={22} />
      {incoming.length ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={{ position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 11 }}>{incoming.length}</Text>
        </Animated.View>
      ) : null}
    </Squish>
  );

  if (!friend) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 2, paddingBottom: insets.bottom + 16, paddingHorizontal: 24 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -14 }}>
          <TopButton g="settings" onPress={() => router.push('/settings')} />
        </View>
        <View style={{ flex: 1, justifyContent: 'flex-end', gap: 10, paddingBottom: 32 }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 44, lineHeight: 46, letterSpacing: -1 }}>add your{'\n'}friends</Text>
          <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 17 }}>then hold their photo to talk</Text>
        </View>
        <Button title="add friends" onPress={() => router.push('/add')} />
      </View>
    );
  }

  const hearing = !!talkingTo[friend.id];
  const others = friends.filter((f) => f.id !== friend.id);
  const bubble = note ?? (talking ? 'talking…' : hearing ? `${nameOf(friend).toLowerCase()} is talking` : friend.dnd ? 'do not disturb' : friend.online ? 'hold to talk' : 'offline');
  const lead = W / 2 - (SEL + 14) / 2 - GAP - PLUS;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Backdrop friend={friend} talking={talking} />
      <View style={{ paddingTop: insets.top + 2, paddingHorizontal: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
        <TopButton g="settings" onPress={() => router.push('/settings')} />
        <TopButton g={me?.dnd ? 'muted' : 'sound'} onPress={toggleDnd} />
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ alignItems: 'center', gap: 12, paddingHorizontal: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable onPress={poke} hitSlop={10}>
            <Animated.Text style={[{ fontSize: 30 }, wiggleStyle]}>👋</Animated.Text>
          </Pressable>
          <Pressable onPress={() => { Haptics.selectionAsync(); setSheet(true); }} hitSlop={10} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, opacity: pressed ? 0.6 : 1 })}>
            <Swap text={nameOf(friend)} style={{ color: '#fff', fontFamily: F.black, fontSize: 32, letterSpacing: -0.5 }} />
            <View style={{ opacity: 0.85, marginTop: 4 }}><Glyph g="down" size={16} /></View>
          </Pressable>
        </View>
        <Bubble text={bubble} />
      </View>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: insets.bottom + 6 }} contentContainerStyle={{ paddingLeft: lead, paddingRight: 24, paddingVertical: 10, alignItems: 'center', gap: GAP }}>
        <Animated.View layout={MOVE}>{plus}</Animated.View>
        <Animated.View key={friend.id} layout={MOVE}>
          <GestureDetector gesture={hold}>
            <View collapsable={false}><TalkAvatar friend={friend} talking={talking} hearing={hearing} /></View>
          </GestureDetector>
        </Animated.View>
        {others.map((f) => (
          <Animated.View key={f.id} layout={MOVE}>
            <Squish onPress={() => { Haptics.selectionAsync(); set({ selectedId: f.id }); scroll.current?.scrollTo({ x: 0, animated: true }); }} style={{ opacity: f.online || talkingTo[f.id] ? 1 : 0.75 }}>
              <Avatar user={f} size={AV} ring={!!talkingTo[f.id]} />
              <Dot friend={f} />
            </Squish>
          </Animated.View>
        ))}
      </ScrollView>
      {sheet ? <FriendSheet friend={friend} onClose={() => setSheet(false)} onWave={poke} /> : null}
    </View>
  );
}
