import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { req, type Me } from './api';
import { set } from './store';

export async function pickAndUploadPhoto(): Promise<Me | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [3, 4], quality: 1 });
  if (r.canceled || !r.assets[0]) return null;
  const out = await ImageManipulator.manipulateAsync(r.assets[0].uri, [{ resize: { width: 900 } }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
  const blob = await (await fetch(out.uri)).blob();
  const me = await req<Me>('/v1/me/avatar', { method: 'PUT', raw: blob, ctype: 'image/jpeg' });
  set({ me });
  return me;
}
