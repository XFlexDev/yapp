import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, SlideInDown, SlideOutDown, cancelAnimation, interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, avatarUrl, nameOf, req, type Friend, type Me } from '../lib/api';
import { removeFriend, set, useStore } from '../lib/store';
import { C, F, SWATCH } from '../lib/theme';
import { Logo, SPRING, Squish, Swap } from '../lib/tt';
import { Avatar, Button } from '../lib/ui';
import { acceptCall, endCall, focusFriend, lockCall, pressTalk, releaseTalk, setMuted } from '../lib/voice';

const HAND = require('../assets/tt/hand.png');
const ZZ = require('../assets/tt/zz.png');
const { width: W, height: H } = Dimensions.get('window');
const AV = 54;
const SEL = 76;
const PLUS = 48;
const GAP = 14;
const LOCK_AT = 90;
const out = Easing.bezier(0.23, 1, 0.32, 1);
const DND = '#FF9F0A';
const MOON = '#5E5CE6';
const MOVE = LinearTransition.duration(320).easing(out);

const GLYPHS = {
  settings: ['gearshape.fill', 'cog'],
  plus: ['plus', 'plus'],
  sound: ['speaker.wave.2.fill', 'volume-high'],
  muted: ['speaker.slash.fill', 'volume-off'],
  down: ['chevron.down', 'chevron-down'],
  lock: ['lock.fill', 'lock'],
  close: ['xmark', 'close'],
  mic: ['mic.fill', 'microphone'],
  micOff: ['mic.slash.fill', 'microphone-off'],
  phone: ['phone.fill', 'phone'],
  moon: ['moon.fill', 'moon-waning-crescent'],
} as const;

function Glyph({ g, size = 24, color = '#fff' }: { g: keyof typeof GLYPHS; size?: number; color?: string }) {
  const [sf, md] = GLYPHS[g];
  return <SymbolView name={sf as any} tintColor={color} size={size} weight="bold" fallback={<MaterialCommunityIcons name={md as any} size={size + 2} color={color} />} />;
}

function TopButton({ g, onPress }: { g: keyof typeof GLYPHS; onPress: () => void }) {
  return (
    <Squish onPress={onPress} style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
      <Glyph g={g} size={31} />
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

function Zzz() {
  const f = useSharedValue(0);
  useEffect(() => { f.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true); }, []);
  const big = useAnimatedStyle(() => ({ transform: [{ translateY: -f.value * 4 }, { rotate: '-12deg' }] }));
  const small = useAnimatedStyle(() => ({ transform: [{ translateY: f.value * 3 }, { rotate: '-12deg' }] }));
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} pointerEvents="none" style={{ position: 'absolute', right: -14, top: -20 }}>
      <Animated.View style={[{ marginLeft: 8 }, big]}><Image source={ZZ} style={{ width: 24, height: 24 }} /></Animated.View>
      <Animated.View style={[{ marginTop: -2 }, small]}><Image source={ZZ} style={{ width: 16, height: 16 }} /></Animated.View>
    </Animated.View>
  );
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
      {friend.dnd ? <Zzz /> : <Dot friend={friend} size={18} />}
    </Animated.View>
  );
}

/** Big sticker-style counter: white digits with a thick black outline. */
function Counter({ n }: { n: number }) {
  const pop = useSharedValue(1);
  useEffect(() => { pop.value = withSequence(withTiming(1.08, { duration: 50 }), withSpring(1, SPRING)); }, [n]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }, { rotate: '-4deg' }] }));
  const t = String(n);
  const size = t.length > 4 ? 84 : t.length > 3 ? 100 : 116;
  const base = { fontFamily: F.black, fontSize: size, lineHeight: size * 1.15, letterSpacing: -2, textAlign: 'center' as const };
  const o = Math.round(size * 0.07);
  const offs = [[-o, 0], [o, 0], [0, -o], [0, o], [-o * 0.7, -o * 0.7], [o * 0.7, -o * 0.7], [-o * 0.7, o * 0.7], [o * 0.7, o * 0.7], [0, o * 1.6]];
  return (
    <Animated.View style={[{ alignItems: 'center', justifyContent: 'center' }, a]}>
      {offs.map(([x, y], i) => <Text key={i} style={[base, { position: 'absolute', color: '#000', transform: [{ translateX: x }, { translateY: y }] }]}>{t}</Text>)}
      <Text style={[base, { color: '#fff' }]}>{t}</Text>
    </Animated.View>
  );
}

type Pt = { x: number; y: number };
const BIG = 170;

/** The poke: a big 3D hand waving hard, with a trail of hands curving back to the poke button. */
function Hands({ from }: { from: Pt }) {
  const r = useSharedValue(0);
  useEffect(() => { r.value = withRepeat(withSequence(withTiming(1, { duration: 90, easing: Easing.inOut(Easing.quad) }), withTiming(-1, { duration: 90, easing: Easing.inOut(Easing.quad) })), -1, true); }, []);
  const big = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 16}deg` }] }));
  const trail = useAnimatedStyle(() => ({ transform: [{ rotate: `${-r.value * 10}deg` }] }));
  const to = { x: W * 0.52, y: H * 0.42 };
  const ctrl = { x: from.x - 50, y: (from.y + to.y) / 2 + 30 };
  const pts = Array.from({ length: 7 }, (_, i) => {
    const k = i / 7;
    const x = (1 - k) ** 2 * from.x + 2 * (1 - k) * k * ctrl.x + k * k * to.x;
    const y = (1 - k) ** 2 * from.y + 2 * (1 - k) * k * ctrl.y + k * k * to.y;
    return { x, y, s: 30 + k * 80, o: 0.5 + k * 0.5 };
  });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pts.map((h, i) => (
        <Animated.View key={i} style={[{ position: 'absolute', left: h.x - h.s / 2, top: h.y - h.s / 2, opacity: h.o }, trail]}>
          <Image source={HAND} style={{ width: h.s, height: h.s }} />
        </Animated.View>
      ))}
      <Animated.View style={[{ position: 'absolute', left: to.x - BIG / 2, top: to.y - BIG / 2 }, big]}>
        <Image source={HAND} style={{ width: BIG, height: BIG }} />
      </Animated.View>
      <View style={{ position: 'absolute', left: to.x - BIG / 2 - 22, top: to.y - BIG / 2 - 10, width: 70, height: 70, borderRadius: 35, borderTopWidth: 5, borderLeftWidth: 5, borderColor: '#fff', transform: [{ rotate: '8deg' }] }} />
      <View style={{ position: 'absolute', left: to.x - BIG / 2 - 36, top: to.y - BIG / 2 + 14, width: 50, height: 50, borderRadius: 25, borderLeftWidth: 4, borderColor: '#fff', opacity: 0.8 }} />
    </View>
  );
}

function PokeBurst({ n, from }: { n: number; from: Pt }) {
  return (
    <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(260)} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Hands from={from} />
      <View style={{ position: 'absolute', top: H * 0.42 - BIG / 2 - 150, left: 0, right: 0, alignItems: 'center' }}><Counter n={n} /></View>
    </Animated.View>
  );
}

function DndPill() {
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingLeft: 6, paddingRight: 16, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: MOON, alignItems: 'center', justifyContent: 'center' }}><Glyph g="moon" size={15} /></View>
      <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 16 }}>do not disturb</Text>
    </Animated.View>
  );
}

function LockHint({ lift }: { lift: { value: number } }) {
  const pill = useAnimatedStyle(() => ({
    transform: [{ translateY: -lift.value * 18 }, { scale: 1 + lift.value * 0.15 }],
    backgroundColor: interpolateColor(lift.value, [0, 1], ['rgba(0,0,0,0.55)', C.red]),
  }));
  const label = useAnimatedStyle(() => ({ opacity: interpolate(lift.value, [0, 0.6], [1, 0]) }));
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={{ alignItems: 'center', gap: 8, height: 76, justifyContent: 'flex-end' }}>
      <Animated.Text style={[{ color: '#fff', fontFamily: F.black, fontSize: 14 }, label]}>slide up to lock</Animated.Text>
      <Animated.View style={[{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, pill]}>
        <Glyph g="lock" size={17} />
      </Animated.View>
    </Animated.View>
  );
}

function Round({ g, bg, onPress, size = 64 }: { g: keyof typeof GLYPHS; bg: string; onPress: () => void; size?: number }) {
  return (
    <Squish onPress={onPress} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Glyph g={g} size={size * 0.38} color={bg === '#fff' ? '#000' : '#fff'} />
    </Squish>
  );
}

function CallBar({ incoming, muted, onMute, onEnd, onAccept }: { incoming: boolean; muted: boolean; onMute: () => void; onEnd: () => void; onAccept: () => void }) {
  return (
    <Animated.View entering={SlideInDown.duration(320).easing(out)} exiting={FadeOut.duration(200)} style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28, height: SEL + 34 }}>
      {incoming ? (
        <>
          <Round g="close" bg={C.red} onPress={onEnd} size={72} />
          <Round g="phone" bg={C.online} onPress={onAccept} size={72} />
        </>
      ) : (
        <>
          <Round g={muted ? 'micOff' : 'mic'} bg={muted ? '#fff' : 'rgba(255,255,255,0.2)'} onPress={onMute} size={52} />
          <Round g="close" bg={C.red} onPress={onEnd} size={72} />
          <View style={{ width: 52 }} />
        </>
      )}
    </Animated.View>
  );
}

function FriendSheet({ friend, onClose, onPoke }: { friend: Friend; onClose: () => void; onPoke: () => void }) {
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
      <Animated.View entering={SlideInDown.duration(340).easing(out)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, borderRadius: 32, borderCurve: 'continuous', backgroundColor: '#1C1C1E', paddingTop: 24, paddingBottom: 6, alignItems: 'stretch' }}>
        <View style={{ alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Avatar user={friend} size={64} />
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 20 }}>{nameOf(friend)}</Text>
            {friend.username ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 14 }}>@{friend.username}</Text> : null}
          </View>
        </View>
        {row('poke', () => { onClose(); onPoke(); })}
        {row(sure ? 'tap again to remove' : 'remove friend', remove, C.danger)}
        {row('close', onClose, 'rgba(255,255,255,0.5)')}
      </Animated.View>
    </View>
  );
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const { friends, selectedId, talkingTo, incoming, me, pokedAt, pokeCount, call } = useStore();
  const friend = useMemo(() => friends.find((f) => f.id === (call?.friendId ?? selectedId)) ?? friends[0], [friends, selectedId, call?.friendId]);
  const [talking, setTalking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [burst, setBurst] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [, tick] = useState(0);
  const scroll = useRef<any>(null);
  const handRef = useRef<any>(null);
  const [origin, setOrigin] = useState<Pt>({ x: W * 0.35, y: H * 0.78 });
  const locked = useRef(false);
  const lift = useSharedValue(0);
  const wiggle = useSharedValue(0);
  const wiggleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${wiggle.value}deg` }] }));
  const pk = useRef<{ n: number; to: string | null; repeat?: ReturnType<typeof setTimeout>; send?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout>; play?: ReturnType<typeof setInterval> }>({ n: 0, to: null });

  useEffect(() => { if (friend) focusFriend(friend.id); }, [friend?.id]);
  useEffect(() => {
    const id = Object.keys(talkingTo).find((k) => talkingTo[k]);
    if (id && !talking && !call) set({ selectedId: id });
  }, [talkingTo]);
  useEffect(() => { if (note) { const t = setTimeout(() => setNote(null), 2200); return () => clearTimeout(t); } }, [note]);
  useEffect(() => {
    if (call) return;
    if (locked.current) { locked.current = false; setTalking(false); }
    setMutedState(false);
    lift.value = withTiming(0, { duration: 160 });
  }, [call]);
  useEffect(() => { if (call?.state === 'active') { const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); } }, [call?.state]);
  useEffect(() => () => { const p = pk.current; clearTimeout(p.repeat); clearTimeout(p.send); clearTimeout(p.hide); clearInterval(p.play); }, []);

  const shake = () => { wiggle.value = withSequence(withTiming(-18, { duration: 90 }), withTiming(16, { duration: 120 }), withTiming(-10, { duration: 110 }), withSpring(0, SPRING)); };
  const hideBurst = (ms: number) => { const p = pk.current; clearTimeout(p.hide); p.hide = setTimeout(() => setBurst(0), ms); };

  // Someone poked me: replay their burst, counting up to their total.
  useEffect(() => {
    if (!friend || !pokedAt[friend.id] || Date.now() - pokedAt[friend.id] > 1500) return;
    const total = pokeCount[friend.id] ?? 1;
    const p = pk.current;
    shake();
    setNote(`${nameOf(friend).toLowerCase()} poked you`);
    clearInterval(p.play);
    let i = 0;
    const steps = Math.min(total, 40);
    p.play = setInterval(() => {
      i++;
      setBurst(Math.round((total * i) / steps));
      if (i % 4 === 0) Haptics.selectionAsync();
      if (i >= steps) { clearInterval(p.play); hideBurst(900); }
    }, Math.max(25, Math.min(90, 1400 / steps)));
  }, [friend && pokedAt[friend.id]]);

  const flushPokes = () => {
    const p = pk.current;
    const n = p.n, to = p.to;
    p.n = 0;
    if (!n || !to) return;
    req('/v1/poke', { method: 'POST', body: { friend_id: to, count: n } })
      .then(() => setNote(n > 1 ? `poked ×${n}` : 'poked'))
      .catch((e) => { if (!(e instanceof ApiError) || e.status !== 429) setNote(String(e.message).toLowerCase()); });
  };
  const bump = () => {
    const p = pk.current;
    p.n++;
    setBurst((b) => b + 1);
    if (p.n % 3 === 1) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearTimeout(p.send); clearTimeout(p.hide);
  };
  const pokeDown = () => {
    if (!friend) return;
    const p = pk.current;
    clearInterval(p.play);
    if (p.to !== friend.id) { flushPokes(); p.to = friend.id; setBurst(0); }
    shake();
    bump();
    let delay = 150;
    const loop = () => { p.repeat = setTimeout(() => { bump(); delay = Math.max(30, delay * 0.86); loop(); }, delay); };
    p.repeat = setTimeout(loop, 260);
  };
  const pokeUp = () => {
    const p = pk.current;
    clearTimeout(p.repeat);
    p.send = setTimeout(flushPokes, 700);
    hideBurst(1100);
  };
  const pokeOnce = () => { pokeDown(); pokeUp(); };

  const start = () => {
    if (!friend || call) return;
    if (friend.dnd) { setNote('do not disturb'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); return; }
    locked.current = false;
    lift.value = 0;
    setTalking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    pressTalk(friend.id).catch((e) => { setTalking(false); if (locked.current) endCall(); setNote((e instanceof ApiError || e instanceof Error ? e.message : 'couldn’t connect').toLowerCase()); });
  };
  const lock = () => {
    if (!friend || locked.current || !talking) return;
    locked.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    lift.value = withSpring(1, SPRING);
    lockCall(friend.id).catch((e) => { locked.current = false; setTalking(false); releaseTalk(friend.id); setNote(String(e?.message ?? 'couldn’t call').toLowerCase()); });
  };
  const stop = () => {
    if (!friend || !talking || locked.current) return;
    setTalking(false);
    lift.value = withTiming(0, { duration: 160 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    releaseTalk(friend.id);
  };
  const hold = Gesture.Pan().activateAfterLongPress(80).runOnJS(true)
    .onStart(start)
    .onUpdate((e) => { if (locked.current) return; const v = Math.min(1, Math.max(0, -e.translationY / LOCK_AT)); lift.value = v; if (v >= 1) lock(); })
    .onFinalize(stop);

  const accept = () => acceptCall().catch((e) => { setNote(String(e?.message ?? 'couldn’t connect').toLowerCase()); endCall(); });
  const toggleMute = () => { Haptics.selectionAsync(); const m = !muted; setMutedState(m); setMuted(m); };

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
  const live = talking || call?.state === 'active';
  const others = friends.filter((f) => f.id !== friend.id);
  const secs = call?.state === 'active' ? Math.floor((Date.now() - call.since) / 1000) : 0;
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const bubble = call?.state === 'incoming' ? `${nameOf(friend).toLowerCase()} is calling`
    : call?.state === 'outgoing' ? 'calling…'
    : call?.state === 'active' ? clock
    : note ?? (talking ? 'talking…' : hearing ? `${nameOf(friend).toLowerCase()} is talking` : friend.dnd ? 'do not disturb' : friend.online ? 'hold to talk' : 'offline');
  const lead = W / 2 - (SEL + 14) / 2 - GAP - PLUS;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Backdrop friend={friend} talking={live} />
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
        <TopButton g="settings" onPress={() => router.push('/settings')} />
        <TopButton g={me?.dnd ? 'muted' : 'sound'} onPress={toggleDnd} />
      </View>
      {friend.dnd ? <View style={{ marginTop: 6 }}><DndPill /></View> : null}
      {burst ? <PokeBurst n={burst} from={origin} /> : null}
      <View style={{ flex: 1 }} />
      <View style={{ alignItems: 'center', gap: 12, paddingHorizontal: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable ref={handRef} onLayout={() => handRef.current?.measureInWindow((x: number, y: number, w: number, h: number) => setOrigin({ x: x + w / 2, y: y + h / 2 }))} onPressIn={pokeDown} onPressOut={pokeUp} hitSlop={12}>
            <Animated.View style={wiggleStyle}><Image source={HAND} style={{ width: 36, height: 36 }} /></Animated.View>
          </Pressable>
          <Pressable onPress={() => { Haptics.selectionAsync(); setSheet(true); }} hitSlop={10} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, opacity: pressed ? 0.6 : 1 })}>
            <Swap text={nameOf(friend)} style={{ color: '#fff', fontFamily: F.black, fontSize: 32, letterSpacing: -0.5 }} />
            <View style={{ opacity: 0.85, marginTop: 4 }}><Glyph g="down" size={16} /></View>
          </Pressable>
        </View>
        {talking && !call ? <LockHint lift={lift} /> : <Bubble text={bubble} />}
      </View>
      {call && call.state !== 'outgoing' ? (
        <View style={{ marginBottom: insets.bottom + 6, paddingVertical: 10 }}>
          <CallBar incoming={call.state === 'incoming'} muted={muted} onMute={toggleMute} onEnd={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); endCall(); }} onAccept={accept} />
        </View>
      ) : call ? (
        <View style={{ marginBottom: insets.bottom + 6, paddingVertical: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28 }}>
          <View style={{ width: 52 }} />
          <TalkAvatar friend={friend} talking hearing={hearing} />
          <Round g="close" bg={C.red} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); endCall(); }} size={52} />
        </View>
      ) : (
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
      )}
      {sheet ? <FriendSheet friend={friend} onClose={() => setSheet(false)} onPoke={pokeOnce} /> : null}
    </View>
  );
}
