import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { setMuted, useMuted } from '../lib/notifs';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, SlideInDown, SlideInRight, SlideOutDown, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withSpring, withTiming, withDelay } from 'react-native-reanimated';;
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { avatarUrl, mediaUrl, nameOf, req } from '../lib/api';
import { block, REASONS, report } from '../lib/safety';
import { BACKGROUNDS, chatOf, deleteChat, deleteMessage, loadChatPhotos, loadMessages, markRead, pickBackgroundPhoto, react as reactMsg, retry, saveImageAsSticker, sendMessage, sendPhoto, sendSticker, setBackground } from '../lib/chat';
import { removeFriend, set, useStore, type ChatMsg } from '../lib/store';
import { C, F } from '../lib/theme';
import { Squish } from '../lib/tt';
import { Avatar } from '../lib/ui';
import { PICKER_H, StickerPicker, dropLast } from '../components/StickerPicker';
import { InlineBody } from '../components/MsgInline';
import { getCachedSticker, loadAllCustomStickers, loadRecentStickers, resolveSticker, saveSticker, type Sticker } from '../lib/stickers';
import { BlurView } from 'expo-blur';

let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch {}
let MediaLibrary: any = null;
try { MediaLibrary = require('expo-media-library'); } catch {}

const out = Easing.bezier(0.23, 1, 0.32, 1);
export const G = { back: ['chevron.left', 'chevron-left'], palette: ['paintpalette.fill', 'palette'], send: ['arrow.up', 'arrow-up'], mic: ['mic.fill', 'microphone'], gear: ['gearshape.fill', 'cog'], minus: ['minus.circle.fill', 'minus-circle'], people: ['person.2.fill', 'account-multiple'], add: ['plus', 'plus'], plus: ['photo.badge.plus', 'image-plus'], photo: ['photo.fill', 'image'], sticker: ['face.smiling.inverse', 'sticker-emoji'] } as const;
export function MuteRow({ chat }: { chat: string }) {
  const muted = useMuted(chat);
  return (
    <Squish onPress={() => { Haptics.selectionAsync(); setMuted(chat, !muted); }} style={{ marginHorizontal: 18, height: 48, borderRadius: 24, backgroundColor: muted ? '#fff' : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: muted ? '#000' : '#fff', fontFamily: F.black, fontSize: 16 }}>{muted ? 'muted · tap to unmute' : 'mute notifications'}</Text>
    </Squish>
  );
}

export function SettingRow({ title, onPress, more, danger }: { title: string; onPress: () => void; more?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => ({ marginHorizontal: 10, height: 52, borderRadius: 22, backgroundColor: danger ? C.danger : 'rgba(255,255,255,0.06)', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 16 }}>{title}</Text>
      {more ? <Text style={{ color: 'rgba(255,255,255,0.35)', fontFamily: F.black, fontSize: 18 }}>›</Text> : null}
    </Pressable>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.black, fontSize: 13, paddingHorizontal: 24, marginTop: 4 }}>{children}</Text>;
}

export function Glyph({ g, size = 20, color = '#fff' }: { g: keyof typeof G; size?: number; color?: string }) {
  return <SymbolView name={G[g][0] as any} tintColor={color} size={size} weight="bold" fallback={<MaterialCommunityIcons name={G[g][1] as any} size={size + 4} color={color} />} />;
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

export function Backdrop({ bg, photo }: { bg: string | null; photo: string | null }) {
  const preset = BACKGROUNDS.find((b) => b.id === bg);
  return (
    <Animated.View key={bg ?? 'none'} entering={FadeIn.duration(260)} exiting={FadeOut.duration(260)} style={StyleSheet.absoluteFill}>
      {bg?.startsWith('b-') ? (
        <>
          <Image source={mediaUrl(bg)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
        </>
      ) : bg === 'photo' && photo ? (
        <>
          <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
        </>
      ) : preset ? <LinearGradient colors={preset.colors} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />}
    </Animated.View>
  );
}

function sxy(v: number) {
  'worklet';
  return [{ scaleX: v }, { scaleY: v }];
}
const AV = 38;
const MORPH = { damping: 24, stiffness: 260, mass: 0.8 };

/** Photo bubble: exact aspect from the start, blurred preview until the WebP arrives from the CDN. */
function PhotoBubble({ m, onOpen, onRetry, onLongPress }: { m: ChatMsg; onOpen?: (uri: string) => void; onRetry: () => void; onLongPress?: (e: any) => void }) {
  const [w, h, thumb] = (m.meta ?? '').split(',');
  const ratio = +w && +h ? Math.min(1.5, Math.max(0.6, +h / +w)) : 1;
  const src = m.body.startsWith('c-') ? mediaUrl(m.body) : m.body;
  return (
    <Pressable onPress={() => (m.failed ? onRetry() : onOpen?.(src))} onLongPress={onLongPress} delayLongPress={350} style={({ pressed }) => ({ transform: [{ scaleX: pressed ? 0.98 : 1 }, { scaleY: pressed ? 0.98 : 1 }] })}>
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

export function PhotoViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  if (!uri) return null;
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={[StyleSheet.absoluteFill, { backgroundColor: '#000', zIndex: 20 }]}>
      <Pressable style={{ flex: 1 }} onPress={onClose}><Image source={uri} style={{ flex: 1 }} contentFit="contain" cachePolicy="memory-disk" /></Pressable>
    </Animated.View>
  );
}

const QUICK_REACTIONS = ['\u2764\ufe0f', '\ud83d\ude02', '\ud83d\udc4d', '\ud83d\ude2e', '\ud83d\ude22', '\ud83d\udd25'];

export function ReplyQuote({ reply, name }: { reply: { from: string; kind: string; body: string }; name: string }) {
  const label = reply.kind === 'image' ? '\ud83d\udcf7 photo' : reply.kind === 'sticker' ? 'sticker' : reply.body;
  return (
    <View style={{ flexDirection: 'row', gap: 8, borderLeftWidth: 3, borderLeftColor: 'rgba(255,255,255,0.7)', paddingLeft: 8, marginBottom: 5 }}>
      <View style={{ flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 12, opacity: 0.9 }}>{name}</Text>
        <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.75)', fontFamily: F.bold, fontSize: 12 }}>{label}</Text>
      </View>
    </View>
  );
}

export function Bubble({ m, mine, joined, fresh, seen, onRetry, onOpen, onDelete, onMenu, onReact, author, friendName }: { m: ChatMsg; mine: boolean; joined: boolean; fresh: boolean; seen: boolean | string; onRetry: () => void; onOpen?: (uri: string) => void; onDelete?: () => void; onMenu?: (m: ChatMsg, y: number, x: number) => void; onReact?: (emoji: string) => void; author?: string; friendName?: string }) {
  const hold = !m.pending && onMenu ? (e: any) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onMenu(m, e.nativeEvent.pageY, e.nativeEvent.pageX); } : undefined;
  const chips = m.reactions ?? [];
  return (
    <Animated.View entering={fresh ? FadeInDown.duration(220).easing(out) : undefined} style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: joined ? 2 : 8 }}>
      {author && !joined ? <Text style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.bold, fontSize: 12, marginBottom: 3, marginLeft: 12 }}>{author}</Text> : null}
      {m.reply && (m.kind === 'image' || m.kind === 'sticker') ? (
        <View style={{ marginBottom: 4, paddingHorizontal: 6 }}><ReplyQuote reply={m.reply} name={m.reply.from === m.from ? (mine ? 'you' : friendName || 'them') : (mine ? friendName || 'them' : 'you')} /></View>
      ) : null}
      {m.kind === 'image' ? (
        <PhotoBubble m={m} onOpen={onOpen} onRetry={onRetry} onLongPress={hold} />
      ) : m.kind === 'sticker' ? (
        <StickerBubble m={m} onLongPress={hold} />
      ) : (
        <Pressable onPress={m.failed ? onRetry : undefined} onLongPress={hold} delayLongPress={350} style={{ maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderCurve: 'continuous', backgroundColor: mine ? C.red : 'rgba(255,255,255,0.13)', opacity: m.pending ? 0.6 : 1 }}>
          {m.reply ? <ReplyQuote reply={m.reply} name={m.reply.from === m.from ? (mine ? 'you' : friendName || 'them') : (mine ? friendName || 'them' : 'you')} /> : null}
          <FormattedMessageText text={m.body} />
        </Pressable>
      )}
      {chips.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
          {chips.map((r) => (
            <Pressable key={r.emoji} onPress={() => { Haptics.selectionAsync(); onReact?.(r.emoji); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' }}>
              <Text style={{ fontSize: 13 }}>{r.emoji}</Text>
              {r.users.length > 1 ? <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.bold, fontSize: 11 }}>{r.users.length}</Text> : null}
            </Pressable>
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

export function MsgMenu({
  m, mine, y, x, friendName, onClose, onReply, onDelete, onReact, onForward,
}: {
  m: ChatMsg; mine: boolean; y: number; x: number; friendName?: string;
  onClose: () => void; onReply: () => void; onDelete?: () => void;
  onReact: (emoji: string) => void; onForward: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const rows: { icon: [string, string]; label: string; danger?: boolean; go: () => void }[] = [];
  rows.push({ icon: ['arrowshape.turn.up.left.fill', 'arrow-undo'], label: 'reply', go: onReply });
  if (m.kind === 'text' && Clipboard) rows.push({ icon: ['doc.on.doc.fill', 'content-copy'], label: 'copy', go: () => { Clipboard.setStringAsync(m.body).catch(() => {}); onClose(); } });
  if (m.kind === 'sticker' || m.kind === 'image') {
    rows.push({
      icon: ['plus.square.fill', 'sticker-plus-outline'],
      label: saved ? 'saved' : m.kind === 'sticker' ? 'save sticker' : 'save as sticker',
      go: async () => {
        if (saved) { onClose(); return; }
        try {
          if (m.kind === 'sticker') await saveSticker(m.body);
          else await saveImageAsSticker(m.body);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setSaved(true);
          setTimeout(onClose, 500);
        } catch { onClose(); }
      },
    });
  }
  if (m.kind === 'image' && MediaLibrary) {
    rows.push({
      icon: ['arrow.down.to.line.compact', 'download'], label: 'save to photos', go: async () => {
        try {
          const url = mediaUrl(m.body);
          const r = await MediaLibrary.requestPermissionsAsync(true);
          if (r.granted) { await MediaLibrary.saveToLibraryAsync(url); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
        } catch {}
        onClose();
      },
    });
  }
  rows.push({ icon: ['arrowshape.turn.up.right.fill', 'arrow-redo'], label: 'forward', go: onForward });
  if (onDelete) rows.push({ icon: ['trash.fill', 'delete'], label: 'delete', danger: true, go: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); onDelete(); onClose(); } });

  const W = 230, ROW = 46, MENU_H = rows.length * ROW + 14;
  const SCREEN_H = Dimensions.get('window').height;
  const CLONE_H = m.kind === 'image' ? 200 : m.kind === 'sticker' ? 150 : 60;
  // enough room below the tap → clone at tap, pill+card underneath; otherwise flip so the card lands above
  const below = y + CLONE_H / 2 + 56 + MENU_H + 30 < SCREEN_H;
  const cloneTop = below ? Math.max(y - CLONE_H / 2, 70) : Math.max(y - CLONE_H / 2 - 56 - MENU_H - 10, 70);
  const springIn = FadeIn.duration(1);
  const morph = { damping: 26, stiffness: 320, mass: 0.9 };

  const clone = (
    <Animated.View
      entering={(s: any) => {
        'worklet';
        return {
          initialValues: { opacity: 0, transform: [{ scale: 0.55 }, { translateY: 14 }] },
          animations: {
            opacity: withTiming(1, { duration: 110 }),
            transform: [{ scale: withSpring(1, morph) }, { translateY: withSpring(0, morph) }],
          },
        };
      }}
      exiting={FadeOut.duration(90)}
      style={{ alignItems: mine ? 'flex-end' : 'flex-start', paddingHorizontal: 12 }}>
      {m.kind === 'image' ? (
        <Image source={mediaUrl(m.body)} style={{ width: 200, height: 200 }} contentFit="contain" cachePolicy="memory-disk" />
      ) : m.kind === 'sticker' ? (
        <Image source={mediaUrl(m.body)} style={{ width: 150, height: 150 }} contentFit="contain" cachePolicy="memory-disk" />
      ) : (
        <View style={{ maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderCurve: 'continuous', backgroundColor: mine ? C.red : 'rgba(255,255,255,0.2)' }}>
          <FormattedMessageText text={m.body} />
        </View>
      )}
    </Animated.View>
  );

  const pill = (
    <Animated.View
      entering={(s: any) => {
        'worklet';
        return {
          initialValues: { opacity: 0, transform: [{ scale: 0.6 }, { translateY: below ? -8 : 8 }] },
          animations: {
            opacity: withTiming(1, { duration: 120 }),
            transform: [{ scale: withDelay(50, withSpring(1, morph)) }, { translateY: withDelay(50, withSpring(0, morph)) }],
          },
        };
      }}
      exiting={FadeOut.duration(90)}
      style={{ flexDirection: 'row', alignSelf: 'center', gap: 2, backgroundColor: 'rgba(40,40,44,0.95)', borderRadius: 24, paddingHorizontal: 6, paddingVertical: 4, marginVertical: 10 }}>
      {QUICK_REACTIONS.map((e) => (
        <Pressable key={e} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onReact(e); onClose(); }} style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.15)' : 'transparent' })}>
          <Text style={{ fontSize: 22 }}>{e}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );

  const card = (
    <Animated.View
      entering={(s: any) => {
        'worklet';
        return {
          initialValues: { opacity: 0, transform: [{ scaleY: 0.6 }, { scaleX: 0.85 }, { translateY: below ? -10 : 10 }] },
          animations: {
            opacity: withTiming(1, { duration: 110 }),
            transform: [{ scaleY: withDelay(80, withSpring(1, morph)) }, { scaleX: withDelay(80, withSpring(1, morph)) }, { translateY: withDelay(80, withSpring(0, morph)) }],
          },
        };
      }}
      exiting={FadeOut.duration(90)}
      style={{ alignSelf: mine ? 'flex-end' : 'flex-start', marginRight: mine ? 12 : 0, marginLeft: mine ? 0 : 12, width: W, borderRadius: 18, borderCurve: 'continuous', backgroundColor: 'rgba(30,30,34,0.97)', overflow: 'hidden' }}>
      {rows.map((r, i) => (
        <Animated.View
          key={r.label}
          entering={(s: any) => {
            'worklet';
            return { initialValues: { opacity: 0 }, animations: { opacity: withDelay(110 + i * 28, withTiming(1, { duration: 110 })) } };
          }}>
          <Pressable onPress={() => { Haptics.selectionAsync(); r.go(); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: ROW, backgroundColor: pressed ? 'rgba(255,255,255,0.08)' : 'transparent', borderBottomWidth: i === rows.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' })}>
            <SymbolView name={r.icon[0] as any} size={17} tintColor={r.danger ? C.danger : '#fff'} fallback={<MaterialCommunityIcons name={r.icon[1] as any} size={19} color={r.danger ? C.danger : '#fff'} />} />
            <Text style={{ color: r.danger ? C.danger : '#fff', fontFamily: F.bold, fontSize: 16 }}>{r.label}</Text>
          </Pressable>
        </Animated.View>
      ))}
    </Animated.View>
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <BlurView intensity={30} tint="dark" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
      </Pressable>
      <View style={{ position: 'absolute', top: cloneTop, left: 0, right: 0 }}>
        {below ? (
          <>
            {clone}
            {pill}
            {card}
          </>
        ) : (
          <>
            {pill}
            {card}
            {clone}
          </>
        )}
      </View>
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
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
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
  const [text, setText] = useState('');
  const sendVisible = !!text.trim();
  const sendButtonStyle = useAnimatedStyle(() => ({
    width: withTiming(sendVisible ? 44 : 0, { duration: 160, easing: out }),
    opacity: withTiming(sendVisible ? 1 : 0, { duration: 160, easing: out }),
    transform: [{ scale: withTiming(sendVisible ? 1 : 0.82, { duration: 160, easing: out }) }],
  }));
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState<{ m: ChatMsg; y: number; x: number } | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMsg | null>(null);
  const [forwarding, setForwarding] = useState<ChatMsg | null>(null);
  const [stickersVisible, setStickersVisible] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [page, setPage] = useState<null | 'bg' | 'photos' | 'report'>(null);
  const [photos, setPhotos] = useState<ChatMsg[] | null>(null);
  const [sure, setSure] = useState<null | 'delete' | 'remove' | 'block'>(null);
  const [reported, setReported] = useState(false);
  const close = () => { setPicker(false); setPage(null); setSure(null); };
  const arm = (k: 'delete' | 'remove' | 'block', go: () => void) => { if (sure !== k) { Haptics.selectionAsync(); setSure(k); return; } Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); go(); };
  const opened = useRef(Date.now());
  const kb = useAnimatedKeyboard();
  const [kbPad, setKbPad] = useState(0);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardWillShow', (e) => { setStickersVisible(false); setKbPad(Math.max(0, e.endCoordinates.height - insets.bottom)); });
    const c = Keyboard.addListener('keyboardDidShow', () => setStickersVisible(false));
    const b = Keyboard.addListener('keyboardDidHide', () => setKbPad(0));
    return () => { a.remove(); b.remove(); c.remove(); };
  }, [insets.bottom]);
  const pk = useSharedValue(0);
  useEffect(() => { pk.value = withTiming(stickersVisible ? PICKER_H : 0, { duration: 260, easing: Easing.out(Easing.cubic) }); }, [stickersVisible]);
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

  if (!friend) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  const msgs = chat.messages;
  const lastMine = msgs.find((m) => m.from === meId && !m.pending && !m.failed);
  const send = () => {
    const b = text.trim();
    if (!b) return;
    Haptics.selectionAsync();
    setText('');
    sendMessage(id!, b, replyingTo?.id);
    setReplyingTo(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Backdrop bg={chat.background} photo={avatarUrl(friend)} />
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.75)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 84, zIndex: 1 }} />
      <View style={{ zIndex: 2, paddingTop: insets.top + 4, paddingHorizontal: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Squish onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="back" size={22} /></Squish>
        <Animated.View ref={avRef} onLayout={onAvLayout} style={avStyle}><Avatar user={friend} size={AV} /></Animated.View>
        <Animated.View style={[{ flex: 1 }, textIn]}>
          <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 18 }}>{nameOf(friend)}</Text>
          <Text style={{ color: talking ? C.red : friend.online ? C.online : 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 13 }}>{talking ? `${nameOf(friend).toLowerCase()} is talking` : friend.dnd ? 'do not disturb' : friend.online ? 'online' : 'offline'}</Text>
        </Animated.View>
        <Squish onPress={() => { Haptics.selectionAsync(); setPicker(true); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="gear" /></Squish>
      </View>
      <View style={{ flex: 1, overflow: 'hidden' }}>
      <Animated.View entering={FadeIn.duration(260)} style={[{ flex: 1, paddingBottom: insets.bottom + 8 }, lift]}>
        <Animated.FlatList
          itemLayoutAnimation={LinearTransition.duration(220).easing(out)}
          windowSize={9}
          maxToRenderPerBatch={12}
          inverted
          data={msgs}
          keyExtractor={(m) => m.cid ?? m.id}
          renderItem={({ item, index }) => {
            const older = msgs[index + 1];
            const joined = !!older && older.from === item.from && item.created_at >= older.created_at && item.created_at - older.created_at <= 120_000;
            return (
              <View>
                <Bubble m={item} mine={item.from === meId} joined={joined} fresh={item.created_at > opened.current} friendName={nameOf(friend)}
                  seen={item.id === lastMine?.id && chat.theirReadAt >= item.created_at} onRetry={() => retry(id!, item)} onOpen={setView}
                  onReact={(e: string) => reactMsg(id!, item.id, e).catch(() => {})}
                  onMenu={(mm, y, x) => setMenu({ m: mm, y, x })}
                  onDelete={item.from === meId ? () => deleteMessage(id!, item).catch(() => {}) : undefined} />
                {older && !sameCalendarDay(item.created_at, older.created_at) ? <DatePill timestamp={older.created_at} /> : null}
              </View>
            );
          }}
          onEndReached={() => loadMessages(id!, true).catch(() => {})}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 + Math.max(kbPad, stickersVisible ? PICKER_H : 0), flexGrow: 1 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={chat.loaded && !msgs.length ? <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.bold, fontSize: 15, textAlign: 'center', marginTop: 40 }}>say hi to {nameOf(friend).toLowerCase()}</Text> : undefined}
        />
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
          <Squish onPress={() => { Haptics.selectionAsync(); sendPhoto(id!).catch(() => {}); }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}><Glyph g="photo" size={19} /></Squish>
          <ComposerPill text={text} onChange={setText} placeholder="message" onSticker={() => { Haptics.selectionAsync(); Keyboard.dismiss(); setStickersVisible((v) => !v); }} />
          <Animated.View style={[{ overflow: 'hidden' }, sendButtonStyle]}>
            {sendVisible ? <Squish onPress={send} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><Glyph g="send" size={18} color="#000" /></Squish> : null}
          </Animated.View>
        </View>
      </Animated.View>
      </View>
      {menu ? (
        <MsgMenu
          m={menu.m} mine={menu.m.from === meId} y={menu.y} x={menu.x} friendName={nameOf(friend)}
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
          setStickersVisible(false);
          const meta = stk.width && stk.height ? `${stk.width}:${stk.height}:${stk.name || ''}` : undefined;
          sendSticker(id!, stk.id, meta).catch(() => {});
        }}
      />
      {picker ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(180)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}><Pressable style={{ flex: 1 }} onPress={close} /></Animated.View>
          <Animated.View entering={SlideInDown.duration(320).easing(out)} exiting={SlideOutDown.duration(200)} style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 8, borderRadius: 30, borderCurve: 'continuous', backgroundColor: '#1C1C1E', paddingVertical: 20, gap: 14, maxHeight: '85%' }}>
            {page ? (
              <Animated.View key={page} entering={SlideInRight.duration(260).easing(out)} style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
                  <Squish onPress={() => setPage(null)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Glyph g="back" size={20} /></Squish>
                  <Text style={{ flex: 1, color: '#fff', fontFamily: F.black, fontSize: 20, textAlign: 'center', marginRight: 44 }}>{page === 'bg' ? 'background' : page === 'photos' ? 'photos' : 'report'}</Text>
                </View>
                {page === 'bg' ? (
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
                ) : page === 'photos' ? (
                  <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: 12 }}>
                    {photos === null ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 15, padding: 12 }}>loading…</Text>
                      : !photos.length ? <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.bold, fontSize: 15, padding: 12 }}>no photos yet</Text>
                      : photos.map((p) => { const [, , t] = (p.meta ?? '').split(','); const src = mediaUrl(p.body); return (
                        <Pressable key={p.id} onPress={() => setView(src)} style={{ width: '32.4%', aspectRatio: 1 }}>
                          <Image source={src} placeholder={t ? { uri: `data:image/webp;base64,${t}` } : undefined} contentFit="cover" cachePolicy="memory-disk" transition={150} style={{ flex: 1, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' }} />
                        </Pressable>
                      ); })}
                  </ScrollView>
                ) : (
                  <View style={{ gap: 8 }}>
                    {REASONS.map((r) => (
                      <SettingRow key={r} title={r} onPress={() => { report(friend.id, r).catch(() => {}); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setPage(null); setReported(true); }} />
                    ))}
                  </View>
                )}
              </Animated.View>
            ) : (
              <Animated.View key="main" entering={FadeIn.duration(180)} style={{ gap: 12 }}>
                <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 20, textAlign: 'center' }}>chat settings</Text>
                <SectionLabel>notifications</SectionLabel>
                <MuteRow chat={id!} />
                <SettingRow title="background" onPress={() => setPage('bg')} more />
                <SettingRow title="photos" onPress={() => { setPage('photos'); setPhotos(null); loadChatPhotos(id!).then(setPhotos).catch(() => setPhotos([])); }} more />
                <SettingRow title={sure === 'delete' ? 'tap again to delete chat' : 'delete chat'} danger={sure === 'delete'} onPress={() => arm('delete', () => { deleteChat(id!).catch(() => {}); close(); router.back(); })} />
                <SectionLabel>{nameOf(friend).toLowerCase()}</SectionLabel>
                <SettingRow title={sure === 'remove' ? 'tap again to remove friend' : 'remove friend'} danger={sure === 'remove'} onPress={() => arm('remove', () => { req(`/v1/friends/${friend.id}`, { method: 'DELETE' }).then(() => removeFriend(friend.id)).catch(() => {}); close(); router.back(); })} />
                <SettingRow title={sure === 'block' ? 'tap again to block' : 'block'} danger={sure === 'block'} onPress={() => arm('block', () => { block(friend.id).catch(() => {}); close(); router.back(); })} />
                <SettingRow title={reported ? 'reported, thanks' : 'report'} onPress={() => !reported && setPage('report')} more={!reported} />
              </Animated.View>
            )}
          </Animated.View>
        </View>
      ) : null}
      <PhotoViewer uri={view} onClose={() => setView(null)} />
    </View>
  );
}
