import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { req, type Me } from './api';
import { set } from './store';

export async function pickAndUploadPhoto(): Promise<Me | null> {
  // iOS's built-in crop editor returns a low-res image, so take the original; it's shown full-bleed.
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const a = r.assets?.[0];
  if (r.canceled || !a) return null;
  const resize = a.width > 1290 ? [{ resize: { width: 1290 } }] : [];
  const out = await ImageManipulator.manipulateAsync(a.uri, resize, { compress: 0.86, format: ImageManipulator.SaveFormat.JPEG });
  const blob = await (await fetch(out.uri)).blob();
  const me = await req<Me>('/v1/me/avatar', { method: 'PUT', raw: blob, ctype: 'image/jpeg' });
  set({ me });
  return me;
}
