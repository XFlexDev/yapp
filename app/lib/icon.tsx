import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView } from 'expo-symbols';
import { drawnIcon } from './drawn';
import { createContext, useContext, useEffect, useState } from 'react';
import { Pressable, Text, View, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { F } from './theme';

/** Kept for callers; the drawn icons carry their own motion. */
export type Move = 'bounce' | 'spin' | 'left' | 'right' | 'up' | 'down' | 'wiggle';

// Counts the taps of the nearest pressable, so the icons inside it know when to play.
const Pulse = createContext(0);
export const PulseProvider = Pulse.Provider;
export function usePulse(): [number, () => void] {
  const [n, setN] = useState(0);
  return [n, () => setN((v) => v + 1)];
}

/**
 * An icon that plays its line animation once whenever the pressable around it is tapped.
 * Builds with react-native-svg draw the animated Lucide version; older builds show the plain SF Symbol / Material icon.
 */
export function Icon({ sf, md, size = 20, mdSize, color = '#fff', weight = 'bold' }: { sf: string; md: string; size?: number; mdSize?: number; color?: string; weight?: 'medium' | 'semibold' | 'bold'; move?: Move }) {
  const tick = useContext(Pulse);
  const Drawn = drawnIcon(sf);
  if (Drawn) return <Drawn tick={tick} size={size} color={color} />;
  return <SymbolView name={sf as any} tintColor={color} size={size} weight={weight} fallback={<MaterialCommunityIcons name={md as any} size={mdSize ?? size + 3} color={color} />} />;
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
