import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, Tap } from '../lib/icon';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { savePhoto } from '../lib/chat';

/** A photo to show full screen. `rect` is where its bubble sits on screen, so it can grow out of it and shrink back. */
type Rect = { x: number; y: number; w: number; h: number };
export type Shot = { uri: string; thumb?: string; iw?: number; ih?: number; rect?: Rect; /** Where the bubble is right now; it may have moved since opening. */ measure?: (cb: (r: Rect | null) => void) => void };

const OUT = Easing.bezier(0.23, 1, 0.32, 1);
const SPRING = { damping: 28, stiffness: 280, mass: 0.9 };
const MAX_ZOOM = 5;

function Round({ icon, onPress }: { icon: [string, string]; onPress: () => void }) {
  return (
    <Tap onPress={onPress} hitSlop={8} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(30,30,30,0.72)', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Icon sf={icon[0]} md={icon[1]} size={18} mdSize={22} move={icon[0] === 'arrow.down.to.line' ? 'down' : 'bounce'} />
    </Tap>
  );
}

export function PhotoViewer({ shot, onClose }: { shot: Shot | null; onClose: () => void }) {
  if (!shot) return null;
  return <Viewer key={shot.uri} shot={shot} onClose={onClose} />;
}

function Viewer({ shot, onClose }: { shot: Shot; onClose: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [dims, setDims] = useState({ w: shot.iw || 0, h: shot.ih || 0 });
  const [bars, setBars] = useState(true);
  const [saved, setSaved] = useState(false);
  const closing = useRef(false);

  // Where the photo ends up: as large as fits, centered.
  const iw = dims.w || shot.rect?.w || W;
  const ih = dims.h || shot.rect?.h || W;
  const fit = Math.min(W / iw, H / ih);
  const fw = iw * fit, fh = ih * fit, fx = (W - fw) / 2, fy = (H - fh) / 2;
  const grown = !!shot.rect;
  const start = shot.rect ?? { x: fx + fw * 0.05, y: fy + fh * 0.05, w: fw * 0.9, h: fh * 0.9 };
  const ox = useSharedValue(start.x), oy = useSharedValue(start.y), ow = useSharedValue(start.w), oh = useSharedValue(start.h);

  const p = useSharedValue(0);
  const ui = useSharedValue(1);
  const zoom = useSharedValue(1), zoom0 = useSharedValue(1);
  const tx = useSharedValue(0), ty = useSharedValue(0), tx0 = useSharedValue(0), ty0 = useSharedValue(0);
  const dx = useSharedValue(0), dy = useSharedValue(0);

  useEffect(() => { p.value = withTiming(1, { duration: 340, easing: OUT }); }, []);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    const shrink = (r: Rect | null) => {
      if (r && r.w > 0 && r.h > 0) { ox.value = r.x; oy.value = r.y; ow.value = r.w; oh.value = r.h; }
      const t = { duration: 280, easing: OUT };
      zoom.value = withTiming(1, t); tx.value = withTiming(0, t); ty.value = withTiming(0, t);
      dx.value = withTiming(0, t); dy.value = withTiming(0, t);
      ui.value = withTiming(0, { duration: 120 });
      p.value = withTiming(0, t, (done) => { if (done) scheduleOnRN(onClose); });
    };
    if (shot.measure) shot.measure(shrink); else shrink(null);
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
  }, []);

  const toggleBars = () => { setBars((v) => { ui.value = withTiming(v ? 0 : 1, { duration: 160 }); return !v; }); };
  const save = () => {
    if (saved) return;
    savePhoto(shot.uri).then((ok) => { if (ok) { setSaved(true); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } }).catch(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
  };

  const pinch = Gesture.Pinch()
    .onStart(() => { zoom0.value = zoom.value; })
    .onUpdate((e) => { zoom.value = Math.min(MAX_ZOOM, Math.max(0.75, zoom0.value * e.scale)); })
    .onEnd(() => {
      if (zoom.value < 1.05) { zoom.value = withSpring(1, SPRING); tx.value = withSpring(0, SPRING); ty.value = withSpring(0, SPRING); return; }
      const mx = Math.max(0, (fw * zoom.value - W) / 2), my = Math.max(0, (fh * zoom.value - H) / 2);
      tx.value = withSpring(Math.min(mx, Math.max(-mx, tx.value)), SPRING);
      ty.value = withSpring(Math.min(my, Math.max(-my, ty.value)), SPRING);
    });
  const pan = Gesture.Pan().maxPointers(1).minDistance(6)
    .onStart(() => { tx0.value = tx.value; ty0.value = ty.value; })
    .onUpdate((e) => {
      if (zoom.value > 1.02) {
        const mx = Math.max(0, (fw * zoom.value - W) / 2), my = Math.max(0, (fh * zoom.value - H) / 2);
        tx.value = Math.min(mx, Math.max(-mx, tx0.value + e.translationX));
        ty.value = Math.min(my, Math.max(-my, ty0.value + e.translationY));
      } else { dx.value = e.translationX * 0.6; dy.value = e.translationY; }
    })
    .onEnd((e) => {
      if (zoom.value > 1.02) return;
      if (Math.abs(dy.value) > 110 || Math.abs(e.velocityY) > 1100) scheduleOnRN(close);
      else { dx.value = withSpring(0, SPRING); dy.value = withSpring(0, SPRING); }
    });
  const twice = Gesture.Tap().numberOfTaps(2).maxDelay(240).onEnd((e) => {
    if (zoom.value > 1.02) { zoom.value = withSpring(1, SPRING); tx.value = withSpring(0, SPRING); ty.value = withSpring(0, SPRING); return; }
    const z = 2.5;
    const mx = Math.max(0, (fw * z - W) / 2), my = Math.max(0, (fh * z - H) / 2);
    zoom.value = withSpring(z, SPRING);
    tx.value = withSpring(Math.min(mx, Math.max(-mx, (W / 2 - e.absoluteX) * (z - 1))), SPRING);
    ty.value = withSpring(Math.min(my, Math.max(-my, (H / 2 - e.absoluteY) * (z - 1))), SPRING);
  });
  const once = Gesture.Tap().onEnd(() => { scheduleOnRN(toggleBars); });
  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(twice, once));

  const shade = useAnimatedStyle(() => ({ opacity: p.value * (1 - Math.min(1, Math.abs(dy.value) / (H * 0.45)) * 0.85) }));
  const frame = useAnimatedStyle(() => {
    const k = p.value;
    const pull = Math.min(1, Math.abs(dy.value) / (H * 0.6));
    return {
      left: ox.value + (fx - ox.value) * k,
      top: oy.value + (fy - oy.value) * k,
      width: ow.value + (fw - ow.value) * k,
      height: oh.value + (fh - oh.value) * k,
      borderRadius: 20 * (1 - k) + 22 * pull,
      opacity: grown ? 1 : k,
      transform: [{ translateX: tx.value + dx.value }, { translateY: ty.value + dy.value }, { scale: zoom.value * (1 - pull * 0.28) }],
    };
  });
  const chrome = useAnimatedStyle(() => ({ opacity: ui.value * p.value * (1 - Math.min(1, Math.abs(dy.value) / 60)) }));

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 30 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, shade]} />
      <GestureDetector gesture={gesture}>
        <Animated.View style={StyleSheet.absoluteFill}>
          <Animated.View style={[{ position: 'absolute', overflow: 'hidden', borderCurve: 'continuous', backgroundColor: '#111' }, frame]}>
            <Image source={shot.uri} placeholder={shot.thumb ? { uri: `data:image/webp;base64,${shot.thumb}` } : undefined} placeholderContentFit="cover" contentFit="cover" cachePolicy="memory-disk" style={StyleSheet.absoluteFill}
              onLoad={(e) => { if (!shot.iw && e.source?.width && e.source?.height) setDims({ w: e.source.width, h: e.source.height }); }} />
          </Animated.View>
        </Animated.View>
      </GestureDetector>
      <Animated.View pointerEvents={bars ? 'box-none' : 'none'} style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, chrome]}>
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 90 }} />
        <View pointerEvents="box-none" style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: insets.top + 8, paddingHorizontal: 14 }}>
          <Round icon={['xmark', 'close']} onPress={close} />
          <Round icon={saved ? ['checkmark', 'check'] : ['arrow.down.to.line', 'tray-arrow-down']} onPress={save} />
        </View>
      </Animated.View>
    </View>
  );
}
