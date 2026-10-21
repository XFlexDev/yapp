import { useEffect, useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { F } from './theme';

const W = Dimensions.get('window').width;
const BG = '#FF1F1F';
const WORD = ['y', 'a', 'p', 'p'];
const STEP = 110;
const SLIDE = { duration: 460, easing: Easing.out(Easing.cubic) };
const DROP = { damping: 16, stiffness: 210, mass: 1 };
let played = false;

function Letter({ ch, i }: { ch: string; i: number }) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  useEffect(() => {
    x.value = withDelay(i * STEP, withTiming(1, SLIDE));
    y.value = withDelay(i * STEP + 60, withSpring(1, DROP));
  }, []);
  const st = useAnimatedStyle(() => ({
    opacity: Math.min(1, x.value * 4),
    transform: [{ translateX: (1 - x.value) * W * 0.6 }, { translateY: (1 - y.value) * -64 }],
  }));
  return <Animated.Text style={[s.letter, st]}>{ch}</Animated.Text>;
}

export function Intro() {
  const reduce = useReducedMotion();
  const [on, setOn] = useState(!played && !reduce);
  const out = useSharedValue(0);
  useEffect(() => {
    if (!on) return;
    played = true;
    const done = () => setOn(false);
    out.value = withDelay(WORD.length * STEP + 820, withTiming(1, { duration: 240, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) scheduleOnRN(done);
    }));
  }, []);
  const fade = useAnimatedStyle(() => ({ opacity: 1 - out.value }));
  const word = useAnimatedStyle(() => ({ transform: [{ scale: 1 + out.value * 0.06 }] }));
  if (!on) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.wrap, fade]}>
      <Animated.View style={[s.row, word]}>
        {WORD.map((c, i) => <Letter key={i} ch={c} i={i} />)}
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row' },
  letter: { color: '#fff', fontFamily: F.black, fontSize: 83, letterSpacing: -3, includeFontPadding: false },
});
