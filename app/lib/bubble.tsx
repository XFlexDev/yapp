import { type ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, cancelAnimation, interpolateColor, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { C, F } from './theme';

/** iOS renders a uniform `scale` transform pixelated (facebook/react-native#48673); separate X/Y scales stay sharp. */
function sxy(v: number) {
  'worklet';
  return [{ scaleX: v }, { scaleY: v }];
}


const DARK = '#1a1a1a';
const MORPH = { damping: 17, stiffness: 260, mass: 1 };
const JELLY = { damping: 8, stiffness: 220, mass: 1 };
const PAD = 22;
const ICON = 22;
const DOTS = 22;
const BAND = 52;
const label = { fontFamily: F.black, fontSize: 17, letterSpacing: -0.2 } as const;

/** One liquid pill: white "hold to talk" -> dark "slide up to lock" -> red as you slide. Width stretches past its target and settles, the body wobbles like a drop, labels melt into each other and the tail gets sucked back in. */
export function Bubble({ text, lock, lift, icon, loading = false }: { text: string; lock: boolean; lift: { value: number }; icon: ReactNode; loading?: boolean }) {
  const m = useSharedValue(lock ? 1 : 0);
  const j = useSharedValue(0);
  const tw = useSharedValue(-1);
  const x = useSharedValue(1);
  const ld = useSharedValue(loading ? 1 : 0);
  const sh = useSharedValue(0);
  const dt = useSharedValue(0);
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

  useEffect(() => {
    ld.value = withSpring(loading ? 1 : 0, MORPH);
    if (loading) {
      sh.value = 0;
      sh.value = withRepeat(withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.quad) }), -1, false);
      dt.value = 0;
      dt.value = withRepeat(withTiming(1, { duration: 1050, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(sh);
      cancelAnimation(dt);
    }
  }, [loading]);

  const measure = (w: number) => { tw.value = tw.value < 0 ? w : withSpring(w, MORPH); };

  const body = useAnimatedStyle(() => {
    const l = lift.value * m.value;
    return { transform: [{ translateY: -l * 16 }, { scaleX: 1 + j.value * 0.1 - l * 0.02 }, { scaleY: 1 - j.value * 0.14 + l * 0.08 }] };
  });
  const pill = useAnimatedStyle(() => ({
    width: Math.max(0, tw.value) + PAD * 2 + Math.max(0, m.value) * ICON + Math.max(0, ld.value) * DOTS,
    opacity: tw.value < 0 ? 0 : 1,
    backgroundColor: interpolateColor(m.value, [0, 1], ['#ffffff', DARK]),
  }));
  const tail = useAnimatedStyle(() => {
    const k = Math.min(1, Math.max(0, m.value));
    return { backgroundColor: interpolateColor(m.value, [0, 1], ['#ffffff', DARK]), transform: [{ translateY: -k * 11 }, { scaleX: 1 - k * 0.55 }, { scaleY: 1 + Math.sin(k * Math.PI) * 0.5 }, { rotate: '45deg' }] };
  });
  const red = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, lift.value * m.value)) }));
  const redTail = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, lift.value * m.value)) }));
  const lockIn = useAnimatedStyle(() => ({ width: Math.max(0, m.value) * ICON, opacity: Math.min(1, Math.max(0, m.value)), transform: [...sxy(0.4 + Math.min(1, Math.max(0, m.value)) * 0.6)] }));
  const inText = useAnimatedStyle(() => ({
    color: interpolateColor(m.value, [0, 1], ['#000000', '#ffffff']),
    opacity: x.value,
    transform: [
      { translateX: -Math.max(0, ld.value) * DOTS / 2 },
      { translateY: (1 - x.value) * 4 },
    ],
  }));
  const outText = useAnimatedStyle(() => ({
    color: interpolateColor(m.value, [0, 1], ['#000000', '#ffffff']),
    opacity: 1 - Math.min(1, x.value * 1.6),
    transform: [
      { translateX: -Math.max(0, ld.value) * DOTS / 2 },
      { translateY: -x.value * 4 },
    ],
  }));

  const dots = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, ld.value)) }));
  const band = useAnimatedStyle(() => {
    const w = Math.max(0, tw.value) + PAD * 2 + DOTS;
    return { opacity: Math.min(1, Math.max(0, ld.value)), transform: [{ translateX: -BAND + sh.value * (w + BAND) }, { skewX: '-18deg' }] };
  });

  return (
    <Animated.View style={[{ alignItems: 'center', transformOrigin: '50% 100%' }, body]}>
      <Text style={[label, styles.measure]} onLayout={(e) => measure(e.nativeEvent.layout.width)}>{cur}</Text>
      <Animated.View style={[styles.pill, pill]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.red }, red]} />
        <Animated.View style={[{ overflow: 'hidden', alignItems: 'flex-start' }, lockIn]}>{icon}</Animated.View>
        <View style={{ flex: 1, height: 34, justifyContent: 'center' }}>
          {prev !== null && <Animated.Text style={[label, styles.layer, outText]}>{prev}</Animated.Text>}
          <Animated.Text style={[label, styles.layer, inText]}>{cur}</Animated.Text>
          <Animated.View pointerEvents="none" style={[styles.dots, dots]}>
            {[0, 1, 2].map((i) => <Dot key={i} i={i} t={dt} />)}
          </Animated.View>
        </View>
        <Animated.View pointerEvents="none" style={[styles.band, band]}>
          <LinearGradient start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </Animated.View>
      <Animated.View style={[styles.tail, tail]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.red }, redTail]} />
      </Animated.View>
    </Animated.View>
  );
}

/** One dot of "connecting...": hops in turn, then lands with a little squashy jiggle. */
function Dot({ i, t }: { i: number; t: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const p = (((t.value - i * 0.14) % 1) + 1) % 1;
    let y = 0;
    let sx = 1;
    if (p < 0.32) {
      const k = p / 0.32;
      y = -Math.sin(k * Math.PI) * 6;
      sx = 1 - Math.sin(k * Math.PI) * 0.12;
    } else if (p < 0.58) {
      const k = (p - 0.32) / 0.26;
      const d = 1 - k;
      y = Math.sin(k * Math.PI * 3) * 1.4 * d;
      sx = 1 + Math.sin(k * Math.PI * 3) * 0.28 * d;
    }
    return { transform: [{ translateY: y }, { scaleX: sx }, { scaleY: 2 - sx }] };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  dots: { position: 'absolute', right: 0, top: 0, bottom: 0, width: DOTS, paddingLeft: 2, paddingTop: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#000' },
  band: { position: 'absolute', left: 0, top: -6, bottom: -6, width: BAND },
  measure: { position: 'absolute', opacity: 0, left: -9999, top: 0 },
  pill: { zIndex: 2, height: 44, paddingHorizontal: PAD, borderRadius: 22, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  layer: { position: 'absolute', width: 320, left: '50%', marginLeft: -160, textAlign: 'center' },
  tail: { zIndex: 1, width: 14, height: 14, borderRadius: 3, marginTop: -8, overflow: 'hidden' },
});
