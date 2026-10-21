import { useEffect, useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { F } from './theme';

const W = Dimensions.get('window').width;
const BG = '#FF1F1F';
const WORD = ['y', 'a', 'p', 'p'];
const STEP = 85;
const DROP = { damping: 15, stiffness: 190, mass: 0.9 };
let played = false;

function Letter({ ch, i }: { ch: string; i: number }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withDelay(i * STEP, withSpring(1, DROP)); }, []);
  const st = useAnimatedStyle(() => ({
    opacity: Math.min(1, t.value * 3),
    transform: [{ translateX: (1 - t.value) * W * 0.7 }, { translateY: (1 - t.value) * -28 }],
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
    out.value = withDelay(WORD.length * STEP + 650, withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) scheduleOnRN(done);
    }));
  }, []);
  const fade = useAnimatedStyle(() => ({ opacity: 1 - out.value }));
  const word = useAnimatedStyle(() => ({ transform: [{ scale: 1 + out.value * 0.08 }] }));
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
  letter: { color: '#fff', fontFamily: F.black, fontSize: 92, letterSpacing: -2, includeFontPadding: false },
});
