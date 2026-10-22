import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { setPref } from '../lib/notifs';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { router, DarkTheme, ThemeProvider } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dimensions, Linking, Pressable, Share, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, FadeIn, FadeInLeft, FadeInRight, FadeOut, LinearTransition, interpolate, interpolateColor, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, clear, logout, nameOf, req, type Friend, type FriendRequest, type Me, type User } from '../lib/api';
import { pickAndUploadPhoto } from '../lib/photo';
import { loadBlocks, unblock } from '../lib/safety';
import { syncAll } from '../lib/realtime';
import { removeFriend, set, upsertFriend, useStore } from '../lib/store';
import { API, C, F } from '../lib/theme';
import { SPRING, Squish, Swap } from '../lib/tt';
import { Avatar } from '../lib/ui';
import { signOutLocal } from './_layout';

const CARD = '#121212';
const SEP = 'rgba(255,255,255,0.07)';
const MOVE = LinearTransition.duration(240);
const PILL_SPRING = { damping: 28, stiffness: 320, mass: 0.8 };

function Chevron() {
  return <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.3)" size={14} weight="bold" fallback={<MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.3)" />} />;
}

type Trophy = { id: string; title: string; sub: string; goal: number; progress: number; done: boolean };

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Animated.View layout={MOVE} entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={{ gap: 8 }}>
      {title ? <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.black, fontSize: 13, paddingHorizontal: 16 }}>{title}</Text> : null}
      <View style={{ backgroundColor: CARD, borderRadius: 24, borderCurve: 'continuous', overflow: 'hidden' }}>{children}</View>
    </Animated.View>
  );
}

function Row({ label, sub, onPress, right, color = '#fff', first }: { label: string; sub?: string; onPress?: () => void; right?: ReactNode; color?: string; first?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ minHeight: 56, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent', borderTopWidth: first ? 0 : 1, borderTopColor: SEP })}>
      <View style={{ flex: 1 }}>
        <Swap text={label} style={{ color, fontFamily: F.bold, fontSize: 16 }} />
        {sub ? <Text style={{ color: 'rgba(255,255,255,0.42)', fontFamily: F.regular, fontSize: 13, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      {right === undefined && onPress ? <Chevron /> : right}
    </Pressable>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => { v.value = withSpring(on ? 1 : 0, SPRING); }, [on]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(v.value, [0, 1], ['rgba(255,255,255,0.14)', C.red]) }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: v.value * 22 }] }));
  return (
    <Pressable onPress={() => { Haptics.selectionAsync(); onChange(!on); }} hitSlop={8}>
      <Animated.View style={[{ width: 52, height: 30, borderRadius: 15, padding: 3 }, track]}>
        <Animated.View style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' }, knob]} />
      </Animated.View>
    </Pressable>
  );
}

function Chip({ title, onPress, strong, danger }: { title: string; onPress: () => void; strong?: boolean; danger?: boolean }) {
  return (
    <Squish onPress={onPress} style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: 'center', backgroundColor: danger ? 'rgba(255,69,58,0.2)' : strong ? '#fff' : 'rgba(255,255,255,0.1)' }}>
      <Swap text={title} style={{ color: danger ? C.danger : strong ? '#000' : '#fff', fontFamily: F.black, fontSize: 13 }} />
    </Squish>
  );
}

function Person({ user, first, right }: { user: User; first?: boolean; right: ReactNode }) {
  return (
    <Animated.View layout={MOVE} exiting={FadeOut.duration(160)} style={{ minHeight: 62, paddingHorizontal: 18, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: first ? 0 : 1, borderTopColor: SEP }}>
      <Avatar user={user} size={40} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 15 }}>{nameOf(user)}</Text>
        {user.username ? <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.42)', fontFamily: F.regular, fontSize: 13 }}>@{user.username}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>{right}</View>
    </Animated.View>
  );
}

function FriendRow({ f, first }: { f: Friend; first: boolean }) {
  const [sure, setSure] = useState(false);
  useEffect(() => { if (sure) { const t = setTimeout(() => setSure(false), 3000); return () => clearTimeout(t); } }, [sure]);
  const remove = () => {
    if (!sure) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); setSure(true); return; }
    removeFriend(f.id);
    req(`/v1/friends/${f.id}`, { method: 'DELETE' }).catch(() => syncAll().catch(() => {}));
  };
  return <Person user={f} first={first} right={<Chip title={sure ? 'sure?' : 'remove'} danger={sure} onPress={remove} />} />;
}

function Inline({ value, onSave, prefix, placeholder, max, clean }: { value: string; onSave: (v: string) => Promise<void>; prefix?: string; placeholder: string; max: number; clean?: (v: string) => string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = () => { if (v.trim() && v !== value) onSave(v.trim()).catch(() => setV(value)); else setV(value); };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {prefix ? <Text style={{ color: 'rgba(255,255,255,0.42)', fontFamily: F.bold, fontSize: 16 }}>{prefix}</Text> : null}
      <TextInput value={v} onChangeText={(t) => setV(clean ? clean(t) : t)} onBlur={save} onSubmitEditing={save} placeholder={placeholder} placeholderTextColor="rgba(255,255,255,0.25)" maxLength={max} autoCapitalize={prefix ? 'none' : 'words'} autoCorrect={false} returnKeyType="done" keyboardAppearance="dark" selectionColor={C.red} style={{ flex: 1, color: '#fff', fontFamily: F.bold, fontSize: 16, paddingVertical: 0 }} />
    </View>
  );
}

type TabKey = 'profile' | 'friends' | 'prefs';

type TabItem = {
  key: TabKey;
  label: string;
  badge?: number;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function SegmentedTabs({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: TabItem[];
  activeTab: TabKey;
  onSelect: (k: TabKey) => void;
}) {
  const count = Math.max(tabs.length, 1);
  const initialWidth = Math.max(0, SCREEN_WIDTH - 32 - 8);
  const [rowWidth, setRowWidth] = useState(initialWidth);
  const tabWidth = rowWidth / count;
  const activeIndex = Math.max(0, tabs.findIndex((t) => t.key === activeTab));

  const pillX = useSharedValue(activeIndex * (initialWidth / count));
  const pillWidth = useSharedValue(initialWidth / count);
  const isFirstMount = useRef(true);

  useEffect(() => {
    const targetX = activeIndex * tabWidth;
    if (isFirstMount.current) {
      pillX.value = targetX;
      pillWidth.value = tabWidth;
      isFirstMount.current = false;
    } else {
      pillX.value = withSpring(targetX, PILL_SPRING);
      pillWidth.value = withSpring(tabWidth, PILL_SPRING);
    }
  }, [activeIndex, tabWidth]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: pillWidth.value,
  }));

  return (
    <View
      style={{
        backgroundColor: CARD,
        borderRadius: 22,
        padding: 4,
        height: 46,
      }}>
      <View
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0 && Math.abs(w - rowWidth) > 0.5) {
            setRowWidth(w);
          }
        }}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'stretch',
          position: 'relative',
        }}>
        {/* Sliding Pill */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.14)',
            },
            pillStyle,
          ]}
        />

        {/* Tab Items */}
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => {
                Haptics.selectionAsync();
                onSelect(t.key);
              }}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 6,
                zIndex: 1,
              }}>
              <Text
                style={{
                  color: active ? '#fff' : 'rgba(255,255,255,0.4)',
                  fontFamily: F.bold,
                  fontSize: 13,
                }}>
                {t.label}
              </Text>
              {t.badge ? (
                <View
                  style={{
                    minWidth: 16,
                    height: 16,
                    paddingHorizontal: 4,
                    borderRadius: 8,
                    backgroundColor: C.red,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 10 }}>{t.badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function Settings() {
  const insets = useSafeAreaInsets();
  const { me, friends, incoming, outgoing } = useStore();
  const [tab, setTab] = useState<TabKey>('profile');
  const [blocked, setBlocked] = useState<User[]>([]);
  useEffect(() => { loadBlocks().then(setBlocked).catch(() => {}); }, []);
  const [trophies, setTrophies] = useState<Trophy[]>([]);
  useEffect(() => { req<Trophy[]>('/v1/me/achievements').then(setTrophies).catch(() => {}); }, []);
  const doUnblock = (u: User) => { setBlocked((b) => b.filter((x) => x.id !== u.id)); unblock(u.id).catch(() => loadBlocks().then(setBlocked).catch(() => {})); };
  const [error, setError] = useState('');
  const [sureDelete, setSureDelete] = useState(false);
  useEffect(() => { if (error) { const t = setTimeout(() => setError(''), 3500); return () => clearTimeout(t); } }, [error]);
  useEffect(() => { if (sureDelete) { const t = setTimeout(() => setSureDelete(false), 3500); return () => clearTimeout(t); } }, [sureDelete]);
  if (!me) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  const patch = async (body: Partial<Me>) => {
    try { set({ me: await req<Me>('/v1/me', { method: 'PATCH', body }) }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    catch (e) { setError((e instanceof ApiError ? e.message : 'couldn’t save').toLowerCase()); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); throw e; }
  };
  const notif = useStore((s) => s.notif);
  const setDnd = (dnd: boolean) => {
    set({ me: { ...me, dnd } });
    req<Me>('/v1/status', { method: 'PUT', body: { dnd } }).then((m) => set({ me: m })).catch(() => set({ me: { ...me, dnd: !dnd } }));
  };
  const accept = async (r: FriendRequest) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    set((s) => ({ incoming: s.incoming.filter((x) => x.id !== r.id) }));
    try { upsertFriend(await req(`/v1/friends/requests/${r.id}/accept`, { method: 'POST' })); } catch { syncAll().catch(() => {}); }
  };
  const drop = (r: FriendRequest) => {
    Haptics.selectionAsync();
    set((s) => ({ incoming: s.incoming.filter((x) => x.id !== r.id), outgoing: s.outgoing.filter((x) => x.id !== r.id) }));
    req(`/v1/friends/requests/${r.id}`, { method: 'DELETE' }).catch(() => syncAll().catch(() => {}));
  };
  const del = async () => {
    if (!sureDelete) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); setSureDelete(true); return; }
    await req('/v1/me', { method: 'DELETE' }).catch(() => {});
    await clear(); signOutLocal();
  };
  const version = `${Constants.expoConfig?.version ?? '1.0.0'}${Updates.updateId ? ` · ${Updates.updateId.slice(0, 7)}` : ''}`;

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const borderStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 16], [0, 1], 'clamp'),
  }));

  const tabs: TabItem[] = [
    { key: 'profile', label: 'profile' },
    { key: 'friends', label: `friends (${friends.length})`, badge: incoming.length || undefined },
    { key: 'prefs', label: 'settings' },
  ];

  const TAB_ORDER: TabKey[] = ['profile', 'friends', 'prefs'];
  const prevTab = useRef<TabKey>(tab);
  const tabDir = TAB_ORDER.indexOf(tab) >= TAB_ORDER.indexOf(prevTab.current) ? 1 : -1;
  useEffect(() => {
    prevTab.current = tab;
  }, [tab]);

  const headerHeight = insets.top + 56;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Sticky Header with Real Native Frost Backdrop */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
        }}>
        {/* Real Native iOS frosted glass backdrop (reveals cleanly on scroll) */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: headerHeight,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              overflow: 'hidden',
            },
            borderStyle,
          ]}>
          <BlurView
            tint="systemUltraThinMaterialDark"
            intensity={85}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(0,0,0,0.15)' },
            ]}
          />
          {/* Hairline bottom border */}
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: StyleSheet.hairlineWidth,
              backgroundColor: SEP,
            }}
          />
        </Animated.View>

        {/* Soft bottom gradient feather to melt smoothly into content */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: headerHeight,
              left: 0,
              right: 0,
              height: 20,
            },
            borderStyle,
          ]}>
          <LinearGradient
            colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0.08)', 'transparent']}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* Header Content */}
        <View
          style={{
            paddingTop: insets.top + 8,
            paddingBottom: 10,
            paddingHorizontal: 20,
            justifyContent: 'center',
          }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 32, letterSpacing: -0.5 }}>settings</Text>
        </View>
      </View>

      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: headerHeight + 12,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 16,
          gap: 18,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets>
        {/* Morphing Animated Segmented Tab Bar */}
        <SegmentedTabs tabs={tabs} activeTab={tab} onSelect={setTab} />

        {/* TAB 1: PROFILE */}
        {tab === 'profile' && (
          <Animated.View key="profile" entering={tabDir > 0 ? FadeInRight.duration(220) : FadeInLeft.duration(220)} style={{ gap: 16 }}>
            {/* Avatar block */}
            <View style={{ alignItems: 'center', paddingVertical: 6, gap: 10 }}>
              <Squish onPress={() => pickAndUploadPhoto().catch((e) => setError(String(e?.message ?? 'upload failed').toLowerCase()))} style={{ alignItems: 'center', gap: 10 }}>
                <Avatar user={me} size={96} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <SymbolView name="camera.fill" size={13} tintColor="rgba(255,255,255,0.6)" fallback={<MaterialCommunityIcons name="camera" size={13} color="rgba(255,255,255,0.6)" />} />
                  <Text style={{ color: 'rgba(255,255,255,0.65)', fontFamily: F.black, fontSize: 14 }}>change photo</Text>
                </View>
              </Squish>
              {error ? <Animated.Text entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={{ color: C.danger, fontFamily: F.bold, fontSize: 13 }}>{error}</Animated.Text> : null}
            </View>

            {/* Profile fields */}
            <Section title="your details">
              <Row first label="name" right={<View style={{ width: '60%' }}><Inline value={me.display_name} placeholder="your name" max={32} onSave={(display_name) => patch({ display_name })} /></View>} />
              <Row label="username" right={<View style={{ width: '60%' }}><Inline value={me.username ?? ''} prefix="@" placeholder="username" max={20} clean={(t) => t.toLowerCase().replace(/[^a-z0-9_.]/g, '')} onSave={(username) => patch({ username })} /></View>} />
              <Row label="email" right={<Text numberOfLines={1} style={{ width: '60%', color: 'rgba(255,255,255,0.42)', fontFamily: F.bold, fontSize: 15 }}>{me.email}</Text>} />
            </Section>

            {/* Share & Quick Add */}
            <Section title="share">
              <Row first label="share my profile" sub={`@${me.username}`} onPress={() => Share.share({ message: `add me on yapp! i'm @${me.username}` })} />
            </Section>

            {/* Trophies */}
            {trophies.length ? (
              <Section title={`trophies · ${trophies.filter((t) => t.done).length}/${trophies.length}`}>
                {trophies.map((t, i) => (
                  <Row key={t.id} first={i === 0} label={t.title} sub={t.sub} color={t.done ? '#fff' : 'rgba(255,255,255,0.5)'}
                    right={<Text style={{ color: t.done ? '#fff' : 'rgba(255,255,255,0.35)', fontFamily: F.black, fontSize: 13 }}>{t.done ? 'unlocked' : `${t.progress}/${t.goal}`}</Text>} />
                ))}
              </Section>
            ) : null}
          </Animated.View>
        )}

        {/* TAB 2: FRIENDS & REQUESTS */}
        {tab === 'friends' && (
          <Animated.View key="friends" entering={tabDir > 0 ? FadeInRight.duration(220) : FadeInLeft.duration(220)} style={{ gap: 16 }}>
            {/* Add friend action banner */}
            <Section>
              <Row first label="add friends by username" sub="find friends and invite them to chat" onPress={() => { router.back(); setTimeout(() => router.push('/add'), 250); }} />
            </Section>

            {/* Incoming Requests */}
            {incoming.length ? (
              <Section title={`friend requests · ${incoming.length}`}>
                {incoming.map((r, i) => (
                  <Person key={r.id} user={r.user} first={i === 0} right={
                    <>
                      <Chip title="decline" onPress={() => drop(r)} />
                      <Chip title="accept" strong onPress={() => accept(r)} />
                    </>
                  } />
                ))}
              </Section>
            ) : null}

            {/* Outgoing Requests */}
            {outgoing.length ? (
              <Section title={`sent requests · ${outgoing.length}`}>
                {outgoing.map((r, i) => (
                  <Person key={r.id} user={r.user} first={i === 0} right={<Chip title="cancel" onPress={() => drop(r)} />} />
                ))}
              </Section>
            ) : null}

            {/* Friend List */}
            <Section title={`all friends · ${friends.length}`}>
              {friends.length ? (
                friends.map((f, i) => <FriendRow key={f.id} f={f} first={i === 0} />)
              ) : (
                <Row first label="no friends yet" sub="tap above to add someone by username" />
              )}
            </Section>

            {/* Blocked Users */}
            {blocked.length ? (
              <Section title={`blocked · ${blocked.length}`}>
                {blocked.map((u, i) => (
                  <Person key={u.id} user={u} first={i === 0} right={<Chip title="unblock" onPress={() => doUnblock(u)} />} />
                ))}
              </Section>
            ) : null}
          </Animated.View>
        )}

        {/* TAB 3: PREFERENCES & SETTINGS */}
        {tab === 'prefs' && (
          <Animated.View key="prefs" entering={tabDir > 0 ? FadeInRight.duration(220) : FadeInLeft.duration(220)} style={{ gap: 16 }}>
            {/* Status */}
            <Section title="status">
              <Row first label="do not disturb" sub="friends can’t talk or call you" right={<Toggle on={me.dnd} onChange={setDnd} />} />
            </Section>

            {/* Notifications */}
            {notif ? (
              <Section title="notifications">
                <Row first label="messages" sub="chats and groups" right={<Toggle on={notif.prefs.messages} onChange={(v) => setPref('messages', v)} />} />
                <Row label="talk" sub="when a friend talks to you" right={<Toggle on={notif.prefs.talk} onChange={(v) => setPref('talk', v)} />} />
                <Row label="calls" sub="incoming voice and video calls" right={<Toggle on={notif.prefs.calls} onChange={(v) => setPref('calls', v)} />} />
                <Row label="friends" sub="requests and acceptances" right={<Toggle on={notif.prefs.friends} onChange={(v) => setPref('friends', v)} />} />
              </Section>
            ) : null}

            {/* Support and legal */}
            <Section title="help & legal">
              <Row first label="contact support" sub="info@kreatix.dev" onPress={() => Linking.openURL('mailto:info@kreatix.dev?subject=Yapp')} />
              <Row label="privacy policy" onPress={() => Linking.openURL(`${API}/privacy`)} />
              <Row label="terms of service" onPress={() => Linking.openURL(`${API}/terms`)} />
            </Section>

            {/* Account Danger Zone */}
            <Section title="account">
              <Row first label="sign out" onPress={async () => { await logout(); signOutLocal(); }} right={null} />
              <Row label={sureDelete ? 'tap again to delete forever' : 'delete account'} sub="removes your profile, photo and friends" color={C.danger} onPress={del} right={null} />
            </Section>
          </Animated.View>
        )}

        {/* Footer */}
        <Text style={{ color: 'rgba(255,255,255,0.25)', fontFamily: F.bold, fontSize: 12, textAlign: 'center', marginTop: 4 }}>
          yapp {version}
        </Text>
      </Animated.ScrollView>
    </View>
  );
}
