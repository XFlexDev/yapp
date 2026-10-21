import { VideoTrack } from '@livekit/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { haptic } from './haptic';
import { set, useStore } from './store';
import { flipCamera } from './voice';

const out = Easing.out(Easing.cubic);
const { width: W, height: H } = Dimensions.get('window');
const FLY = { damping: 22, stiffness: 220, mass: 0.8 };
const SMALL = 104;
const BIG = 150;
const RATIO = 16 / 9;
const M = 12;
const PEEK = 22;

const toggleBare = () => { haptic.tap(); set((s) => ({ cams: { ...s.cams, bare: !s.cams.bare } })); };
const toggleFit = () => { haptic.click(); set((s) => ({ cams: { ...s.cams, fit: !s.cams.fit } })); };
const swapViews = () => { haptic.softHeavy(); set((s) => ({ cams: { ...s.cams, swap: !s.cams.swap } })); };
const flip = () => { haptic.click(); flipCamera().catch(() => {}); };

/** Full-screen video: the friend's camera, or yours when swapped. Tap hides the UI, double tap fits/fills. */
export function RemoteVideo({ id }: { id: string }) {
  const remote = useStore((s) => s.cams.remote[id]);
  const local = useStore((s) => s.cams.local);
  const swap = useStore((s) => s.cams.swap) && !!remote && !!local;
  const fit = useStore((s) => s.cams.fit);
  const front = useStore((s) => s.cams.front);
  const ref = swap ? local : remote;
  if (!ref) return null;
  const tap = Gesture.Tap().runOnJS(true).onEnd((_e, ok) => { if (ok) toggleBare(); });
  const dbl = Gesture.Tap().numberOfTaps(2).runOnJS(true).onEnd((_e, ok) => { if (ok) toggleFit(); });
  return (
    <GestureDetector gesture={Gesture.Exclusive(dbl, tap)}>
      <Animated.View entering={FadeIn.duration(260).easing(out)} exiting={FadeOut.duration(200)} style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
        <VideoTrack trackRef={ref} style={StyleSheet.absoluteFill} objectFit={fit ? 'contain' : 'cover'} mirror={swap && front} zOrder={0} />
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.45)', 'transparent', 'transparent', 'rgba(0,0,0,0.6)']} locations={[0, 0.2, 0.6, 1]} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * Floating self view. Drag and fling to any corner, flick off a side edge to tuck it away,
 * pinch to resize, tap to swap with the big video, double tap to flip the camera.
 */
export function LocalVideo({ top, bottom, friendId }: { top: number; bottom: number; friendId: string }) {
  const local = useStore((s) => s.cams.local);
  const remote = useStore((s) => s.cams.remote[friendId]);
  const swap = useStore((s) => s.cams.swap) && !!remote && !!local;
  const front = useStore((s) => s.cams.front);
  const ref = swap ? remote : local;
  const hasRemote = !!remote;

  const w = useSharedValue(SMALL);
  const x = useSharedValue(W - SMALL - M);
  const y = useSharedValue(top);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const ow = useSharedValue(SMALL);
  const tucked = useSharedValue(0);
  const lift = useSharedValue(0);

  const snap = (vx: number, vy: number) => {
    'worklet';
    const h = w.value * RATIO;
    const px = x.value + vx * 0.18;
    const py = y.value + vy * 0.18;
    const right = px + w.value / 2 > W / 2;
    if (Math.abs(vx) > 1300 && (px < -w.value * 0.15 || px + w.value > W + w.value * 0.15)) {
      tucked.value = right ? 1 : -1;
      x.value = withSpring(right ? W - PEEK : PEEK - w.value, { ...FLY, velocity: vx });
    } else {
      tucked.value = 0;
      x.value = withSpring(right ? W - w.value - M : M, { ...FLY, velocity: vx });
    }
    const low = H - bottom - h;
    y.value = withSpring(py + h / 2 > (top + low + h) / 2 ? low : top, { ...FLY, velocity: vy });
  };
  useEffect(() => { snap(0, 0); }, [top, bottom]);

  const pan = Gesture.Pan()
    .onStart(() => { ox.value = x.value; oy.value = y.value; lift.value = withSpring(1, FLY); })
    .onUpdate((e) => { x.value = ox.value + e.translationX; y.value = oy.value + e.translationY; })
    .onEnd((e) => { snap(e.velocityX, e.velocityY); scheduleOnRN(haptic.tap); })
    .onFinalize(() => { lift.value = withSpring(0, FLY); });
  const pinch = Gesture.Pinch()
    .onStart(() => { ow.value = w.value; })
    .onUpdate((e) => { w.value = Math.max(SMALL * 0.85, Math.min(BIG * 1.15, ow.value * e.scale)); })
    .onEnd(() => { w.value = withSpring(w.value > (SMALL + BIG) / 2 ? BIG : SMALL, FLY); scheduleOnRN(haptic.softHeavy); })
    .onFinalize(() => { const t = w.value > (SMALL + BIG) / 2 ? BIG : SMALL; const r = x.value + w.value / 2 > W / 2; x.value = withSpring(r ? W - t - M : M, FLY); const low = H - bottom - t * RATIO; if (y.value > top + 1) y.value = withSpring(low, FLY); });
  const tap = Gesture.Tap().onEnd((_e, ok) => {
    if (!ok) return;
    if (tucked.value) { snap(-tucked.value * 400, 0); scheduleOnRN(haptic.tap); return; }
    scheduleOnRN(hasRemote ? swapViews : flip);
  });
  const dbl = Gesture.Tap().numberOfTaps(2).onEnd((_e, ok) => { if (ok && !tucked.value) scheduleOnRN(flip); });

  const st = useAnimatedStyle(() => ({
    width: w.value,
    height: w.value * RATIO,
    borderRadius: 22 * (w.value / SMALL),
    shadowOpacity: 0.25 + lift.value * 0.25,
    transform: [{ translateX: x.value }, { translateY: y.value }]
  }));
  const veil = useAnimatedStyle(() => {
    const off = Math.max(0, -x.value, x.value + w.value - W);
    return { opacity: Math.min(0.5, (off / w.value) * 0.6) };
  });

  if (!ref) return null;
  return (
    <GestureDetector gesture={Gesture.Race(Gesture.Simultaneous(pan, pinch), Gesture.Exclusive(dbl, tap))}>
      <Animated.View entering={FadeIn.duration(220).easing(out)} exiting={FadeOut.duration(180)} style={[{ position: 'absolute', left: 0, top: 0, overflow: 'hidden', borderCurve: 'continuous', backgroundColor: '#111', shadowColor: '#000', shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }, st]}>
        <VideoTrack trackRef={ref} style={StyleSheet.absoluteFill} objectFit="cover" mirror={!swap && front} zOrder={1} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, veil]} />
      </Animated.View>
    </GestureDetector>
  );
}
