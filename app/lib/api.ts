import { requireOptionalNativeModule } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { Linking } from 'react-native';
import { API } from './theme';

export type User = { id: string; username: string | null; display_name: string; color: number; avatar: string | null; pfp?: string | null };
export type Me = User & { email: string; dnd: boolean };
export type Clip = { id: string; from: string; ms: number; created_at: number };
export type Friend = User & { online: boolean; dnd: boolean; since: number; streak: number; last_talked_at: number };
export type FriendRequest = { id: string; user: User; created_at: number };
type Tokens = { access_token: string; refresh_token: string; expires_in: number; user: Me };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const KEY = 'yap.session';
let access: string | null = null;
let refresh: string | null = null;
let refreshing: Promise<'ok' | 'denied' | 'failed'> | null = null;
export let onSignedOut: () => void = () => {};
export const setSignedOutHandler = (f: () => void) => { onSignedOut = f; };

export const mediaUrl = (key: string) => (/^[pqbcs]-[0-9a-f]{32}\.(?:jpg|webp|png)$/.test(key) ? `${API}/m/${key}` : `${API}/avatars/${key}`);
export const avatarUrl = (u: Pick<User, 'avatar'>) => (u.avatar ? mediaUrl(u.avatar) : null);
/** Square profile picture; falls back to the full photo for accounts that never cropped one. */
export const pfpUrl = (u: Pick<User, 'avatar' | 'pfp'>) => (u.pfp ? mediaUrl(u.pfp) : avatarUrl(u));
export const nameOf = (u: User) => u.display_name || u.username || 'Someone';
export const accessToken = () => access;

async function save(t: Tokens) {
  access = t.access_token;
  refresh = t.refresh_token;
  await SecureStore.setItemAsync(KEY, JSON.stringify({ refresh: t.refresh_token, me: t.user }));
}

/** With no connection the saved profile is used, so opening yapp offline doesn't land on the sign-in screen. */
export async function restore(): Promise<Me | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  const saved: { refresh: string; me?: Me } = JSON.parse(raw);
  refresh = saved.refresh;
  const r = await doRefresh();
  if (r === 'denied') return null;
  if (r === 'failed') return saved.me ?? null;
  return req<Me>('/v1/me').catch((e) => (e instanceof ApiError && e.status === 0 ? saved.me ?? null : null));
}

/** 'denied' means the server refused the session. 'failed' is anything else (offline, server restarting) and must not sign the user out. */
async function doRefresh(): Promise<'ok' | 'denied' | 'failed'> {
  if (!refresh) return 'denied';
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${API}/v1/auth/refresh`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (r.status === 401) { await clear(); return 'denied' as const; }
      if (!r.ok) return 'failed' as const;
      await save(await r.json());
      return 'ok' as const;
    } catch { return 'failed' as const; } finally { refreshing = null; }
  })();
  return refreshing;
}

export async function clear() {
  access = null; refresh = null;
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
}

export async function req<T>(path: string, opts: { method?: string; body?: unknown; raw?: Blob | ArrayBuffer; ctype?: string } = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { 'content-type': opts.ctype ?? 'application/json' };
  if (access) headers.authorization = `Bearer ${access}`;
  let r: Response;
  try {
    r = await fetch(API + path, { method: opts.method ?? 'GET', headers, body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined) });
  } catch {
    throw new ApiError(0, 'Network', "You're offline");
  }
  if (r.status === 401 && retry && refresh) {
    const refreshed = await doRefresh();
    if (refreshed === 'ok') return req<T>(path, opts, false);
    if (refreshed === 'failed') throw new ApiError(0, 'Network', "You're offline");
    onSignedOut();
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error ?? 'Error', j.message ?? 'Something went wrong');
  return j as T;
}

export const startLogin = (email: string) => req('/v1/auth/start', { method: 'POST', body: { email } });
export async function confirmLogin(email: string, code: string): Promise<Me> {
  const t = await req<Tokens>('/v1/auth/confirm', { method: 'POST', body: { email, code } });
  await save(t);
  return t.user;
}
const exchanging: Record<string, Promise<Me>> = {};
/** One-time code from the Google sign-in page. Deduped: on Android both the auth sheet and the deep link deliver it. */
export function exchangeGoogle(code: string): Promise<Me> {
  return (exchanging[code] ??= (async () => {
    const t = await req<Tokens>('/v1/auth/exchange', { method: 'POST', body: { code } });
    await save(t);
    return t.user;
  })());
}

/** In-app Safari sheet when the build has it, otherwise Safari (the deep link comes back to /auth). */
export async function googleLogin(): Promise<Me | null> {
  const url = `${API}/auth/google`;
  if (!requireOptionalNativeModule('ExpoWebBrowser')) {
    await Linking.openURL(url);
    return null;
  }
  const WebBrowser = await import('expo-web-browser');
  const r = await WebBrowser.openAuthSessionAsync(url, 'yapp://auth');
  const code = r.type === 'success' ? /[?&]code=([^&#]+)/.exec(r.url)?.[1] : undefined;
  return code ? exchangeGoogle(decodeURIComponent(code)) : null;
}
export async function logout() {
  if (refresh) await req('/v1/auth/logout', { method: 'POST', body: { refresh_token: refresh } }).catch(() => {});
  await clear().catch(() => {});
}
