// SPDX-License-Identifier: MIT
//
// @praeventio/capacitor-mesh — entry point (Sprint 30 scaffold).

import { registerPlugin } from '@capacitor/core';

import type { MeshPlugin } from './definitions';

const Mesh = registerPlugin<MeshPlugin>('Mesh', {
  // Web fallback uses the BroadcastChannel-based simulator — works in
  // any modern browser (every tab of the same origin sees every packet).
  web: () => import('./web').then((m) => new m.MeshWeb()),
});

export * from './definitions';
export { Mesh };
