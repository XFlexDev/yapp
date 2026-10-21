import { req, type User } from './api';
import { removeFriend } from './store';

export const REASONS = ['harassment or bullying', 'nudity or sexual stuff', 'spam or scam', 'they seem under 13', 'something else'] as const;

export async function block(userId: string) {
  await req('/v1/blocks', { method: 'POST', body: { user_id: userId } });
  removeFriend(userId);
}

export const unblock = (userId: string) => req(`/v1/blocks/${userId}`, { method: 'DELETE' });
export const loadBlocks = () => req<User[]>('/v1/blocks');

export const report = (userId: string, reason: string, extra?: { message_id?: string; group_id?: string }) =>
  req('/v1/reports', { method: 'POST', body: { user_id: userId, reason, ...extra } });
