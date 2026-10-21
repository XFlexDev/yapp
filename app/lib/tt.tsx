import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F } from './theme';

export const RED = '#FE0000';
export const FILL = 'rgba(255,255,255,0.22)';
export const GHOST = 'rgba(255,255,255,0.45)';

function Sym({ sf, md, size = 26 }: { sf: string; md: string; size?: number }) {
  return <SymbolView name={sf as any} tintColor="#fff" size={size} weight="bold" fallback={<MaterialCommunityIcons name={md as any} size={size + 4} color="#fff" />} />;
}

export function Pill({ title, onPress, disabled, loading, ghost }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; ghost?: boolean }) {
  const white = !ghost && !disabled;
  return (
    <Pressable disabled={disabled || loading} onPress={() => { Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => ({ height: 52, borderRadius: 26, backgroundColor: white ? '#fff' : FILL, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      {loading ? <ActivityIndicator color={white ? '#000' : '#fff'} /> : (
        <Text style={{ color: white ? '#000' : ghost ? '#fff' : GHOST, fontFamily: F.black, fontSize: 17 }}>{title}</Text>
      )}
    </Pressable>
  );
}

function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const row = (t: string, on: () => void, dim?: boolean) => (
    <Pressable onPress={on} style={({ pressed }) => ({ height: 54, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
      <Text style={{ color: dim ? 'rgba(255,255,255,0.5)' : '#fff', fontFamily: F.bold, fontSize: 17 }}>{t}</Text>
    </Pressable>
  );
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {open ? <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <Animated.View entering={SlideInDown.duration(320)} exiting={SlideOutDown.duration(220)} style={{ marginHorizontal: 8, marginBottom: insets.bottom + 8, borderRadius: 32, borderCurve: 'continuous', backgroundColor: '#1C1C1E', paddingTop: 24, paddingBottom: 6 }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 20, textAlign: 'center' }}>send feedback</Text>
          <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.regular, fontSize: 14, textAlign: 'center', marginTop: 4, marginBottom: 10 }}>let’s improve the app together!</Text>
          {row('email us', () => { onClose(); Linking.openURL('mailto:info@kreatix.dev?subject=yapp'); })}
          {row('close', onClose, true)}
        </Animated.View>
      </Animated.View> : null}
    </Modal>
  );
}

export function RedScreen({ children, onBack, help = true }: { children: ReactNode; onBack?: () => void; help?: boolean }) {
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState(false);
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: RED }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 14, height: insets.top + 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        {onBack ? <Pressable hitSlop={12} onPress={onBack} style={({ pressed }) => ({ width: 40, height: 40, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}><Sym sf="chevron.left" md="chevron-left" size={22} /></Pressable> : <View />}
        {help ? <Pressable hitSlop={12} onPress={() => setSheet(true)} style={({ pressed }) => ({ width: 40, height: 40, alignItems: 'flex-end', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}><Sym sf="questionmark.circle" md="help-circle-outline" size={26} /></Pressable> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: Math.max(insets.bottom, 12) }}>{children}</View>
      <HelpSheet open={sheet} onClose={() => setSheet(false)} />
    </KeyboardAvoidingView>
  );
}

export function Label({ children }: { children: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 22 }}>{children}</Text>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff' }} />
    </View>
  );
}

export function Heading({ children }: { children: string }) {
  return <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 30, lineHeight: 36, textAlign: 'center', letterSpacing: -0.3 }}>{children}</Text>;
}

export const bigInput = { color: '#fff', fontFamily: F.black, fontSize: 30, textAlign: 'center' as const, minWidth: 60, paddingVertical: 4 };

export function Logo({ size = 170 }: { size?: number }) {
  const t = { fontFamily: F.black, fontSize: size, lineHeight: size * 1.15, includeFontPadding: false } as const;
  const w = size * 0.05;
  const rings = Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2) * w, Math.sin((i / 16) * Math.PI * 2) * w]);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-10deg' }] }}>
      {rings.map(([x, y], i) => <Text key={i} style={[t, { color: '#000', position: 'absolute', transform: [{ translateX: x + w * 1.1 }, { translateY: y + w * 1.3 }] }]}>y</Text>)}
      {rings.map(([x, y], i) => <Text key={'o' + i} style={[t, { color: '#000', position: 'absolute', transform: [{ translateX: x }, { translateY: y }] }]}>y</Text>)}
      <Text style={[t, { color: '#fff' }]}>y</Text>
    </View>
  );
}
