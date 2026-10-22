import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
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

  useEffect(() => {
    if (!visible) return;
    loadRecentStickers().then(setRecent).catch(() => {});
    loadStickerPacks().then(setPacks).catch(() => {});
  }, [visible]);

  const handleUploadSticker = async (isEmoji = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const stk = await uploadCustomSticker(isEmoji);
      if (stk) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setRecent((prev) => [stk, ...prev.filter((x) => x.id !== stk.id)]);
        if (isEmoji) {
          onPickEmoji(`:${stk.alt_emoji || 'custom'}:`);
        } else {
          onPickSticker(stk);
        }
      }
    } catch (e) {
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
      emojis: sec.emojis.filter((e) => e.includes(q)),
    })).filter((sec) => sec.emojis.length > 0);
  }, [search]);

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
                    onPress={() => handleUploadSticker(true)}
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
                  {recent.filter((s) => s.is_emoji).map((stk) => (
                    <Pressable
                      key={stk.id}
                      onPress={() => handleSelectSticker(stk)}
                      style={({ pressed }) => ({
                        width: 44,
                        height: 44,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 12,
                        backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent',
                      })}>
                      <Image
                        source={stk.url || mediaUrl(stk.id)}
                        style={{ width: 34, height: 34 }}
                        contentFit="contain"
                        cachePolicy="memory-disk"
                      />
                    </Pressable>
                  ))}
                  {recent.filter((s) => s.is_emoji).length === 0 && (
                    <Text style={{ color: 'rgba(255,255,255,0.25)', fontFamily: F.bold, fontSize: 13, paddingVertical: 4 }}>
                      Tap "+ Add" to upload custom emojis from your photos
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
                  onPress={() => handleUploadSticker(false)}
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
                {recent.filter((s) => !s.is_emoji).map((stk) => (
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
                {recent.filter((s) => !s.is_emoji).length === 0 && (
                  <View style={{ paddingVertical: 18, alignItems: 'center', width: '100%', gap: 6 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.bold, fontSize: 14 }}>
                      No stickers yet
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.25)', fontFamily: F.regular, fontSize: 12, textAlign: 'center' }}>
                      Tap "+ New Sticker" to upload custom animated or static stickers
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
    </View>
  );
}
