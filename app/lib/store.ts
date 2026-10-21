import { create } from 'zustand';
import type { Friend, FriendRequest, Me, User } from './api';

export type ChatMsg = { id: string; from: string; to: string; kind: string; body: string; created_at: number; pending?: boolean; failed?: boolean };
export type Chat = { messages: ChatMsg[]; loaded: boolean; more: boolean; background: string | null; theirReadAt: number; unread: number };

type State = {
  status: 'loading' | 'out' | 'in';
  me: Me | null;
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  selectedId: string | null;
  talkingTo: Record<string, boolean>; // friend id -> they are talking to me
  pokedAt: Record<string, number>;
  pokeCount: Record<string, number>;
  call: { friendId: string; state: 'outgoing' | 'incoming' | 'active'; since: number } | null;
  connected: boolean;
  chats: Record<string, Chat>;
  openChat: string | null;
};

export const useStore = create<State>(() => ({
  status: 'loading', me: null, friends: [], incoming: [], outgoing: [],
  selectedId: null, talkingTo: {}, pokedAt: {}, pokeCount: {}, call: null, connected: false, chats: {}, openChat: null,
}));

export const set = useStore.setState;
export const get = useStore.getState;

export function upsertFriend(f: Friend) {
  set((s) => ({ friends: [f, ...s.friends.filter((x) => x.id !== f.id)], selectedId: s.selectedId ?? f.id }));
}
export function patchFriend(id: string, p: Partial<Friend>) {
  set((s) => ({ friends: s.friends.map((f) => (f.id === id ? { ...f, ...p } : f)) }));
}
export function patchUser(u: User) { patchFriend(u.id, u); }
export function removeFriend(id: string) {
  set((s) => {
    const friends = s.friends.filter((f) => f.id !== id);
    return { friends, selectedId: s.selectedId === id ? friends[0]?.id ?? null : s.selectedId };
  });
}
