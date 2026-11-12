import type { ComponentType } from 'react';

export type DrawnProps = { tick: number; size: number; color: string };

/** The animated version of an SF Symbol name, when this build can draw it. */
export function drawnIcon(_sf: string): ComponentType<DrawnProps> | null {
  return null;
}
