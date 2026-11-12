import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Segmented } from '../lib/icon';
import { mediaUrl } from '../lib/api';
import { confirm } from '../lib/native';
import { createPack, deletePack, installPack, loadAllCustomStickers, loadMarket, loadRecentStickers, loadStickerPacks, recordRecentSticker, updatePack, uploadCustomSticker, type Sticker, type StickerPack } from '../lib/stickers';
import { C, F } from '../lib/theme';

const src = (s: Sticker) => s.url || mediaUrl(s.id);
const why = (e: any, fallback: string) => String(e?.message || fallback).toLowerCase();

function Button({ title, onPress, strong, busy, disabled }: { title: string; onPress: () => void; strong?: boolean; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable disabled={busy || disabled} onPress={() => { Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => ({ height: 44, paddingHorizontal: 18, borderRadius: 22, borderCurve: 'continuous', backgroundColor: strong ? '#fff' : 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}>
      {busy ? <ActivityIndicator color={strong ? '#000' : '#fff'} /> : <Text style={{ color: strong ? '#000' : '#fff', fontFamily: F.black, fontSize: 15 }}>{title}</Text>}
    </Pressable>
  );
}

function Strip({ stickers }: { stickers: Sticker[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {stickers.map((s) => <Image key={s.id} source={src(s)} style={{ width: 56, height: 56 }} contentFit="contain" cachePolicy="memory-disk" />)}
    </ScrollView>
  );
}

function Card({ children, at = 0 }: { children: React.ReactNode; at?: number }) {
  return <Animated.View entering={FadeInDown.delay(Math.min(at, 6) * 45).duration(260)} layout={LinearTransition.duration(240)} style={{ borderRadius: 24, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.06)', padding: 16, gap: 12 }}>{children}</Animated.View>;
}

export default function Packs() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'mine' | 'market'>('mine');
  const [packs, setPacks] = useState<StickerPack[] | null>(null);
  const [market, setMarket] = useState<StickerPack[] | null>(null);
  const [mine, setMine] = useState<Sticker[]>([]);
  const [making, setMaking] = useState(false);
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const reload = () => {
    loadStickerPacks().then(setPacks).catch(() => setPacks([]));
    loadMarket().then(setMarket).catch(() => setMarket([]));
  };
  useEffect(() => {
    reload();
    Promise.all([loadAllCustomStickers(), loadRecentStickers()]).then(([own, recent]) => {
      const seen = new Set<string>();
      setMine([...own, ...recent].filter((s) => !s.is_emoji && (seen.has(s.id) ? false : (seen.add(s.id), true))));
    }).catch(() => {});
  }, []);

  const owned = useMemo(() => (packs ?? []).filter((p) => p.mine), [packs]);
  const added = useMemo(() => (packs ?? []).filter((p) => !p.mine && p.owner_id), [packs]);
  const run = async (key: string, job: () => Promise<unknown>, fallback: string) => {
    setBusy(key);
    setError('');
    try { await job(); reload(); return true; }
    catch (e) { setError(why(e, fallback)); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); return false; }
    finally { setBusy(null); }
  };
  const create = async () => {
    if (await run('create', () => createPack(title.trim(), picked), 'couldn’t make the pack, try again')) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMaking(false); setTitle(''); setPicked([]);
    }
  };
  const upload = () => run('upload', async () => {
    const s = await uploadCustomSticker(false);
    if (!s) return;
    recordRecentSticker(s.id);
    setMine((v) => [s, ...v.filter((x) => x.id !== s.id)]);
    setPicked((v) => (v.includes(s.id) ? v : [...v, s.id]));
  }, 'couldn’t upload this image, try again');
  const publish = (p: StickerPack, on: boolean) => {
    setPacks((v) => v?.map((x) => (x.id === p.id ? { ...x, published: on } : x)) ?? v);
    run(`pub:${p.id}`, () => updatePack(p.id, { published: on }), 'couldn’t change this pack, try again');
  };
  const remove = (p: StickerPack) => confirm(p.mine ? `delete ${p.title.toLowerCase()}?` : `remove ${p.title.toLowerCase()}?`, p.mine ? 'the pack is deleted for everyone who added it. your stickers stay.' : 'it leaves your sticker picker.', p.mine ? 'delete' : 'remove', () => {
    run(`del:${p.id}`, () => deletePack(p.id), 'couldn’t remove this pack, try again');
  });

  const label = (text: string) => <Text style={{ color: C.dim, fontFamily: F.black, fontSize: 13, marginLeft: 6, marginTop: 6 }}>{text}</Text>;

  return (
    <ScrollView style={{ backgroundColor: C.surface }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 26, paddingBottom: insets.bottom + 28, gap: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 26, letterSpacing: -0.4, marginLeft: 4 }}>sticker packs</Text>
      <Segmented options={['mine', 'market'] as const} value={tab} height={38} label={(t) => (t === 'mine' ? 'my packs' : 'marketplace')} onChange={(t) => { Haptics.selectionAsync(); setTab(t); setError(''); }} />
      {error ? <Animated.Text entering={FadeIn.duration(180)} style={{ color: C.danger, fontFamily: F.bold, fontSize: 14, marginLeft: 6 }}>{error}</Animated.Text> : null}

      {tab === 'mine' ? (
        making ? (
          <Card>
            <TextInput value={title} onChangeText={setTitle} placeholder="pack name" placeholderTextColor="rgba(255,255,255,0.35)" maxLength={32} autoFocus keyboardAppearance="dark"
              style={{ height: 48, borderRadius: 16, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, color: '#fff', fontFamily: F.bold, fontSize: 16 }} />
            <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 13 }}>{picked.length ? `${picked.length} picked` : 'pick the stickers for this pack'}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Pressable onPress={upload} style={({ pressed }) => ({ width: 68, height: 68, borderRadius: 18, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                {busy === 'upload' ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 26, lineHeight: 30 }}>+</Text>}
              </Pressable>
              {mine.map((s) => {
                const n = picked.indexOf(s.id);
                return (
                  <Pressable key={s.id} onPress={() => { Haptics.selectionAsync(); setPicked((v) => (n >= 0 ? v.filter((x) => x !== s.id) : v.length < 100 ? [...v, s.id] : v)); }} style={({ pressed }) => ({ width: 68, height: 68, borderRadius: 18, borderCurve: 'continuous', padding: 5, backgroundColor: n >= 0 ? 'rgba(255,255,255,0.16)' : 'transparent', borderWidth: 2, borderColor: n >= 0 ? '#fff' : 'transparent', transform: [{ scale: pressed ? 0.9 : 1 }] })}>
                    <Image source={src(s)} style={{ flex: 1 }} contentFit="contain" cachePolicy="memory-disk" />
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              <Button title="cancel" onPress={() => { setMaking(false); setError(''); }} />
              <Button strong title="create pack" busy={busy === 'create'} disabled={!title.trim() || !picked.length} onPress={create} />
            </View>
          </Card>
        ) : (
          <>
            <Button strong title="new pack" onPress={() => { setMaking(true); setError(''); }} />
            {packs === null ? <ActivityIndicator color="#fff" style={{ marginTop: 20 }} /> : null}
            {packs && !owned.length && !added.length ? <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 15, textAlign: 'center', marginTop: 18, paddingHorizontal: 20 }}>no packs yet. make one from your stickers, or add one from the marketplace.</Text> : null}
            {owned.length ? label('made by you') : null}
            {owned.map((p, i) => (
              <Card key={p.id} at={i}>
                <View>
                  <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 18 }}>{p.title}</Text>
                  <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 13 }}>{p.stickers.length} {p.stickers.length === 1 ? 'sticker' : 'stickers'}{p.published ? ` · ${p.installs ?? 0} ${p.installs === 1 ? 'add' : 'adds'}` : ' · only you'}</Text>
                </View>
                <Strip stickers={p.stickers} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 15 }}>on the marketplace</Text>
                    <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 12 }}>free for everyone to add</Text>
                  </View>
                  <Switch value={!!p.published} disabled={busy === `pub:${p.id}`} onValueChange={(on) => publish(p, on)} trackColor={{ true: C.red, false: 'rgba(255,255,255,0.18)' }} thumbColor="#fff" ios_backgroundColor="rgba(255,255,255,0.18)" />
                </View>
                <Pressable onPress={() => remove(p)} hitSlop={8}><Text style={{ color: C.danger, fontFamily: F.black, fontSize: 15 }}>delete pack</Text></Pressable>
              </Card>
            ))}
            {added.length ? label('added from the marketplace') : null}
            {added.map((p, i) => (
              <Card key={p.id} at={owned.length + i}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 18 }}>{p.title}</Text>
                    <Text numberOfLines={1} style={{ color: C.dim, fontFamily: F.bold, fontSize: 13 }}>by {(p.owner_name ?? 'someone').toLowerCase()}</Text>
                  </View>
                  <Button title="remove" busy={busy === `del:${p.id}`} onPress={() => remove(p)} />
                </View>
                <Strip stickers={p.stickers} />
              </Card>
            ))}
          </>
        )
      ) : (
        <>
          {market === null ? <ActivityIndicator color="#fff" style={{ marginTop: 20 }} /> : null}
          {market && !market.length ? <Text style={{ color: C.dim, fontFamily: F.bold, fontSize: 15, textAlign: 'center', marginTop: 18, paddingHorizontal: 20 }}>nothing here yet. publish one of your packs to be first.</Text> : null}
          {(market ?? []).map((p, i) => (
            <Card key={p.id} at={i}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: '#fff', fontFamily: F.black, fontSize: 18 }}>{p.title}</Text>
                  <Text numberOfLines={1} style={{ color: C.dim, fontFamily: F.bold, fontSize: 13 }}>by {(p.owner_name ?? 'someone').toLowerCase()} · {p.stickers.length} {p.stickers.length === 1 ? 'sticker' : 'stickers'} · free</Text>
                </View>
                {p.installed
                  ? <Button title="added" busy={busy === `del:${p.id}`} onPress={() => run(`del:${p.id}`, () => deletePack(p.id), 'couldn’t remove this pack, try again')} />
                  : <Button strong title="add" busy={busy === `add:${p.id}`} onPress={() => run(`add:${p.id}`, () => installPack(p.id), 'couldn’t add this pack, try again').then((ok) => { if (ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); })} />}
              </View>
              <Strip stickers={p.stickers} />
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}
