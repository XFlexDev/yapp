import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { req, type Me } from './api';
import { set } from './store';

export type Pending = { uri: string; width: number; height: number; resolve: (m: Me | null) => void; reject: (e: unknown) => void };
let pending: Pending | null = null;
export const takePending = () => pending;

/** Pick a photo, then let the user crop the 9:16 photo and the 1:1 profile pic on the crop screen. */
export async function pickAndUploadPhoto(): Promise<Me | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const a = r.assets?.[0];
  if (r.canceled || !a) return null;
  // Bake in EXIF rotation and cap the size so cropping math matches the pixels we get back.
  const long = Math.max(a.width, a.height);
  const norm = await ImageManipulator.manipulateAsync(a.uri, long > 2600 ? [{ resize: a.width >= a.height ? { width: 2600 } : { height: 2600 } }] : [], { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG });
  return new Promise((resolve, reject) => {
    pending = { uri: norm.uri, width: norm.width, height: norm.height, resolve: (m) => { pending = null; resolve(m); }, reject: (e) => { pending = null; reject(e); } };
    router.push('/crop');
  });
}

export async function crop(uri: string, rect: { originX: number; originY: number; width: number; height: number }, width: number) {
  return ImageManipulator.manipulateAsync(uri, [{ crop: rect }, { resize: { width: Math.min(width, rect.width) } }], { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG });
}

async function put(path: string, uri: string) {
  const blob = await (await fetch(uri)).blob();
  return req<Me>(path, { method: 'PUT', raw: blob, ctype: 'image/jpeg' });
}

export async function uploadPhotos(photoUri: string, pfpUri: string) {
  await put('/v1/me/avatar', photoUri);
  const me = await put('/v1/me/pfp', pfpUri);
  set({ me });
  return me;
}
