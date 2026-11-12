import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { F } from '../lib/theme';

/** A 0..1 slider with its label on the left. Drag or tap anywhere on the track. */
export function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const at = (x: number) => { if (w > 0) onChange(Math.min(1, Math.max(0, (x - 14) / (w - 28)))); };
  const tick = () => { Haptics.selectionAsync(); };
  const pan = Gesture.Pan().activeOffsetX([-4, 4]).failOffsetY([-12, 12])
    .onBegin((e) => { scheduleOnRN(at, e.x); })
    .onUpdate((e) => { scheduleOnRN(at, e.x); })
    .onEnd(() => { scheduleOnRN(tick); });
  const tap = Gesture.Tap().onEnd((e) => { scheduleOnRN(at, e.x); scheduleOnRN(tick); });
  const fill = 14 + Math.max(0, w - 28) * Math.min(1, Math.max(0, value));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18 }}>
      <Text style={{ width: 84, color: '#fff', fontFamily: F.black, fontSize: 15 }}>{label}</Text>
      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flex: 1, height: 40, justifyContent: 'center' }}>
          <View style={{ height: 28, borderRadius: 14, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
            <View style={{ width: fill + 14, height: 28, borderRadius: 14, borderCurve: 'continuous', backgroundColor: '#fff' }} />
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}
