import { useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { req } from './api';
import { F } from './theme';

export const WAVE_IMG = require('../assets/wave_3d.png');
const { width: W, height: H } = Dimensions.get('window');

/**
 * Curved white wind/motion arcs on either side of the waving hand.
 * Matches the live screenshot styling in wave4.jpg & wave8.jpg.
 */
function MotionSwoosh({ side }: { side: 'left' | 'right' }) {
  const rot = side === 'left' ? '-24deg' : '24deg';
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        [side]: -14,
        top: 36,
        width: 32,
        height: 60,
        borderRadius: 30,
        borderLeftWidth: side === 'left' ? 4 : 0,
        borderRightWidth: side === 'right' ? 4 : 0,
        borderColor: 'rgba(255,255,255,0.85)',
        transform: [{ rotate: rot }],
      }}
    />
  );
}

/**
 * Animated stream of 3D Fluent wave hands rising upwards with a live counter badge.
 */
export function WaveStream({
  count,
  active,
  onDone,
}: {
  count: number;
  active: boolean;
  onDone?: () => void;
}) {
  const bump = useSharedValue(1);
  const rot = useSharedValue(0);
  const floatY = useSharedValue(0);
  const opacity = useSharedValue(1);

  // Oscillating wave motion while active
  useEffect(() => {
    rot.value = withRepeat(
      withSequence(
        withTiming(-14, { duration: 80, easing: Easing.inOut(Easing.quad) }),
        withTiming(16, { duration: 80, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      true
    );
    return () => {
      cancelAnimation(rot);
    };
  }, []);

  // Bump scale on every wave tick
  useEffect(() => {
    bump.value = withSequence(
      withTiming(1.15, { duration: 45, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 14, stiffness: 300 })
    );
  }, [count]);

  // Float up and fade out when gesture ends
  useEffect(() => {
    if (!active && count > 0) {
      const timer = setTimeout(() => {
        floatY.value = withTiming(-60, { duration: 450, easing: Easing.out(Easing.quad) });
        opacity.value = withTiming(0, { duration: 400 }, (done) => {
          if (done && onDone) {
            onDone();
          }
        });
      }, 600);
      return () => clearTimeout(timer);
    } else {
      floatY.value = 0;
      opacity.value = 1;
    }
  }, [active]);

  const mainHandStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: floatY.value },
      { rotate: `${rot.value}deg` },
      { scaleX: bump.value },
      { scaleY: bump.value },
    ],
  }));

  // Visual stack of hands leading up to the main hand (interpolating sizes)
  // Matching wave4.jpg & wave8.jpg fan layout
  const stack = [
    { size: 36, offset: { x: -8, y: 160 }, rot: '-10deg' },
    { size: 48, offset: { x: 4, y: 130 }, rot: '8deg' },
    { size: 66, offset: { x: -6, y: 98 }, rot: '-6deg' },
    { size: 88, offset: { x: 10, y: 64 }, rot: '12deg' },
    { size: 120, offset: { x: -4, y: 32 }, rot: '-4deg' },
  ];

  return (
    <Animated.View
      pointerEvents="none"
      entering={FadeIn.duration(120)}
      exiting={FadeOut.duration(200)}
      style={[
        StyleSheet.absoluteFill,
        { alignItems: 'center', justifyContent: 'center', zIndex: 999 },
      ]}>
      <Animated.View style={[{ alignItems: 'center', justifyContent: 'center' }, mainHandStyle]}>
        {/* Trailing hands forming the stream fan */}
        {stack.map((item, idx) => (
          <Image
            key={idx}
            source={WAVE_IMG}
            style={{
              position: 'absolute',
              width: item.size,
              height: item.size,
              transform: [
                { translateX: item.offset.x },
                { translateY: item.offset.y },
                { rotate: item.rot },
              ],
              opacity: 0.9,
            }}
            contentFit="contain"
          />
        ))}

        {/* Motion swoosh lines */}
        <MotionSwoosh side="left" />
        <MotionSwoosh side="right" />

        {/* Main top waving hand */}
        <Image
          source={WAVE_IMG}
          style={{ width: 195, height: 195 }}
          contentFit="contain"
          priority="high"
        />

        {/* Live count badge in the palm of the waving hand */}
        <View
          style={{
            position: 'absolute',
            top: 48,
            left: 0,
            right: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {/* Black shadow layer for high contrast outline */}
          <Text
            style={{
              position: 'absolute',
              fontFamily: F.black,
              fontSize: count > 99 ? 50 : 58,
              color: '#000000',
              top: 2,
              letterSpacing: -1,
            }}>
            {count}
          </Text>
          <Text
            style={{
              position: 'absolute',
              fontFamily: F.black,
              fontSize: count > 99 ? 50 : 58,
              color: '#000000',
              left: -2,
              letterSpacing: -1,
            }}>
            {count}
          </Text>
          <Text
            style={{
              position: 'absolute',
              fontFamily: F.black,
              fontSize: count > 99 ? 50 : 58,
              color: '#000000',
              right: -2,
              letterSpacing: -1,
            }}>
            {count}
          </Text>
          <Text
            style={{
              fontFamily: F.black,
              fontSize: count > 99 ? 50 : 58,
              color: '#ffffff',
              letterSpacing: -1,
            }}>
            {count}
          </Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Wave trigger button sitting next to the friend's name.
 * Supports:
 * - Single tap: 1 wave burst with push notification.
 * - Long hold: Accelerates rapidly from 160ms down to 35ms spamming waves.
 *   Sends notify=true only on wave 1, notify=false during the hold.
 */
export function WaveTrigger({
  friendId,
  onWaveTick,
  onWaveEnd,
}: {
  friendId: string;
  onWaveTick: (count: number) => void;
  onWaveEnd: () => void;
}) {
  const countRef = useRef(0);
  const activeRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(160);
  const squish = useSharedValue(1);

  const cleanUp = () => {
    activeRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    squish.value = withSpring(1, { damping: 20, stiffness: 350 });
  };

  const sendWaveApi = (cnt: number, notify: boolean) => {
    req('/v1/wave', {
      method: 'POST',
      body: { friend_id: friendId, count: cnt, notify },
    }).catch(() => {});
  };

  const scheduleNext = () => {
    if (!activeRef.current) return;
    countRef.current += 1;
    const current = countRef.current;
    onWaveTick(current);

    // Haptics: light impact on every wave, heavier on milestones
    if (current % 25 === 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } else if (current % 5 === 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    // Send batch to backend
    if (current % 5 === 0) {
      sendWaveApi(current, false);
    }

    // Accelerate: decreases interval dynamically down to 35ms
    delayRef.current = Math.max(35, Math.floor(delayRef.current * 0.93));
    timerRef.current = setTimeout(scheduleNext, delayRef.current);
  };

  const handlePressIn = () => {
    cleanUp();
    activeRef.current = true;
    countRef.current = 1;
    delayRef.current = 160;
    squish.value = withSpring(0.85, { damping: 25, stiffness: 450 });

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onWaveTick(1);

    // First wave: notify is true!
    sendWaveApi(1, true);

    // Start acceleration after initial hold delay
    timerRef.current = setTimeout(scheduleNext, 220);
  };

  const handlePressOut = () => {
    if (!activeRef.current) return;
    const finalCount = countRef.current;
    cleanUp();

    // If held and ended on non-multiple of 5, send final count
    if (finalCount > 1 && finalCount % 5 !== 0) {
      sendWaveApi(finalCount, false);
    }

    onWaveEnd();
  };

  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: squish.value }, { scaleY: squish.value }],
  }));

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={12}
      style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={btnStyle}>
        <Image
          source={WAVE_IMG}
          style={{ width: 32, height: 32 }}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      </Animated.View>
    </Pressable>
  );
}
