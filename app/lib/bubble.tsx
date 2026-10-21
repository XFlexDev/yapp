import { type ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { C, F } from './theme';

const DARK = '#1a1a1a';
const MORPH = { damping: 17, stiffness: 260, mass: 1 };
const JELLY = { damping: 8, stiffness: 220, mass: 1 };
const PAD = 16;
const ICON = 21;
const label = { fontFamily: F.black, fontSize: 15 } as const;

/** One liquid pill: white "hold to talk" -> dark "slide up to lock" -> red as you slide. Width stretches past its target and settles, the body wobbles like a drop, labels melt into each other and the tail gets sucked back in. */
export function Bubble({ text, lock, lift, icon }: { text: string; lock: boolean; lift: { value: number }; icon: ReactNode }) {
  const m = useSharedValue(lock ? 1 : 0);
  const j = useSharedValue(0);
  const tw = useSharedValue(-1);
  const x = useSharedValue(1);
  const [cur, setCur] = useState(text);
  const [prev, setPrev] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    m.value = withSpring(lock ? 1 : 0, MORPH);
    if (first.current) { first.current = false; return; }
    j.value = withSequence(withTiming(1, { duration: 110, easing: Easing.out(Easing.quad) }), withSpring(0, JELLY));
  }, [lock]);

  useEffect(() => {
    if (text === cur) return;
    setPrev(cur);
    setCur(text);
    x.value = 0;
    x.value = withTiming(1, { duration: 260, easing: Easing.bezier(0.23, 1, 0.32, 1) });
  }, [text]);

  const measure = (w: number) => { tw.value = tw.value < 0 ? w : withSpring(w, MORPH); };

  const body = useAnimatedStyle(() => {
    const l = lift.value * m.value;
    return { transform: [{ translateY: -l * 16 }, { scaleX: 1 + j.value * 0.1 - l * 0.02 }, { scaleY: 1 - j.value * 0.14 + l * 0.08 }] };
  });
  const pill = useAnimatedStyle(() => ({
    width: Math.max(0, tw.value) + PAD * 2 + Math.max(0, m.value) * ICON,
    opacity: tw.value < 0 ? 0 : 1,
    backgroundColor: interpolateColor(m.value, [0, 1], ['#ffffff', DARK]),
  }));
  const tail = useAnimatedStyle(() => {
    const k = Math.min(1, Math.max(0, m.value));
    return { backgroundColor: interpolateColor(m.value, [0, 1], ['#ffffff', DARK]), transform: [{ translateY: -k * 11 }, { scaleX: 1 - k * 0.55 }, { scaleY: 1 + Math.sin(k * Math.PI) * 0.5 }, { rotate: '45deg' }] };
  });
  const red = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, lift.value * m.value)) }));
  const redTail = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, lift.value * m.value)) }));
  const lockIn = useAnimatedStyle(() => ({ width: Math.max(0, m.value) * ICON, opacity: Math.min(1, Math.max(0, m.value)), transform: [{ scale: 0.4 + Math.min(1, Math.max(0, m.value)) * 0.6 }] }));
  const inText = useAnimatedStyle(() => ({ color: interpolateColor(m.value, [0, 1], ['#000000', '#ffffff']), opacity: x.value, transform: [{ translateY: (1 - x.value) * 7 }, { scale: 0.86 + x.value * 0.14 }] }));
  const outText = useAnimatedStyle(() => ({ color: interpolateColor(m.value, [0, 1], ['#000000', '#ffffff']), opacity: 1 - Math.min(1, x.value * 1.6), transform: [{ translateY: -x.value * 7 }, { scale: 1 - x.value * 0.14 }] }));

  return (
    <Animated.View style={[{ alignItems: 'center', transformOrigin: '50% 100%' }, body]}>
      <Text style={[label, styles.measure]} onLayout={(e) => measure(e.nativeEvent.layout.width)}>{cur}</Text>
      <Animated.View style={[styles.pill, pill]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.red }, red]} />
        <Animated.View style={[{ overflow: 'hidden', alignItems: 'flex-start' }, lockIn]}>{icon}</Animated.View>
        <View style={{ flex: 1, height: 34, justifyContent: 'center' }}>
          {prev !== null && <Animated.Text style={[label, styles.layer, outText]}>{prev}</Animated.Text>}
          <Animated.Text style={[label, styles.layer, inText]}>{cur}</Animated.Text>
        </View>
      </Animated.View>
      <Animated.View style={[styles.tail, tail]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.red }, redTail]} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  measure: { position: 'absolute', opacity: 0, left: -9999, top: 0 },
  pill: { zIndex: 2, height: 34, paddingHorizontal: PAD, borderRadius: 17, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  layer: { position: 'absolute', width: 300, left: '50%', marginLeft: -150, textAlign: 'center' },
  tail: { zIndex: 1, width: 13, height: 13, borderRadius: 3, marginTop: -9, overflow: 'hidden' },
});
