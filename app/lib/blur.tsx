import MaskedViewRaw from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Component, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

const MaskedView = MaskedViewRaw as unknown as ComponentType<{ style?: StyleProp<ViewStyle>; maskElement: ReactElement; children?: ReactNode }>;

class Safe extends Component<{ children: ReactNode }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() { return { bad: true }; }
  render() { return this.state.bad ? null : this.props.children; }
}

/**
 * Blur that is strongest at the screen edge and fades out into the content.
 * iOS stacks two masked blurs; Android falls back to a dark fade.
 */
export function ProgressiveBlur({ edge = 'top', height, intensity = 44, scrim = 0.6, style }: { edge?: 'top' | 'bottom'; height: number; intensity?: number; scrim?: number; style?: StyleProp<ViewStyle> }) {
  const top = edge === 'top';
  const dir = top ? { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } } : { start: { x: 0, y: 1 }, end: { x: 0, y: 0 } };
  const mask = (stops: readonly [number, number, number, number]) => (
    <LinearGradient {...dir} colors={['#000', '#000', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']} locations={stops} style={StyleSheet.absoluteFill} />
  );
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, height }, top ? { top: 0 } : { bottom: 0 }, style]}>
      {Platform.OS === 'ios' ? (
        <Safe>
          <MaskedView style={StyleSheet.absoluteFill} maskElement={mask([0, 0.45, 0.75, 1])}>
            <BlurView tint="dark" intensity={intensity * 0.4} style={StyleSheet.absoluteFill} />
          </MaskedView>
          <MaskedView style={StyleSheet.absoluteFill} maskElement={mask([0, 0.25, 0.5, 0.75])}>
            <BlurView tint="dark" intensity={intensity} style={StyleSheet.absoluteFill} />
          </MaskedView>
        </Safe>
      ) : null}
      {scrim > 0 ? <LinearGradient {...dir} colors={[`rgba(0,0,0,${Platform.OS === 'ios' ? scrim : Math.min(1, scrim + 0.3)})`, `rgba(0,0,0,${scrim * 0.5})`, 'rgba(0,0,0,0)']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} /> : null}
    </View>
  );
}

/** Blurred, dimmed backdrop behind sheets. */
export function BlurBackdrop({ dim = 0.42 }: { dim?: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Platform.OS === 'ios' ? <BlurView tint="dark" intensity={22} style={StyleSheet.absoluteFill} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${Platform.OS === 'ios' ? dim : dim + 0.15})` }]} />
    </View>
  );
}
