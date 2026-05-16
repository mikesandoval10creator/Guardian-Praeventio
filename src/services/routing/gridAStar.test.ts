// Tests para A* real sobre grilla. Cierra Codex fake fix §2.3.

import { describe, it, expect } from 'vitest';
import { findPathAStar } from './gridAStar';

describe('findPathAStar', () => {
  it('encuentra path en grilla vacía 5×5', () => {
    const grid = Array(5).fill(0).map(() => Array(5).fill(0));
    const path = findPathAStar(grid, { x: 0, y: 0 }, { x: 4, y: 4 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 4 });
    // En 4-conexa, distancia Manhattan = 8 → path length = 9 nodos
    expect(path!.length).toBe(9);
  });

  it('evita obstáculos', () => {
    // Pared vertical en x=2, dejamos hueco en y=4
    const grid = Array(5).fill(0).map(() => Array(5).fill(0));
    grid[0][2] = 1;
    grid[1][2] = 1;
    grid[2][2] = 1;
    grid[3][2] = 1;
    // grid[4][2] = 0 → hueco

    const path = findPathAStar(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    // El path debe pasar por y=4 (único hueco)
    expect(path!.some((c) => c.y === 4)).toBe(true);
    // Ninguna celda del path puede ser obstáculo
    expect(path!.every((c) => grid[c.y][c.x] !== 1)).toBe(true);
  });

  it('devuelve null si destino inalcanzable (sin fake path)', () => {
    // Cercamos el destino completamente
    const grid = Array(5).fill(0).map(() => Array(5).fill(0));
    grid[3][4] = 1; // arriba
    grid[4][3] = 1; // izquierda
    // Esquina inferior derecha (4,4) está atrapada
    const path = findPathAStar(grid, { x: 0, y: 0 }, { x: 4, y: 4 });
    // (4,4) sigue siendo walkable, pero rodeado de obstáculos → inalcanzable
    expect(path).toBeNull();
  });

  it('devuelve null si start está en obstáculo', () => {
    const grid = Array(5).fill(0).map(() => Array(5).fill(0));
    grid[0][0] = 1;
    const path = findPathAStar(grid, { x: 0, y: 0 }, { x: 4, y: 4 });
    expect(path).toBeNull();
  });

  it('devuelve null si goal está en obstáculo', () => {
    const grid = Array(5).fill(0).map(() => Array(5).fill(0));
    grid[4][4] = 1;
    const path = findPathAStar(grid, { x: 0, y: 0 }, { x: 4, y: 4 });
    expect(path).toBeNull();
  });

  it('path de start a start', () => {
    const grid = Array(3).fill(0).map(() => Array(3).fill(0));
    const path = findPathAStar(grid, { x: 1, y: 1 }, { x: 1, y: 1 });
    expect(path).toEqual([{ x: 1, y: 1 }]);
  });

  it('respeta cellCost custom (zona peligrosa)', () => {
    const grid = Array(5).fill(0).map(() => Array(5).fill(0));
    // Toda la fila y=2 es peligrosa (costo alto)
    const path = findPathAStar(grid, { x: 0, y: 0 }, { x: 4, y: 4 }, {
      cellCost: (_x, y) => (y === 2 ? 100 : 1),
    });
    expect(path).not.toBeNull();
    // El path debería evitar la fila y=2 si hay alternativa más barata
    // (en este caso pasar por y=2 es inevitable porque tenemos que ir de y=0 a y=4
    //  en 4-conexa, así que el path tocará y=2 una vez; pero NO debería volver)
    const visitsY2 = path!.filter((c) => c.y === 2).length;
    expect(visitsY2).toBeLessThanOrEqual(1);
  });

  it('soporta diagonales con allowDiagonals=true', () => {
    const grid = Array(5).fill(0).map(() => Array(5).fill(0));
    const path = findPathAStar(grid, { x: 0, y: 0 }, { x: 4, y: 4 }, {
      allowDiagonals: true,
    });
    expect(path).not.toBeNull();
    // En 8-conexa con grid vacía, path length = max(|Δx|, |Δy|) + 1 = 5
    expect(path!.length).toBe(5);
  });

  it('no corner-cutting con diagonales (seguridad evacuación)', () => {
    const grid = Array(3).fill(0).map(() => Array(3).fill(0));
    // L-shape de obstáculos forzando que diagonal pase por esquina
    grid[0][1] = 1;
    grid[1][0] = 1;
    // (0,0) y (1,1) son walkable, pero ir diagonal entre ellos requiere
    // pasar entre dos obstáculos → bloqueado por la regla anti-corner-cutting
    const path = findPathAStar(grid, { x: 0, y: 0 }, { x: 1, y: 1 }, {
      allowDiagonals: true,
    });
    // Sin corner-cutting, no hay path
    expect(path).toBeNull();
  });

  it('determinístico — mismos inputs producen mismo path', () => {
    const grid = Array(10).fill(0).map(() => Array(10).fill(0));
    grid[3][3] = 1;
    grid[3][4] = 1;
    grid[5][5] = 1;
    const path1 = findPathAStar(grid, { x: 0, y: 0 }, { x: 9, y: 9 });
    const path2 = findPathAStar(grid, { x: 0, y: 0 }, { x: 9, y: 9 });
    expect(path1).toEqual(path2);
  });
});
