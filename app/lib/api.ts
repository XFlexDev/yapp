import * as SecureStore from 'expo-secure-store';
import { API } from './theme';

export type User = { id: string; username: string | null; display_name: string; color: number; avatar: string | null };
export type Me = User & { email: string; dnd: boolean };
export type Friend = User & { online: boolean; dnd: boolean; since: number };
export type FriendRequest = { id: string; user: User; created_at: number };
type Tokens = { access_token: string; refresh_token: string; expires_in: number; user: Me };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const KEY = 'yap.session';
let access: string | null = null;
let refresh: string | null = null;
let refreshing: Promise<boolean> | null = null;
export let onSignedOut: () => void = () => {};
export const setSignedOutHandler = (f: () => void) => { onSignedOut = f; };

export const avatarUrl = (u: Pick<User, 'avatar'>) => (u.avatar ? `${API}/avatars/${u.avatar}` : null);
export const nameOf = (u: User) => u.display_name || u.username || 'Someone';
export const accessToken = () => access;

async function save(t: Tokens) {
  access = t.access_token;
  refresh = t.refresh_token;
  await SecureStore.setItemAsync(KEY, JSON.stringify({ refresh: t.refresh_token }));
}

export async function restore(): Promise<Me | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  refresh = JSON.parse(raw).refresh;
  if (!(await doRefresh())) return null;
  return req<Me>('/v1/me');
}

async function doRefresh(): Promise<boolean> {
  if (!refresh) return false;
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${API}/v1/auth/refresh`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (r.status === 401) { await clear(); return false; }
      if (!r.ok) return false;
      await save(await r.json());
      return true;
    } catch { return false; } finally { refreshing = null; }
  })();
  return refreshing;
}

export async function clear() {
  access = null; refresh = null;
  await SecureStore.deleteItemAsync(KEY);
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
    if (await doRefresh()) return req<T>(path, opts, false);
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
export async function logout() {
  if (refresh) await req('/v1/auth/logout', { method: 'POST', body: { refresh_token: refresh } }).catch(() => {});
  await clear();
}
