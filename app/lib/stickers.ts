import * as ImagePicker from 'expo-image-picker';
import { req } from './api';
import { get, set, type ChatMsg } from './store';

export type Sticker = {
  id: string;
  url: string;
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

export async function loadStickerPacks(): Promise<StickerPack[]> {
  try {
    return await req<StickerPack[]>('/v1/sticker-packs');
  } catch {
    return [];
  }
}

export async function loadRecentStickers(): Promise<Sticker[]> {
  try {
    return await req<Sticker[]>('/v1/stickers/recent');
  } catch {
    return [];
  }
}

export async function recordRecentSticker(sid: string) {
  req(`/v1/stickers/recent/${sid}`, { method: 'POST' }).catch(() => {});
}

export async function uploadCustomSticker(isEmoji = false): Promise<Sticker | null> {
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    quality: 1,
  });
  const a = r.assets?.[0];
  if (r.canceled || !a) return null;

  const blob = await (await fetch(a.uri)).blob();
  const ctype = a.mimeType || 'image/png';
  return await req<Sticker>(`/v1/stickers/upload?is_emoji=${isEmoji}`, {
    method: 'POST',
    raw: blob,
    ctype,
  });
}
