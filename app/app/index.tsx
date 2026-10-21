import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, avatarUrl, nameOf, req, type Friend, type Me } from '../lib/api';
import { set, useStore } from '../lib/store';
import { C, F, SWATCH } from '../lib/theme';
import { Avatar, Button } from '../lib/ui';
import { focusFriend, pressTalk, releaseTalk } from '../lib/voice';

const AV = 64;
const SEL = 92;

function Icon({ name, fallback, onPress, badge }: { name: any; fallback: string; onPress: () => void; badge?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <SymbolView name={name} tintColor="#fff" size={26} weight="bold" fallback={<Text style={{ color: '#fff', fontFamily: F.black, fontSize: 24 }}>{fallback}</Text>} />
      {badge ? <View style={{ position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Text style={{ color: '#fff', fontFamily: F.black, fontSize: 11 }}>{badge}</Text></View> : null}
    </Pressable>
  );
}

function Backdrop({ friend }: { friend: Friend }) {
  const url = avatarUrl(friend);
  return (
    <Animated.View key={friend.id} entering={FadeIn.duration(220)} style={[StyleSheet.absoluteFill, { backgroundColor: SWATCH[friend.color] ?? C.red }]}>
      {url ? <Image source={url} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontFamily: F.black, fontSize: 220 }}>{nameOf(friend).slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <LinearGradient colors={['rgba(0,0,0,0.55)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 180 }} />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 360 }} />
    </Animated.View>
  );
}

function TalkAvatar({ friend, talking, hearing }: { friend: Friend; talking: boolean; hearing: boolean }) {
  const s = useSharedValue(1);
  const pulse = useSharedValue(0);
  useEffect(() => {
    s.value = withSpring(talking ? 1.12 : 1, { damping: 14, stiffness: 260 });
    pulse.value = talking || hearing ? withRepeat(withSequence(withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 520 })), -1) : withTiming(0, { duration: 150 });
  }, [talking, hearing]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const ring = useAnimatedStyle(() => ({ opacity: pulse.value * 0.7, transform: [{ scale: 1 + pulse.value * 0.18 }] }));
  return (
    <Animated.View style={a}>
      <Animated.View style={[{ position: 'absolute', inset: -6, borderRadius: SEL, borderWidth: 6, borderColor: talking ? C.red : '#fff' }, ring]} />
      <View style={{ padding: 4, borderRadius: SEL, borderWidth: 4, borderColor: talking ? C.red : '#fff' }}>
        <Avatar user={friend} size={SEL} />
      </View>
      {friend.online ? <View style={{ position: 'absolute', right: 4, bottom: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.online, borderWidth: 3, borderColor: '#000' }} /> : null}
    </Animated.View>
  );
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const { friends, selectedId, talkingTo, incoming, me, pokedAt } = useStore();
  const friend = useMemo(() => friends.find((f) => f.id === selectedId) ?? friends[0], [friends, selectedId]);
  const [talking, setTalking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => { if (friend) focusFriend(friend.id); }, [friend?.id]);
  useEffect(() => {
    const id = Object.keys(talkingTo).find((k) => talkingTo[k]);
    if (id && !talking) set({ selectedId: id });
  }, [talkingTo]);
  useEffect(() => { if (hint) { const t = setTimeout(() => setHint(null), 2200); return () => clearTimeout(t); } }, [hint]);

  const start = () => {
    if (!friend) return;
    if (friend.dnd) { setHint(`${nameOf(friend)} is on do not disturb`); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); return; }
    setTalking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    pressTalk(friend.id).catch((e) => { setTalking(false); setHint(e instanceof ApiError || e instanceof Error ? e.message : 'Couldn’t connect'); });
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
    req('/v1/poke', { method: 'POST', body: { friend_id: friend.id } }).then(() => setHint(`poked ${nameOf(friend)}`)).catch((e) => setHint(e.message));
  };

  const toggleDnd = async () => {
    Haptics.selectionAsync();
    const next = !me?.dnd;
    set((s) => ({ me: s.me ? { ...s.me, dnd: next } : s.me }));
    req<Me>('/v1/status', { method: 'PUT', body: { dnd: next } }).then((m) => set({ me: m })).catch(() => set((s) => ({ me: s.me ? { ...s.me, dnd: !next } : s.me })));
  };

  if (!friend) {
    return (
      <View style={{ flex: 1, backgroundColor: C.red, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16, paddingHorizontal: 24 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -8 }}>
          <Icon name="gearshape.fill" fallback="⋯" onPress={() => router.push('/settings')} />
          <Icon name="person.badge.plus" fallback="+" onPress={() => router.push('/add')} badge={incoming.length} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: 10 }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 44, lineHeight: 46, letterSpacing: -1 }}>add your{'\n'}friends</Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: F.bold, fontSize: 17 }}>Then hold their face to talk. They hear you instantly.</Text>
        </View>
        <Button title="Add friends" onPress={() => router.push('/add')} style={{ backgroundColor: '#000' }} />
      </View>
    );
  }

  const hearing = !!talkingTo[friend.id];
  const status = talking ? 'talking…' : hearing ? 'is talking…' : friend.dnd ? 'do not disturb' : friend.online ? 'online' : 'offline';
  const recentPoke = pokedAt[friend.id] && Date.now() - pokedAt[friend.id] < 4000;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Backdrop friend={friend} />
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Icon name="gearshape.fill" fallback="⋯" onPress={() => router.push('/settings')} />
        <View style={{ flexDirection: 'row' }}>
          <Icon name="person.badge.plus" fallback="+" onPress={() => router.push('/add')} badge={incoming.length} />
          <Icon name={me?.dnd ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} fallback={me?.dnd ? '×' : '♪'} onPress={toggleDnd} />
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ paddingHorizontal: 20, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={poke} hitSlop={8} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.85 : 1 }] })}>
            <Text style={{ fontSize: 30 }}>👋</Text>
          </Pressable>
          <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 36, letterSpacing: -0.5, flexShrink: 1 }}>{nameOf(friend)}</Text>
        </View>
        <Text style={{ color: hearing || talking ? '#fff' : 'rgba(255,255,255,0.75)', fontFamily: F.bold, fontSize: 16 }}>{recentPoke ? 'poked you' : status}</Text>
      </View>
      <View style={{ height: 170, marginTop: 16, marginBottom: insets.bottom + 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, alignItems: 'flex-end', gap: 14, paddingBottom: 8 }}>
          {friends.map((f) => f.id === friend.id ? (
            <View key={f.id} style={{ alignItems: 'center' }}>
              <View style={{ backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 10 }}>
                <Text style={{ color: '#000', fontFamily: F.black, fontSize: 14 }}>{hint ?? (talking ? 'release to stop' : hearing ? 'hold to reply' : 'hold to talk')}</Text>
              </View>
              <GestureDetector gesture={hold}>
                <View><TalkAvatar friend={f} talking={talking} hearing={hearing} /></View>
              </GestureDetector>
            </View>
          ) : (
            <Pressable key={f.id} onPress={() => { Haptics.selectionAsync(); set({ selectedId: f.id }); }} style={{ marginBottom: 16 }}>
              <Avatar user={f} size={AV} ring={!!talkingTo[f.id]} />
              {f.online ? <View style={{ position: 'absolute', right: 0, bottom: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: C.online, borderWidth: 2, borderColor: '#000' }} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
