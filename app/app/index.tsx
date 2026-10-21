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
import { LocalVideo, RemoteVideo } from '../lib/callvideo';
import { block, report, REASONS } from '../lib/safety';
import { acceptCall, endCall, focusFriend, lockCall, pressTalk, releaseTalk, setCamera, setMuted } from '../lib/voice';

const ZZ = require('../assets/tt/zz.png');
const { width: W, height: H } = Dimensions.get('window');
const AV = 54;
const SEL = 76;
const PLUS = 48;
const GAP = 14;
const LOCK_AT = 90;
const GROW = 1.1;
const out = Easing.bezier(0.23, 1, 0.32, 1);
const DND = '#FF9F0A';
const MOON = '#5E5CE6';
const MOVE = LinearTransition.duration(320).easing(out);

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

function Backdrop({ friend, talking }: { friend: Friend; talking: boolean }) {
  const url = avatarUrl(friend);
  const hue = SWATCH[friend.color] ?? C.red;
  const tint = useSharedValue(0);
  useEffect(() => { tint.value = withTiming(talking ? 1 : 0, { duration: talking ? 180 : 320, easing: out }); }, [talking]);
  const red = useAnimatedStyle(() => ({ opacity: tint.value * 0.5 }));
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

const DARK = '#1a1a1a';
const MORPH = { damping: 28, stiffness: 300, mass: 1 };

/** One liquid pill: white "hold to talk" -> dark "slide up to lock" -> red as you slide. The tail is part of the same body and melts into it. */
function Bubble({ text, lock, lift }: { text: string; lock: boolean; lift: { value: number } }) {
  const m = useSharedValue(lock ? 1 : 0);
  useEffect(() => { m.value = withSpring(lock ? 1 : 0, MORPH); }, [lock]);
  const body = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value * m.value * 16 }, { scale: 1 + lift.value * m.value * 0.06 }] }));
  const pill = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(m.value, [0, 1], ['#ffffff', DARK]) }));
  const tail = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(m.value, [0, 1], ['#ffffff', DARK]), transform: [{ translateY: -m.value * 10 }, { rotate: '45deg' }, { scale: 1 - m.value * 0.5 }] }));
  const red = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, lift.value * m.value)) }));
  const redTail = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, lift.value * m.value)) }));
  const ink = useAnimatedStyle(() => ({ color: interpolateColor(m.value, [0, 1], ['#000000', '#ffffff']) }));
  const icon = useAnimatedStyle(() => ({ width: Math.max(0, m.value) * 21, opacity: Math.min(1, Math.max(0, m.value)) }));
  return (
    <Animated.View style={[{ alignItems: 'center' }, body]}>
      <Animated.View layout={LinearTransition.springify().damping(MORPH.damping).stiffness(MORPH.stiffness)} style={[{ zIndex: 2, height: 34, paddingHorizontal: 16, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, pill]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.red }, red]} />
        <Animated.View style={[{ overflow: 'hidden', alignItems: 'flex-start' }, icon]}><Glyph g="lock" size={14} /></Animated.View>
        <Swap text={text} style={[{ fontFamily: F.black, fontSize: 15 }, ink]} />
      </Animated.View>
      <Animated.View style={[{ zIndex: 1, width: 13, height: 13, borderRadius: 3, marginTop: -9, overflow: 'hidden' }, tail]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.red }, redTail]} />
      </Animated.View>
    </Animated.View>
  );
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

function TalkAvatar({ friend, talking, hearing }: { friend: Friend; talking: boolean; hearing: boolean }) {
  const press = useSharedValue(0);
  const ripple = useSharedValue(0);
  useEffect(() => { press.value = withSpring(talking ? 1 : 0, SPRING); }, [talking]);
  useEffect(() => {
    if (hearing) ripple.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);
    else { cancelAnimation(ripple); ripple.value = withTiming(0, { duration: 200 }); }
  }, [hearing]);
  const body = useAnimatedStyle(() => ({ transform: [{ scale: (1 + press.value * 0.1) / GROW }] }));
  const ring = useAnimatedStyle(() => ({ borderColor: interpolateColor(press.value, [0, 1], ['#ffffff', C.red]) }));
  const wave = useAnimatedStyle(() => ({ opacity: (1 - ripple.value) * 0.6, transform: [{ scale: 1 + ripple.value * 0.25 }] }));
  const size = Math.round((SEL + 14) * GROW);
  const box = SEL + 14;
  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
    <Animated.View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, body]}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: '#fff' }, wave]} />
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 4 }, ring]} />
      <Avatar user={friend} size={Math.round(SEL * GROW)} />
      {friend.dnd ? <Zzz /> : <Dot friend={friend} size={20} />}
    </Animated.View>
    </View>
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

function CallBar({ incoming, muted, cam, onMute, onCam, onEnd, onAccept }: { incoming: boolean; muted: boolean; cam: boolean; onMute: () => void; onCam: () => void; onEnd: () => void; onAccept: () => void }) {
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
          <Round g={cam ? 'video' : 'videoOff'} bg={cam ? '#fff' : 'rgba(255,255,255,0.2)'} onPress={onCam} size={52} />
        </>
      )}
    </Animated.View>
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
  const { friends, selectedId, talkingTo, incoming, me, call, chats, groups } = useStore();
  const cam = useStore((s) => !!s.cams.local);
  const unreadAll = Object.values(chats).reduce((n, c) => n + c.unread, 0) + Object.values(groups).reduce((n, g) => n + g.unread, 0);
  const friend = useMemo(() => friends.find((f) => f.id === (call?.friendId ?? selectedId)) ?? friends[0], [friends, selectedId, call?.friendId]);
  const [talking, setTalking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [muted, setMutedState] = useState(false);
  const scroll = useRef<any>(null);
  const locked = useRef(false);
  const lift = useSharedValue(0);
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
  const toggleCam = () => { Haptics.selectionAsync(); setCamera(!cam).catch((e) => setNote(String(e?.message ?? 'camera failed').toLowerCase())); };

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
  const bubble = call?.state === 'incoming' ? `${nameOf(friend).toLowerCase()} is calling`
    : call?.state === 'outgoing' ? 'calling…'
    : call?.state === 'active' ? 'on call'
    : talking ? 'slide up to lock' : note ?? ( hearing ? `${nameOf(friend).toLowerCase()} is talking` : friend.dnd ? 'do not disturb' : friend.online ? 'hold to talk' : 'offline');
  const lead = W / 2 - (SEL + 14) / 2 - GAP - PLUS;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Backdrop friend={friend} talking={live || !!call} />
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
      <View style={{ alignItems: 'center', gap: 12, paddingHorizontal: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => { Haptics.selectionAsync(); setSheet(true); }} hitSlop={10} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, opacity: pressed ? 0.6 : 1 })}>
            <Swap text={nameOf(friend)} style={{ color: '#fff', fontFamily: F.black, fontSize: 32, letterSpacing: -0.5 }} />
            <View style={{ opacity: 0.85, marginTop: 4 }}><Glyph g="down" size={16} /></View>
          </Pressable>
        </View>
        <Bubble text={bubble} lock={talking && !call} lift={lift} />
      </View>
      {call && call.state !== 'outgoing' ? (
        <View style={{ marginBottom: insets.bottom + 6, paddingVertical: 10 }}>
          <CallBar incoming={call.state === 'incoming'} muted={muted} cam={cam} onCam={toggleCam} onMute={toggleMute} onEnd={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); endCall(); }} onAccept={accept} />
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
      {sheet ? <FriendSheet friend={friend} onClose={() => setSheet(false)} /> : null}
    </View>
  );
}
