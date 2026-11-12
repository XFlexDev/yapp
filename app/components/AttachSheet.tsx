import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { requireOptionalNativeModule } from 'expo';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, LinearTransition, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { BlurBackdrop } from '../lib/blur';
import { pickPhotos, preparePhoto, systemCamera, type Photo } from '../lib/chat';
import { C, F } from '../lib/theme';

// In-app camera, only in builds that ship expo-camera; older builds open the phone's own camera screen.
const Cam: any = requireOptionalNativeModule('ExpoCamera') ? (() => { try { return require('expo-camera'); } catch { return null; } })() : null;
// Recent pictures need full photo access, which Google Play only grants to gallery apps, so this is iOS only.
const Lib: any = Platform.OS === 'ios' ? (() => { try { return require('expo-media-library/legacy'); } catch { return null; } })() : null;

type Recent = { id: string; uri: string; width: number; height: number };
export type AttachAction = { title: string; sub: string; icon: [string, string]; onPress: () => void };

const OUT = Easing.bezier(0.23, 1, 0.32, 1);
const TILE = 104;

function Icon({ icon, size = 22, color = '#fff' }: { icon: [string, string]; size?: number; color?: string }) {
  return <SymbolView name={icon[0] as any} tintColor={color} size={size} weight="semibold" fallback={<MaterialCommunityIcons name={icon[1] as any} size={size + 3} color={color} />} />;
}

function Tile({ icon, label, onPress }: { icon: [string, string]; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => ({ width: TILE, height: TILE, borderRadius: 30, borderCurve: 'continuous', backgroundColor: pressed ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', gap: 8 })}>
      <Icon icon={icon} size={24} />
      <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

function Round({ icon, onPress }: { icon: [string, string]; onPress: () => void }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync(); onPress(); }} hitSlop={8} style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(20,20,20,0.6)', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Icon icon={icon} size={19} />
    </Pressable>
  );
}

function Pill({ title, onPress, strong, busy }: { title: string; onPress: () => void; strong?: boolean; busy?: boolean }) {
  return (
    <Pressable disabled={busy} onPress={() => { Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => ({ minWidth: 104, height: 46, paddingHorizontal: 22, borderRadius: 23, borderCurve: 'continuous', backgroundColor: strong ? '#fff' : 'rgba(20,20,20,0.6)', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      {busy ? <ActivityIndicator color={strong ? '#000' : '#fff'} /> : <Text style={{ color: strong ? '#000' : '#fff', fontFamily: F.black, fontSize: 16 }}>{title}</Text>}
    </Pressable>
  );
}

/** The + menu of a chat: photo library, camera and the latest pictures, plus whatever else the chat offers. */
export function AttachSheet({ visible, onClose, onSend, actions }: { visible: boolean; onClose: () => void; onSend: (photos: Photo[]) => void; actions?: AttachAction[] }) {
  if (!visible) return null;
  return <Sheet onClose={onClose} onSend={onSend} actions={actions ?? []} />;
}

function Sheet({ onClose, onSend, actions }: { onClose: () => void; onSend: (photos: Photo[]) => void; actions: AttachAction[] }) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'menu' | 'camera' | 'review'>('menu');
  const [recents, setRecents] = useState<Recent[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [denied, setDenied] = useState(false);
  const [still, setStill] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [sh, setSh] = useState(440);
  const cam = useRef<any>(null);
  const gone = useRef(false);
  const after = useRef<(() => void) | undefined>(undefined);
  const p = useSharedValue(0);
  const drag = useSharedValue(0);
  const CAM_H = Math.min(Math.round((W - 32) * 1.3), Math.round(H * 0.6));

  useEffect(() => { p.value = withTiming(1, { duration: 320, easing: OUT }); }, []);
  useEffect(() => {
    if (!Lib) return;
    (async () => {
      let perm = await Lib.getPermissionsAsync(false, ['photo']);
      if (!perm.granted && perm.status === 'undetermined') perm = await Lib.requestPermissionsAsync(false, ['photo']);
      if (!perm.granted) return;
      const page = await Lib.getAssetsAsync({ first: 30, mediaType: 'photo', sortBy: [['creationTime', false]] });
      setRecents(page.assets);
    })().catch(() => {});
  }, []);

  const finish = () => { onClose(); after.current?.(); };
  const close = (then?: () => void) => {
    if (gone.current) return;
    gone.current = true;
    after.current = then;
    p.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) }, (done) => { if (done) scheduleOnRN(finish); });
  };
  const back = () => { setStill(null); setMode('menu'); };
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (modeRef.current === 'menu') close(); else back(); return true; });
    return () => sub.remove();
  }, []);

  const deliver = (list: Photo[]) => { if (list.length) close(() => onSend(list)); };
  const fromLibrary = () => { pickPhotos().then(deliver).catch(() => {}); };
  const openCamera = async () => {
    if (!Cam) { systemCamera().then((one) => { if (one) deliver([one]); }).catch(() => {}); return; }
    try { const r = await Cam.Camera.requestCameraPermissionsAsync(); setDenied(!r.granted); } catch { setDenied(true); }
    setMode('camera');
  };
  const shoot = async () => {
    if (busy || !cam.current) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { setStill(await cam.current.takePictureAsync({ quality: 0.9 })); setMode('review'); } catch {} finally { setBusy(false); }
  };
  const sendStill = async () => {
    if (!still || busy) return;
    setBusy(true);
    try { deliver([await preparePhoto(still.uri, still.width, still.height)]); } catch { setBusy(false); }
  };
  const sendPicked = async () => {
    if (busy) return;
    setBusy(true);
    const out: Photo[] = [];
    for (const aid of picked) {
      const a = recents.find((x) => x.id === aid);
      if (!a) continue;
      try { const info = await Lib.getAssetInfoAsync(a); out.push(await preparePhoto(info.localUri ?? a.uri, a.width, a.height)); } catch {}
    }
    if (out.length) deliver(out); else { setBusy(false); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
  };
  const toggle = (aid: string) => { Haptics.selectionAsync(); setPicked((v) => (v.includes(aid) ? v.filter((x) => x !== aid) : v.length < 10 ? [...v, aid] : v)); };

  const OFF = sh + insets.bottom + 40;
  const shade = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, p.value)) * (1 - Math.min(1, drag.value / sh) * 0.7) }));
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - p.value) * OFF + drag.value }] }));
  const pan = Gesture.Pan().activeOffsetY([-12, 12]).failOffsetX([-14, 14])
    .onChange((e) => { drag.value = e.translationY > 0 ? e.translationY : e.translationY * 0.15; })
    .onEnd((e) => {
      if (e.translationY > sh * 0.3 || e.velocityY > 900) scheduleOnRN(close);
      else drag.value = withSpring(0, { damping: 26, stiffness: 260 });
    });

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 12 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, shade]}>
        <BlurBackdrop />
        <Pressable style={{ flex: 1 }} onPress={() => close()} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View onLayout={(e) => setSh(e.nativeEvent.layout.height)} layout={LinearTransition.duration(280).easing(OUT)} style={[{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, borderRadius: 34, borderCurve: 'continuous', backgroundColor: '#161616', overflow: 'hidden' }, sheet]}>
          {mode === 'menu' ? (
            <Animated.View key="menu" entering={FadeIn.duration(180)} style={{ paddingTop: 10, paddingBottom: 14 }}>
              <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', marginBottom: 14 }} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 10 }}>
                <Tile icon={['photo.on.rectangle', 'image-multiple-outline']} label="photos" onPress={fromLibrary} />
                <Tile icon={['camera', 'camera-outline']} label="camera" onPress={openCamera} />
                {recents.map((a) => {
                  const n = picked.indexOf(a.id);
                  return (
                    <Pressable key={a.id} onPress={() => toggle(a.id)} style={{ width: TILE, height: TILE, borderRadius: 30, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' }}>
                      <Image source={a.uri} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={a.id} />
                      {n >= 0 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.28)' }]} /> : null}
                      <View style={{ position: 'absolute', top: 9, right: 9, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: n >= 0 ? C.red : 'rgba(0,0,0,0.25)', borderWidth: n >= 0 ? 0 : 2, borderColor: 'rgba(255,255,255,0.9)' }}>
                        {n >= 0 ? <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 13, fontVariant: ['tabular-nums'] }}>{n + 1}</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {picked.length ? (
                <Animated.View entering={FadeIn.duration(160)} style={{ paddingHorizontal: 14, paddingTop: 14 }}>
                  <Pressable disabled={busy} onPress={sendPicked} style={({ pressed }) => ({ height: 52, borderRadius: 26, borderCurve: 'continuous', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
                    {busy ? <ActivityIndicator color="#000" /> : <Text style={{ color: '#000', fontFamily: F.black, fontSize: 16 }}>{picked.length === 1 ? 'send photo' : `send ${picked.length} photos`}</Text>}
                  </Pressable>
                </Animated.View>
              ) : actions.length ? (
                <View style={{ marginTop: 10 }}>
                  {actions.map((a) => (
                    <Pressable key={a.title} onPress={() => { Haptics.selectionAsync(); close(a.onPress); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 22, paddingVertical: 11, backgroundColor: pressed ? 'rgba(255,255,255,0.06)' : 'transparent' })}>
                      <View style={{ width: 28, alignItems: 'center' }}><Icon icon={a.icon} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 16 }}>{a.title}</Text>
                        <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 13 }}>{a.sub}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </Animated.View>
          ) : (
            <Animated.View key="camera" entering={FadeIn.duration(180)} style={{ padding: 8 }}>
              <View style={{ height: CAM_H, borderRadius: 27, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: '#000' }}>
                {mode === 'review' && still ? <Image source={still.uri} style={StyleSheet.absoluteFill} contentFit="cover" />
                  : denied ? (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 30 }}>
                      <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 17, textAlign: 'center' }}>yapp can’t use the camera</Text>
                      <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 14, textAlign: 'center' }}>turn on camera access for yapp in settings to take photos here.</Text>
                      <Pill title="open settings" onPress={() => { Linking.openSettings().catch(() => {}); }} />
                    </View>
                  ) : <Cam.CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} mirror />}
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 }}>
                  {mode === 'review' ? (
                    <>
                      <Pill title="retake" onPress={() => { setStill(null); setMode('camera'); }} />
                      <Pill strong title="send" busy={busy} onPress={sendStill} />
                    </>
                  ) : (
                    <>
                      <Round icon={['chevron.left', 'chevron-left']} onPress={back} />
                      {denied ? null : (
                        <Pressable onPress={shoot} style={({ pressed }) => ({ width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
                          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' }} />
                        </Pressable>
                      )}
                      {denied ? <View style={{ width: 46 }} /> : <Round icon={['arrow.triangle.2.circlepath', 'camera-flip-outline']} onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} />}
                    </>
                  )}
                </View>
              </View>
            </Animated.View>
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
