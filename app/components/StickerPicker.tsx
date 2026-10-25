import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import {
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
import { Pill, Squish } from '../lib/tt';

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
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [busy, setBusy] = useState(false);
  const [namingDialog, setNamingDialog] = useState<{
    uri: string;
    mimeType?: string;
    isEmoji: boolean;
  } | null>(null);
  const [assignedId, setAssignedId] = useState('');
  const [namingError, setNamingError] = useState('');

  useEffect(() => {
    if (!visible) return;
    Promise.all([loadRecentStickers(), loadAllCustomStickers()])
      .then(([r, all]) => {
        const seen = new Set<string>();
        const merged = [...r, ...all].filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
        setRecent(merged);
      })
      .catch(() => {});
    loadStickerPacks().then(setPacks).catch(() => {});
  }, [visible]);

  const handleStartPick = async (isEmoji: boolean) => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
      });
      const a = r.assets?.[0];
      if (r.canceled || !a) return;
      const base = (a.fileName || '').replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || (isEmoji ? 'emoji' : 'sticker');
      setAssignedId(base.slice(0, 24));
      setNamingError('');
      setNamingDialog({
        uri: a.uri,
        mimeType: a.mimeType,
        isEmoji,
      });
    } catch {}
  };

  const handleConfirmNaming = async () => {
    if (!namingDialog || busy) return;
    const clean = assignedId.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
    if (clean.length < 2) {
      setNamingError('ID must be at least 2 characters (letters, numbers, _ -)');
      return;
    }
    setBusy(true);
    setNamingError('');
    try {
      const stk = await uploadCustomSticker(
        namingDialog.isEmoji,
        clean,
        { uri: namingDialog.uri, mimeType: namingDialog.mimeType }
      );
      if (stk) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setRecent((prev) => [stk, ...prev.filter((x) => x.id !== stk.id)]);
        setNamingDialog(null);
        if (namingDialog.isEmoji) {
          onPickEmoji(`:${stk.name || clean}:`);
        } else {
          onPickSticker(stk);
        }
      }
    } catch (e: any) {
      setNamingError(e?.message || 'Failed to upload. Try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
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
      <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.black, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, paddingLeft: 4 }}>
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
    <Pressable
      key={stk.id}
      onPress={() => (stk.is_emoji ? onPickEmoji(COLON + (stk.name || 'custom') + COLON) : handleSelectSticker(stk))}
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
                  <Pressable
                    onPress={() => handleStartPick(true)}
                    style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)' })}>
                    <SymbolView name="plus" size={18} tintColor="#fff" fallback={<MaterialCommunityIcons name="plus" size={20} color="#fff" />} />
                  </Pressable>
                  {filteredCustomEmojis.map((s) => stickerCell(s, 42))}
                </>
              ))}
              {filteredEmojiSections.map((sec) => row(sec.title, sec.emojis.map(emojiCell)))}
            </>
          )}
          {tab === 'stickers' && (
            <>
              {row('my stickers', (
                <>
                  <Pressable
                    onPress={() => handleStartPick(false)}
                    style={({ pressed }) => ({ width: 72, height: 72, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)' })}>
                    <SymbolView name="plus" size={22} tintColor="#fff" fallback={<MaterialCommunityIcons name="plus" size={24} color="#fff" />} />
                  </Pressable>
                  {filteredCustomStickers.map((s) => stickerCell(s))}
                </>
              ))}
              {packs.map((p) => row(p.title.toLowerCase(), p.stickers.map((s) => stickerCell(s))))}
            </>
          )}
        </ScrollView>
      </Animated.View>

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

      {/* ID Assignment Dialog for custom emojis & stickers */}
      {namingDialog ? (
        <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
          <Pressable
            onPress={() => setNamingDialog(null)}
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.82)' }]}
          />
          <View
            style={{
              position: 'absolute',
              left: 24,
              right: 24,
              top: '30%',
              alignSelf: 'center',
              maxWidth: 340,
              backgroundColor: '#1E1E20',
              borderRadius: 26,
              borderCurve: 'continuous',
              padding: 20,
              gap: 14,
            }}>
            <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 18, textAlign: 'center' }}>
              {namingDialog.isEmoji ? 'name your emoji' : 'name your sticker'}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.bold, fontSize: 13, textAlign: 'center' }}>
              type :{assignedId || 'name'}: in chat to use it
            </Text>
            <View style={{ alignItems: 'center' }}>
              <Image
                source={namingDialog.uri}
                style={{ width: namingDialog.isEmoji ? 52 : 96, height: namingDialog.isEmoji ? 52 : 96, borderRadius: namingDialog.isEmoji ? 14 : 10 }}
                contentFit="contain"
              />
            </View>
            <View
              style={{
                height: 46,
                borderRadius: 23,
                backgroundColor: 'rgba(255,255,255,0.08)',
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
              }}>
              <Text style={{ color: C.red, fontFamily: F.black, fontSize: 16 }}>:</Text>
              <TextInput
                value={assignedId}
                onChangeText={(t) => {
                  setAssignedId(t.toLowerCase().replace(/[^a-z0-9_-]/g, ''));
                  setNamingError('');
                }}
                placeholder="name"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardAppearance="dark"
                maxLength={32}
                style={{ flex: 1, color: '#fff', fontFamily: F.bold, fontSize: 16, paddingHorizontal: 4, paddingVertical: 0 }}
              />
              <Text style={{ color: C.red, fontFamily: F.black, fontSize: 16 }}>:</Text>
            </View>
            {namingError ? (
              <Text style={{ color: C.danger, fontFamily: F.bold, fontSize: 12, textAlign: 'center' }}>{namingError}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <View style={{ flex: 1 }}>
                <Pill title="cancel" ghost onPress={() => setNamingDialog(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <Pill title={busy ? 'saving…' : 'save'} loading={busy} onPress={handleConfirmNaming} />
              </View>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
