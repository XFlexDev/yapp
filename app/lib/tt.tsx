import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Dimensions, Keyboard, Linking, Platform, Pressable, Text, View } from 'react-native';
import Animated, { Easing, LayoutAnimationConfig, FadeIn, FadeInDown, FadeOut, interpolateColor, SlideInDown, useAnimatedKeyboard, SlideOutDown, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F } from './theme';

export const RED = '#FE0000';
export const FILL = 'rgba(255,255,255,0.22)';
export const GHOST = 'rgba(255,255,255,0.45)';

function Sym({ sf, md, size = 26 }: { sf: string; md: string; size?: number }) {
  return <SymbolView name={sf as any} tintColor="#fff" size={size} weight="bold" fallback={<MaterialCommunityIcons name={md as any} size={size + 4} color="#fff" />} />;
}

// Near-critical spring: settles with a hint of give, never wobbles.
// Critically damped: settles with a soft ease, never overshoots.
export const SPRING = { damping: 38, stiffness: 340, mass: 1 };
const PRESS = { damping: 50, stiffness: 600 };
const RELEASE = { damping: 38, stiffness: 400 };
const EASE = Easing.bezier(0.23, 1, 0.32, 1);

// Full-width push like a native nav stack: both pages stay solid and move in lockstep on one spring.
export function slide(dir: number) {
  const w = Dimensions.get('window').width;
  return () => {
    'worklet';
    return { initialValues: { transform: [{ translateX: dir * w }] }, animations: { transform: [{ translateX: withSpring(0, SPRING) }] } };
  };
}
export function slideOut(dir: number) {
  const w = Dimensions.get('window').width;
  return () => {
    'worklet';
    return { initialValues: { transform: [{ translateX: 0 }] }, animations: { transform: [{ translateX: withSpring(-dir * w, SPRING) }] } };
  };
}
export function pop(delay = 0) {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: 10 }] },
      animations: { opacity: withDelay(delay, withTiming(1, { duration: 180, easing: EASE })), transform: [{ translateY: withDelay(delay, withSpring(0, SPRING)) }] },
    };
  };
}
export function popOut() {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
      animations: { opacity: withTiming(0, { duration: 140, easing: EASE }), transform: [{ translateY: withTiming(6, { duration: 140, easing: EASE }) }] },
    };
  };
}
export const rise = (delay = 0) => FadeInDown.duration(320).easing(EASE).delay(delay);

// Crossfades text changes in place so swaps never cut.
export function Swap({ text, style }: { text: string; style?: any }) {
  const [shown, setShown] = useState(text);
  const o = useSharedValue(1);
  useEffect(() => {
    if (text === shown) { o.value = withTiming(1, { duration: 160, easing: EASE }); return; }
    o.value = withTiming(0, { duration: 70, easing: EASE });
    const t = setTimeout(() => setShown(text), 70);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => { o.value = withTiming(1, { duration: 160, easing: EASE }); }, [shown]);
  const a = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: (1 - o.value) * 4 }] }));
  return <Animated.Text style={[style, a]}>{shown}</Animated.Text>;
}

export function Squish({ children, onPress, disabled, style }: { children: ReactNode; onPress: () => void; disabled?: boolean; style?: any }) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scaleX: s.value }, { scaleY: s.value }] }));
  return (
    <Pressable disabled={disabled} onPress={onPress} onPressIn={() => { s.value = withSpring(0.96, PRESS); }} onPressOut={() => { s.value = withSpring(1, RELEASE); }}>
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
      <LayoutAnimationConfig skipEntering>
        {loading ? <Animated.View entering={pop() as any} exiting={popOut() as any}><ActivityIndicator color={white ? '#000' : '#fff'} /></Animated.View> : (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}><Swap text={title} style={[{ fontFamily: F.black, fontSize: 17 }, fg]} /></Animated.View>
        )}
      </LayoutAnimationConfig>
    </Squish>
  );
}

export function Collapse({ open, height, children }: { open: boolean; height: number; children: ReactNode }) {
  const v = useSharedValue(open ? 1 : 0);
  useEffect(() => { v.value = withSpring(open ? 1 : 0, SPRING); }, [open]);
  const a = useAnimatedStyle(() => ({ height: Math.max(0, v.value) * height, opacity: v.value, transform: [{ translateY: (1 - v.value) * -6 }] }));
  return <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[{ overflow: 'hidden' }, a]}>{children}</Animated.View>;
}

export function useShake() {
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const shake = () => { x.value = withSequence(withTiming(-9, { duration: 45 }), withTiming(7, { duration: 70 }), withTiming(-3, { duration: 70 }), withSpring(0, SPRING)); };
  return { style, shake };
}

function Fade({ show, children }: { show: boolean; children: ReactNode }) {
  const v = useSharedValue(show ? 1 : 0);
  useEffect(() => { v.value = withSpring(show ? 1 : 0, SPRING); }, [show]);
  const a = useAnimatedStyle(() => ({ opacity: v.value }));
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
      <Animated.View entering={SlideInDown.duration(340).easing(EASE)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, borderRadius: 32, borderCurve: 'continuous', backgroundColor: '#1C1C1E', paddingTop: 24, paddingBottom: 6 }}>
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

export function Logo({ size = 170, ch = 'y' }: { size?: number; ch?: string }) {
  const t = { fontFamily: F.black, fontSize: size, lineHeight: size * 1.15, includeFontPadding: false } as const;
  const w = size * 0.05;
  const rings = Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2) * w, Math.sin((i / 16) * Math.PI * 2) * w]);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-10deg' }] }}>
      {rings.map(([x, y], i) => <Text key={i} style={[t, { color: '#000', position: 'absolute', transform: [{ translateX: x + w * 1.1 }, { translateY: y + w * 1.3 }] }]}>{ch}</Text>)}
      {rings.map(([x, y], i) => <Text key={'o' + i} style={[t, { color: '#000', position: 'absolute', transform: [{ translateX: x }, { translateY: y }] }]}>{ch}</Text>)}
      <Text style={[t, { color: '#fff' }]}>{ch}</Text>
    </View>
  );
}
