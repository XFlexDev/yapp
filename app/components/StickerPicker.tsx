import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
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
import { Squish } from '../lib/tt';

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

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Dimmed backdrop */}
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(150)}
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 50 }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      {/* Main Bottom Sheet Tray */}
      <Animated.View
        entering={SlideInDown.duration(280)}
        exiting={SlideOutDown.duration(200)}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '62%',
          height: 440,
          backgroundColor: '#161618',
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          borderCurve: 'continuous',
          paddingBottom: bottomInset,
          zIndex: 60,
          overflow: 'hidden',
        }}>
        {/* Top Segmented Controls: [Emoji] | [Stickers] */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 10 }}>
          <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 3 }}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setTab('emoji');
              }}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 15,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                backgroundColor: tab === 'emoji' ? 'rgba(255,255,255,0.18)' : 'transparent',
              }}>
              <SymbolView
                name="face.smiling"
                size={17}
                tintColor={tab === 'emoji' ? '#fff' : 'rgba(255,255,255,0.4)'}
                fallback={<MaterialCommunityIcons name="emoticon-outline" size={18} color={tab === 'emoji' ? '#fff' : 'rgba(255,255,255,0.4)'} />}
              />
              <Text style={{ color: tab === 'emoji' ? '#fff' : 'rgba(255,255,255,0.4)', fontFamily: F.black, fontSize: 14 }}>Emoji</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setTab('stickers');
              }}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 15,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                backgroundColor: tab === 'stickers' ? 'rgba(255,255,255,0.18)' : 'transparent',
              }}>
              <SymbolView
                name="star.square.fill"
                size={17}
                tintColor={tab === 'stickers' ? '#fff' : 'rgba(255,255,255,0.4)'}
                fallback={<MaterialCommunityIcons name="sticker-emoji" size={18} color={tab === 'stickers' ? '#fff' : 'rgba(255,255,255,0.4)'} />}
              />
              <Text style={{ color: tab === 'stickers' ? '#fff' : 'rgba(255,255,255,0.4)', fontFamily: F.black, fontSize: 14 }}>Stickers</Text>
            </Pressable>
          </View>

          {/* Search Bar */}
          <View
            style={{
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(255,255,255,0.07)',
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 12,
              gap: 8,
            }}>
            <SymbolView
              name="magnifyingglass"
              size={15}
              tintColor="rgba(255,255,255,0.35)"
              fallback={<MaterialCommunityIcons name="magnify" size={18} color="rgba(255,255,255,0.35)" />}
            />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={tab === 'emoji' ? 'Search emojis...' : 'Search stickers...'}
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardAppearance="dark"
              style={{ flex: 1, color: '#fff', fontFamily: F.bold, fontSize: 14, paddingVertical: 0 }}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <SymbolView
                  name="xmark.circle.fill"
                  size={15}
                  tintColor="rgba(255,255,255,0.4)"
                  fallback={<MaterialCommunityIcons name="close-circle" size={16} color="rgba(255,255,255,0.4)" />}
                />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Content Container */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled">
          
          {/* TAB 1: EMOJI */}
          {tab === 'emoji' && (
            <View style={{ gap: 16 }}>
              {/* Custom Emojis row */}
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.black, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Custom Emojis
                  </Text>
                  <Squish
                    onPress={() => handleStartPick(true)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: 10,
                      height: 26,
                      borderRadius: 13,
                      backgroundColor: 'rgba(255,255,255,0.1)',
                    }}>
                    <SymbolView
                      name="plus"
                      size={12}
                      tintColor="#fff"
                      fallback={<MaterialCommunityIcons name="plus" size={13} color="#fff" />}
                    />
                    <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 11 }}>Add</Text>
                  </Squish>
                </View>

                {/* Custom emojis grid */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {filteredCustomEmojis.map((stk) => (
                    <Pressable
                      key={stk.id}
                      onPress={() => onPickEmoji(`:${stk.name || 'custom'}:`)}
                      style={({ pressed }) => ({
                        minWidth: 48,
                        paddingVertical: 4,
                        paddingHorizontal: 6,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 12,
                        backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)',
                      })}>
                      <Image
                        source={stk.url || mediaUrl(stk.id)}
                        style={{ width: 34, height: 34 }}
                        contentFit="contain"
                        cachePolicy="memory-disk"
                      />
                      {stk.name ? (
                        <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.bold, fontSize: 10, marginTop: 2, maxWidth: 52, textAlign: 'center' }}>
                          :{stk.name}:
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                  {filteredCustomEmojis.length === 0 && (
                    <Text style={{ color: 'rgba(255,255,255,0.25)', fontFamily: F.bold, fontSize: 13, paddingVertical: 4 }}>
                      Tap "+ Add" to upload custom emojis with a custom ID
                    </Text>
                  )}
                </View>
              </View>

              {/* Standard Emoji Categories */}
              {filteredEmojiSections.map((sec) => (
                <View key={sec.title} style={{ gap: 8 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.black, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {sec.title}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {sec.emojis.map((em) => (
                      <Pressable
                        key={em}
                        onPress={() => handleSelectEmoji(em)}
                        style={({ pressed }) => ({
                          width: 38,
                          height: 38,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 10,
                          backgroundColor: pressed ? 'rgba(255,255,255,0.15)' : 'transparent',
                        })}>
                        <Text style={{ fontSize: 26 }}>{em}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* TAB 2: STICKERS */}
          {tab === 'stickers' && (
            <View style={{ gap: 16 }}>
              {/* Upload custom sticker action banner */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: F.black, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  My Stickers & Recents
                </Text>
                <Squish
                  onPress={() => handleStartPick(false)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    paddingHorizontal: 12,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: C.red,
                  }}>
                  <SymbolView
                    name="plus"
                    size={12}
                    tintColor="#fff"
                    fallback={<MaterialCommunityIcons name="plus" size={14} color="#fff" />}
                  />
                  <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 12 }}>New Sticker</Text>
                </Squish>
              </View>

              {/* Recent / Custom Stickers Grid */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {filteredCustomStickers.map((stk) => (
                  <Pressable
                    key={stk.id}
                    onPress={() => handleSelectSticker(stk)}
                    style={({ pressed }) => ({
                      minWidth: 78,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 16,
                      padding: 6,
                      backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                    })}>
                    <Image
                      source={stk.url || mediaUrl(stk.id)}
                      style={{ width: 68, height: 68 }}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                    />
                    {stk.name ? (
                      <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.bold, fontSize: 10, marginTop: 4, maxWidth: 70, textAlign: 'center' }}>
                        :{stk.name}:
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
                {filteredCustomStickers.length === 0 && (
                  <View style={{ paddingVertical: 18, alignItems: 'center', width: '100%', gap: 6 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.bold, fontSize: 14 }}>
                      No stickers yet
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.25)', fontFamily: F.regular, fontSize: 12, textAlign: 'center' }}>
                      Tap "+ New Sticker" to upload custom stickers with an ID
                    </Text>
                  </View>
                )}
              </View>

              {/* Sticker Packs */}
              {packs.map((p) => (
                <View key={p.id} style={{ gap: 8 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.black, fontSize: 13 }}>
                    {p.title}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                    {p.stickers.map((stk) => (
                      <Pressable
                        key={stk.id}
                        onPress={() => handleSelectSticker(stk)}
                        style={({ pressed }) => ({
                          width: 78,
                          height: 78,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 16,
                          backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                        })}>
                        <Image
                          source={stk.url || mediaUrl(stk.id)}
                          style={{ width: 68, height: 68 }}
                          contentFit="contain"
                          cachePolicy="memory-disk"
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Bottom Quick Dock */}
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 48,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: 'rgba(255,255,255,0.08)',
            backgroundColor: '#111113',
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            justifyContent: 'space-between',
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setTab('emoji');
              }}
              hitSlop={8}
              style={{ opacity: tab === 'emoji' ? 1 : 0.4 }}>
              <SymbolView
                name="clock.fill"
                size={18}
                tintColor="#fff"
                fallback={<MaterialCommunityIcons name="clock-outline" size={18} color="#fff" />}
              />
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setTab('stickers');
              }}
              hitSlop={8}
              style={{ opacity: tab === 'stickers' ? 1 : 0.4 }}>
              <SymbolView
                name="star.fill"
                size={18}
                tintColor="#fff"
                fallback={<MaterialCommunityIcons name="star" size={18} color="#fff" />}
              />
            </Pressable>
          </View>

          {/* Close tray icon button */}
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              onClose();
            }}
            hitSlop={8}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: 'rgba(255,255,255,0.1)',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <SymbolView
              name="chevron.down"
              size={14}
              tintColor="#fff"
              weight="bold"
              fallback={<MaterialCommunityIcons name="chevron-down" size={18} color="#fff" />}
            />
          </Pressable>
        </View>
      </Animated.View>

      {/* ID Assignment Dialog for custom emojis & stickers */}
      {namingDialog ? (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(140)}
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: 'rgba(0,0,0,0.82)',
              zIndex: 100,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 24,
            },
          ]}>
          <View
            style={{
              width: '100%',
              maxWidth: 320,
              backgroundColor: '#1E1E20',
              borderRadius: 24,
              borderCurve: 'continuous',
              padding: 20,
              alignItems: 'center',
              gap: 14,
            }}>
            <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 18 }}>
              {namingDialog.isEmoji ? 'Assign Emoji ID' : 'Assign Sticker ID'}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontFamily: F.bold, fontSize: 13, textAlign: 'center' }}>
              Type :{assignedId || 'name'}: in chat to use it
            </Text>

            <Image
              source={namingDialog.uri}
              style={{
                width: namingDialog.isEmoji ? 48 : 88,
                height: namingDialog.isEmoji ? 48 : 88,
                borderRadius: namingDialog.isEmoji ? 12 : 8,
              }}
              contentFit="contain"
            />

            <View
              style={{
                width: '100%',
                height: 44,
                borderRadius: 22,
                backgroundColor: 'rgba(255,255,255,0.08)',
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 14,
              }}>
              <Text style={{ color: C.red, fontFamily: F.black, fontSize: 16 }}>:</Text>
              <TextInput
                value={assignedId}
                onChangeText={(t) => {
                  setAssignedId(t.toLowerCase().replace(/[^a-z0-9_-]/g, ''));
                  setNamingError('');
                }}
                placeholder="custom_id"
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
              <Text style={{ color: C.danger, fontFamily: F.bold, fontSize: 12, textAlign: 'center' }}>
                {namingError}
              </Text>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10, width: '100%', marginTop: 4 }}>
              <Squish
                onPress={() => setNamingDialog(null)}
                style={{
                  flex: 1,
                  height: 42,
                  borderRadius: 21,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Text style={{ color: '#fff', fontFamily: F.bold, fontSize: 15 }}>Cancel</Text>
              </Squish>
              <Squish
                onPress={handleConfirmNaming}
                disabled={busy}
                style={{
                  flex: 1,
                  height: 42,
                  borderRadius: 21,
                  backgroundColor: C.red,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: busy ? 0.6 : 1,
                }}>
                <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 15 }}>
                  {busy ? 'Saving…' : 'Save'}
                </Text>
              </Squish>
            </View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}
