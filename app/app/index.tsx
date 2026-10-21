import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, SlideInDown, SlideOutDown, cancelAnimation, interpolate, interpolateColor, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { ApiError, avatarUrl, nameOf, pfpUrl, req, type Friend, type Me } from '../lib/api';
import { clearPokeCount, removeFriend, set, useStore } from '../lib/store';
import { C, F, SWATCH } from '../lib/theme';
import { Logo, SPRING, Squish, Swap } from '../lib/tt';
import { Avatar, Button } from '../lib/ui';
import { Bubble } from '../lib/bubble';
import { LocalVideo, RemoteVideo } from '../lib/callvideo';
import { block, report, REASONS } from '../lib/safety';
import { acceptCall, endCall, focusFriend, lockCall, pressTalk, releaseTalk, setCamera, setMuted } from '../lib/voice';

/** iOS renders a uniform `scale` transform pixelated (facebook/react-native#48673); separate X/Y scales stay sharp. */
function sxy(v: number) {
  'worklet';
  return [{ scaleX: v }, { scaleY: v }];
}


const ZZ = require('../assets/tt/zz.png');
const { width: W, height: H } = Dimensions.get('window');
const AV = 54;
const SEL = 76;
const PLUS = 48;
const GAP = 14;
const LOCK_AT = 90;
const SLOT = 80;
const MIN = AV / SEL;
const SNAP = { damping: 34, stiffness: 260, mass: 1 };
const PLUS_X = 16;
const FADE_AT = PLUS_X + PLUS + 14;
const out = Easing.bezier(0.23, 1, 0.32, 1);
const DND = '#FF9F0A';
const MOON = '#5E5CE6';
const MOVE = LinearTransition.duration(320).easing(out);

function relativeTalkedAt(at: number) {
  const minutes = Math.floor(Math.max(0, Date.now() - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

const GLYPHS = {
  settings: ['gearshape.fill', 'cog'],
  video: ['video.fill', 'video'],
  videoOff: ['video.slash.fill', 'video-off'],
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
  chat: ['bubble.left.fill', 'chat'],
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

function Backdrop({ friend }: { friend: Friend }) {
  const seq = useRef(0);
  const [layers, setLayers] = useState<{ f: Friend; k: number }[]>([{ f: friend, k: 0 }]);
  useEffect(() => {
    setLayers((l) => {
      const top = l[l.length - 1];
      if (top.f.id === friend.id) return top.f === friend ? l : [...l.slice(0, -1), { f: friend, k: top.k }];
      return [...l, { f: friend, k: ++seq.current }].slice(-3);
    });
  }, [friend]);
  const settle = (k: number) => setLayers((l) => { const i = l.findIndex((x) => x.k === k); return i > 0 ? l.slice(i) : l; });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {layers.map((x, i) => <Layer key={x.k} friend={x.f} fade={i > 0} onIn={() => settle(x.k)} />)}
      <LinearGradient colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']} locations={[0, 0.14, 0.55, 0.8, 1]} style={StyleSheet.absoluteFill} />
    </View>
  );
}

function Layer({ friend, fade, onIn }: { friend: Friend; fade: boolean; onIn: () => void }) {
  const url = avatarUrl(friend);
  const hue = SWATCH[friend.color] ?? C.red;
  const o = useSharedValue(fade ? 0 : 1);
  useEffect(() => {
    if (fade) o.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }, (done) => { if (done) scheduleOnRN(onIn); });
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: url ? '#000' : hue }, st]}>
      {url ? <Image source={url} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" priority="high" /> : (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingBottom: '30%' }]}>
          <Logo ch={nameOf(friend).slice(0, 1).toLowerCase()} size={190} />
        </View>
      )}
    </Animated.View>
  );
}

function Fresh({ text, style }: { text: string; style: any }) {
  return <Animated.Text key={text} entering={FadeIn.duration(150)} style={style}>{text}</Animated.Text>;
}

function Dot({ friend, size = 14 }: { friend: Friend; size?: number }) {
  if (!friend.online && !friend.dnd) return null;
  const inner = size - 6;
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={{ position: 'absolute', right: 1, top: 1, width: size, height: size, borderRadius: size / 2, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: friend.dnd ? DND : C.online }} />
    </Animated.View>
  );
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

const RING = SEL + 14;

/** Every size here is real layout driven by `focus` on the UI thread, never a scale transform, so iOS always draws it at native resolution. */
function TalkAvatar({ friend, talking, hearing, pokeAt, pokeSquish, focus }: { friend: Friend; talking: boolean; hearing: boolean; pokeAt: number; pokeSquish: SharedValue<number>; focus: SharedValue<number> }) {
  const press = useSharedValue(0);
  const ripple = useSharedValue(0);
  const hear = useSharedValue(hearing ? 1 : 0);
  const bump = useSharedValue(0);
  useEffect(() => { press.value = withSpring(talking ? 1 : 0, SPRING); }, [talking]);
  useEffect(() => {
    if (pokeAt) bump.value = withSequence(withTiming(1, { duration: 110, easing: Easing.out(Easing.quad) }), withSpring(0, SPRING));
  }, [pokeAt]);
  useEffect(() => {
    hear.value = withTiming(hearing ? 1 : 0, { duration: 200 });
    if (hearing) ripple.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);
    else { cancelAnimation(ripple); ripple.value = withTiming(0, { duration: 200 }); }
  }, [hearing]);
  const url = pfpUrl(friend);
  const k = useDerivedValue(() => MIN + (1 - MIN) * focus.value);
  const body = useAnimatedStyle(() => {
    const s = RING * k.value;
    return { width: s, height: s, transform: sxy((1 + press.value * 0.1 + bump.value * 0.07) * pokeSquish.value) };
  });
  const round = useAnimatedStyle(() => ({ borderRadius: (RING * k.value) / 2 }));
  const ring = useAnimatedStyle(() => ({ opacity: focus.value, borderWidth: 3 + focus.value, borderColor: interpolateColor(press.value, [0, 1], ['#ffffff', C.red]) }));
  const wave = useAnimatedStyle(() => ({ opacity: hear.value * (1 - ripple.value) * 0.6, transform: sxy(1 + ripple.value * 0.25) }));
  const face = useAnimatedStyle(() => { const s = SEL * k.value; return { width: s, height: s, borderRadius: s / 2 }; });
  const letter = useAnimatedStyle(() => ({ fontSize: SEL * k.value * 0.42 }));
  const dot = useAnimatedStyle(() => { const s = 16 + 4 * focus.value; return { width: s, height: s, borderRadius: s / 2 }; });
  return (
    <View style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ alignItems: 'center', justifyContent: 'center' }, body]}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderWidth: 2, borderColor: '#fff' }, round, wave]} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, round, ring]} />
        <Animated.View style={[{ overflow: 'hidden', backgroundColor: SWATCH[friend.color] ?? C.red, alignItems: 'center', justifyContent: 'center' }, face]}>
          {url ? (
            <Image source={url} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} cachePolicy="memory-disk" recyclingKey={friend.id} />
          ) : (
            <Animated.Text style={[{ color: '#fff', fontFamily: F.black }, letter]}>{nameOf(friend).slice(0, 1).toUpperCase()}</Animated.Text>
          )}
        </Animated.View>
        {friend.dnd ? <Zzz /> : friend.online ? (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={[{ position: 'absolute', right: 1, top: 1, backgroundColor: '#000', padding: 3 }, dot]}>
            <View style={{ flex: 1, borderRadius: 99, backgroundColor: C.online }} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}

function Slot({ i, x, dim, badge, sel, dir, cp, ca, children }: { i: number; x: SharedValue<number>; dim: boolean; badge: number; sel: boolean; dir: number; cp: SharedValue<number>; ca: SharedValue<number>; children: (focus: SharedValue<number>) => React.ReactNode }) {
  const focus = useDerivedValue(() => 1 - Math.min(1, Math.abs(x.value - i * SLOT) / SLOT));
  const st = useAnimatedStyle(() => {
    const k = sel ? 1 - 0.4 * ca.value : 1 - 0.3 * cp.value;
    return { transform: [{ translateX: sel ? 0 : dir * 36 * cp.value }, ...sxy(k)] };
  });
  const edge = useAnimatedStyle(() => {
    const cx = W / 2 + i * SLOT - x.value;
    const gone = sel ? ca.value : cp.value;
    return { opacity: Math.max(0, Math.min(1, (cx - FADE_AT) / 34)) * (dim ? 0.75 : 1) * Math.max(0, 1 - gone * 1.4) };
  });
  const r = Math.round(((SEL + 14) * MIN) / 2);
  return (
    <Animated.View style={[{ width: SLOT, height: SEL + 14, alignItems: 'center', justifyContent: 'center' }, edge]}>
      <Animated.View style={st}>{children(focus)}</Animated.View>
      <View pointerEvents="none" style={{ position: 'absolute', top: (SEL + 14) / 2 - r, left: SLOT / 2 - r, width: r * 2, height: r * 2 }}>
        <PokeBadge count={badge} />
      </View>
    </Animated.View>
  );
}
function PokeBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} pointerEvents="none" style={{ position: 'absolute', top: -5, right: -8, minWidth: 22, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#000', fontFamily: F.black, fontSize: 11 }}>×{count}</Text>
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

function Round({ g, bg, onPress, size = 64 }: { g: keyof typeof GLYPHS; bg: string; onPress: () => void; size?: number }) {
  return (
    <Squish onPress={onPress} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Glyph g={g} size={size * 0.38} color={bg === '#fff' ? '#000' : '#fff'} />
    </Squish>
  );
}

const MORPH = { damping: 24, stiffness: 260, mass: 0.9 };
const BTN = 72;

function CallControls({ cp, ca, on, incoming, muted, cam, onMute, onCam, onEnd, onAccept }: { cp: SharedValue<number>; ca: SharedValue<number>; on: boolean; incoming: boolean; muted: boolean; cam: boolean; onMute: () => void; onCam: () => void; onEnd: () => void; onAccept: () => void }) {
  const inc = incoming ? 1 : 0;
  const end = useAnimatedStyle(() => ({
    opacity: Math.min(1, cp.value * 1.5),
    transform: [{ translateX: interpolate(ca.value, [0, 1], [SLOT, inc ? -50 : 0]) }, ...sxy(Math.max(0, cp.value) * interpolate(ca.value, [0, 1], [52 / BTN, 1]))]
  }));
  const left = useAnimatedStyle(() => ({ opacity: Math.max(0, ca.value), transform: [{ translateX: -SLOT * ca.value }, ...sxy(0.4 + 0.6 * ca.value)] }));
  const right = useAnimatedStyle(() => ({ opacity: Math.max(0, ca.value), transform: [{ translateX: (inc ? 50 : SLOT) * ca.value }, ...sxy(0.4 + 0.6 * ca.value)] }));
  const at = { position: 'absolute' as const, left: W / 2 - BTN / 2, top: (SEL + 34) / 2 - BTN / 2, width: BTN, height: BTN, alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <View pointerEvents={on ? 'box-none' : 'none'} style={StyleSheet.absoluteFill}>
      {incoming ? null : <Animated.View style={[at, left]}><Round g={muted ? 'micOff' : 'mic'} bg={muted ? '#fff' : 'rgba(255,255,255,0.2)'} onPress={onMute} size={52} /></Animated.View>}
      <Animated.View style={[at, right]}>
        {incoming ? <Round g="phone" bg={C.online} onPress={onAccept} size={BTN} /> : <Round g={cam ? 'video' : 'videoOff'} bg={cam ? '#fff' : 'rgba(255,255,255,0.2)'} onPress={onCam} size={52} />}
      </Animated.View>
      <Animated.View style={[at, end]}><Round g="close" bg={C.red} onPress={onEnd} size={BTN} /></Animated.View>
    </View>
  );
}

function FriendSheet({ friend, onClose }: { friend: Friend; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [sure, setSure] = useState<'remove' | 'block' | null>(null);
  const [mode, setMode] = useState<'main' | 'report' | 'reported'>('main');
  const [busy, setBusy] = useState(false);
  const confirm = (k: 'remove' | 'block') => { if (sure === k) return true; Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); setSure(k); return false; };
  const remove = async () => {
    if (!confirm('remove')) return;
    setBusy(true);
    try { await req(`/v1/friends/${friend.id}`, { method: 'DELETE' }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); removeFriend(friend.id); onClose(); }
    catch { setBusy(false); setSure(null); }
  };
  const doBlock = async () => {
    if (!confirm('block')) return;
    setBusy(true);
    try { await block(friend.id); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onClose(); }
    catch { setBusy(false); setSure(null); }
  };
  const doReport = async (reason: string) => {
    setBusy(true);
    try { await report(friend.id, reason); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setMode('reported'); }
    catch { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
    finally { setBusy(false); }
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
        {mode === 'report' ? (
          <>
            {REASONS.map((r) => <View key={r}>{row(r, () => doReport(r))}</View>)}
            {row('back', () => setMode('main'), 'rgba(255,255,255,0.5)')}
          </>
        ) : (
          <>
            {mode === 'reported'
              ? <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.bold, fontSize: 15, textAlign: 'center', paddingHorizontal: 24, paddingVertical: 8 }}>thanks, we’ll look at it. you can also block them.</Text>
              : row('report', () => setMode('report'))}
            {mode === 'main' ? row('reorder friends', () => { onClose(); router.push('/order'); }) : null}
            {row(sure === 'block' ? 'tap again to block' : 'block', doBlock, C.danger)}
            {mode === 'main' ? row(sure === 'remove' ? 'tap again to remove' : 'remove friend', remove, C.danger) : null}
            {row('close', onClose, 'rgba(255,255,255,0.5)')}
          </>
        )}
      </Animated.View>
    </View>
  );
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const { friends, selectedId, talkingTo, incoming, me, call, chats, groups, pokedAt, pokedCount, pokeCount } = useStore();
  const cam = useStore((s) => !!s.cams.local);
  const unreadAll = Object.values(chats).reduce((n, c) => n + c.unread, 0) + Object.values(groups).reduce((n, g) => n + g.unread, 0);
  const friend = useMemo(() => friends.find((f) => f.id === (call?.friendId ?? selectedId)) ?? friends[0], [friends, selectedId, call?.friendId]);
  const [talking, setTalking] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showConnecting, setShowConnecting] = useState(false);
  const pressSeq = useRef(0);
  const connectingRef = useRef(false);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bottomH, setBottomH] = useState(0);
  const back = useSharedValue(0);
  const cp = useSharedValue(call ? 1 : 0);
  const ca = useSharedValue(call && call.state !== 'outgoing' ? 1 : 0);
  const lastCall = useRef(call);
  if (call) lastCall.current = call;
  const stage = useAnimatedStyle(() => ({ borderRadius: back.value * 44, transform: [...sxy(1 - back.value * 0.08)] }));
  const [note, setNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [incomingPoke, setIncomingPoke] = useState<{ friendId: string; count: number; at: number } | null>(null);
  const [pendingPokeCounts, setPendingPokeCounts] = useState<Record<string, number>>({});
  const pendingPokes = useRef<Record<string, { count: number; timer: ReturnType<typeof setTimeout> }>>({});
  const locked = useRef(false);
  const lift = useSharedValue(0);
  const pokeSquish = useSharedValue(1);
  const one = useSharedValue(1);
  const list = useRef(friends);
  list.current = friends;
  const selRef = useRef(friend?.id);
  selRef.current = friend?.id;
  const selIdx = friend ? Math.max(0, friends.findIndex((f) => f.id === friend.id)) : 0;
  const count = friends.length;
  const sx = useSharedValue(selIdx * SLOT);
  const from = useSharedValue(0);
  const fling = useSharedValue(false);
  const track = useAnimatedStyle(() => ({ transform: [{ translateX: -sx.value }] }));
  const choose = (i: number) => {
    const f = list.current[i];
    if (!f || f.id === selRef.current) return;
    set({ selectedId: f.id });
    clearPokeCount(f.id);
  };
  const buzz = () => { Haptics.selectionAsync(); };
  useAnimatedReaction(() => Math.round(sx.value / SLOT), (i, prev) => {
    if (prev !== null && i !== prev && fling.value && i >= 0 && i < count) scheduleOnRN(buzz);
  }, [count]);
  const maxX = Math.max(0, (count - 1) * SLOT);
  const swipe = Gesture.Pan().enabled(!talking && !call && count > 1).activeOffsetX([-8, 8]).failOffsetY([-14, 14])
    .onStart(() => { cancelAnimation(sx); fling.value = true; from.value = sx.value; })
    .onUpdate((e) => { const v = from.value - e.translationX; sx.value = v < 0 ? v * 0.3 : v > maxX ? maxX + (v - maxX) * 0.3 : v; })
    .onEnd((e) => {
      const i = Math.max(0, Math.min(Math.round((sx.value - e.velocityX * 0.2) / SLOT), count - 1));
      scheduleOnRN(choose, i);
      sx.value = withSpring(i * SLOT, { ...SNAP, velocity: Math.max(-1200, Math.min(1200, -e.velocityX)) }, () => { fling.value = false; });
    });
  const jump = (i: number) => {
    if (talking || call) return;
    Haptics.selectionAsync();
    choose(i);
  };
  useEffect(() => {
    if (!friend || call || fling.value) return;
    sx.value = withSpring(selIdx * SLOT, SNAP);
  }, [friend?.id, selIdx, !!call]);
  useEffect(() => {
    if (!friend) return;
    const t = setTimeout(() => focusFriend(friend.id), 220);
    return () => clearTimeout(t);
  }, [friend?.id]);
  useEffect(() => {
    const id = Object.keys(talkingTo).find((k) => talkingTo[k]);
    if (id && !talking && !call) { set({ selectedId: id }); clearPokeCount(id); }
  }, [talkingTo]);
  useEffect(() => {
    if (!friend) { setIncomingPoke(null); return; }
    const at = pokedAt[friend.id] ?? 0;
    if (!at || at + 2500 <= Date.now()) { setIncomingPoke(null); return; }
    setIncomingPoke({ friendId: friend.id, count: pokedCount[friend.id] || 1, at });
    const timer = setTimeout(() => setIncomingPoke((current) => current?.at === at ? null : current), at + 2500 - Date.now());
    return () => clearTimeout(timer);
  }, [friend?.id, pokedAt[friend?.id ?? ''], pokedCount[friend?.id ?? '']]);
  useEffect(() => { back.value = withSpring(talking || call ? 1 : 0, SPRING); }, [talking, !!call]);
  useEffect(() => {
    cp.value = withSpring(call ? 1 : 0, MORPH);
    ca.value = withSpring(call && call.state !== 'outgoing' ? 1 : 0, MORPH);
  }, [call?.state]);
  useEffect(() => { if (note) { const t = setTimeout(() => setNote(null), 2200); return () => clearTimeout(t); } }, [note]);
  useEffect(() => {
    if (call) return;
    if (locked.current) { locked.current = false; setTalking(false); }
    setMutedState(false);
    lift.value = withTiming(0, { duration: 160 });
  }, [call]);

  const setConnectingState = (v: boolean) => {
    connectingRef.current = v;
    if (!v && connectTimer.current) { clearTimeout(connectTimer.current); connectTimer.current = null; }
    setConnecting(v);
    setShowConnecting(false);
  };
  const start = () => {
    if (!friend || call) return;
    if (friend.dnd) { setNote('do not disturb'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); return; }
    locked.current = false;
    lift.value = 0;
    const seq = ++pressSeq.current;
    setTalking(true);
    setConnectingState(true);
    connectTimer.current = setTimeout(() => { if (pressSeq.current === seq && connectingRef.current) setShowConnecting(true); }, 150);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pressTalk(friend.id).then(() => {
      if (pressSeq.current !== seq) return;
      setConnectingState(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }).catch((e) => { if (pressSeq.current === seq) setConnectingState(false); setTalking(false); if (locked.current) endCall(); setNote((e instanceof ApiError || e instanceof Error ? e.message : 'couldn’t connect').toLowerCase()); });
  };
  const lock = () => {
    if (!friend || locked.current || !talking || connectingRef.current) return;
    locked.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    lift.value = withSpring(1, SPRING);
    lockCall(friend.id).catch((e) => { locked.current = false; setTalking(false); releaseTalk(friend.id); setNote(String(e?.message ?? 'couldn’t call').toLowerCase()); });
  };
  const stop = () => {
    if (!friend || !talking || locked.current) return;
    pressSeq.current++;
    setConnectingState(false);
    setTalking(false);
    lift.value = withTiming(0, { duration: 160 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    releaseTalk(friend.id);
  };
  const hold = Gesture.Pan().activateAfterLongPress(200).runOnJS(true)
    .onStart(start)
    .onUpdate((e) => { if (locked.current) return; const v = Math.min(1, Math.max(0, -e.translationY / LOCK_AT)); lift.value = v; if (v >= 1) lock(); })
    .onFinalize(stop);
  const flushPokes = (friendId: string) => {
    const batch = pendingPokes.current[friendId];
    if (!batch) return;
    clearTimeout(batch.timer);
    delete pendingPokes.current[friendId];
    setPendingPokeCounts((counts) => { const next = { ...counts }; delete next[friendId]; return next; });
    req('/v1/poke', { method: 'POST', body: { friend_id: friendId, count: batch.count } }).catch((e) => {
      setNote((e instanceof ApiError || e instanceof Error ? e.message : 'couldn’t send poke').toLowerCase());
    });
  };
  const poke = () => {
    if (!friend || call) return;
    if (friend.dnd) { setNote('do not disturb'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pokeSquish.value = withSequence(withTiming(0.94, { duration: 70 }), withSpring(1, SPRING));
    const previous = pendingPokes.current[friend.id];
    if (previous) clearTimeout(previous.timer);
    const count = (previous?.count ?? 0) + 1;
    const timer = setTimeout(() => flushPokes(friend.id), 900);
    pendingPokes.current[friend.id] = { count, timer };
    setPendingPokeCounts((counts) => ({ ...counts, [friend.id]: count }));
  };
  const tap = Gesture.Tap().maxDuration(190).runOnJS(true).onEnd((_event, success) => { if (success) poke(); });
  const avatarGesture = Gesture.Race(hold, tap);

  const accept = () => acceptCall().catch((e) => { setNote(String(e?.message ?? 'couldn’t connect').toLowerCase()); endCall(); });
  const toggleMute = () => { Haptics.selectionAsync(); const m = !muted; setMutedState(m); setMuted(m); };
  const toggleCam = () => { Haptics.selectionAsync(); setCamera(!cam).catch((e) => setNote(String(e?.message ?? 'camera failed').toLowerCase())); };

  const toggleDnd = () => {
    Haptics.selectionAsync();
    const next = !me?.dnd;
    set((s) => ({ me: s.me ? { ...s.me, dnd: next } : s.me }));
    req<Me>('/v1/status', { method: 'PUT', body: { dnd: next } }).then((m) => set({ me: m })).catch(() => set((s) => ({ me: s.me ? { ...s.me, dnd: !next } : s.me })));
  };

  const plusSt = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - cp.value * 1.4), transform: [...sxy(1 - 0.3 * cp.value)] }));
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
  const incomingPokeText = incomingPoke?.friendId === friend.id ? `poked you${incomingPoke.count > 1 ? ` ×${incomingPoke.count}` : ''}` : null;
  const pendingPokeCount = pendingPokeCounts[friend.id] ?? 0;
  const friendActivity = [friend.streak > 0 ? `${friend.streak}` : '', friend.last_talked_at > 0 ? `talked ${relativeTalkedAt(friend.last_talked_at)}` : ''].filter(Boolean).join(' · ');
  const bubble = call?.state === 'incoming' ? `${nameOf(friend).toLowerCase()} is calling`
    : call?.state === 'outgoing' ? 'calling…'
    : call?.state === 'active' ? 'on call'
    : talking && connecting ? (showConnecting ? 'connecting' : 'hold to talk') : talking ? 'slide up to lock' : hearing ? `${nameOf(friend).toLowerCase()} is talking` : note ?? incomingPokeText ?? (pendingPokeCount ? `poke${pendingPokeCount > 1 ? ` ×${pendingPokeCount}` : ''}` : friend.dnd ? 'do not disturb' : friend.online ? 'hold to talk' : 'offline');

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, stage]}>
      <Backdrop friend={friend} />
      {call?.state === 'active' ? <RemoteVideo id={friend.id} /> : null}
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
        <TopButton g="settings" onPress={() => router.push('/settings')} />
        <View style={{ flexDirection: 'row' }}>
          <View>
            <TopButton g="chat" onPress={() => router.push('/inbox')} />
            {unreadAll ? (
              <Animated.View pointerEvents="none" entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={{ position: 'absolute', top: 8, right: 6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 11 }}>{unreadAll > 99 ? '99+' : unreadAll}</Text>
              </Animated.View>
            ) : null}
          </View>
          <TopButton g={me?.dnd ? 'muted' : 'sound'} onPress={toggleDnd} />
        </View>
      </View>
      {friend.dnd ? <View style={{ marginTop: 6 }}><DndPill /></View> : null}
      {call?.state === 'active' ? <LocalVideo top={insets.top + 64} /> : null}
      <View style={{ flex: 1 }} />
      <View style={{ alignItems: 'center', gap: 12, paddingHorizontal: 24, marginBottom: bottomH + 12, opacity: bottomH ? 1 : 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => { Haptics.selectionAsync(); setSheet(true); }} hitSlop={10} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, opacity: pressed ? 0.6 : 1 })}>
            <Fresh text={nameOf(friend)} style={{ color: '#fff', fontFamily: F.black, fontSize: 32, letterSpacing: -0.5 }} />
            <View style={{ opacity: 0.85, marginTop: 4 }}><Glyph g="down" size={16} /></View>
          </Pressable>
        </View>
        {friendActivity ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            {friend.streak > 0 && <Image source={require('../assets/fire.png')} style={{ width: 17, height: 17 }} />}
            <Fresh text={friendActivity} style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.regular, fontSize: 14 }} />
          </View>
        ) : null}
      </View>
      </Animated.View>
      <View pointerEvents="none" style={{ flex: 1 }} />
      <View onLayout={(e) => setBottomH(e.nativeEvent.layout.height)}>
      <View style={{ alignItems: 'center', paddingHorizontal: 24 }}>
        <Bubble text={bubble} lock={talking && !connecting && !call} loading={talking && showConnecting && !call} lift={lift} icon={<Glyph g="lock" size={14} />} />
      </View>
        <GestureDetector gesture={swipe}>
        <View style={{ marginBottom: insets.bottom + 6, height: SEL + 34 }}>
        <Animated.View style={[{ position: 'absolute', left: W / 2 - SLOT / 2, top: 10, flexDirection: 'row' }, track]}>
          {friends.map((f, i) => {
            const sel = f.id === friend.id;
            return (
              <Slot key={f.id} i={i} x={sx} sel={sel} dir={Math.sign(i - selIdx)} cp={cp} ca={ca} dim={!sel && !(f.online || talkingTo[f.id])} badge={sel ? 0 : pokeCount[f.id] ?? 0}>
                {(focus) => (
                  <GestureDetector gesture={sel ? avatarGesture : Gesture.Tap().runOnJS(true).onEnd((_e, ok) => { if (ok) jump(i); })}>
                    <View collapsable={false}>
                      <TalkAvatar friend={f} talking={sel && (talking || !!call)} hearing={!!talkingTo[f.id]} pokeAt={sel ? pokedAt[f.id] ?? 0 : 0} pokeSquish={sel ? pokeSquish : one} focus={focus} />
                    </View>
                  </GestureDetector>
                )}
              </Slot>
            );
          })}
        </Animated.View>
        <Animated.View pointerEvents={call ? 'none' : 'box-none'} style={[{ position: 'absolute', left: PLUS_X, top: 0, bottom: 0, justifyContent: 'center' }, plusSt]}>{plus}</Animated.View>
        <CallControls cp={cp} ca={ca} on={!!call} incoming={(call ?? lastCall.current)?.state === 'incoming'} muted={muted} cam={cam} onCam={toggleCam} onMute={toggleMute} onEnd={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); endCall(); }} onAccept={accept} />
        </View>
        </GestureDetector>
      </View>
      {sheet ? <FriendSheet friend={friend} onClose={() => setSheet(false)} /> : null}
    </View>
  );
}
