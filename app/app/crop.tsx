import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api';
import { crop, takePending, uploadPhotos } from '../lib/photo';
import { C, F } from '../lib/theme';
import { SPRING, Squish, Swap, slide, slideOut } from '../lib/tt';

const { width: W, height: H } = Dimensions.get('window');
const MASK = 2000;

type Img = { uri: string; width: number; height: number };
type Rect = { originX: number; originY: number; width: number; height: number };

function clampT(t: number, s: number, img: number, frame: number) {
  'worklet';
  const m = Math.max(0, (img * s - frame) / 2);
  return Math.min(m, Math.max(-m, t));
}

/** Drag and pinch an image under a fixed frame; the frame is always fully covered. */
function Cropper({ img, fw, fh, round, onRect }: { img: Img; fw: number; fh: number; round: boolean; onRect: (get: () => Rect) => void }) {
  const base = Math.max(fw / img.width, fh / img.height);
  const dw = img.width * base, dh = img.height * base;
  const s = useSharedValue(1), tx = useSharedValue(0), ty = useSharedValue(0);
  const s0 = useSharedValue(1), x0 = useSharedValue(0), y0 = useSharedValue(0);

  useEffect(() => {
    onRect(() => {
      const k = base * s.value;
      const width = Math.min(img.width, fw / k), height = Math.min(img.height, fh / k);
      const originX = Math.min(img.width - width, Math.max(0, img.width / 2 - tx.value / k - width / 2));
      const originY = Math.min(img.height - height, Math.max(0, img.height / 2 - ty.value / k - height / 2));
      return { originX: Math.round(originX), originY: Math.round(originY), width: Math.floor(width), height: Math.floor(height) };
    });
  }, [img.uri]);

  const pinch = Gesture.Pinch()
    .onStart(() => { s0.value = s.value; })
    .onUpdate((e) => {
      s.value = Math.min(6, Math.max(1, s0.value * e.scale));
      tx.value = clampT(tx.value, s.value, dw, fw);
      ty.value = clampT(ty.value, s.value, dh, fh);
    });
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => { x0.value = tx.value; y0.value = ty.value; })
    .onUpdate((e) => {
      tx.value = clampT(x0.value + e.translationX, s.value, dw, fw);
      ty.value = clampT(y0.value + e.translationY, s.value, dh, fh);
    });
  const reset = Gesture.Tap().numberOfTaps(2).onEnd(() => { s.value = withSpring(1, SPRING); tx.value = withSpring(0, SPRING); ty.value = withSpring(0, SPRING); });
  const g = Gesture.Simultaneous(pinch, pan, reset);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: s.value }] }));
  const r = round ? fw / 2 : 28;

  return (
    <GestureDetector gesture={g}>
      <View style={{ width: W, flex: 1, alignItems: 'center', justifyContent: 'center' }} collapsable={false}>
        <View style={{ width: fw, height: fh, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[{ width: dw, height: dh }, a]}>
            <Image source={img.uri} style={{ width: dw, height: dh }} contentFit="fill" />
          </Animated.View>
          <View pointerEvents="none" style={{ position: 'absolute', width: fw + MASK * 2, height: fh + MASK * 2, borderRadius: r + MASK, borderWidth: MASK, borderColor: 'rgba(0,0,0,0.72)' }} />
          <View pointerEvents="none" style={{ position: 'absolute', width: fw, height: fh, borderRadius: r, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' }} />
        </View>
      </View>
    </GestureDetector>
  );
}

export default function Crop() {
  const insets = useSafeAreaInsets();
  const [p] = useState(takePending);
  const [step, setStep] = useState<'photo' | 'pfp'>('photo');
  const [photo, setPhoto] = useState<Img | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rect = useRef<() => Rect>(null);
  const done = useRef(false);

  useEffect(() => { if (!p) router.back(); }, []);
  useEffect(() => () => { if (!done.current) p?.resolve(null); }, []);
  if (!p) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  const room = H - insets.top - insets.bottom - 230;
  let fw = W - 56, fh = fw * 16 / 9;
  if (fh > room) { fh = room; fw = fh * 9 / 16; }
  const d = W - 64;

  const next = async () => {
    if (!rect.current || busy) return;
    Haptics.selectionAsync();
    setBusy(true); setError('');
    try {
      if (step === 'photo') {
        const out = await crop(p.uri, rect.current(), 1080);
        setPhoto({ uri: out.uri, width: out.width, height: out.height });
        setStep('pfp');
      } else {
        const out = await crop(photo!.uri, rect.current(), 600);
        const me = await uploadPhotos(photo!.uri, out.uri);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        done.current = true;
        p.resolve(me);
        router.back();
      }
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError((e instanceof ApiError || e instanceof Error ? e.message : 'couldn’t save').toLowerCase());
    } finally { setBusy(false); }
  };
  const back = () => { Haptics.selectionAsync(); if (step === 'pfp') setStep('photo'); else router.back(); };

  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, height: 44 }}>
        <Squish onPress={back} style={{ height: 36, paddingHorizontal: 14, justifyContent: 'center' }}>
          <Swap text={step === 'pfp' ? 'back' : 'cancel'} style={{ color: 'rgba(255,255,255,0.7)', fontFamily: F.black, fontSize: 16 }} />
        </Squish>
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.black, fontSize: 14 }}>{step === 'photo' ? '1 of 2' : '2 of 2'}</Text>
        <View style={{ width: 70 }} />
      </View>
      <View style={{ alignItems: 'center', gap: 4, marginTop: 4 }}>
        <Swap text={step === 'photo' ? 'your photo' : 'your profile pic'} style={{ color: '#fff', fontFamily: F.black, fontSize: 28, letterSpacing: -0.5 }} />
        <Swap text={step === 'photo' ? 'this fills your friends’ screen' : 'this shows up in their friends row'} style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.bold, fontSize: 15 }} />
      </View>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        {step === 'photo' ? (
          <Animated.View key="photo" entering={slide(-1)} exiting={slideOut(-1)} style={{ flex: 1 }}>
            <Cropper img={p} fw={fw} fh={fh} round={false} onRect={(g) => { rect.current = g; }} />
          </Animated.View>
        ) : photo ? (
          <Animated.View key="pfp" entering={slide(1)} exiting={slideOut(1)} style={{ flex: 1 }}>
            <Cropper img={photo} fw={d} fh={d} round onRect={(g) => { rect.current = g; }} />
          </Animated.View>
        ) : null}
      </View>
      {error ? <Animated.Text entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={{ color: C.danger, fontFamily: F.bold, fontSize: 14, textAlign: 'center', marginBottom: 10 }}>{error}</Animated.Text> : null}
      <Text style={{ color: 'rgba(255,255,255,0.35)', fontFamily: F.bold, fontSize: 13, textAlign: 'center', marginBottom: 12 }}>drag and pinch to fit · double tap to reset</Text>
      <View style={{ paddingHorizontal: 24 }}>
        <Squish onPress={next} disabled={busy} style={{ height: 58, borderRadius: 29, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
          {busy ? <ActivityIndicator color="#000" /> : <Swap text={step === 'photo' ? 'next' : 'done'} style={{ color: '#000', fontFamily: F.black, fontSize: 18 }} />}
        </Squish>
      </View>
    </View>
  );
}
