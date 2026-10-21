import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolateColor, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { nameOf, req, type Friend } from '../lib/api';
import { set, useStore } from '../lib/store';
import { syncAll } from '../lib/realtime';
import { C, F } from '../lib/theme';
import { SPRING } from '../lib/tt';
import { Avatar } from '../lib/ui';

const ROW = 68;

type Pos = Record<string, number>;

function Row({ friend, positions, count, onLift, onMove, onDrop }: { friend: Friend; positions: SharedValue<Pos>; count: number; onLift: () => void; onMove: () => void; onDrop: () => void }) {
  const id = friend.id;
  const y = useSharedValue((positions.value[id] ?? 0) * ROW);
  const lifted = useSharedValue(0);
  const dragging = useSharedValue(false);
  const start = useSharedValue(0);
  useAnimatedReaction(() => positions.value[id], (p) => {
    if (!dragging.value && p !== undefined) y.value = withSpring(p * ROW, SPRING);
  });
  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(() => {
      dragging.value = true;
      start.value = y.value;
      lifted.value = withSpring(1, SPRING);
      scheduleOnRN(onLift);
    })
    .onUpdate((e) => {
      y.value = Math.max(0, Math.min(start.value + e.translationY, (count - 1) * ROW));
      const to = Math.max(0, Math.min(Math.round(y.value / ROW), count - 1));
      const from = positions.value[id];
      if (to === from) return;
      const next: Pos = { ...positions.value };
      for (const k in next) {
        const p = next[k];
        if (from < to && p > from && p <= to) next[k] = p - 1;
        else if (from > to && p >= to && p < from) next[k] = p + 1;
      }
      next[id] = to;
      positions.value = next;
      scheduleOnRN(onMove);
    })
    .onFinalize(() => {
      if (!dragging.value) return;
      dragging.value = false;
      y.value = withSpring(positions.value[id] * ROW, SPRING);
      lifted.value = withSpring(0, SPRING);
      scheduleOnRN(onDrop);
    });
  const st = useAnimatedStyle(() => ({
    zIndex: lifted.value > 0.01 ? 10 : 1,
    backgroundColor: interpolateColor(lifted.value, [0, 1], ['rgba(255,255,255,0)', C.surface2]),
    transform: [{ translateY: y.value }, { scale: 1 + lifted.value * 0.03 }],
  }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: ROW, borderRadius: 20, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 14 }, st]}>
        <Avatar user={friend} size={46} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 17 }} numberOfLines={1}>{nameOf(friend)}</Text>
          {friend.username ? <Text style={{ color: C.dim, fontFamily: F.regular, fontSize: 14 }} numberOfLines={1}>@{friend.username}</Text> : null}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

export default function Order() {
  const friends = useStore((s) => s.friends);
  const key = friends.map((f) => f.id).join(',');
  const positions = useSharedValue<Pos>(Object.fromEntries(friends.map((f, i) => [f.id, i])));
  useEffect(() => { positions.value = Object.fromEntries(friends.map((f, i) => [f.id, i])); }, [key]);

  const lift = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); };
  const move = () => { Haptics.selectionAsync(); };
  const drop = () => {
    const pos = positions.value;
    const sorted = [...friends].sort((a, b) => (pos[a.id] ?? 0) - (pos[b.id] ?? 0));
    if (sorted.every((f, i) => f.id === friends[i].id)) return;
    set({ friends: sorted });
    req<Friend[]>('/v1/friends/order', { method: 'PUT', body: { ids: sorted.map((f) => f.id) } })
      .then((v) => set({ friends: v }))
      .catch(() => syncAll().catch(() => {}));
  };

  return (
    <ScrollView style={{ backgroundColor: C.surface }} contentContainerStyle={{ padding: 24, paddingTop: 28, gap: 6 }}>
      <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 28 }}>friend order</Text>
      <Text style={{ color: C.dim, fontFamily: F.regular, fontSize: 15, marginBottom: 14 }}>{friends.length ? 'hold a friend and drag to move them' : 'no friends yet'}</Text>
      <View style={{ height: friends.length * ROW, marginHorizontal: -12 }}>
        {friends.map((f) => <Row key={f.id} friend={f} positions={positions} count={friends.length} onLift={lift} onMove={move} onDrop={drop} />)}
      </View>
    </ScrollView>
  );
}
