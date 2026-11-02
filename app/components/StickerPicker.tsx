import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  uploadCustomSticker,
  type Sticker,
  type StickerPack,
} from '../lib/stickers';
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

export function StickerPicker({
  visible,
  onClose,
  onPickEmoji,
  onPickSticker,
  bottomInset = 20,
}: {
  visible: boolean;
  onClose: () => void;
  onPickEmoji: (emoji: string) => void;
  onPickSticker: (sticker: Sticker) => void;
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
      setUploadError(String(e?.message || 'couldn’t upload this image, try again').toLowerCase());
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setUploadError(''), 3000);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusyType(null);
    }
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

  const filteredCustomEmojis = useMemo(() => {
    const list = recent.filter((s) => s.is_emoji);
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase().replace(/^:|:$/g, '');
    return list.filter((s) => s.name?.toLowerCase().includes(q) || s.alt_emoji?.toLowerCase().includes(q));
  }, [recent, search]);

  const filteredCustomStickers = useMemo(() => {
    const list = recent.filter((s) => !s.is_emoji);
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase().replace(/^:|:$/g, '');
    return list.filter((s) => s.name?.toLowerCase().includes(q));
  }, [recent, search]);

  const myStickerIds = useMemo(() => new Set(recent.map((s) => s.id)), [recent]);
  const filteredEveryoneEmojis = useMemo(() => {
    const list = publicStickers.filter((s) => s.is_emoji && !myStickerIds.has(s.id));
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase().replace(/^:|:$/g, '');
    return list.filter((s) => s.name?.toLowerCase().includes(q) || s.alt_emoji?.toLowerCase().includes(q));
  }, [myStickerIds, publicStickers, search]);
  const filteredEveryoneStickers = useMemo(() => {
    const list = publicStickers.filter((s) => !s.is_emoji && !myStickerIds.has(s.id));
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase().replace(/^:|:$/g, '');
    return list.filter((s) => s.name?.toLowerCase().includes(q));
  }, [myStickerIds, publicStickers, search]);

  if (!visible) return null;

  const chip = (e: string, kw: string) => (
    <Pressable
      key={e}
      onPress={() => {
        Haptics.selectionAsync();
        setSearch(search === kw ? '' : kw);
      }}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: search === kw ? 'rgba(255,255,255,0.16)' : pressed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
      })}>
      <Text style={{ fontSize: 18 }}>{e}</Text>
    </Pressable>
  );

  const row = (title: string, items: React.ReactNode) => (
    <View style={{ gap: 8 }} key={title}>
      <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.black, fontSize: 12, paddingLeft: 4 }}>
        {title}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
        {items}
      </ScrollView>
    </View>
  );

  const emojiCell = (em: string) => (
    <Pressable
      key={em}
      onPress={() => handleSelectEmoji(em)}
      style={({ pressed }) => ({
        width: 42,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        backgroundColor: pressed ? 'rgba(255,255,255,0.14)' : 'transparent',
      })}>
      <Text style={{ fontSize: 26 }}>{em}</Text>
    </Pressable>
  );

  const stickerCell = (stk: Sticker, sz = 72) => (
    <Animated.View key={stk.id} entering={newStickerId === stk.id ? FadeIn.duration(180) : undefined}>
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
        style={({ pressed }) => ({
          width: sz,
          height: sz,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)',
        })}>
        <Image source={stk.url || mediaUrl(stk.id)} style={{ width: sz - 10, height: sz - 10 }} contentFit="contain" cachePolicy="memory-disk" />
      </Pressable>
    </Animated.View>
  );

  const addTile = (isEmoji: boolean, size: number) => (
    <Pressable
      key={isEmoji ? 'add-emoji' : 'add-sticker'}
      disabled={busyType !== null}
      onPress={() => handleStartPick(isEmoji)}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: isEmoji ? 12 : 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.12)',
        opacity: pressed ? 0.72 : 1,
      })}>
      {busyType === (isEmoji ? 'emoji' : 'stickers') ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', width: 18, height: 2, borderRadius: 1, backgroundColor: '#fff' }} />
          <View style={{ position: 'absolute', width: 2, height: 18, borderRadius: 1, backgroundColor: '#fff' }} />
        </View>
      )}
    </Pressable>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.duration(260)}
        exiting={SlideOutDown.duration(200)}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '58%',
          backgroundColor: '#121214',
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          borderCurve: 'continuous',
          paddingBottom: bottomInset + 64,
          overflow: 'hidden',
        }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
          <Pressable onPress={() => { setTab('emoji'); setSearch(''); }} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            <SymbolView name="clock" size={20} tintColor={tab === 'emoji' ? '#fff' : 'rgba(255,255,255,0.5)'} fallback={<MaterialCommunityIcons name="clock-outline" size={20} color={tab === 'emoji' ? '#fff' : 'rgba(255,255,255,0.5)'} />} />
          </Pressable>
          <Pressable onPress={() => { setTab('emoji'); }} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            <SymbolView name="face.smiling" size={20} tintColor={tab === 'emoji' ? '#fff' : 'rgba(255,255,255,0.5)'} fallback={<MaterialCommunityIcons name="emoticon-outline" size={20} color={tab === 'emoji' ? '#fff' : 'rgba(255,255,255,0.5)'} />} />
          </Pressable>
          <Pressable onPress={() => { setTab('stickers'); }} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            <SymbolView name="star.square" size={20} tintColor={tab === 'stickers' ? '#fff' : 'rgba(255,255,255,0.5)'} fallback={<MaterialCommunityIcons name="sticker-emoji" size={20} color={tab === 'stickers' ? '#fff' : 'rgba(255,255,255,0.5)'} />} />
          </Pressable>
          <View style={{ width: StyleSheet.hairlineWidth, height: 22, backgroundColor: 'rgba(255,255,255,0.12)' }} />
          {packs.map((p) => (
            <Pressable key={p.id} onPress={() => setTab('stickers')} style={{ width: 40, height: 40, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              {p.thumbnail_url ? <Image source={p.thumbnail_url} style={{ width: 34, height: 34 }} contentFit="contain" /> : <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 13 }}>{p.title.slice(0, 2).toLowerCase()}</Text>}
            </Pressable>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.07)', paddingHorizontal: 12, width: 132 }}>
            <SymbolView name="magnifyingglass" size={14} tintColor="rgba(255,255,255,0.4)" fallback={<MaterialCommunityIcons name="magnify" size={16} color="rgba(255,255,255,0.4)" />} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="search"
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardAppearance="dark"
              style={{ flex: 1, color: '#fff', fontFamily: F.bold, fontSize: 14, paddingVertical: 0 }}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {chip('❤️', 'heart')}
            {chip('👍', 'thumbs')}
            {chip('👎', 'down')}
            {chip('🎉', 'party')}
            {chip('😀', 'smile')}
            {chip('😂', 'laugh')}
            {chip('😢', 'sad')}
            {chip('😡', 'angry')}
            {chip('🔥', 'fire')}
          </ScrollView>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 18, paddingHorizontal: 10, paddingBottom: 20 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {tab === 'emoji' && (
            <>
              {row('custom emojis', (
                <>
                  {addTile(true, 42)}
                  {filteredCustomEmojis.map((s) => stickerCell(s, 42))}
                </>
              ))}
              {filteredEveryoneEmojis.length ? row("everyone's emojis", filteredEveryoneEmojis.map((s) => stickerCell(s, 42))) : null}
              {filteredEmojiSections.map((sec) => row(sec.title, sec.emojis.map(emojiCell)))}
            </>
          )}
          {tab === 'stickers' && (
            <>
              {row('my stickers', (
                <>
                  {addTile(false, 72)}
                  {filteredCustomStickers.map((s) => stickerCell(s))}
                </>
              ))}
              {filteredEveryoneStickers.length ? row("everyone's stickers", filteredEveryoneStickers.map((s) => stickerCell(s))) : null}
              {packs.map((p) => row(p.title.toLowerCase(), p.stickers.map((s) => stickerCell(s))))}
            </>
          )}

        </ScrollView>
      </Animated.View>

      {uploadError ? (
        <Animated.View
          entering={SlideInDown.duration(240)}
          exiting={FadeOut.duration(160)}
          style={{ position: 'absolute', bottom: bottomInset + 62, left: 0, right: 0, alignItems: 'center' }}
          pointerEvents="none">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(28,28,32,0.97)', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, maxWidth: '88%', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 12 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.danger }} />
            <Text style={{ color: '#fff', fontFamily: F.bold, fontSize: 13 }}>{uploadError}</Text>
          </View>
        </Animated.View>
      ) : null}

      <Animated.View entering={FadeIn.delay(120).duration(180)} exiting={FadeOut.duration(120)} style={{ position: 'absolute', bottom: bottomInset + 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(30,30,34,0.96)', borderRadius: 24, padding: 4 }}>
          {(['emoji', 'stickers'] as TabType[]).map((t) => (
            <Pressable
              key={t}
              onPress={() => { Haptics.selectionAsync(); setTab(t); }}
              style={{ paddingHorizontal: 20, height: 38, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === t ? 'rgba(255,255,255,0.16)' : 'transparent' }}>
              <Text style={{ color: tab === t ? '#fff' : 'rgba(255,255,255,0.45)', fontFamily: F.black, fontSize: 14 }}>{t}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={onClose}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(30,30,34,0.96)', alignItems: 'center', justifyContent: 'center' }}>
          <SymbolView name="xmark" size={16} tintColor="#fff" weight="bold" fallback={<MaterialCommunityIcons name="close" size={20} color="#fff" />} />
        </Pressable>
      </Animated.View>

    </View>
  );
}
