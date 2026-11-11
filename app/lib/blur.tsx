import MaskedViewRaw from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { Component, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

const MaskedView = MaskedViewRaw as unknown as ComponentType<{ style?: StyleProp<ViewStyle>; maskElement: ReactElement; children?: ReactNode }>;

// Native variable blur, only in builds that ship modules/yapp-blur; older builds use the stacked layers below.
const NativeBlur: ComponentType<{ edge: 'top' | 'bottom'; radius: number; style?: StyleProp<ViewStyle> }> | null =
  Platform.OS === 'ios' && requireOptionalNativeModule('YappBlur') ? requireNativeView('YappBlur') : null;

class Safe extends Component<{ children: ReactNode }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() { return { bad: true }; }
  render() { return this.state.bad ? null : this.props.children; }
}

// [share of full blur, fully on until, gone by] as fractions of the height, weakest layer reaching furthest.
const LAYERS: readonly [number, number, number][] = [
  [0.14, 0.72, 1],
  [0.22, 0.56, 0.84],
  [0.36, 0.4, 0.68],
  [0.6, 0.24, 0.52],
  [1, 0.08, 0.36],
];

/**
 * Blur whose radius grows towards the screen edge. iOS uses the native variable blur,
 * or stacked masked blurs in builds without it; Android gets a dark fade.
 */
export function ProgressiveBlur({ edge = 'top', height, intensity = 50, scrim = 0.25, style }: { edge?: 'top' | 'bottom'; height: number; intensity?: number; scrim?: number; style?: StyleProp<ViewStyle> }) {
  const top = edge === 'top';
  const dir = top ? { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } } : { start: { x: 0, y: 1 }, end: { x: 0, y: 0 } };
  const ios = Platform.OS === 'ios';
  const shade = ios ? scrim : Math.min(1, scrim + 0.4);
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, height }, top ? { top: 0 } : { bottom: 0 }, style]}>
      {NativeBlur ? (
        <NativeBlur edge={edge} radius={intensity * 0.4} style={StyleSheet.absoluteFill} />
      ) : ios ? (
        <Safe>
          {LAYERS.map(([k, on, off], i) => (
            <MaskedView key={i} style={StyleSheet.absoluteFill} maskElement={<LinearGradient {...dir} colors={['#000', '#000', 'rgba(0,0,0,0)']} locations={[0, on, off]} style={StyleSheet.absoluteFill} />}>
              <BlurView tint="dark" intensity={intensity * k} style={StyleSheet.absoluteFill} />
            </MaskedView>
          ))}
        </Safe>
      ) : null}
      {shade > 0 ? <LinearGradient {...dir} colors={[`rgba(0,0,0,${shade})`, `rgba(0,0,0,${shade * 0.4})`, 'rgba(0,0,0,0)']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} /> : null}
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
