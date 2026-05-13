// SPDX-License-Identifier: MIT
//
// useGeofence — Sprint 44 P2 (audit H11) unit tests para el hash de
// geometría que controla la resubscripción de `watchPosition`.
//
// Bug histórico: el hash leía `(z as any).polygon ?? (z as any).points`
// sobre un tipo cuyo campo real es `coordinates`. El hash degeneraba a
// `null` para toda zona, así que editar el polígono in-place dejaba al
// watcher amarrado al perímetro VIEJO — un bypass silente de geofence.
//
// Estos tests fijan el contrato:
//   1. Hash cambia cuando el polígono muta (misma id, coords distintas).
//   2. Hash es estable bajo flips de referencia (mismo contenido, array nuevo).
//   3. Hash es invariante al orden de las zonas en el input.
//   4. Hash distingue add/remove de zonas.

import { describe, expect, it } from 'vitest';

import { buildZonesGeometryHash, type GeofenceZone } from './useGeofence';

const baseZone = (
  id: string,
  coords: number[][][] = [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
): GeofenceZone => ({
  id,
  name: `zone-${id}`,
  type: 'RESTRICTED',
  coordinates: coords,
});

describe('buildZonesGeometryHash — H11 in-place edit safety', () => {
  it('detecta edición in-place del polígono (misma id, coords distintas)', () => {
    const before = [baseZone('z1')];
    const after = [
      baseZone('z1', [
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ],
      ]),
    ];
    expect(buildZonesGeometryHash(before)).not.toBe(buildZonesGeometryHash(after));
  });

  it('hash estable bajo flip de referencia (mismo contenido, array nuevo)', () => {
    const a = [baseZone('z1'), baseZone('z2')];
    const b = [baseZone('z1'), baseZone('z2')];
    expect(buildZonesGeometryHash(a)).toBe(buildZonesGeometryHash(b));
  });

  it('hash invariante al orden de zonas', () => {
    const a = [baseZone('a'), baseZone('b')];
    const b = [baseZone('b'), baseZone('a')];
    expect(buildZonesGeometryHash(a)).toBe(buildZonesGeometryHash(b));
  });

  it('detecta zona añadida', () => {
    const before = [baseZone('z1')];
    const after = [baseZone('z1'), baseZone('z2')];
    expect(buildZonesGeometryHash(before)).not.toBe(buildZonesGeometryHash(after));
  });

  it('detecta zona removida', () => {
    const before = [baseZone('z1'), baseZone('z2')];
    const after = [baseZone('z1')];
    expect(buildZonesGeometryHash(before)).not.toBe(buildZonesGeometryHash(after));
  });

  it('hash de lista vacía es determinista', () => {
    expect(buildZonesGeometryHash([])).toBe(buildZonesGeometryHash([]));
  });
});
