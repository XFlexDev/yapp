import { BlurView } from 'expo-blur';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView } from 'expo-symbols';
import { Icon, Segmented, Tap } from '../lib/icon';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { mediaUrl } from '../lib/api';
import {
  loadAllCustomStickers,
  loadRecentStickers,
  loadStickerPacks,
  recordRecentSticker,
  removeSticker,
  uploadCustomSticker,
  type Sticker,
  type StickerPack,
  onPacksChanged,
} from '../lib/stickers';
import { confirm } from '../lib/native';
import { useStore } from '../lib/store';
import { C, F } from '../lib/theme';

// Standard high-frequency native emojis grouped cleanly
const STANDARD_EMOJI_SECTIONS = [
  {
    title: 'Smileys & Emotion',
    emojis: [
      '😀','😃','😄','😁','😆','😅','😂','🤣','🥲','🥹','😊','😇','🙂','🙃','😉',
      '😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓',
      '😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫',
      '😩','🥺','😢','😭','😮‍💨','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨',
      '😰','😥','😓','🫣','🤗','🫡','🤫','🫠','🤥','😶','😶‍🌫️','😐','😑','😬','🫨',
      '😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😮‍💨','😵','😵‍💫','🤐','🥴','🤢',
      '🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀',
    ],
  },
  {
    title: 'Gestures & People',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🫰','🤞',
      '🫶','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊',
      '🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿',
      '🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🫀','👀','👁️','👅','👄','🫦','💋',
    ],
  },
  {
    title: 'Hearts & Vibes',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞',
      '💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️',
      '✨','⭐️','🌟','💫','⚡️','☄️','💥','🔥','🌪️','🌈','☀️','🌤️','⛅️','🌥️','☁️',
    ],
  },
  {
    title: 'Food & Objects',
    emojis: [
      '☕️','🍵','🧃','🥤','🍺','🍻','🍷','🍸','🍹','🍕','🍔','🍟','🌭','🍿','🥞',
      '🧇','🥓','🍳','🍞','🥖','🥐','🧀','🥗','🍣','🍙','🍜','🍝','🌮','🌯','🥙',
      '📱','💻','⌚️','📷','📸','🎥','📽️','🎙️','📻','📺','🕹️','🎮','🎲','🎸','🎹',
      '🚀','🛸','🏎️','🏍️','🚲','🛴','🛹','⛵️','✈️','🎈','🎉','🎊','🎁','🏆','🥇',
    ],
  },
];

const EMOJI_KEYWORDS: Record<string, string> = {
  '😀': 'grinning smile happy',
  '😃': 'smiley happy open',
  '😄': 'smile grin happy',
  '😁': 'beaming grin',
  '😆': 'grinning squinting laugh',
  '😅': 'grin sweat relieved',
  '😂': 'joy tears laugh cry',
  '🤣': 'rofl rolling laughing',
  '🥲': 'smiling tear',
  '🥹': 'holding tears touched',
  '😊': 'smiling blush',
  '😇': 'innocent halo',
  '🙂': 'slightly smiling',
  '🙃': 'upside down silly',
  '😉': 'wink',
  '😌': 'relieved calm',
  '😍': 'heart eyes love',
  '🥰': 'smiling hearts love',
  '😘': 'kiss blowing',
  '😗': 'kissing',
  '😙': 'kissing smiling',
  '😚': 'kissing closed eyes',
  '😋': 'yummy tasty',
  '😛': 'tongue out',
  '😝': 'tongue squint',
  '😜': 'wink tongue',
  '🤪': 'zany crazy',
  '🤨': 'raised eyebrow skeptical',
  '🧐': 'monocle fancy',
  '🤓': 'nerd glasses',
  '😎': 'cool sunglasses',
  '🥸': 'disguise mask',
  '🤩': 'star struck excited',
  '🥳': 'party celebrate',
  '😏': 'smirk',
  '😒': 'unamused annoyed',
  '😞': 'disappointed sad',
  '😔': 'pensive sad',
  '😟': 'worried',
  '😕': 'confused',
  '🙁': 'slightly frowning',
  '☹️': 'frowning sad',
  '😣': 'persevering',
  '😖': 'confounded',
  '😫': 'tired',
  '😩': 'weary exhausted',
  '🥺': 'pleading puppy eyes',
  '😢': 'cry tear sad',
  '😭': 'sob loud crying',
  '😮‍💨': 'exhale',
  '😤': 'triumph steam nose',
  '😠': 'angry mad',
  '😡': 'pouting rage',
  '🤬': 'swearing cursing symbols',
  '🤯': 'exploding head mind blown',
  '😳': 'flushed embarrassed',
  '🥵': 'hot heat',
  '🥶': 'cold freezing',
  '😱': 'scream fear shocked',
  '😨': 'fearful scared',
  '😰': 'anxious sweat',
  '😥': 'sad relieved',
  '😓': 'downcast sweat',
  '🫣': 'peeking eye shy',
  '🤗': 'hugging hug',
  '🫡': 'salute respect',
  '🤫': 'shushing quiet',
  '🫠': 'melting',
  '🤥': 'lying pinocchio',
  '😶': 'no mouth silent',
  '😶‍🌫️': 'face in clouds fog',
  '😐': 'neutral',
  '😑': 'expressionless',
  '😬': 'grimacing awkward',
  '🫨': 'shaking',
  '😯': 'hushed surprised',
  '😦': 'frowning open mouth',
  '😧': 'anguished',
  '😮': 'open mouth surprised',
  '😲': 'astonished wow',
  '🥱': 'yawning tired',
  '😴': 'sleeping zzz',
  '🤤': 'drooling',
  '😪': 'sleepy',
  '😵': 'dizzy dead',
  '😵‍💫': 'spiral eyes dizzy',
  '🤐': 'zipper mouth',
  '🥴': 'woozy drunk',
  '🤢': 'nauseated sick',
  '🤮': 'vomiting',
  '🤧': 'sneezing sick',
  '😷': 'mask sick',
  '🤒': 'thermometer sick fever',
  '🤕': 'bandage hurt injured',
  '🤑': 'money mouth rich',
  '🤠': 'cowboy hat',
  '😈': 'smiling devil horns',
  '👿': 'angry devil',
  '👹': 'ogre monster',
  '👺': 'goblin',
  '🤡': 'clown',
  '💩': 'poop pile',
  '👻': 'ghost',
  '💀': 'skull dead',
  '👋': 'waving hello bye hand',
  '🤚': 'raised back hand',
  '🖐️': 'raised hand fingers',
  '✋': 'raised hand stop',
  '🖖': 'vulcan spock',
  '🫱': 'rightwards hand',
  '🫲': 'leftwards hand',
  '🫳': 'palm down',
  '🫴': 'palm up',
  '👌': 'ok perfect',
  '🤌': 'pinched fingers italian',
  '🤏': 'pinching tiny',
  '✌️': 'victory peace',
  '🫰': 'hand heart money snap',
  '🤞': 'crossed fingers luck',
  '🫶': 'heart hands love',
  '🤟': 'love you rock',
  '🤘': 'horns rock metal',
  '🤙': 'call me shaka',
  '👈': 'point left',
  '👉': 'point right',
  '👆': 'point up',
  '🖕': 'middle finger',
  '👇': 'point down',
  '☝️': 'index up',
  '🫵': 'pointing at you',
  '👍': 'thumbs up like yes',
  '👎': 'thumbs down dislike no',
  '✊': 'fist raised',
  '👊': 'fist bump punch',
  '🤛': 'left fist',
  '🤜': 'right fist',
  '👏': 'clapping applause',
  '🙌': 'raising hands celebrate',
  '👐': 'open hands hug',
  '🤲': 'palms together pray offer',
  '🤝': 'handshake deal',
  '🙏': 'pray please thanks',
  '✍️': 'writing',
  '💅': 'nail polish sassy',
  '🤳': 'selfie',
  '💪': 'flexed biceps strong muscle',
  '🦾': 'mechanical arm',
  '🦿': 'mechanical leg',
  '🦵': 'leg',
  '🦶': 'foot',
  '👂': 'ear listen',
  '🦻': 'ear hearing aid',
  '👃': 'nose smell',
  '🫀': 'heart organ',
  '🫁': 'lungs',
  '🧠': 'brain smart',
  '👀': 'eyes look watching',
  '👁️': 'eye',
  '👅': 'tongue',
  '👄': 'mouth lips',
  '🫦': 'biting lip',
  '💋': 'kiss mark lips',
  '❤️': 'red heart love',
  '🧡': 'orange heart',
  '💛': 'yellow heart',
  '💚': 'green heart',
  '💙': 'blue heart',
  '💜': 'purple heart',
  '🖤': 'black heart',
  '🤍': 'white heart',
  '🤎': 'brown heart',
  '💔': 'broken heart sad',
  '❤️‍🔥': 'heart on fire passion',
  '❤️‍🩹': 'mending heart heal',
  '❣️': 'heart exclamation',
  '💕': 'two hearts',
  '💞': 'revolving hearts',
  '💓': 'beating heart',
  '💗': 'growing heart',
  '💖': 'sparkling heart',
  '💘': 'heart arrow cupid',
  '💝': 'heart ribbon gift',
  '💟': 'heart decoration',
  '☮️': 'peace symbol',
  '✝️': 'cross christian',
  '☪️': 'star crescent islam',
  '🕉️': 'om hindu',
  '☸️': 'dharma wheel buddhist',
  '✡️': 'star david jewish',
  '🔯': 'six pointed star',
  '🕎': 'menorah',
  '☯️': 'yin yang',
  '✨': 'sparkles magic',
  '⭐️': 'star',
  '🌟': 'glowing star',
  '💫': 'dizzy star',
  '⚡️': 'lightning bolt zap fast',
  '☄️': 'comet',
  '💥': 'collision boom explode',
  '🔥': 'fire hot lit',
  '🌪️': 'tornado',
  '🌈': 'rainbow pride',
  '☀️': 'sun sunny',
  '🌤️': 'sun small cloud',
  '⛅️': 'sun behind cloud',
  '🌥️': 'sun large cloud',
  '☁️': 'cloud',
  '☕️': 'coffee hot drink',
  '🍵': 'tea teacup',
  '🧃': 'juice box',
  '🥤': 'cup straw soda',
  '🍺': 'beer mug drink',
  '🍻': 'beers cheers',
  '🍷': 'wine glass',
  '🍸': 'cocktail martini',
  '🍹': 'tropical drink',
  '🍕': 'pizza',
  '🍔': 'burger hamburger',
  '🍟': 'fries french',
  '🌭': 'hot dog',
  '🍿': 'popcorn movie',
  '🥞': 'pancakes',
  '🧇': 'waffle',
  '🥓': 'bacon',
  '🍳': 'egg cooking breakfast',
  '🍞': 'bread loaf',
  '🥖': 'baguette bread',
  '🥐': 'croissant',
  '🧀': 'cheese',
  '🥗': 'salad healthy',
  '🍣': 'sushi',
  '🍙': 'rice ball',
  '🍜': 'ramen noodles steaming',
  '🍝': 'spaghetti pasta',
  '🌮': 'taco',
  '🌯': 'burrito wrap',
  '🥙': 'stuffed flatbread pita',
  '📱': 'phone mobile',
  '💻': 'laptop computer',
  '⌚️': 'watch',
  '📷': 'camera photo',
  '📸': 'camera flash',
  '🎥': 'movie camera film',
  '📽️': 'projector',
  '🎙️': 'studio microphone',
  '📻': 'radio',
  '📺': 'television tv',
  '🕹️': 'joystick game',
  '🎮': 'video game controller',
  '🎲': 'dice game',
  '🎸': 'guitar rock',
  '🎹': 'piano keyboard music',
  '🚀': 'rocket launch space',
  '🛸': 'ufo flying saucer alien',
  '🏎️': 'race car f1',
  '🏍️': 'motorcycle',
  '🚲': 'bike bicycle',
  '🛴': 'scooter kick',
  '🛹': 'skateboard',
  '⛵️': 'sailboat',
  '✈️': 'airplane flight travel',
  '🎈': 'balloon party',
  '🎉': 'party popper tada celebrate',
  '🎊': 'confetti ball party',
  '🎁': 'gift present wrapped',
  '🏆': 'trophy win champion',
  '🥇': 'gold medal first',
};

type TabType = 'emoji' | 'stickers';
const COLON = ':';
export const PICKER_H = 340;
const RAIL = 52;

/** Removes the last emoji (incl. skin tones, ZWJ sequences, flags) or `:custom:` token. */
export function dropLast(s: string) {
  const m = s.match(/:[\w-]+:$/);
  if (m) return s.slice(0, -m[0].length);
  const cps = Array.from(s);
  let i = cps.length - 1;
  while (i > 0 && (/[\u200d\ufe0f\u20e3\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u.test(cps[i]) || cps[i - 1] === '\u200d')) i--;
  if (i > 0 && /[\u{1F1E6}-\u{1F1FF}]/u.test(cps[i]) && /[\u{1F1E6}-\u{1F1FF}]/u.test(cps[i - 1])) i--;
  return cps.slice(0, Math.max(0, i)).join('');
}

export function StickerPicker({
  visible,
  onClose,
  onPickEmoji,
  onPickSticker,
  onBackspace,
  bottomInset = 20,
}: {
  visible: boolean;
  onClose: () => void;
  onPickEmoji: (emoji: string) => void;
  onPickSticker: (sticker: Sticker) => void;
  onBackspace?: () => void;
  bottomInset?: number;
}) {
  const [tab, setTab] = useState<TabType>('emoji');
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState<Sticker[]>([]);
  const [publicStickers, setPublicStickers] = useState<Sticker[]>([]);
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [busyType, setBusyType] = useState<TabType | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [newStickerId, setNewStickerId] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;
    Promise.all([loadRecentStickers(), loadAllCustomStickers()])
      .then(([r, all]) => {
        const seen = new Set<string>();
        setRecent(r.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))));
        setPublicStickers([...new Map(all.map((s) => [s.id, s])).values()]);
      })
      .catch(() => {});
    loadStickerPacks().then(setPacks).catch(() => {});
    return onPacksChanged(() => { loadStickerPacks().then(setPacks).catch(() => {}); });
  }, [visible]);

  useEffect(() => () => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
  }, []);

  const handleStartPick = async (isEmoji: boolean) => {
    if (busyType) return;
    setBusyType(isEmoji ? 'emoji' : 'stickers');
    setUploadError('');
    try {
      const sticker = await uploadCustomSticker(isEmoji);
      if (!sticker) return;
      recordRecentSticker(sticker.id);
      setRecent((prev) => [sticker, ...prev.filter((item) => item.id !== sticker.id)]);
      setPublicStickers((prev) => [sticker, ...prev.filter((item) => item.id !== sticker.id)]);
      setNewStickerId(sticker.id);
      setTimeout(() => setNewStickerId((id) => id === sticker.id ? null : id), 500);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      flash(String(e?.message || 'couldn’t upload this image, try again').toLowerCase());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusyType(null);
    }
  };

  const meId = useStore((s) => s.me?.id);
  const flash = (text: string) => {
    setUploadError(text);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setUploadError(''), 3000);
  };
  // Long press: your own uploads are deleted for everyone, anything else just leaves your collection.
  const handleRemove = (s: Sticker) => {
    const kind = s.is_emoji ? 'emoji' : 'sticker';
    const own = !!meId && s.owner_id === meId;
    if (!own && !recent.some((x) => x.id === s.id)) return;
    confirm(own ? `delete this ${kind}?` : `remove this ${kind}?`, own ? 'it’s deleted from your collection and your packs. messages that already use it stay.' : `it’s removed from your ${kind}s.`, own ? 'delete' : 'remove', async () => {
      const before = { recent, publicStickers };
      setRecent((prev) => prev.filter((x) => x.id !== s.id));
      if (own) setPublicStickers((prev) => prev.filter((x) => x.id !== s.id));
      try { await removeSticker(s.id); }
      catch {
        setRecent(before.recent); setPublicStickers(before.publicStickers);
        flash(`couldn’t remove this ${kind}, try again`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    });
  };

  const handleSelectSticker = (s: Sticker) => {
    Haptics.selectionAsync();
    recordRecentSticker(s.id);
    onPickSticker(s);
  };

  const handleSelectEmoji = (e: string) => {
    Haptics.selectionAsync();
    onPickEmoji(e);
  };

  const filteredEmojiSections = useMemo(() => {
    if (!search.trim()) return STANDARD_EMOJI_SECTIONS;
    const q = search.trim().toLowerCase();
    return STANDARD_EMOJI_SECTIONS.map((sec) => ({
      ...sec,
      emojis: sec.emojis.filter((e) => (EMOJI_KEYWORDS[e] || '').includes(q)),
    })).filter((sec) => sec.emojis.length > 0);
  }, [search]);

  // Yours: what you used or saved lately, then the rest of your uploads.
  const own = useMemo(() => [...new Map([...recent, ...publicStickers].map((s) => [s.id, s])).values()], [recent, publicStickers]);
  const filteredCustomEmojis = useMemo(() => {
    const list = own.filter((s) => s.is_emoji);
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase().replace(/^:|:$/g, '');
    return list.filter((s) => s.name?.toLowerCase().includes(q) || s.alt_emoji?.toLowerCase().includes(q));
  }, [own, search]);

  const filteredCustomStickers = useMemo(() => {
    const list = own.filter((s) => !s.is_emoji);
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase().replace(/^:|:$/g, '');
    return list.filter((s) => s.name?.toLowerCase().includes(q));
  }, [own, search]);

  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const sectionY = useRef<Record<string, number>>({});

  if (!visible) return null;

  const W = Dimensions.get('window').width;
  const EC = Math.floor((W - 16) / 8);
  const SC = Math.floor((W - 16) / 4);
  const jump = (k: string) => { Haptics.selectionAsync(); scrollRef.current?.scrollTo({ y: Math.max(0, (sectionY.current[k] ?? 0) - 4), animated: true }); };

  const section = (key: string, title: string, items: React.ReactNode) => (
    <View key={key} onLayout={(e) => { sectionY.current[key] = e.nativeEvent.layout.y; }} style={{ marginBottom: 10 }}>
      <Text style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.black, fontSize: 14, paddingHorizontal: 8, marginBottom: 6 }}>{title.toLowerCase()}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{items}</View>
    </View>
  );

  const emojiCell = (em: string) => (
    <Pressable
      key={em}
      onPress={() => handleSelectEmoji(em)}
      style={({ pressed }) => ({ width: EC, height: EC, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent', transform: [{ scale: pressed ? 0.82 : 1 }] })}>
      <Text style={{ fontSize: EC * 0.62 }}>{em}</Text>
    </Pressable>
  );

  const cell = (size: number, children: React.ReactNode, key: string) => (
    <View key={key} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>{children}</View>
  );

  const stickerCell = (stk: Sticker, sz: number) => cell(sz, (
    <Animated.View entering={newStickerId === stk.id ? FadeIn.duration(180) : undefined}>
      <Pressable
        onPress={() => {
          if (stk.is_emoji) {
            Haptics.selectionAsync();
            recordRecentSticker(stk.id);
            onPickEmoji(stk.name ? COLON + stk.name + COLON : COLON + stk.id.replace(/\.webp$/i, '') + COLON);
          } else {
            handleSelectSticker(stk);
          }
        }}
        onLongPress={() => handleRemove(stk)}
        delayLongPress={350}
        style={({ pressed }) => ({ width: sz - 6, height: sz - 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent', transform: [{ scale: pressed ? 0.86 : 1 }] })}>
        <Image source={stk.url || mediaUrl(stk.id)} style={{ width: sz * 0.78, height: sz * 0.78 }} contentFit="contain" cachePolicy="memory-disk" />
      </Pressable>
    </Animated.View>
  ), stk.id);

  const addTile = (isEmoji: boolean, sz: number) => cell(sz, (
    <Pressable
      disabled={busyType !== null}
      onPress={() => handleStartPick(isEmoji)}
      style={({ pressed }) => ({ width: sz - 6, height: sz - 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', opacity: pressed ? 0.7 : 1 })}>
      {busyType === (isEmoji ? 'emoji' : 'stickers') ? <ActivityIndicator color="#fff" /> : (
        <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', width: 16, height: 2, borderRadius: 1, backgroundColor: '#fff' }} />
          <View style={{ position: 'absolute', width: 2, height: 16, borderRadius: 1, backgroundColor: '#fff' }} />
        </View>
      )}
    </Pressable>
  ), isEmoji ? 'add-emoji' : 'add-sticker');

  const railBtn = (key: string, child: React.ReactNode) => (
    <Tap key={key} onPress={() => jump(key)} style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.14)' : 'transparent', transform: [{ scale: pressed ? 0.88 : 1 }] })}>
      {child}
    </Tap>
  );
  const dim = 'rgba(255,255,255,0.55)';

  return (
    <Animated.View
      entering={SlideInDown.duration(260)}
      exiting={SlideOutDown.duration(200)}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: PICKER_H + bottomInset, backgroundColor: Platform.OS === 'ios' ? 'rgba(14,14,16,0.72)' : '#121214', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderCurve: 'continuous', overflow: 'hidden' }}>
      {Platform.OS === 'ios' ? <BlurView tint="dark" intensity={60} style={StyleSheet.absoluteFill} /> : null}
      <Pressable onPress={onClose} hitSlop={8} style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 6 }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' }} />
      </Pressable>

      <View style={{ marginHorizontal: 10 }}>
        <Segmented options={['emoji', 'stickers'] as const} value={tab} onChange={(t) => { Haptics.selectionAsync(); setTab(t); setSearch(''); sectionY.current = {}; }} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10, marginTop: 8, marginBottom: 6, height: 40, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12 }}>
        <SymbolView name="magnifyingglass" size={15} tintColor="rgba(255,255,255,0.45)" fallback={<MaterialCommunityIcons name="magnify" size={18} color="rgba(255,255,255,0.45)" />} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={tab === 'emoji' ? 'find the perfect emoji' : 'find a sticker'}
          placeholderTextColor="rgba(255,255,255,0.35)"
          keyboardAppearance="dark"
          style={{ flex: 1, color: '#fff', fontFamily: F.bold, fontSize: 15, paddingVertical: 0 }}
        />
      </View>

      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 4, paddingBottom: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Animated.View key={tab} entering={FadeIn.duration(200)}>
        {tab === 'emoji' ? (
          <>
            {section('mine', 'your emojis', [addTile(true, EC), ...filteredCustomEmojis.map((s) => stickerCell(s, EC))])}
            {filteredEmojiSections.map((sec) => section(sec.title, sec.title, sec.emojis.map(emojiCell)))}
          </>
        ) : (
          <>
            {section('mine', 'your stickers', [addTile(false, SC), ...filteredCustomStickers.map((s) => stickerCell(s, SC))])}
            {packs.map((p) => section(p.id, p.title, p.stickers.map((s) => stickerCell(s, SC))))}
          </>
        )}
        </Animated.View>
      </ScrollView>

      <View style={{ height: RAIL + bottomInset, paddingBottom: bottomInset, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0c0c0e' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 6, paddingHorizontal: 10 }}>
          {railBtn('mine', <Icon sf="clock.fill" md="clock" size={20} mdSize={22} color={dim} move="spin" />)}
          {tab === 'stickers' ? (
            <Tap onPress={() => { Haptics.selectionAsync(); router.push('/packs'); }} hitSlop={4} style={({ pressed }) => ({ height: 36, paddingHorizontal: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: pressed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)', transform: [{ scale: pressed ? 0.95 : 1 }] })}>
              <Icon sf="square.grid.2x2.fill" md="view-grid" size={15} mdSize={17} />
              <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 13 }}>packs</Text>
            </Tap>
          ) : null}
          {tab === 'emoji'
            ? filteredEmojiSections.map((sec) => railBtn(sec.title, <Text style={{ fontSize: 20, opacity: 0.85 }}>{sec.emojis[0]}</Text>))
            : packs.map((p) => railBtn(p.id, p.thumbnail_url
              ? <Image source={p.thumbnail_url} style={{ width: 28, height: 28, borderRadius: 14 }} contentFit="cover" />
              : <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 12 }}>{p.title.slice(0, 2).toLowerCase()}</Text>))}
        </ScrollView>
        {tab === 'emoji' && onBackspace ? (
          <Tap onPress={() => { Haptics.selectionAsync(); onBackspace(); }} hitSlop={6} style={({ pressed }) => ({ width: 48, height: 38, marginRight: 8, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.14)' : 'transparent' })}>
            <Icon sf="delete.left.fill" md="backspace" size={22} mdSize={22} color={dim} move="left" />
          </Tap>
        ) : null}
      </View>

      {uploadError ? (
        <Animated.View
          entering={SlideInDown.duration(240)}
          exiting={FadeOut.duration(160)}
          style={{ position: 'absolute', bottom: RAIL + bottomInset + 10, left: 0, right: 0, alignItems: 'center' }}
          pointerEvents="none">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(28,28,32,0.97)', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, maxWidth: '88%', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 12 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.danger }} />
            <Text style={{ color: '#fff', fontFamily: F.bold, fontSize: 13 }}>{uploadError}</Text>
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
