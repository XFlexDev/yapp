import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { BlurBackdrop } from './blur';
import { C, F } from './theme';
import { Morph, Squish } from './tt';

export type Ask = {
  title: string;
  /** With a message it is a question with one big button, without it a list of options. */
  message?: string;
  options: readonly string[];
  /** Index of the option shown in red. */
  destructive?: number;
  /** The pick opens another sheet, so this one turns into it instead of closing first. */
  chain?: boolean;
  onPick: (i: number) => void;
};

const hosts: ((a: Ask) => void)[] = [];
const OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** Show yapp's own bottom sheet on the screen in front. False when no screen can show it. */
export function present(a: Ask): boolean {
  const show = hosts[hosts.length - 1];
  if (!show) return false;
  show(a);
  return true;
}

/**
 * Yapp's own menus and confirmations. Every screen that asks something mounts one: it has to sit inside
 * the screen, because a native sheet (profile, add friend) would cover one mounted at the root.
 */
export function Sheets() {
  const insets = useSafeAreaInsets();
  const [ask, setAsk] = useState<Ask | null>(null);
  const live = useRef<Ask | null>(null);
  const after = useRef<(() => void) | null>(null);
  const p = useSharedValue(0);
  const h = useSharedValue(420);

  const show = useCallback((a: Ask) => {
    live.current = a;
    after.current = null;
    setAsk(a);
    p.value = withTiming(1, { duration: 320, easing: OUT });
  }, [p]);
  useEffect(() => {
    hosts.push(show);
    return () => { const i = hosts.indexOf(show); if (i >= 0) hosts.splice(i, 1); };
  }, [show]);

  const gone = useCallback(() => {
    if (live.current) return;
    setAsk(null);
    const run = after.current;
    after.current = null;
    // The sheet has to be off screen before the pick runs: a pick can close the screen under it.
    if (run) setTimeout(run, 60);
  }, []);
  const close = (then?: () => void) => {
    live.current = null;
    after.current = then ?? null;
    p.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) }, (done) => { if (done) scheduleOnRN(gone); });
  };
  const pick = (i: number) => {
    const a = live.current;
    if (!a) return;
    if (a.chain) { a.onPick(i); if (live.current === a) close(); } else close(() => a.onPick(i));
  };

  const dim = useAnimatedStyle(() => ({ opacity: p.value }));
  const card = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - p.value) * (h.value + 60) }] }));
  if (!ask) return null;
  const red = ask.destructive;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => close()}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, dim]}><BlurBackdrop dim={0.5} /></Animated.View>
        <Pressable accessibilityLabel="close" onPress={() => close()} style={StyleSheet.absoluteFill} />
        <Animated.View onLayout={(e) => { h.value = e.nativeEvent.layout.height; }} style={[{ marginHorizontal: 10, marginBottom: Math.max(insets.bottom, 12) + 8, borderRadius: 28, borderCurve: 'continuous', backgroundColor: '#1C1C1E', overflow: 'hidden' }, card]}>
          <Morph>
            <View style={{ padding: 20, gap: 14 }}>
              <View style={{ gap: 6, paddingHorizontal: 4, paddingTop: 4 }}>
                <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 22 }}>{ask.title}</Text>
                {ask.message ? <Text style={{ color: 'rgba(255,255,255,0.65)', fontFamily: F.bold, fontSize: 15, lineHeight: 21 }}>{ask.message}</Text> : null}
              </View>
              {ask.message ? (
                <Squish onPress={() => pick(0)} style={{ height: 50, borderRadius: 25, backgroundColor: red === 0 ? C.red : '#fff', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: red === 0 ? '#fff' : '#000', fontFamily: F.black, fontSize: 16 }}>{ask.options[0]}</Text>
                </Squish>
              ) : (
                <View style={{ borderRadius: 20, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                  {ask.options.map((o, i) => (
                    <View key={o}>
                      {i ? <View style={{ height: StyleSheet.hairlineWidth, marginLeft: 18, backgroundColor: 'rgba(255,255,255,0.1)' }} /> : null}
                      <Pressable onPress={() => pick(i)} style={({ pressed }) => ({ height: 54, paddingHorizontal: 18, justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.07)' : 'transparent' })}>
                        <Text numberOfLines={1} style={{ color: i === red ? C.red : '#fff', fontFamily: F.black, fontSize: 16 }}>{o}</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              <Pressable onPress={() => close()} hitSlop={8} style={{ alignSelf: 'center', padding: 6 }}>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.bold, fontSize: 14 }}>cancel</Text>
              </Pressable>
            </View>
          </Morph>
        </Animated.View>
      </View>
    </Modal>
  );
}
