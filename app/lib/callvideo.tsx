import { VideoTrack } from '@livekit/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut } from 'react-native-reanimated';
import { useStore } from './store';
import { flipCamera } from './voice';

const out = Easing.out(Easing.cubic);

export function RemoteVideo({ id }: { id: string }) {
  const ref = useStore((s) => s.cams.remote[id]);
  if (!ref) return null;
  return (
    <Animated.View pointerEvents="none" entering={FadeIn.duration(260).easing(out)} exiting={FadeOut.duration(200)} style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
      <VideoTrack trackRef={ref} style={StyleSheet.absoluteFill} objectFit="cover" zOrder={0} />
      <LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent', 'transparent', 'rgba(0,0,0,0.6)']} locations={[0, 0.2, 0.6, 1]} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

export function LocalVideo({ top }: { top: number }) {
  const ref = useStore((s) => s.cams.local);
  const front = useStore((s) => s.cams.front);
  if (!ref) return null;
  return (
    <Animated.View entering={FadeIn.duration(220).easing(out)} exiting={FadeOut.duration(180)} style={{ position: 'absolute', top, right: 12, width: 104, height: 184, borderRadius: 22, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: '#111' }}>
      <Pressable style={{ flex: 1 }} onPress={() => { Haptics.selectionAsync(); flipCamera().catch(() => {}); }}>
        <VideoTrack trackRef={ref} style={StyleSheet.absoluteFill} objectFit="cover" mirror={front} zOrder={1} />
      </Pressable>
    </Animated.View>
  );
}
