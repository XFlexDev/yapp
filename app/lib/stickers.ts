import * as ImagePicker from 'expo-image-picker';
import { req } from './api';
import { get, set, type ChatMsg } from './store';

export type Sticker = {
  id: string;
  url: string;
  name?: string;
  is_animated: boolean;
  is_emoji: boolean;
  width: number;
  height: number;
  size_bytes: number;
  alt_emoji?: string;
};

export type StickerPack = {
  id: string;
  slug: string;
  title: string;
  owner_id?: string;
  is_emoji_pack: boolean;
  thumbnail_url?: string;
  stickers: Sticker[];
};

const stickerCache = new Map<string, Sticker>();
const nameLookup = new Map<string, Sticker>();

export function registerStickers(stickers: Sticker[]) {
  for (const s of stickers) {
    if (!s) continue;
    stickerCache.set(s.id, s);
    if (s.name) {
      nameLookup.set(s.name.toLowerCase().trim(), s);
    }
    if (s.alt_emoji) {
      nameLookup.set(s.alt_emoji.toLowerCase().trim(), s);
    }
  }
}

export function getCachedSticker(nameOrId: string): Sticker | undefined {
  const clean = nameOrId.toLowerCase().trim().replace(/^:|:$/g, '');
  return nameLookup.get(clean) || stickerCache.get(nameOrId);
}

export async function resolveSticker(nameOrId: string): Promise<Sticker | null> {
  const cached = getCachedSticker(nameOrId);
  if (cached) return cached;
  const clean = nameOrId.toLowerCase().trim().replace(/^:|:$/g, '');
  try {
    const res = await req<Sticker>(`/v1/stickers/resolve/${encodeURIComponent(clean)}`);
    if (res) {
      registerStickers([res]);
      return res;
    }
  } catch {}
  return null;
}

export async function loadAllCustomStickers(): Promise<Sticker[]> {
  try {
    const res = await req<Sticker[]>('/v1/stickers');
    registerStickers(res);
    return res;
  } catch {
    return [];
  }
}

export async function loadStickerPacks(): Promise<StickerPack[]> {
  try {
    const packs = await req<StickerPack[]>('/v1/sticker-packs');
    for (const p of packs) {
      registerStickers(p.stickers);
    }
    return packs;
  } catch {
    return [];
  }
}

export async function loadRecentStickers(): Promise<Sticker[]> {
  try {
    const recents = await req<Sticker[]>('/v1/stickers/recent');
    registerStickers(recents);
    return recents;
  } catch {
    return [];
  }
}

export async function recordRecentSticker(sid: string) {
  req(`/v1/stickers/recent/${sid}`, { method: 'POST' }).catch(() => {});
}

export async function uploadCustomSticker(
  isEmoji = false,
  name?: string,
  preSelectedAsset?: { uri: string; mimeType?: string }
): Promise<Sticker | null> {
  let asset = preSelectedAsset;
  if (!asset) {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
    });
    const a = r.assets?.[0];
    if (r.canceled || !a) return null;
    asset = { uri: a.uri, mimeType: a.mimeType };
  }

  const blob = await (await fetch(asset.uri)).blob();
  const ctype = asset.mimeType || 'image/png';
  const qName = name ? `&name=${encodeURIComponent(name.toLowerCase().trim())}` : '';
  const stk = await req<Sticker>(`/v1/stickers/upload?is_emoji=${isEmoji}${qName}`, {
    method: 'POST',
    raw: blob,
    ctype,
  });
  if (stk) {
    registerStickers([stk]);
  }
  return stk;
}
