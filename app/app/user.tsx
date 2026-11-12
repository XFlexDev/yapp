import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, avatarUrl, nameOf, req, type User } from '../lib/api';
import { choose, confirm } from '../lib/native';
import { syncAll } from '../lib/realtime';
import { block, REASONS, report } from '../lib/safety';
import { removeFriend, set, upsertFriend, useStore } from '../lib/store';
import { C, F, SWATCH } from '../lib/theme';
import { Morph } from '../lib/tt';
import { Avatar } from '../lib/ui';
import { SettingGroup, SettingRow } from './chat';

type Profile = { user: User; joined_at: number; friends: number; mutual: number; is_friend: boolean; trophies: { id: string; title: string; sub: string }[] };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const joined = (t: number) => { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 20, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text numberOfLines={1} style={{ color: C.dim, fontFamily: F.bold, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Action({ title, onPress, strong, disabled }: { title: string; onPress: () => void; strong?: boolean; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} onPress={() => { Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => ({ flex: 1, height: 50, borderRadius: 25, borderCurve: 'continuous', backgroundColor: strong ? '#fff' : 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: strong ? '#000' : '#fff', fontFamily: F.black, fontSize: 16 }}>{title}</Text>
    </Pressable>
  );
}

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const me = useStore((s) => s.me);
  const friend = useStore((s) => s.friends.find((f) => f.id === id));
  const incoming = useStore((s) => s.incoming.find((r) => r.user.id === id));
  const outgoing = useStore((s) => s.outgoing.find((r) => r.user.id === id));
  // Whatever the app already knows about this person shows instantly; the rest fills in.
  const known = useStore((s) => (s.me?.id === id ? (s.me as User) : undefined)
    ?? Object.values(s.groups).flatMap((g) => g.members).find((u) => u.id === id));
  const [p, setP] = useState<Profile | null>(null);
  const [gone, setGone] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    req<Profile>(`/v1/users/${id}/profile`).then(setP).catch((e) => { if (e instanceof ApiError && e.status === 404) setGone(true); });
  }, [id]);

  const user: User | undefined = friend ?? p?.user ?? incoming?.user ?? outgoing?.user ?? known;
  if (!user) {
    return (
      <View style={{ flex: 1, minHeight: 320, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
        {gone ? <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 16 }}>this profile isn’t available</Text> : <ActivityIndicator color="#fff" />}
      </View>
    );
  }

  const isMe = user.id === me?.id;
  const who = nameOf(user).toLowerCase();
  const photo = avatarUrl(user);
  const status = isMe ? null : friend ? (friend.dnd ? 'do not disturb' : friend.online ? 'online' : 'offline') : null;

  const message = () => {
    const open = useStore.getState().openChat === user.id;
    router.back();
    if (!open) setTimeout(() => router.push({ pathname: '/chat', params: { id: user.id } }), 250);
  };
  const add = async () => {
    if (!user.username) return;
    setBusy(true);
    try {
      await req('/v1/friends/requests', { method: 'POST', body: { username: user.username } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSent(true);
      syncAll().catch(() => {});
    } catch { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
    finally { setBusy(false); }
  };
  const accept = async () => {
    if (!incoming) return;
    setBusy(true);
    set((s) => ({ incoming: s.incoming.filter((x) => x.id !== incoming.id) }));
    try { upsertFriend(await req(`/v1/friends/requests/${incoming.id}/accept`, { method: 'POST' })); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    catch { syncAll().catch(() => {}); }
    finally { setBusy(false); }
  };
  const remove = () => confirm(`remove ${who}?`, 'they won’t be able to talk to you until you add each other again.', 'remove', () => {
    req(`/v1/friends/${user.id}`, { method: 'DELETE' }).then(() => removeFriend(user.id)).catch(() => {});
  });
  const doBlock = () => confirm(`block ${who}?`, 'they can’t talk to you, call you or find you.', 'block', () => { block(user.id).catch(() => {}); router.back(); });
  const sendReport = (reason: string) => { report(user.id, reason).catch(() => {}); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setReporting(false); setReported(true); };
  const openReport = () => { if (!choose(`report ${who}`, REASONS, (i) => sendReport(REASONS[i]))) setReporting((v) => !v); };

  return (
    <ScrollView style={{ backgroundColor: C.surface }} contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
      <View style={{ height: 320, backgroundColor: SWATCH[user.color] ?? C.red, justifyContent: 'flex-end' }}>
        {photo ? <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" /> : null}
        <LinearGradient colors={['rgba(17,17,17,0)', 'rgba(17,17,17,0.55)', C.surface]} locations={[0, 0.6, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 200 }} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, paddingHorizontal: 20 }}>
          <Avatar user={user} size={76} ring />
          <View style={{ flex: 1, paddingBottom: 6 }}>
            <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 28, letterSpacing: -0.4 }}>{nameOf(user)}</Text>
            <Text numberOfLines={1} style={{ fontFamily: F.bold, fontSize: 15 }}>
              {user.username ? <Text style={{ color: 'rgba(255,255,255,0.6)' }}>@{user.username}</Text> : null}
              {status ? <Text style={{ color: status === 'online' ? C.online : 'rgba(255,255,255,0.6)' }}>{user.username ? ' · ' : ''}{status}</Text> : null}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 18, gap: 16 }}>
        <Animated.View entering={FadeInDown.duration(260)} style={{ flexDirection: 'row', gap: 10 }}>
          {isMe ? <Action title="edit profile" onPress={() => { router.back(); setTimeout(() => router.push('/settings'), 250); }} />
            : friend ? <Action strong title="message" onPress={message} />
            : incoming ? <Action strong title="accept request" disabled={busy} onPress={accept} />
            : outgoing || sent ? <Action title="request sent" disabled onPress={() => {}} />
            : user.username ? <Action strong title="add friend" disabled={busy} onPress={add} />
            : null}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(50).duration(260)} style={{ flexDirection: 'row', borderRadius: 24, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.06)', paddingVertical: 16 }}>
          <Stat value={p ? String(p.friends) : '–'} label="friends" />
          {isMe ? null : <Stat value={p ? String(p.mutual) : '–'} label="mutual" />}
          {friend ? <Stat value={String(friend.streak)} label="day streak" /> : null}
          <Stat value={p ? joined(p.joined_at) : '–'} label="joined" />
        </Animated.View>

        {p?.trophies.length ? (
          <Animated.View entering={FadeInDown.duration(260)} style={{ gap: 8 }}>
            <Text style={{ color: C.dim, fontFamily: F.black, fontSize: 13, marginLeft: 6 }}>trophies</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {p.trophies.map((t) => (
                <View key={t.id} style={{ borderRadius: 18, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 14 }}>{t.title}</Text>
                  <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 12 }}>{t.sub}</Text>
                </View>
              ))}
            </View>
          </Animated.View>
        ) : null}

        {isMe ? null : (
          <Morph>
          <SettingGroup>
            <SettingRow title={reported ? 'reported, thanks' : `report ${who}`} icon={['flag', 'flag-outline']} onPress={() => { if (!reported) openReport(); }} more={!reported} />
            {reporting ? REASONS.map((r) => <SettingRow key={r} title={r} onPress={() => sendReport(r)} />) : null}
            {friend ? <SettingRow title="remove friend" icon={['person.badge.minus', 'account-minus-outline']} danger onPress={remove} /> : null}
            <SettingRow title="block" icon={['hand.raised', 'hand-back-left-outline']} danger onPress={doBlock} />
          </SettingGroup>
          </Morph>
        )}
      </View>
    </ScrollView>
  );
}
