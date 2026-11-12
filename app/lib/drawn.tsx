import { useEffect, type ComponentType } from 'react';
import { TurboModuleRegistry, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { DRAWN, type Motion, type Shape } from './drawn-data';

export type DrawnProps = { tick: number; size: number; color: string };

// Vector drawing only exists in builds that ship react-native-svg; older builds keep their plain icons.
const Svg: any = TurboModuleRegistry.get('RNSVGRenderableModule') ? (() => { try { return require('react-native-svg'); } catch { return null; } })() : null;
const AnimatedPath: any = Svg ? Animated.createAnimatedComponent(Svg.Path) : null;

const STROKE = 2.2;
const EASE = Easing.bezier(0.23, 1, 0.32, 1);

/** A path that redraws itself from its start as `p` goes 0 to 1. */
function DrawPath({ d, length, p, color }: { d: string; length: number; p: SharedValue<number>; color: string }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - p.value) }));
  return <AnimatedPath d={d} stroke={color} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={[length, length]} animatedProps={props} />;
}

function shape(s: Shape, i: number, color: string) {
  const line = { stroke: color, strokeWidth: STROKE, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  if (s[0] === 'p') return <Svg.Path key={i} d={s[1]} {...line} />;
  if (s[0] === 'c') return <Svg.Circle key={i} cx={s[1]} cy={s[2]} r={s[3]} {...line} fill={s[4] ? color : 'none'} />;
  return <Svg.Rect key={i} x={s[1]} y={s[2]} width={s[3]} height={s[4]} rx={s[5]} {...line} />;
}

/** One Lucide icon: the still part, and on top the part that plays its motion once per tap. */
function Drawn({ name, tick, size, color }: DrawnProps & { name: string }) {
  const { s, m, a } = DRAWN[name];
  const box = Math.round(size * 1.12);
  const k = box / 24;
  const turn = useSharedValue(0);
  const t = useSharedValue(0);
  const p = useSharedValue(1);
  useEffect(() => {
    if (!tick) return;
    if (a[0] === 'spin') turn.value = withTiming(turn.value + a[1], { duration: 620, easing: EASE });
    else if (a[0] === 'ring') t.value = withSequence(withTiming(-1, { duration: 90 }), withTiming(1, { duration: 130 }), withTiming(-0.5, { duration: 120 }), withTiming(0, { duration: 160, easing: EASE }));
    else if (a[0] === 'shift') t.value = withSequence(withTiming(1, { duration: 150, easing: EASE }), withSpring(0, { damping: 18, stiffness: 220, mass: 0.7 }));
    else { p.value = 0; p.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }); }
  }, [tick]);
  const motion: Motion = a;
  const moving = useAnimatedStyle(() => {
    if (motion[0] === 'spin') return { transform: [{ rotate: `${turn.value}deg` }] };
    if (motion[0] === 'ring') return { transform: [{ rotate: `${t.value * motion[1]}deg` }] };
    if (motion[0] === 'shift') return { transform: [{ translateX: t.value * motion[1] * k }, { translateY: t.value * motion[2] * k }] };
    return {};
  });
  return (
    <View style={{ width: box, height: box }}>
      {s.length ? <Svg.Svg width={box} height={box} viewBox="0 0 24 24" style={{ position: 'absolute' }}>{s.map((x, i) => shape(x, i, color))}</Svg.Svg> : null}
      <Animated.View style={[{ position: 'absolute', width: box, height: box }, moving]}>
        <Svg.Svg width={box} height={box} viewBox="0 0 24 24">
          {m.map((x, i) => (a[0] === 'draw' && x[0] === 'p' ? <DrawPath key={i} d={x[1]} length={x[2] ?? 30} p={p} color={color} /> : shape(x, i, color)))}
        </Svg.Svg>
      </Animated.View>
    </View>
  );
}

const cache = new Map<string, ComponentType<DrawnProps>>();
/** The animated version of an SF Symbol name, when this build can draw it. */
export function drawnIcon(sf: string): ComponentType<DrawnProps> | null {
  if (!Svg || !DRAWN[sf]) return null;
  let made = cache.get(sf);
  if (!made) { made = (props: DrawnProps) => <Drawn name={sf} {...props} />; cache.set(sf, made); }
  return made;
}
