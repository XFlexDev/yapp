import { setMuted, useMuted } from '../lib/notifs';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Icon, Tap, type Move } from '../lib/icon';
import { confirm } from '../lib/native';
import { BlurBackdrop, ProgressiveBlur } from '../lib/blur';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Children, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dimensions, Keyboard, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, SlideInDown, FadeInLeft, FadeInRight, SlideOutDown, ZoomIn, ZoomOut, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withSpring, withTiming, withDelay, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { avatarUrl, mediaUrl, nameOf, req } from '../lib/api';
import { block, REASONS, report } from '../lib/safety';
import { BACKGROUNDS, chatOf, deleteChat, deleteMessage, loadChatPhotos, loadMessages, markRead, pickBackgroundPhoto, react as reactMsg, retry, saveImageAsSticker, savePhoto, sendMessage, sendPhotoTo, sendSticker, setBackground, type Photo } from '../lib/chat';
import { removeFriend, set, useStore, type ChatMsg } from '../lib/store';
import { C, F } from '../lib/theme';
import { Morph, Squish } from '../lib/tt';
import { Avatar } from '../lib/ui';
import { PICKER_H, StickerPicker, dropLast } from '../components/StickerPicker';
import { InlineBody } from '../components/MsgInline';
import { AttachSheet } from '../components/AttachSheet';
import { Slider } from '../components/Slider';
import { setLook, useLook, type Look } from '../lib/look';
import { PhotoViewer, type Shot } from '../components/PhotoViewer';
import { getCachedSticker, loadAllCustomStickers, loadRecentStickers, resolveSticker, saveSticker, type Sticker } from '../lib/stickers';

let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch {}

const out = Easing.bezier(0.23, 1, 0.32, 1);
export const G = { back: ['chevron.left', 'chevron-left'], palette: ['paintpalette.fill', 'palette'], send: ['arrow.up', 'arrow-up'], mic: ['mic.fill', 'microphone'], gear: ['gearshape.fill', 'cog'], minus: ['minus.circle.fill', 'minus-circle'], people: ['person.2.fill', 'account-multiple'], add: ['plus', 'plus'], plus: ['photo.badge.plus', 'image-plus'], photo: ['photo.fill', 'image'], sticker: ['face.smiling.inverse', 'sticker-emoji'] } as const;
export function MuteRow({ chat }: { chat: string }) {
  const muted = useMuted(chat);
  return (
    <SettingRow title="mute notifications" icon={muted ? ['bell.slash', 'bell-off-outline'] : ['bell', 'bell-outline']} onPress={() => setMuted(chat, !muted)}
      right={<Switch value={muted} onValueChange={(v) => { Haptics.selectionAsync(); setMuted(chat, v); }} trackColor={{ false: 'rgba(255,255,255,0.16)', true: C.red }} thumbColor="#fff" ios_backgroundColor="rgba(255,255,255,0.16)" style={{ alignSelf: 'center' }} />} />
  );
}

export function SettingRow({ title, onPress, more, danger, icon, right }: { title: string; onPress: () => void; more?: boolean; danger?: boolean; icon?: [string, string]; right?: ReactNode }) {
  const col = danger ? C.red : '#fff';
  return (
    <Tap onPress={() => { Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => ({ height: 54, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.07)' : 'transparent' })}>
      {icon ? (
        <View style={{ width: 28, marginRight: 12, alignItems: 'center' }}>
          <Icon sf={icon[0]} md={icon[1]} size={21} mdSize={23} weight="medium" color={col} move={danger ? 'wiggle' : 'bounce'} />
        </View>
      ) : null}
      <Text numberOfLines={1} style={{ flex: 1, color: col, fontFamily: F.black, fontSize: 16 }}>{title}</Text>
      {right ?? (more ? <Icon sf="chevron.right" md="chevron-right" size={13} mdSize={22} color="rgba(255,255,255,0.3)" move="right" /> : null)}
    </Tap>
  );
}

/** Rounded card that holds setting rows with hairlines between them. */
export function SettingGroup({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <View style={{ marginHorizontal: 14, borderRadius: 24, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      {items.map((c, i) => (
        <View key={i}>
          {i ? <View style={{ height: StyleSheet.hairlineWidth, marginLeft: 16, backgroundColor: 'rgba(255,255,255,0.1)' }} /> : null}
          {c}
        </View>
      ))}
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.black, fontSize: 13, paddingHorizontal: 24, marginTop: 4 }}>{children}</Text>;
}

// What each glyph does when its button is tapped; the rest bounce.
const GLYPH_MOVES: Partial<Record<keyof typeof G, Move>> = { back: 'left', gear: 'spin', send: 'up', add: 'spin', minus: 'wiggle' };

export function Glyph({ g, size = 20, color = '#fff' }: { g: keyof typeof G; size?: number; color?: string }) {
  return <Icon sf={G[g][0]} md={G[g][1]} size={size} mdSize={size + 4} color={color} move={GLYPH_MOVES[g]} />;
}

const ZWSP = '​';
const ID_TOKEN_RE = /:s-[0-9a-f]{32}:/;

/** Composer pill: text input plus inline custom-emoji chips. `text` keeps the raw
 * `:s-<id>:` tokens so messages stay plain strings; the chips are display-only. */
export function ComposerPill({ text, onChange, placeholder, onSticker }: { text: string; onChange: (t: string) => void; placeholder: string; onSticker: () => void }) {
  const segs = useMemo(() => text.split(/(:s-[0-9a-f]{32}:)/g), [text]);
  const lastSeg = segs[segs.length - 1] ?? '';
  const head = text.slice(0, text.length - lastSeg.length);
  const change = (v: string) => {
    if (!v.startsWith(ZWSP)) {
      // The zero-width sentinel was deleted: backspace at the edge pops the last emoji chip.
      let idx = -1;
      const re = /:s-[0-9a-f]{32}:/g;
      let mm;
      while ((mm = re.exec(head)) !== null) idx = mm.index;
      onChange(idx >= 0 ? head.slice(0, idx) : head);
      return;
    }
    onChange(head + v.slice(1));
  };
  return (
    <View style={{ flex: 1, minHeight: 44, maxHeight: 130, flexDirection: 'row', alignItems: 'center', borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', paddingLeft: 16, paddingRight: 4 }}>
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
        {segs.map((s, i) => {
          if (ID_TOKEN_RE.test(s)) {
            return <Image key={i} source={mediaUrl(`${s.slice(1, -1)}.webp`)} style={{ width: 26, height: 26, marginRight: 3, borderRadius: 6 }} contentFit="contain" cachePolicy="memory-disk" />;
          }
          if (i === segs.length - 1) {
            return (
              <TextInput key={i} value={ZWSP + lastSeg} onChangeText={change} placeholder={placeholder} placeholderTextColor="rgba(255,255,255,0.35)" multiline maxLength={2000} keyboardAppearance="dark" selectionColor={C.red}
                style={{ flexGrow: 1, minWidth: 56, color: '#fff', fontFamily: F.bold, fontSize: 16, paddingHorizontal: 0, paddingTop: 11, paddingBottom: 11 }} />
            );
          }
          return <Text key={i} style={{ color: '#fff', fontFamily: F.bold, fontSize: 16, paddingTop: 11, paddingBottom: 11 }}>{s}</Text>;
        })}
      </View>
      <Squish onPress={onSticker} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}><Glyph g="sticker" size={19} /></Squish>
    </View>
  );
}

/** What a background looks like before the user touches the sliders. */
export function lookOf(bg: string | null, look: Look = {}): { blur: number; bright: number; photo: boolean } {
  const photo = !!bg && (bg.startsWith('b-') || bg === 'photo');
  const base = bg?.startsWith('b-') ? { blur: 0, bright: 0.65 } : bg === 'photo' ? { blur: 1, bright: 0.45 } : { blur: 0, bright: 1 };
  return { blur: photo ? look.blur ?? base.blur : 0, bright: look.bright ?? base.bright, photo };
}

export function Backdrop({ bg, photo, look }: { bg: string | null; photo: string | null; look?: Look }) {
  const preset = BACKGROUNDS.find((b) => b.id === bg);
  const { blur, bright } = lookOf(bg, look);
  return (
    <Animated.View key={bg ?? 'none'} entering={FadeIn.duration(260)} exiting={FadeOut.duration(260)} style={StyleSheet.absoluteFill}>
      {bg?.startsWith('b-') ? <Image source={mediaUrl(bg)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" blurRadius={Math.round(blur * 40)} />
        : bg === 'photo' && photo ? <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={Math.round(blur * 40)} />
        : preset ? <LinearGradient colors={preset.colors} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />}
      {bright < 1 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${(1 - bright) * 0.9})` }]} /> : null}
    </Animated.View>
  );
}

/** Blur (photo backgrounds only) and brightness sliders for a chat's background. */
export function LookSliders({ chat, bg }: { chat: string; bg: string | null }) {
  const look = useLook(chat);
  const now = lookOf(bg, look);
  if (!bg) return null;
  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      {now.photo ? <Slider label="blur" value={now.blur} onChange={(v) => setLook(chat, { blur: v })} /> : null}
      <Slider label="brightness" value={now.bright} onChange={(v) => setLook(chat, { bright: Math.max(0.1, v) })} />
    </View>
  );
}

function sxy(v: number) {
  'worklet';
  return [{ scaleX: v }, { scaleY: v }];
}
const AV = 38;
const MORPH = { damping: 24, stiffness: 260, mass: 0.8 };

/** Photo bubble: exact aspect from the start, blurred preview until the WebP arrives from the CDN. */
function PhotoBubble({ m, onOpen, onRetry, onLongPress }: { m: ChatMsg; onOpen?: (s: Shot) => void; onRetry: () => void; onLongPress?: (e: any) => void }) {
  const [w, h, thumb] = (m.meta ?? '').split(',');
  const ratio = +w && +h ? Math.min(1.5, Math.max(0.6, +h / +w)) : 1;
  const src = m.body.startsWith('c-') ? mediaUrl(m.body) : m.body;
  const box = useRef<any>(null);
  // The viewer grows out of this bubble, so it needs to know where the bubble is on screen.
  const measure: NonNullable<Shot['measure']> = (cb) => {
    if (!box.current?.measureInWindow) return cb(null);
    box.current.measureInWindow((x: number, y: number, bw: number, bh: number) => cb(bw > 0 && bh > 0 ? { x, y, w: bw, h: bh } : null));
  };
  const open = () => measure((rect) => onOpen?.({ uri: src, thumb, iw: +w || undefined, ih: +h || undefined, rect: rect ?? undefined, measure }));
  return (
    <Pressable ref={box} onPress={() => (m.failed ? onRetry() : open())} onLongPress={onLongPress} delayLongPress={350} style={({ pressed }) => ({ transform: [{ scaleX: pressed ? 0.98 : 1 }, { scaleY: pressed ? 0.98 : 1 }] })}>
      <Image source={src} placeholder={thumb ? { uri: `data:image/webp;base64,${thumb}` } : undefined} placeholderContentFit="cover" contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={m.cid ?? m.id}
        style={{ width: 230, height: 230 * ratio, borderRadius: 20, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.08)', opacity: m.pending ? 0.6 : 1 }} />
    </Pressable>
  );
}

function StickerBubble({ m, onLongPress }: { m: ChatMsg; onLongPress?: (e: any) => void }) {
  const [wStr, hStr] = m.meta ? m.meta.split(':') : [];
  const metaW = wStr ? parseFloat(wStr) : 0;
  const metaH = hStr ? parseFloat(hStr) : 0;
  const ratio = metaW > 0 && metaH > 0 ? metaH / metaW : 1;

  // Preserve natural aspect ratio without forcing 1:1
  const maxW = 180;
  const maxH = 220;
  let w = 150;
  let h = Math.round(w * ratio);
  if (h > maxH) {
    h = maxH;
    w = Math.round(h / ratio);
  } else if (w > maxW) {
    w = maxW;
    h = Math.round(w * ratio);
  }

  const src = m.body.startsWith('s-') ? mediaUrl(m.body) : m.body;
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={350} style={({ pressed }) => ({ transform: [{ scaleX: pressed ? 0.94 : 1 }, { scaleY: pressed ? 0.94 : 1 }] })}>
      <Image
        source={src}
        style={{ width: w, height: h, opacity: m.pending ? 0.6 : 1 }}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
    </Pressable>
  );
}

export function FormattedMessageText({ text }: { text: string }) {
  const [resolved, setResolved] = useState<Record<string, Sticker>>({});

  const tokens = useMemo(() => {
    const list: string[] = [];
    const re = /:([a-zA-Z0-9_-]{2,34}):/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      list.push(m[1].toLowerCase());
    }
    return list;
  }, [text]);

  useEffect(() => {
    for (const name of tokens) {
      if (/^s-[0-9a-f]{32}$/.test(name)) continue;
      if (!resolved[name]) {
        const c = getCachedSticker(name);
        if (c) {
          setResolved((prev) => ({ ...prev, [name]: c }));
        } else {
          resolveSticker(name).then((s) => {
            if (s) setResolved((prev) => ({ ...prev, [name]: s }));
          }).catch(() => {});
        }
      }
    }
  }, [tokens]);

  // Check if message is purely 1-4 custom emojis
  const isOnlyEmojis = useMemo(() => {
    const trimmed = text.trim();
    const parts = trimmed.split(/\s+/);
    return parts.length > 0 && parts.length <= 4 && parts.every((p) => {
      const match = p.match(/^:([a-zA-Z0-9_-]{2,34}):$/);
      if (!match) return false;
      const token = match[1].toLowerCase();
      return /^s-[0-9a-f]{32}$/.test(token) || resolved[token]?.is_emoji;
    });
  }, [text, resolved]);

  // Check if message is a single standalone sticker
  const singleSticker = useMemo(() => {
    const m = text.trim().match(/^:([a-zA-Z0-9_-]{2,34}):$/);
    if (!m) return null;
    const stk = resolved[m[1].toLowerCase()];
    return stk && !stk.is_emoji ? stk : null;
  }, [text, resolved]);

  // Parse mixed text and custom emojis — hooks must run before any early return.
  const parts = useMemo(() => {
    const res: { type: 'text' | 'emoji'; content: string; stk?: Sticker; src?: string }[] = [];
    const re = /:([a-zA-Z0-9_-]{2,34}):/g;
    let lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIndex) {
        res.push({ type: 'text', content: text.slice(lastIndex, m.index) });
      }
      const name = m[1].toLowerCase();
      const stk = resolved[name];
      if (/^s-[0-9a-f]{32}$/.test(name)) {
        res.push({ type: 'emoji', content: m[0], src: mediaUrl(`${name}.webp`) });
      } else if (stk) {
        res.push({ type: 'emoji', content: m[0], stk });
      } else {
        res.push({ type: 'text', content: m[0] });
      }
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) {
      res.push({ type: 'text', content: text.slice(lastIndex) });
    }
    return res;
  }, [text, resolved]);

  if (singleSticker) {
    const ratio = singleSticker.width && singleSticker.height ? singleSticker.height / singleSticker.width : 1;
    const maxW = 180;
    const maxH = 220;
    let w = 150;
    let h = Math.round(w * ratio);
    if (h > maxH) {
      h = maxH;
      w = Math.round(h / ratio);
    } else if (w > maxW) {
      w = maxW;
      h = Math.round(w * ratio);
    }
    return (
      <Image
        source={singleSticker.url || mediaUrl(singleSticker.id)}
        style={{ width: w, height: h }}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
    );
  }

  if (isOnlyEmojis) {
    const parts = text.trim().split(/\s+/);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
        {parts.map((p, idx) => {
          const match = p.match(/^:([a-zA-Z0-9_-]{2,34}):$/)!;
          const token = match[1].toLowerCase();
          const direct = /^s-[0-9a-f]{32}$/.test(token);
          const stk = resolved[token];
          const src = direct ? mediaUrl(`${token}.webp`) : stk!.url || mediaUrl(stk!.id);
          const ratio = stk && stk.width && stk.height ? stk.height / stk.width : 1;
          const sz = 38;
          return (
            <Image
              key={idx}
              source={src}
              style={{ width: sz, height: Math.round(sz * ratio) }}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          );
        })}
      </View>
    );
  }


  // expo-image can't render inline inside <Text> on iOS — wrap segments instead.
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
      {parts.map((p, idx) => {
        if (p.type === 'emoji' && (p.stk || p.src)) {
          const src = p.src || p.stk!.url || mediaUrl(p.stk!.id);
          const ratio = p.stk && p.stk.width && p.stk.height ? p.stk.height / p.stk.width : 1;
          return (
            <Image
              key={idx}
              source={src}
              style={{ width: Math.round(22 / Math.min(ratio, 1)), height: 22, marginHorizontal: 1 }}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          );
        }
        return <Text key={idx} style={{ color: '#fff', fontFamily: F.bold, fontSize: 16, lineHeight: 22 }}>{p.content}</Text>;
      })}
    </View>
  );
}

export function ReplyQuote({ reply, name }: { reply: { from: string; kind: string; body: string }; name: string }) {
  const label = reply.kind === 'image' ? '\ud83d\udcf7 photo' : reply.kind === 'sticker' ? 'sticker' : reply.body;
  return (
    <View style={{ flexDirection: 'row', gap: 8, borderLeftWidth: 3, borderLeftColor: 'rgba(255,255,255,0.7)', paddingLeft: 8, marginBottom: 5 }}>
      <View style={{ flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 12, opacity: 0.9 }}>{name}</Text>
        {reply.kind === 'image' || reply.kind === 'sticker' ? <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.75)', fontFamily: F.bold, fontSize: 12 }}>{label}</Text>
          : <InlineBody body={label} singleLine emojiSize={13} style={{ color: 'rgba(255,255,255,0.75)', fontFamily: F.bold, fontSize: 12 }} />}
      </View>
    </View>
  );
}

export function Bubble({ m, mine, joined, fresh, seen, onRetry, onOpen, onDelete, onMenu, onReact, author, friendName, nameFor, onQuote, onAuthor }: { m: ChatMsg; mine: boolean; joined: boolean; fresh: boolean; seen: boolean | string; onRetry: () => void; onOpen?: (s: Shot) => void; onDelete?: () => void; onMenu?: (m: ChatMsg, y: number, x: number, r?: MenuRect) => void; onReact?: (emoji: string) => void; author?: string; friendName?: string; nameFor?: (uid: string) => string; onQuote?: () => void; onAuthor?: () => void }) {
  const quoteName = !m.reply ? '' : nameFor ? nameFor(m.reply.from) : m.reply.from === m.from ? (mine ? 'you' : friendName || 'them') : (mine ? friendName || 'them' : 'you');
  const hold = !m.pending && onMenu ? (e: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const py = e.nativeEvent.pageY, px = e.nativeEvent.pageX;
    const t = e.currentTarget;
    if (t?.measureInWindow) t.measureInWindow((x: number, y: number, w: number, h: number) => onMenu(m, py, px, w && h ? { x, y, w, h } : undefined));
    else onMenu(m, py, px);
  } : undefined;
  const chips = m.reactions ?? [];
  return (
    <Animated.View entering={fresh ? FadeInDown.duration(220).easing(out) : undefined} style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: joined ? 2 : 8 }}>
      {author && !joined ? <Text onPress={onAuthor} suppressHighlighting style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.bold, fontSize: 12, marginBottom: 3, marginLeft: 12 }}>{author}</Text> : null}
      {m.reply && (m.kind === 'image' || m.kind === 'sticker') ? (
        <Pressable onPress={onQuote} style={{ marginBottom: 4, paddingHorizontal: 6 }}><ReplyQuote reply={m.reply} name={quoteName} /></Pressable>
      ) : null}
      {m.kind === 'image' ? (
        <PhotoBubble m={m} onOpen={onOpen} onRetry={onRetry} onLongPress={hold} />
      ) : m.kind === 'sticker' ? (
        <StickerBubble m={m} onLongPress={hold} />
      ) : (
        <Pressable onPress={m.failed ? onRetry : undefined} onLongPress={hold} delayLongPress={350} style={{ maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderCurve: 'continuous', backgroundColor: mine ? C.red : 'rgba(255,255,255,0.13)', opacity: m.pending ? 0.6 : 1 }}>
          {m.reply ? <Pressable onPress={onQuote} onLongPress={hold} delayLongPress={350}><ReplyQuote reply={m.reply} name={quoteName} /></Pressable> : null}
          <FormattedMessageText text={m.body} />
        </Pressable>
      )}
      {chips.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
          {chips.map((r) => (
            <Animated.View key={r.emoji} entering={ZoomIn.duration(200).easing(out)} exiting={ZoomOut.duration(140)} layout={LinearTransition.duration(200).easing(out)}>
            <Pressable onPress={() => { Haptics.selectionAsync(); onReact?.(r.emoji); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' }}>
              <Text style={{ fontSize: 13 }}>{r.emoji}</Text>
              {r.users.length > 1 ? <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.bold, fontSize: 11 }}>{r.users.length}</Text> : null}
            </Pressable>
            </Animated.View>
          ))}
        </View>
      ) : null}
      {m.failed ? <Text style={{ color: C.danger, fontFamily: F.bold, fontSize: 12, marginTop: 3 }}>not sent · tap to retry</Text> : seen ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 12, marginTop: 3 }}>{typeof seen === 'string' ? seen : 'seen'}</Text> : null}
    </Animated.View>
  );
}

function dateLabel(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const daysAgo = Math.round((day(now) - day(date)) / 86_400_000);
  if (daysAgo === 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  if (daysAgo <= 6) return date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return `${date.getDate()} ${months[date.getMonth()]}${date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : ''}`;
}

export function sameCalendarDay(a: number, b: number) {
  const left = new Date(a), right = new Date(b);
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

export function DatePill({ timestamp }: { timestamp: number }) {
  return (
    <View style={{ alignSelf: 'center', marginVertical: 8, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ color: 'rgba(255,255,255,0.7)', fontFamily: F.bold, fontSize: 12 }}>{dateLabel(timestamp)}</Text>
    </View>
  );
}

export type MenuRect = { x: number; y: number; w: number; h: number };
const MENU_SPRING = { damping: 32, stiffness: 320, mass: 0.9 };
const SHEET_REACTIONS = ['\u2764\ufe0f', '\ud83d\udc4d', '\ud83d\udd25', '\ud83d\udcaf', '\ud83d\ude02', '\ud83d\ude4f', '\ud83d\ude22', '\ud83d\ude2e', '\ud83d\ude21', '\ud83c\udf89', '\ud83d\udc40', '\ud83d\udc80'];

/** Long-press message sheet: reactions on top, actions below. */
export function MsgMenu({
  m, onClose, onReply, onDelete, onReact, onForward,
}: {
  m: ChatMsg; mine: boolean; y: number; x: number; rect?: MenuRect; friendName?: string;
  onClose: () => void; onReply: () => void; onDelete?: () => void;
  onReact: (emoji: string) => void; onForward: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [saved, setSaved] = useState(false);
  const p = useSharedValue(0);
  const drag = useSharedValue(0);
  const closing = useRef(false);
  useEffect(() => { p.value = withSpring(1, MENU_SPRING); }, []);
  const finish = (after?: () => void) => { after?.(); onClose(); };
  const close = (after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    p.value = withTiming(0, { duration: 220, easing: Easing.bezier(0.4, 0, 0.2, 1) }, (done) => { if (done) runOnJS(finish)(after); });
  };
  const rows: { icon: [string, string]; label: string; danger?: boolean; go: () => void }[] = [];
  rows.push({ icon: ['arrowshape.turn.up.left', 'reply-outline'], label: 'reply', go: () => close(onReply) });
  rows.push({ icon: ['arrowshape.turn.up.right', 'share-outline'], label: 'forward', go: () => close(onForward) });
  if (m.kind === 'text' && Clipboard) rows.push({ icon: ['square.on.square', 'content-copy'], label: 'copy', go: () => { Clipboard.setStringAsync(m.body).catch(() => {}); close(); } });
  if (m.kind === 'sticker' || m.kind === 'image') {
    rows.push({
      icon: ['plus.square', 'sticker-plus-outline'],
      label: saved ? 'saved' : m.kind === 'sticker' ? 'save sticker' : 'save as sticker',
      go: async () => {
        if (saved) { close(); return; }
        try {
          if (m.kind === 'sticker') await saveSticker(m.body);
          else await saveImageAsSticker(m.body);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setSaved(true);
          setTimeout(() => close(), 500);
        } catch { close(); }
      },
    });
  }
  if (m.kind === 'image') {
    rows.push({
      icon: ['arrow.down.to.line', 'tray-arrow-down'], label: 'save to photos', go: async () => {
        try { if (await savePhoto(m.body)) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
        catch { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
        close();
      },
    });
  }
  if (onDelete) rows.push({ icon: ['trash', 'trash-can-outline'], label: 'delete', danger: true, go: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); close(onDelete); } });

  const SW = Dimensions.get('window').width;
  const PAD = 18, GAP = 8, ROW = 54;
  const CHIP = Math.min(58, Math.floor((SW - 16 - PAD * 2 - GAP * 5) / 6));
  const H = 22 + CHIP * 2 + GAP + 14 + rows.length * ROW + 12;
  const OFF = H + insets.bottom + 40;

  const shade = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, p.value)) * (1 - Math.min(1, drag.value / H) * 0.7) }));
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - p.value) * OFF + drag.value }] }));
  const pan = Gesture.Pan().activeOffsetY([-10, 10])
    .onChange((e) => { drag.value = e.translationY > 0 ? e.translationY : e.translationY * 0.15; })
    .onEnd((e) => {
      if (e.translationY > H * 0.3 || e.velocityY > 900) runOnJS(close)();
      else drag.value = withSpring(0, MENU_SPRING);
    });

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, shade]}>
        <BlurBackdrop />
        <Pressable style={{ flex: 1 }} onPress={() => close()} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, height: H, borderRadius: 34, borderCurve: 'continuous', backgroundColor: '#161616', paddingTop: 22, paddingHorizontal: PAD, overflow: 'hidden' }, sheet]}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: GAP }}>
            {SHEET_REACTIONS.map((e) => (
              <Pressable key={e} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); close(() => onReact(e)); }} style={({ pressed }) => ({ width: CHIP, height: CHIP, borderRadius: CHIP / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.09)', transform: [{ scaleX: pressed ? 0.9 : 1 }, { scaleY: pressed ? 0.9 : 1 }] })}>
                <Text style={{ fontSize: Math.round(CHIP * 0.48) }}>{e}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ marginTop: 14, marginHorizontal: -PAD }}>
            {rows.map((row) => {
              const col = row.danger ? C.red : '#fff';
              return (
                <Tap key={row.label} onPress={() => { Haptics.selectionAsync(); row.go(); }} style={({ pressed }) => ({ height: ROW, paddingHorizontal: PAD + 6, flexDirection: 'row', alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.07)' : 'transparent' })}>
                  <View style={{ width: 30, alignItems: 'center' }}>
                    <Icon sf={row.icon[0]} md={row.icon[1]} size={23} mdSize={25} weight="medium" color={col} move={row.danger ? 'wiggle' : 'bounce'} />
                  </View>
                  <Text style={{ marginLeft: 16, color: col, fontFamily: F.black, fontSize: 17 }}>{row.label}</Text>
                </Tap>
              );
            })}
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export function ForwardSheet({ m, onClose }: { m: ChatMsg; onClose: () => void }) {
  const friends = useStore((s) => s.friends);
  const groups = useStore((s) => s.groups);
  const send = async (fid: string, gid?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (gid) {
        const { sendGroup } = await import('../lib/groups');
        await sendGroup(gid, m.kind === 'text' ? m.body : m.body, undefined, m.kind, m.meta);
      } else if (m.kind === 'sticker') {
        await sendSticker(fid, m.body, m.meta);
      } else if (m.kind === 'image') {
        await sendMessage(fid, m.body, undefined, 'image', m.meta);
      } else {
        await sendMessage(fid, m.body);
      }
    } catch {}
    onClose();
  };
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]}>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={StyleSheet.absoluteFill}>
        <BlurBackdrop />
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <Animated.View entering={SlideInDown.duration(260).easing(out)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '70%', backgroundColor: '#141416', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderCurve: 'continuous', paddingBottom: 30 }}>
        <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.black, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 }}>forward to</Text>
        <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
          {Object.values(groups).map((g) => (
            <Pressable key={g.id} onPress={() => send('', g.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: pressed ? 'rgba(255,255,255,0.06)' : 'transparent' })}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}><Glyph g="people" size={18} /></View>
              <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 16 }}>{g.name}</Text>
            </Pressable>
          ))}
          {friends.map((f) => (
            <Pressable key={f.id} onPress={() => send(f.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: pressed ? 'rgba(255,255,255,0.06)' : 'transparent' })}>
              <Avatar user={f} size={44} />
              <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 16 }}>{nameOf(f)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/** Unsent text per chat, kept while the app is open so leaving a chat doesn't lose what you typed. */
export const drafts = new Map<string, string>();

/** Scrolls an inverted message list to a message and flashes it. */
export function useJump(msgs: ChatMsg[]) {
  const listRef = useRef<any>(null);
  const [lit, setLit] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const jump = (mid?: string | null) => {
    const i = mid ? msgs.findIndex((x) => x.id === mid) : -1;
    if (i < 0) return;
    Haptics.selectionAsync();
    listRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0.5 });
    setLit(mid!);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLit(null), 1200);
  };
  const toLatest = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });
  const onScrollToIndexFailed = (e: { index: number; averageItemLength: number }) => listRef.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: true });
  return { listRef, lit, jump, toLatest, onScrollToIndexFailed };
}

export default function ChatScreen() {
  const { id, ax, ay, as } = useLocalSearchParams<{ id: string; ax?: string; ay?: string; as?: string }>();
  const insets = useSafeAreaInsets();
  // Avatar morph: flies from where it sat in the chat list up into the header.
  const from = useRef(ax && ay && as ? { x: +ax, y: +ay, s: +as } : null).current;
  const avRef = useRef<React.ComponentRef<typeof View>>(null);
  const [land, setLand] = useState<{ x: number; y: number } | null>(null);
  const morph = useSharedValue(from ? 0 : 1);
  const onAvLayout = () => {
    if (!from || land) return;
    avRef.current?.measureInWindow((x, y) => { setLand({ x, y }); morph.value = withSpring(1, MORPH); });
  };
  const avStyle = useAnimatedStyle(() => {
    if (!from) return {};
    if (!land) return { opacity: 0 };
    const p = morph.value, k = from.s / AV;
    return {
      opacity: 1,
      transform: [
        { translateX: (from.x - land.x + (from.s - AV) / 2) * (1 - p) },
        { translateY: (from.y - land.y + (from.s - AV) / 2) * (1 - p) },
        ...sxy(k + (1 - k) * p),
      ],
    };
  });
  const textIn = useAnimatedStyle(() => ({ opacity: morph.value, transform: [{ translateX: (1 - morph.value) * -12 }] }));
  const friend = useStore((s) => s.friends.find((f) => f.id === id));
  const talking = useStore((s) => !!s.talkingTo[id!]);
  const chat = useStore((s) => s.chats[id!]) ?? chatOf(id!);
  const meId = useStore((s) => s.me?.id);
  const [text, setText] = useState(() => drafts.get(id!) ?? '');
  useEffect(() => { drafts.set(id!, text); }, [id, text]);
  const sendVisible = !!text.trim();
  const sendButtonStyle = useAnimatedStyle(() => ({
    width: withTiming(sendVisible ? 44 : 0, { duration: 160, easing: out }),
    opacity: withTiming(sendVisible ? 1 : 0, { duration: 160, easing: out }),
    transform: [{ scale: withTiming(sendVisible ? 1 : 0.82, { duration: 160, easing: out }) }],
  }));
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState<{ m: ChatMsg; y: number; x: number; r?: MenuRect } | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMsg | null>(null);
  const [forwarding, setForwarding] = useState<ChatMsg | null>(null);
  const [stickersVisible, setStickersVisible] = useState(false);
  const [view, setView] = useState<Shot | null>(null);
  const [attach, setAttach] = useState(false);
  const [page, setPage] = useState<null | 'bg' | 'photos' | 'report'>(null);
  const [photos, setPhotos] = useState<ChatMsg[] | null>(null);
  const [reported, setReported] = useState(false);
  const close = () => { setPicker(false); setPage(null); };
  const arm = (k: 'delete' | 'remove' | 'block', go: () => void) => {
    const who = friend ? nameOf(friend).toLowerCase() : 'them';
    const ask = {
      delete: ['delete this chat?', 'messages are removed for you.', 'delete'],
      remove: [`remove ${who}?`, 'they won’t be able to talk to you until you add each other again.', 'remove'],
      block: [`block ${who}?`, 'they can’t talk to you, call you or find you.', 'block'],
    }[k];
    confirm(ask[0], ask[1], ask[2], go);
  };
  const opened = useRef(Date.now());
  const look = useLook(id!);
  const { height: winH } = useWindowDimensions();
  const kb = useAnimatedKeyboard();
  const [kbPad, setKbPad] = useState(0);
  // Anything that opens over the chat would sit under the keyboard, so the keyboard goes first.
  const covered = !!menu || picker || !!forwarding || !!view || attach;
  useEffect(() => { if (covered) Keyboard.dismiss(); }, [covered]);
  const [barH, setBarH] = useState(50);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardWillShow', (e) => { setStickersVisible(false); setKbPad(Math.max(0, e.endCoordinates.height - insets.bottom)); });
    const c = Keyboard.addListener('keyboardDidShow', () => setStickersVisible(false));
    const b = Keyboard.addListener('keyboardDidHide', () => setKbPad(0));
    return () => { a.remove(); b.remove(); c.remove(); };
  }, [insets.bottom]);
  const pk = useSharedValue(0);
  useEffect(() => { pk.value = withTiming(stickersVisible ? PICKER_H - 8 : 0, { duration: 260, easing: Easing.out(Easing.cubic) }); }, [stickersVisible]);
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(kb.height.value - insets.bottom, pk.value, 0) }] }));

  useEffect(() => {
    set({ openChat: id });
    loadMessages(id!).then(() => markRead(id!)).catch(() => {});
    Promise.all([loadRecentStickers(), loadAllCustomStickers()])
      .then(([r, all]) => {
        const seen = new Set<string>();
        setCustomList([...r, ...all].filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))));
      })
      .catch(() => {});
    return () => set({ openChat: null });
  }, [id]);

  const [customList, setCustomList] = useState<Sticker[]>([]);
  const matchColon = text.match(/:([a-zA-Z0-9_-]+)$/);
  const colonQuery = matchColon ? matchColon[1].toLowerCase() : null;

  const suggestions = useMemo(() => {
    if (!colonQuery || /^s-[0-9a-f]{1,32}$/.test(colonQuery)) return [];
    return customList.filter((s) => s.name?.toLowerCase().includes(colonQuery)).slice(0, 5);
  }, [colonQuery, customList]);

  const insertSuggestion = (s: Sticker) => {
    if (!s.name) return;
    Haptics.selectionAsync();
    const replaced = text.replace(/:([a-zA-Z0-9_-]+)$/, `:${s.name}: `);
    setText(replaced);
  };

  const msgs = chat.messages;
  const { listRef, lit, jump, toLatest, onScrollToIndexFailed } = useJump(msgs);
  if (!friend) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  const nameFor = (uid: string) => (uid === meId ? 'you' : nameOf(friend).toLowerCase());
  const lastMine = msgs.find((m) => m.from === meId && !m.pending && !m.failed);
  // With the keyboard or the picker up, the blur ends at the typing box instead of running into them.
  const lifted = kbPad > 0 || stickersVisible;
  // How far the blur reaches below the typing box: to the screen edge, to the keyboard, or a little behind the picker's rounded top.
  const under = stickersVisible ? 24 : lifted ? 8 : insets.bottom + 8;
  const sendPhotos = async (list: Photo[]) => {
    const r = replyingTo?.id;
    setReplyingTo(null);
    toLatest();
    for (let i = 0; i < list.length; i++) await sendPhotoTo(id!, list[i], i ? undefined : r);
  };
  const send = () => {
    const b = text.trim();
    if (!b) return;
    Haptics.selectionAsync();
    setText('');
    sendMessage(id!, b, replyingTo?.id);
    setReplyingTo(null);
    toLatest();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Backdrop bg={chat.background} photo={avatarUrl(friend)} look={look} />
      <ProgressiveBlur height={insets.top + 68} style={{ zIndex: 1 }} />
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, paddingTop: insets.top + 4, paddingHorizontal: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Squish onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="back" size={22} /></Squish>
        <Pressable onPress={() => { Haptics.selectionAsync(); router.push({ pathname: '/user', params: { id: friend.id } }); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Animated.View ref={avRef} onLayout={onAvLayout} style={avStyle}><Avatar user={friend} size={AV} /></Animated.View>
        <Animated.View style={[{ flex: 1 }, textIn]}>
          <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 18 }}>{nameOf(friend)}</Text>
          <Text style={{ color: talking ? C.red : friend.online && !friend.dnd ? C.online : 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 13 }}>{talking ? `${nameOf(friend).toLowerCase()} is talking` : friend.dnd ? 'do not disturb' : friend.online ? 'online' : 'offline'}</Text>
        </Animated.View>
        </Pressable>
        <Squish onPress={() => { Haptics.selectionAsync(); setPicker(true); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="gear" /></Squish>
      </View>
      <View style={{ flex: 1, overflow: 'hidden' }}>
      <Animated.View entering={FadeIn.duration(260)} style={[{ flex: 1, paddingBottom: insets.bottom + 8 }, lift]}>
        <Animated.FlatList
          ref={listRef}
          extraData={lit}
          onScrollToIndexFailed={onScrollToIndexFailed}
          itemLayoutAnimation={LinearTransition.duration(220).easing(out)}
          windowSize={9}
          maxToRenderPerBatch={12}
          inverted
          data={msgs}
          keyExtractor={(m) => m.cid ?? m.id}
          renderItem={({ item, index }) => {
            const older = msgs[index + 1];
            // The label sits above the first message of each day, and a new day always starts a new group.
            const newDay = older ? !sameCalendarDay(item.created_at, older.created_at) : !chat.more;
            const joined = !!older && !newDay && older.from === item.from && item.created_at >= older.created_at && item.created_at - older.created_at <= 120_000;
            return (
              <View style={lit === item.id ? { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16 } : undefined}>
                {newDay ? <DatePill timestamp={item.created_at} /> : null}
                <Bubble m={item} mine={item.from === meId} joined={joined} fresh={item.created_at > opened.current} friendName={nameOf(friend)}
                  nameFor={nameFor} onQuote={() => jump(item.reply_to)}
                  seen={item.id === lastMine?.id && chat.theirReadAt >= item.created_at} onRetry={() => retry(id!, item)} onOpen={setView}
                  onReact={(e: string) => reactMsg(id!, item.id, e).catch(() => {})}
                  onMenu={(mm, y, x, r) => setMenu({ m: mm, y, x, r })}
                  onDelete={item.from === meId ? () => deleteMessage(id!, item).catch(() => {}) : undefined} />
              </View>
            );
          }}
          onEndReached={() => loadMessages(id!, true).catch(() => {})}
          onEndReachedThreshold={0.4}
          style={{ marginBottom: -(barH + insets.bottom + 8) }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: barH + insets.bottom + 16, paddingBottom: insets.top + 64 + Math.max(kbPad, stickersVisible ? PICKER_H : 0), flexGrow: 1 }}
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollIndicatorInsets={{ top: barH + insets.bottom + 28, bottom: insets.top + 68 + Math.max(kbPad, stickersVisible ? PICKER_H : 0) }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={chat.loaded && !msgs.length ? <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.bold, fontSize: 15, textAlign: 'center', marginTop: 40 }}>say hi to {nameOf(friend).toLowerCase()}</Text> : undefined}
        />
        <View onLayout={(e) => setBarH(e.nativeEvent.layout.height)}>
        <ProgressiveBlur edge="bottom" height={barH + 20 + under} style={{ bottom: -under }} />
        {suggestions.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 6 }}>
            {suggestions.map((s: Sticker) => (
              <Pressable
                key={s.id}
                onPress={() => insertSuggestion(s)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 14,
                  backgroundColor: 'rgba(255,255,255,0.14)',
                }}>
                <Image source={s.url || mediaUrl(s.id)} style={{ width: 20, height: 20 }} contentFit="contain" />
                <Text style={{ color: '#fff', fontFamily: F.bold, fontSize: 13 }}>:{s.name}:</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {replyingTo ? (
          <Animated.View entering={FadeInDown.duration(160).easing(out)} exiting={FadeOut.duration(120)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 10, marginBottom: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: C.red }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.red, fontFamily: F.black, fontSize: 12 }}>{replyingTo.from === meId ? 'you' : nameOf(friend)}</Text>
              {replyingTo.kind === 'image' ? <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.7)', fontFamily: F.bold, fontSize: 13 }}>{'\ud83d\udcf7 photo'}</Text>
                : replyingTo.kind === 'sticker' ? <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.7)', fontFamily: F.bold, fontSize: 13 }}>sticker</Text>
                : <InlineBody body={replyingTo.body} singleLine emojiSize={14} style={{ color: 'rgba(255,255,255,0.7)', fontFamily: F.bold, fontSize: 13 }} />}
            </View>
            <Pressable onPress={() => setReplyingTo(null)} hitSlop={10} style={{ paddingHorizontal: 4, paddingVertical: 6 }}>
              <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 13 }}>cancel</Text>
            </Pressable>
          </Animated.View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 6 }}>
          <Squish onPress={() => { Haptics.selectionAsync(); setStickersVisible(false); setAttach(true); }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}><Glyph g="add" size={20} /></Squish>
          <ComposerPill text={text} onChange={setText} placeholder="message" onSticker={() => { Haptics.selectionAsync(); Keyboard.dismiss(); setStickersVisible((v) => !v); }} />
          <Animated.View style={[{ overflow: 'hidden' }, sendButtonStyle]}>
            {sendVisible ? <Squish onPress={send} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><Glyph g="send" size={18} color="#000" /></Squish> : null}
          </Animated.View>
        </View>
        </View>
      </Animated.View>
      </View>
      {menu ? (
        <MsgMenu
          m={menu.m} mine={menu.m.from === meId} y={menu.y} x={menu.x} rect={menu.r} friendName={nameOf(friend)}
          onClose={() => setMenu(null)}
          onReply={() => { setReplyingTo(menu.m); setMenu(null); }}
          onDelete={menu.m.from === meId ? () => deleteMessage(id!, menu.m).catch(() => {}) : undefined}
          onReact={(e) => reactMsg(id!, menu.m.id, e).catch(() => {})}
          onForward={() => { setForwarding(menu.m); setMenu(null); }}
        />
      ) : null}
      {forwarding ? <ForwardSheet m={forwarding} onClose={() => setForwarding(null)} /> : null}
      <StickerPicker
        visible={stickersVisible}
        onClose={() => setStickersVisible(false)}
        bottomInset={insets.bottom}
        onBackspace={() => setText((prev) => dropLast(prev))}
        onPickEmoji={(emoji) => setText((prev) => prev + emoji)}
        onPickSticker={(stk) => {
          const meta = stk.width && stk.height ? `${stk.width}:${stk.height}:${stk.name || ''}` : undefined;
          sendSticker(id!, stk.id, meta, replyingTo?.id).catch(() => {});
          setReplyingTo(null);
          toLatest();
        }}
      />
      {picker ? (
        <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(180)} style={StyleSheet.absoluteFill}><BlurBackdrop /><Pressable style={{ flex: 1 }} onPress={close} /></Animated.View>
          <Animated.View entering={SlideInDown.duration(320).easing(out)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, borderRadius: 34, borderCurve: 'continuous', backgroundColor: '#161616', paddingTop: 22, paddingBottom: 14 }}>
            <Morph max={Math.round(winH * 0.85) - 36}>
            {page ? (
              <Animated.View key={page} entering={FadeInRight.duration(260).easing(out)} style={{ gap: 12, flexShrink: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
                  <Squish onPress={() => setPage(null)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="back" size={20} /></Squish>
                  <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 20, textAlign: 'center', marginRight: 44 }}>{page === 'bg' ? 'background' : page === 'photos' ? 'photos' : 'report'}</Text>
                </View>
                {page === 'bg' ? (
            <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 12 }}>
              <Squish onPress={() => { Haptics.selectionAsync(); pickBackgroundPhoto(id!).catch(() => {}); }} style={{ width: 58, height: 58, borderRadius: 29, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                <Glyph g="plus" size={20} />
              </Squish>
              {chat.background?.startsWith('b-') ? (
                <View style={{ width: 58, height: 58, borderRadius: 29, overflow: 'hidden', borderWidth: 3, borderColor: '#fff' }}><Image source={mediaUrl(chat.background)} style={StyleSheet.absoluteFill} /></View>
              ) : null}
              {[null, 'photo', ...BACKGROUNDS.map((b) => b.id)].map((b) => {
                const p = BACKGROUNDS.find((x) => x.id === b);
                const on = chat.background === b;
                return (
                  <Squish key={b ?? 'none'} onPress={() => { Haptics.selectionAsync(); setBackground(id!, b); }} style={{ width: 58, height: 58, borderRadius: 29, overflow: 'hidden', borderWidth: on ? 3 : 1, borderColor: on ? '#fff' : 'rgba(255,255,255,0.2)', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
                    {p ? <LinearGradient colors={p.colors} style={StyleSheet.absoluteFill} /> : b === 'photo' && avatarUrl(friend) ? <Image source={avatarUrl(friend)} style={StyleSheet.absoluteFill} blurRadius={8} /> : null}
                    {!b ? <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.black, fontSize: 12 }}>none</Text> : null}
                  </Squish>
                );
              })}
            </ScrollView>
            <LookSliders chat={id!} bg={chat.background} />
            </>
                ) : page === 'photos' ? (
                  <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 12 }}>
                    {photos === null ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 15, padding: 12 }}>loading…</Text>
                      : !photos.length ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 15, padding: 12 }}>no photos yet</Text>
                      : photos.map((p) => { const [, , t] = (p.meta ?? '').split(','); const src = mediaUrl(p.body); return (
                        <Pressable key={p.id} onPress={() => setView({ uri: src })} style={{ width: '32.4%', aspectRatio: 1 }}>
                          <Image source={src} placeholder={t ? { uri: `data:image/webp;base64,${t}` } : undefined} contentFit="cover" cachePolicy="memory-disk" transition={150} style={{ flex: 1, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' }} />
                        </Pressable>
                      ); })}
                  </ScrollView>
                ) : (
                  <SettingGroup>
                    {REASONS.map((r) => (
                      <SettingRow key={r} title={r} onPress={() => { report(friend.id, r).catch(() => {}); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setPage(null); setReported(true); }} />
                    ))}
                  </SettingGroup>
                )}
              </Animated.View>
            ) : (
              <Animated.View key="main" entering={FadeInLeft.duration(260).easing(out)} style={{ gap: 12, flexShrink: 1 }}>
                <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 20, textAlign: 'center', marginBottom: 2 }}>chat settings</Text>
                <SettingGroup>
                  <MuteRow chat={id!} />
                  <SettingRow title="background" icon={['paintpalette', 'palette-outline']} onPress={() => setPage('bg')} more />
                  <SettingRow title="photos" icon={['photo.on.rectangle', 'image-multiple-outline']} onPress={() => { setPage('photos'); setPhotos(null); loadChatPhotos(id!).then(setPhotos).catch(() => setPhotos([])); }} more />
                </SettingGroup>
                <SettingGroup>
                  <SettingRow title={reported ? 'reported, thanks' : `report ${nameOf(friend).toLowerCase()}`} icon={['flag', 'flag-outline']} onPress={() => !reported && setPage('report')} more={!reported} />
                  <SettingRow title="remove friend" icon={['person.badge.minus', 'account-minus-outline']} danger onPress={() => arm('remove', () => { req(`/v1/friends/${friend.id}`, { method: 'DELETE' }).then(() => removeFriend(friend.id)).catch(() => {}); close(); router.back(); })} />
                  <SettingRow title="block" icon={['hand.raised', 'hand-back-left-outline']} danger onPress={() => arm('block', () => { block(friend.id).catch(() => {}); close(); router.back(); })} />
                </SettingGroup>
                <SettingGroup>
                  <SettingRow title="delete chat" icon={['trash', 'trash-can-outline']} danger onPress={() => arm('delete', () => { deleteChat(id!).catch(() => {}); close(); router.back(); })} />
                </SettingGroup>
              </Animated.View>
            )}
            </Morph>
          </Animated.View>
        </View>
      ) : null}
      <AttachSheet visible={attach} onClose={() => setAttach(false)} onSend={sendPhotos}
        actions={[
          { title: 'stickers and emoji', sub: 'send one or add your own', icon: ['face.smiling', 'sticker-emoji'], onPress: () => setStickersVisible(true) },
          { title: 'chat background', sub: 'a color or your own photo', icon: ['paintpalette', 'palette-outline'], onPress: () => { setPicker(true); setPage('bg'); } },
        ]} />
      <PhotoViewer shot={view} onClose={() => setView(null)} />
    </View>
  );
}
