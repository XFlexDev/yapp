import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Updates from 'expo-updates';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, clear, logout, nameOf, req, type Friend, type FriendRequest, type Me, type User } from '../lib/api';
import { pickAndUploadPhoto } from '../lib/photo';
import { syncAll } from '../lib/realtime';
import { removeFriend, set, upsertFriend, useStore } from '../lib/store';
import { API, C, F } from '../lib/theme';
import { SPRING, Squish, Swap } from '../lib/tt';
import { Avatar } from '../lib/ui';
import { signOutLocal } from './_layout';

const CARD = '#121212';
const SEP = 'rgba(255,255,255,0.07)';
const MOVE = LinearTransition.duration(260);

function Chevron() {
  return <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.3)" size={14} weight="bold" fallback={<MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.3)" />} />;
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Animated.View layout={MOVE} entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={{ gap: 8 }}>
      {title ? <Text style={{ color: 'rgba(255,255,255,0.4)', fontFamily: F.black, fontSize: 13, paddingHorizontal: 18 }}>{title}</Text> : null}
      <View style={{ backgroundColor: CARD, borderRadius: 24, borderCurve: 'continuous', overflow: 'hidden' }}>{children}</View>
    </Animated.View>
  );
}

function Row({ label, sub, onPress, right, color = '#fff', first }: { label: string; sub?: string; onPress?: () => void; right?: ReactNode; color?: string; first?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ minHeight: 58, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent', borderTopWidth: first ? 0 : 1, borderTopColor: SEP })}>
      <View style={{ flex: 1 }}>
        <Swap text={label} style={{ color, fontFamily: F.bold, fontSize: 17 }} />
        {sub ? <Text style={{ color: 'rgba(255,255,255,0.42)', fontFamily: F.regular, fontSize: 14, marginTop: 1 }}>{sub}</Text> : null}
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
      <Animated.View style={[{ width: 54, height: 32, borderRadius: 16, padding: 3 }, track]}>
        <Animated.View style={[{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff' }, knob]} />
      </Animated.View>
    </Pressable>
  );
}

function Chip({ title, onPress, strong }: { title: string; onPress: () => void; strong?: boolean }) {
  return (
    <Squish onPress={onPress} style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: strong ? '#fff' : 'rgba(255,255,255,0.1)' }}>
      <Swap text={title} style={{ color: strong ? '#000' : '#fff', fontFamily: F.black, fontSize: 14 }} />
    </Squish>
  );
}

function Person({ user, first, right }: { user: User; first?: boolean; right: ReactNode }) {
  return (
    <Animated.View layout={MOVE} exiting={FadeOut.duration(160)} style={{ minHeight: 66, paddingHorizontal: 18, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: first ? 0 : 1, borderTopColor: SEP }}>
      <Avatar user={user} size={42} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 16 }}>{nameOf(user)}</Text>
        {user.username ? <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.42)', fontFamily: F.regular, fontSize: 14 }}>@{user.username}</Text> : null}
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
  return <Person user={f} first={first} right={<Chip title={sure ? 'sure?' : 'remove'} onPress={remove} />} />;
}

function Inline({ value, onSave, prefix, placeholder, max, clean }: { value: string; onSave: (v: string) => Promise<void>; prefix?: string; placeholder: string; max: number; clean?: (v: string) => string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = () => { if (v.trim() && v !== value) onSave(v.trim()).catch(() => setV(value)); else setV(value); };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {prefix ? <Text style={{ color: 'rgba(255,255,255,0.42)', fontFamily: F.bold, fontSize: 17 }}>{prefix}</Text> : null}
      <TextInput value={v} onChangeText={(t) => setV(clean ? clean(t) : t)} onBlur={save} onSubmitEditing={save} placeholder={placeholder} placeholderTextColor="rgba(255,255,255,0.25)" maxLength={max} autoCapitalize={prefix ? 'none' : 'words'} autoCorrect={false} returnKeyType="done" keyboardAppearance="dark" selectionColor={C.red} style={{ flex: 1, color: '#fff', fontFamily: F.bold, fontSize: 17, paddingVertical: 0 }} />
    </View>
  );
}

export default function Settings() {
  const insets = useSafeAreaInsets();
  const { me, friends, incoming, outgoing } = useStore();
  const [error, setError] = useState('');
  const [sureDelete, setSureDelete] = useState(false);
  useEffect(() => { if (error) { const t = setTimeout(() => setError(''), 3500); return () => clearTimeout(t); } }, [error]);
  useEffect(() => { if (sureDelete) { const t = setTimeout(() => setSureDelete(false), 3500); return () => clearTimeout(t); } }, [sureDelete]);
  if (!me) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  const patch = async (body: Partial<Me>) => {
    try { set({ me: await req<Me>('/v1/me', { method: 'PATCH', body }) }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    catch (e) { setError((e instanceof ApiError ? e.message : 'couldn’t save').toLowerCase()); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); throw e; }
  };
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

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: 22, paddingBottom: insets.bottom + 40, paddingHorizontal: 14, gap: 22 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8 }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 34, letterSpacing: -0.5 }}>settings</Text>
          <Squish onPress={() => router.back()} style={{ height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: '#fff', justifyContent: 'center' }}>
            <Text style={{ color: '#000', fontFamily: F.black, fontSize: 15 }}>done</Text>
          </Squish>
        </View>

        <View style={{ alignItems: 'center', gap: 10 }}>
          <Squish onPress={() => pickAndUploadPhoto().catch((e) => setError(String(e?.message ?? 'upload failed').toLowerCase()))} style={{ alignItems: 'center', gap: 10 }}>
            <Avatar user={me} size={104} />
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontFamily: F.black, fontSize: 15 }}>change photo</Text>
          </Squish>
          {error ? <Animated.Text entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={{ color: C.danger, fontFamily: F.bold, fontSize: 14 }}>{error}</Animated.Text> : null}
        </View>

        <Section title="profile">
          <Row first label="name" right={<View style={{ width: '62%' }}><Inline value={me.display_name} placeholder="your name" max={32} onSave={(display_name) => patch({ display_name })} /></View>} />
          <Row label="username" right={<View style={{ width: '62%' }}><Inline value={me.username ?? ''} prefix="@" placeholder="username" max={20} clean={(t) => t.toLowerCase().replace(/[^a-z0-9_.]/g, '')} onSave={(username) => patch({ username })} /></View>} />
          <Row label="email" right={<Text numberOfLines={1} style={{ width: '62%', color: 'rgba(255,255,255,0.42)', fontFamily: F.bold, fontSize: 17 }}>{me.email}</Text>} />
        </Section>

        <Section>
          <Row first label="add friends" onPress={() => { router.back(); setTimeout(() => router.push('/add'), 250); }} />
          <Row label="share my profile" sub={`@${me.username}`} onPress={() => Share.share({ message: `add me on yapp! i'm @${me.username}` })} />
        </Section>

        {incoming.length ? (
          <Section title={`friend requests · ${incoming.length}`}>
            {incoming.map((r, i) => <Person key={r.id} user={r.user} first={i === 0} right={<><Chip title="decline" onPress={() => drop(r)} /><Chip title="accept" strong onPress={() => accept(r)} /></>} />)}
          </Section>
        ) : null}

        {outgoing.length ? (
          <Section title={`sent · ${outgoing.length}`}>
            {outgoing.map((r, i) => <Person key={r.id} user={r.user} first={i === 0} right={<Chip title="cancel" onPress={() => drop(r)} />} />)}
          </Section>
        ) : null}

        <Section title={`friends · ${friends.length}`}>
          {friends.length ? friends.map((f, i) => <FriendRow key={f.id} f={f} first={i === 0} />) : <Row first label="no friends yet" sub="add someone by their username" />}
        </Section>

        <Section>
          <Row first label="do not disturb" sub="friends can’t talk to you" right={<Toggle on={me.dnd} onChange={setDnd} />} />
        </Section>

        <Section title="help">
          <Row first label="contact support" sub="info@kreatix.dev" onPress={() => Linking.openURL('mailto:info@kreatix.dev?subject=Yapp')} />
          <Row label="privacy policy" onPress={() => Linking.openURL(`${API}/privacy`)} />
          <Row label="terms of service" onPress={() => Linking.openURL(`${API}/terms`)} />
        </Section>

        <Section>
          <Row first label="sign out" onPress={async () => { await logout(); signOutLocal(); }} right={null} />
          <Row label={sureDelete ? 'tap again to delete forever' : 'delete account'} sub="removes your profile, photo and friends" color={C.danger} onPress={del} right={null} />
        </Section>

        <Text style={{ color: 'rgba(255,255,255,0.25)', fontFamily: F.bold, fontSize: 13, textAlign: 'center' }}>yapp {version}</Text>
      </ScrollView>
    </View>
  );
}
