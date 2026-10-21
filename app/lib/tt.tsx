import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, Linking, Platform, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, interpolateColor, SlideInDown, useAnimatedKeyboard, SlideOutDown, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F } from './theme';

export const RED = '#FE0000';
export const FILL = 'rgba(255,255,255,0.22)';
export const GHOST = 'rgba(255,255,255,0.45)';

function Sym({ sf, md, size = 26 }: { sf: string; md: string; size?: number }) {
  return <SymbolView name={sf as any} tintColor="#fff" size={size} weight="bold" fallback={<MaterialCommunityIcons name={md as any} size={size + 4} color="#fff" />} />;
}

export const SPRING = { damping: 15, stiffness: 210, mass: 0.9 };
const PRESS = { damping: 14, stiffness: 520 };

export function slide(dir: number) {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateX: dir * 80 }, { scale: 0.94 }] },
      animations: { opacity: withTiming(1, { duration: 200 }), transform: [{ translateX: withSpring(0, SPRING) }, { scale: withSpring(1, SPRING) }] },
    };
  };
}
export function slideOut(dir: number) {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 1, transform: [{ translateX: 0 }, { scale: 1 }] },
      animations: { opacity: withTiming(0, { duration: 160 }), transform: [{ translateX: withSpring(-dir * 80, SPRING) }, { scale: withSpring(0.94, SPRING) }] },
    };
  };
}
export const rise = (delay = 0) => FadeInDown.springify().damping(14).stiffness(200).delay(delay);

export function Squish({ children, onPress, disabled, style }: { children: ReactNode; onPress: () => void; disabled?: boolean; style?: any }) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable disabled={disabled} onPress={onPress} onPressIn={() => { s.value = withSpring(0.93, PRESS); }} onPressOut={() => { s.value = withSpring(1, { damping: 9, stiffness: 320 }); }}>
      <Animated.View style={[style, a]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Pill({ title, onPress, disabled, loading, ghost }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; ghost?: boolean }) {
  const white = !ghost && !disabled;
  const p = useSharedValue(white ? 1 : 0);
  const g = useSharedValue(ghost ? 1 : 0);
  useEffect(() => { p.value = withSpring(white ? 1 : 0, SPRING); g.value = withTiming(ghost ? 1 : 0, { duration: 200 }); }, [white, ghost]);
  const bg = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(p.value, [0, 1], [FILL, '#ffffff']) }));
  const fg = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [interpolateColor(g.value, [0, 1], [GHOST, '#ffffff']), '#000000']) }));
  return (
    <Squish disabled={disabled || loading} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }} style={[{ height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, bg]}>
      {loading ? <Animated.View entering={ZoomIn.springify().damping(12)}><ActivityIndicator color={white ? '#000' : '#fff'} /></Animated.View> : (
        <Animated.Text key={title} entering={FadeInDown.springify().damping(13).stiffness(260)} exiting={FadeOut.duration(90)} style={[{ fontFamily: F.black, fontSize: 17 }, fg]}>{title}</Animated.Text>
      )}
    </Squish>
  );
}

export function Collapse({ open, height, children }: { open: boolean; height: number; children: ReactNode }) {
  const v = useSharedValue(open ? 1 : 0);
  useEffect(() => { v.value = withSpring(open ? 1 : 0, SPRING); }, [open]);
  const a = useAnimatedStyle(() => ({ height: Math.max(0, v.value) * height, opacity: v.value, transform: [{ scale: 0.9 + 0.1 * v.value }] }));
  return <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[{ overflow: 'hidden' }, a]}>{children}</Animated.View>;
}

export function useShake() {
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const shake = () => { x.value = withSequence(withTiming(-12, { duration: 50 }), withSpring(0, { damping: 4, stiffness: 600, velocity: 600 })); };
  return { style, shake };
}

function Fade({ show, children }: { show: boolean; children: ReactNode }) {
  const v = useSharedValue(show ? 1 : 0);
  useEffect(() => { v.value = withSpring(show ? 1 : 0, SPRING); }, [show]);
  const a = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.6 + 0.4 * v.value }] }));
  return <Animated.View pointerEvents={show ? 'auto' : 'none'} style={a}>{children}</Animated.View>;
}

function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  if (!open) return null;
  const row = (t: string, on: () => void, dim?: boolean) => (
    <Pressable onPress={on} style={({ pressed }) => ({ height: 54, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
      <Text style={{ color: dim ? 'rgba(255,255,255,0.5)' : '#fff', fontFamily: F.bold, fontSize: 17 }}>{t}</Text>
    </Pressable>
  );
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(200)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <Animated.View entering={SlideInDown.springify().damping(24).stiffness(260)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, borderRadius: 32, borderCurve: 'continuous', backgroundColor: '#1C1C1E', paddingTop: 24, paddingBottom: 6 }}>
        <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 20, textAlign: 'center' }}>send feedback</Text>
        <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.regular, fontSize: 14, textAlign: 'center', marginTop: 4, marginBottom: 10 }}>let’s improve the app together!</Text>
        {row('email us', () => { onClose(); Linking.openURL('mailto:info@kreatix.dev?subject=yapp'); })}
        {row('close', onClose, true)}
      </Animated.View>
    </View>
  );
}

export function RedScreen({ children, onBack, help = true, bar = true }: { children: ReactNode; onBack?: () => void; help?: boolean; bar?: boolean }) {
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState(false);
  const kb = useAnimatedKeyboard();
  const bottom = Math.max(insets.bottom, 12);
  const pad = useAnimatedStyle(() => ({ paddingBottom: Platform.OS === 'ios' ? Math.max(kb.height.value + 10, bottom) : bottom }));
  return (
    <View style={{ flex: 1, backgroundColor: RED }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 14, height: insets.top + 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Fade show={bar && !!onBack}><Squish onPress={() => onBack?.()} style={{ width: 40, height: 40, justifyContent: 'center' }}><Sym sf="chevron.left" md="chevron-left" size={22} /></Squish></Fade>
        <Fade show={bar && help}><Squish onPress={() => { Keyboard.dismiss(); setSheet(true); }} style={{ width: 40, height: 40, alignItems: 'flex-end', justifyContent: 'center' }}><Sym sf="questionmark.circle" md="help-circle-outline" size={26} /></Squish></Fade>
      </View>
      <Animated.View style={[{ flex: 1 }, pad]}>{children}</Animated.View>
      <HelpSheet open={sheet} onClose={() => setSheet(false)} />
    </View>
  );
}

export function Label({ children }: { children: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 22 }}>{children}</Text>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff' }} />
    </View>
  );
}

export function Heading({ children }: { children: string }) {
  return <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 30, lineHeight: 36, textAlign: 'center', letterSpacing: -0.3 }}>{children}</Text>;
}

export const bigInput = { color: '#fff', fontFamily: F.black, fontSize: 30, textAlign: 'center' as const, minWidth: 60, paddingVertical: 4 };

export function Logo({ size = 170 }: { size?: number }) {
  const t = { fontFamily: F.black, fontSize: size, lineHeight: size * 1.15, includeFontPadding: false } as const;
  const w = size * 0.05;
  const rings = Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2) * w, Math.sin((i / 16) * Math.PI * 2) * w]);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-10deg' }] }}>
      {rings.map(([x, y], i) => <Text key={i} style={[t, { color: '#000', position: 'absolute', transform: [{ translateX: x + w * 1.1 }, { translateY: y + w * 1.3 }] }]}>y</Text>)}
      {rings.map(([x, y], i) => <Text key={'o' + i} style={[t, { color: '#000', position: 'absolute', transform: [{ translateX: x }, { translateY: y }] }]}>y</Text>)}
      <Text style={[t, { color: '#fff' }]}>y</Text>
    </View>
  );
}
