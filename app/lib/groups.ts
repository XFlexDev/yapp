import { req } from './api';
import { photoFromMsg, photoMeta, pickPhoto, uploadPhoto, type Photo } from './chat';
import { get, set, type ChatMsg, type Group, type GroupInvite } from './store';

type Wire = Omit<Group, 'messages' | 'loaded' | 'more'>;
function merge(w: Wire) {
  set((s) => { const o = s.groups[w.id]; return { groups: { ...s.groups, [w.id]: { messages: o?.messages ?? (w.last ? [w.last] : []), loaded: o?.loaded ?? false, more: o?.more ?? true, ...w } } }; });
}
function patch(id: string, f: (g: Group) => Partial<Group>) {
  set((s) => (s.groups[id] ? { groups: { ...s.groups, [id]: { ...s.groups[id], ...f(s.groups[id]) } } } : {}));
}
const add = (list: ChatMsg[], m: ChatMsg) => {
  if (list.some((x) => x.id === m.id)) return list;
  const twin = list.find((x) => x.pending && x.from === m.from && (x.body === m.body || (x.kind === 'image' && m.kind === 'image')));
  const next = twin ? { ...m, cid: twin.cid ?? twin.id } : m;
  return twin ? list.map((x) => (x === twin ? next : x)) : [next, ...list];
};

export async function loadGroups() { (await req<{ groups: Wire[] }>('/v1/groups')).groups.forEach(merge); }
export async function createGroup(name: string, members: string[]) { const g = await req<Wire>('/v1/groups', { method: 'POST', body: { name, members } }); merge(g); return g.id; }
export async function loadGroupMessages(id: string, older = false) {
  const g = get().groups[id];
  if (older && (!g?.more || !g.loaded)) return;
  const before = older ? g!.messages.filter((m) => !m.pending).at(-1)?.created_at : undefined;
  const r = await req<{ messages: ChatMsg[]; group: Wire }>(`/v1/groups/${id}/messages?limit=40${before ? `&before=${before}` : ''}`);
  merge(r.group);
  patch(id, (o) => ({ messages: older ? [...o.messages, ...r.messages.filter((m) => !o.messages.some((x) => x.id === m.id))] : [...o.messages.filter((m) => m.pending), ...r.messages], loaded: true, more: r.messages.length === 40 }));
}
export async function sendGroup(id: string, body: string) {
  const me = get().me!.id;
  const tmp: ChatMsg = { id: `tmp-${Date.now()}`, from: me, to: id, kind: 'text', body, created_at: Date.now(), pending: true };
  patch(id, (g) => ({ messages: [tmp, ...g.messages] }));
  try { const m = await req<ChatMsg>(`/v1/groups/${id}/messages`, { method: 'POST', body: { body } }); patch(id, (g) => (g.messages.some((x) => x.id === m.id) ? { messages: g.messages.filter((x) => x.id !== tmp.id) } : { messages: g.messages.map((x) => (x.id === tmp.id ? { ...m, cid: tmp.id } : x)) })); }
  catch { patch(id, (g) => ({ messages: g.messages.map((x) => (x.id === tmp.id ? { ...x, pending: false, failed: true } : x)) })); }
}
async function groupPhotoTo(id: string, p: Photo) {
  const me = get().me!.id;
  const tmp: ChatMsg = { id: `tmp-${Date.now()}`, from: me, to: id, kind: 'image', body: p.uri, meta: photoMeta(p), created_at: Date.now(), pending: true };
  patch(id, (g) => ({ messages: [tmp, ...g.messages] }));
  try {
    const m = await uploadPhoto(`/v1/groups/${id}/photo`, p);
    patch(id, (g) => (g.messages.some((x) => x.id === m.id) ? { messages: g.messages.filter((x) => x.id !== tmp.id) } : { messages: g.messages.map((x) => (x.id === tmp.id ? { ...m, cid: tmp.id } : x)) }));
  } catch { patch(id, (g) => ({ messages: g.messages.map((x) => (x.id === tmp.id ? { ...x, pending: false, failed: true } : x)) })); }
}
export async function sendGroupPhoto(id: string) { const p = await pickPhoto(); if (p) await groupPhotoTo(id, p); }
export async function retryGroup(id: string, m: ChatMsg) {
  patch(id, (g) => ({ messages: g.messages.filter((x) => x.id !== m.id) }));
  if (m.kind === 'image') return groupPhotoTo(id, await photoFromMsg(m));
  return sendGroup(id, m.body);
}
export function markGroupRead(id: string) {
  const top = get().groups[id]?.messages.find((m) => !m.pending && !m.failed);
  patch(id, () => ({ unread: 0 }));
  if (top) req(`/v1/groups/${id}/read`, { method: 'POST', body: { at: top.created_at } }).catch(() => {});
}
export const leaveGroup = (id: string) => req(`/v1/groups/${id}/members/${get().me!.id}`, { method: 'DELETE' }).then(() => onLeft(id));
export const renameGroup = (id: string, name: string) => req<Wire>(`/v1/groups/${id}`, { method: 'PATCH', body: { name } }).then(merge);
export const setGroupBackground = (id: string, background: string | null) => req<Wire>(`/v1/groups/${id}`, { method: 'PATCH', body: { background } }).then(merge);
export const addMember = (id: string, user_id: string) => req<Wire>(`/v1/groups/${id}/members`, { method: 'POST', body: { user_id } }).then(merge);

export const onGroupUpdated = (g: Wire) => merge(g);

export async function loadInvites() { set({ groupInvites: (await req<{ invites: GroupInvite[] }>('/v1/groups/invites')).invites }); }
export const onInvite = (i: GroupInvite) => set((s) => ({ groupInvites: [i, ...s.groupInvites.filter((x) => x.group_id !== i.group_id)] }));
const dropInvite = (id: string) => set((s) => ({ groupInvites: s.groupInvites.filter((x) => x.group_id !== id) }));
export async function acceptInvite(id: string) { dropInvite(id); merge(await req<Wire>(`/v1/groups/${id}/invite/accept`, { method: 'POST' })); }
export async function declineInvite(id: string) { dropInvite(id); await req(`/v1/groups/${id}/invite/decline`, { method: 'POST' }); }
export function onGroupMessage(id: string, m: ChatMsg) {
  const mine = m.from === get().me?.id;
  const open = get().openChat === `g:${id}`;
  patch(id, (g) => ({ messages: add(g.messages, m), last: m, unread: !mine && !open ? g.unread + 1 : g.unread }));
  if (open && !mine) markGroupRead(id);
}
export const onGroupRead = (id: string, user: string, at: number) => patch(id, (g) => ({ reads: { ...g.reads, [user]: Math.max(g.reads[user] ?? 0, at) } }));
export const onLeft = (id: string) => set((s) => { const { [id]: _, ...rest } = s.groups; return { groups: rest }; });
