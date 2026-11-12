import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView, type AnimationSpec } from 'expo-symbols';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, Text, View, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { F } from './theme';

/** How an icon answers a tap. Each plays once and settles; nothing loops. */
export type Move = 'bounce' | 'spin' | 'left' | 'right' | 'up' | 'down' | 'wiggle';

// Counts the taps of the nearest pressable, so the icons inside it know when to play.
const Pulse = createContext(0);
export const PulseProvider = Pulse.Provider;
export function usePulse(): [number, () => void] {
  const [n, setN] = useState(0);
  return [n, () => setN((v) => v + 1)];
}

const BACK = { damping: 14, stiffness: 260, mass: 0.7 };
const BOUNCE: AnimationSpec = { effect: { type: 'bounce', wholeSymbol: true, direction: 'up' } };

/** An SF Symbol (Material icon on Android) that plays its move once whenever the pressable around it is tapped. */
export function Icon({ sf, md, size = 20, mdSize, color = '#fff', weight = 'bold', move = 'bounce' }: { sf: string; md: string; size?: number; mdSize?: number; color?: string; weight?: 'medium' | 'semibold' | 'bold'; move?: Move }) {
  const tick = useContext(Pulse);
  // iOS plays the system's own symbol bounce; the other moves are transforms on both platforms.
  const native = Platform.OS === 'ios' && move === 'bounce';
  const [spec, setSpec] = useState<AnimationSpec | undefined>(undefined);
  const t = useSharedValue(0);
  const turn = useSharedValue(0);
  useEffect(() => {
    if (!tick) return;
    if (native) {
      setSpec({ ...BOUNCE });
      const timer = setTimeout(() => setSpec(undefined), 700);
      return () => clearTimeout(timer);
    }
    if (move === 'spin') turn.value = withSpring(turn.value + 90, { damping: 16, stiffness: 180, mass: 0.8 });
    else if (move === 'wiggle') t.value = withSequence(withTiming(-1, { duration: 70 }), withTiming(0.8, { duration: 90 }), withTiming(-0.5, { duration: 90 }), withSpring(0, BACK));
    else t.value = withSequence(withTiming(1, { duration: 110 }), withSpring(0, BACK));
  }, [tick]);
  const a = useAnimatedStyle(() => {
    const v = t.value;
    switch (move) {
      case 'spin': return { transform: [{ rotate: `${turn.value}deg` }] };
      case 'wiggle': return { transform: [{ rotate: `${v * 14}deg` }] };
      case 'left': return { transform: [{ translateX: -5 * v }] };
      case 'right': return { transform: [{ translateX: 5 * v }] };
      case 'up': return { transform: [{ translateY: -5 * v }] };
      case 'down': return { transform: [{ translateY: 5 * v }] };
      default: return { transform: [{ scale: 1 + 0.22 * v }] };
    }
  });
  return (
    <Animated.View style={a}>
      <SymbolView name={sf as any} tintColor={color} size={size} weight={weight} animationSpec={native ? spec : undefined} fallback={<MaterialCommunityIcons name={md as any} size={mdSize ?? size + 3} color={color} />} />
    </Animated.View>
  );
}

/** A Pressable whose icons animate when it is tapped. */
export function Tap({ onPress, children, ...rest }: PressableProps) {
  const [tick, bump] = usePulse();
  return (
    <PulseProvider value={tick}>
      <Pressable {...rest} onPress={(e) => { bump(); onPress?.(e); }}>{children}</Pressable>
    </PulseProvider>
  );
}

/** Segmented control whose highlight slides to the picked option. */
export function Segmented<T extends string>({ options, value, onChange, label, height = 36 }: { options: readonly T[]; value: T; onChange: (v: T) => void; label?: (v: T) => string; height?: number }) {
  const [w, setW] = useState(0);
  const i = Math.max(0, options.indexOf(value));
  const x = useSharedValue(i);
  useEffect(() => { x.value = withSpring(i, { damping: 30, stiffness: 320, mass: 0.8 }); }, [i]);
  const seg = w > 6 ? (w - 6) / options.length : 0;
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * seg }] }));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', padding: 3, borderRadius: 14, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.06)' }}>
      {seg > 0 ? <Animated.View style={[{ position: 'absolute', top: 3, left: 3, width: seg, height, borderRadius: 11, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.14)' }, thumb]} /> : null}
      {options.map((o) => (
        <Pressable key={o} onPress={() => { if (o !== value) onChange(o); }} style={{ flex: 1, height, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: o === value ? '#fff' : 'rgba(255,255,255,0.5)', fontFamily: F.black, fontSize: 15 }}>{label ? label(o) : o}</Text>
        </Pressable>
      ))}
    </View>
  );
}
