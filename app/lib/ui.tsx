import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { avatarUrl, nameOf, type User } from './api';
import { C, F, SWATCH } from './theme';

const ease = Easing.bezier(0.23, 1, 0.32, 1);

export function Avatar({ user, size, ring }: { user: User; size: number; ring?: boolean }) {
  const url = avatarUrl(user);
  const inner = (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: SWATCH[user.color] ?? C.red, alignItems: 'center', justifyContent: 'center' }}>
      {url ? (
        <Image source={url} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={user.id} />
      ) : (
        <Text style={{ color: '#fff', fontFamily: F.black, fontSize: size * 0.42 }}>{nameOf(user).slice(0, 1).toUpperCase()}</Text>
      )}
    </View>
  );
  if (!ring) return inner;
  return <View style={{ padding: 3, borderRadius: size, borderWidth: 3, borderColor: '#fff' }}>{inner}</View>;
}

export function Button({ title, onPress, loading, disabled, kind = 'primary', style }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; kind?: 'primary' | 'ghost' | 'danger'; style?: ViewStyle }) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const bg = kind === 'primary' ? C.red : kind === 'danger' ? 'transparent' : C.surface2;
  const fg = kind === 'danger' ? C.danger : '#fff';
  return (
    <Pressable
      disabled={disabled || loading}
      onPressIn={() => { s.value = withTiming(0.97, { duration: 100, easing: ease }); }}
      onPressOut={() => { s.value = withTiming(1, { duration: 150, easing: ease }); }}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
    >
      <Animated.View style={[{ height: 56, borderRadius: 28, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }, a, style]}>
        {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontFamily: F.black, fontSize: 18 }}>{title}</Text>}
      </Animated.View>
    </Pressable>
  );
}

export function Field(p: TextInputProps & { prefix?: string; ref?: any }) {
  return (
    <View style={{ height: 60, borderRadius: 18, borderCurve: 'continuous', backgroundColor: C.surface2, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 }}>
      {p.prefix ? <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 20, marginRight: 2 }}>{p.prefix}</Text> : null}
      <TextInput placeholderTextColor={C.faint} selectionColor={C.red} keyboardAppearance="dark" {...p} style={[{ flex: 1, color: '#fff', fontFamily: F.bold, fontSize: 20 }, p.style]} />
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 34, letterSpacing: -0.5, lineHeight: 38 }}>{children}</Text>;
}
export function Sub({ children }: { children: ReactNode }) {
  return <Text style={{ color: C.dim, fontFamily: F.regular, fontSize: 16, lineHeight: 22 }}>{children}</Text>;
}
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={{ color: C.danger, fontFamily: F.bold, fontSize: 15 }}>{children}</Text>;
}
