// Praeventio Guard — Sprint 39 Fase D.2: Optimizador de Estiba + COG.
//
// Cierra: Plan Fase D.2 "Optimizador de Estiba 3DBPP + cálculo COG".
//
// Calcula el centro de gravedad (COG) ponderado por masa/posición de
// una carga compuesta, detecta si sale de los límites seguros, y
// resuelve un 3D Bin Packing heurístico (FFD = First Fit Decreasing)
// para sugerir colocación de ítems en un contenedor.
//
// Aplicación crítica:
//   - Camiones de mina (CAEX 240t): COG fuera de límite = volcadura.
//   - Grúas / camionetas con carga: COG alto = riesgo izaje + frenadas.
//   - Bodegas / contenedores: aprovechamiento de espacio sin
//     incompatibilidad (combinable con hazmatInventory.ts).
//
// 100% determinístico. Heurística FFD bien probada; no resuelve el
// óptimo 3DBPP NP-completo, pero da una colocación viable y rápida.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/** Vector 3D (metros para posición; metros para dimensiones; kg para masa). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Item de carga: caja rectangular con masa. */
export interface CargoItem {
  id: string;
  /** Dimensiones de la caja (m). */
  dimensions: Vec3;
  /** Masa total del ítem (kg). */
  mass: number;
  /** Si solo puede ir en el piso (no apilable). */
  cannotBeStacked?: boolean;
  /** Si es frágil (límite de carga arriba). */
  fragile?: boolean;
}

/** Ítem ya colocado en el contenedor. */
export interface PlacedItem {
  item: CargoItem;
  /** Esquina inferior-izquierda-fondo de la caja en el contenedor. */
  position: Vec3;
}

export interface Container {
  /** Dimensiones internas del contenedor (m). */
  dimensions: Vec3;
  /** Carga máxima total (kg). */
  maxPayloadKg: number;
}

// ────────────────────────────────────────────────────────────────────────
// 1. Centro de gravedad ponderado
// ────────────────────────────────────────────────────────────────────────

/**
 * Computa COG ponderado por masa.
 *   COG = Σ(masa_i · centroide_i) / Σ(masa_i)
 * Centroide de cada ítem = position + dimensions/2.
 */
export function computeCenterOfGravity(placedItems: PlacedItem[]): Vec3 {
  let totalMass = 0;
  const acc: Vec3 = { x: 0, y: 0, z: 0 };
  for (const p of placedItems) {
    const m = p.item.mass;
    totalMass += m;
    acc.x += m * (p.position.x + p.item.dimensions.x / 2);
    acc.y += m * (p.position.y + p.item.dimensions.y / 2);
    acc.z += m * (p.position.z + p.item.dimensions.z / 2);
  }
  if (totalMass <= 0) return { x: 0, y: 0, z: 0 };
  return {
    x: acc.x / totalMass,
    y: acc.y / totalMass,
    z: acc.z / totalMass,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 2. Validación de COG vs límites seguros
// ────────────────────────────────────────────────────────────────────────

export interface CogSafetyLimits {
  /** Posición ideal del COG (típicamente centro del contenedor). */
  ideal: Vec3;
  /** Tolerancia en cada eje desde el ideal (m). */
  toleranceX: number;
  toleranceY: number;
  /** Tolerancia alto: altura máxima del COG sobre el piso (m). */
  maxHeightZ: number;
}

export interface CogValidation {
  cog: Vec3;
  /** Distancias absolutas desde el ideal. */
  deviationX: number;
  deviationY: number;
  /** True si COG dentro de límites en TODOS los ejes. */
  isSafe: boolean;
  warnings: string[];
}

export function validateCogAgainstLimits(
  placedItems: PlacedItem[],
  limits: CogSafetyLimits,
): CogValidation {
  const cog = computeCenterOfGravity(placedItems);
  const dx = Math.abs(cog.x - limits.ideal.x);
  const dy = Math.abs(cog.y - limits.ideal.y);
  const warnings: string[] = [];
  if (dx > limits.toleranceX) {
    warnings.push(
      `COG desplazado ${dx.toFixed(2)}m en eje X (límite ${limits.toleranceX}m) — riesgo de vuelco lateral.`,
    );
  }
  if (dy > limits.toleranceY) {
    warnings.push(
      `COG desplazado ${dy.toFixed(2)}m en eje Y (límite ${limits.toleranceY}m) — distribución frontal/trasera asimétrica.`,
    );
  }
  if (cog.z > limits.maxHeightZ) {
    warnings.push(
      `COG demasiado alto (${cog.z.toFixed(2)}m vs máx ${limits.maxHeightZ}m) — reduce centro de masa.`,
    );
  }
  return {
    cog,
    deviationX: dx,
    deviationY: dy,
    isSafe: warnings.length === 0,
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 3. Utilization
// ────────────────────────────────────────────────────────────────────────

export interface UtilizationStats {
  /** Volumen total cargado (m³). */
  loadedVolume: number;
  /** Volumen total contenedor (m³). */
  containerVolume: number;
  /** Porcentaje volumétrico cargado. */
  volumePercent: number;
  /** Masa total cargada (kg). */
  loadedMass: number;
  /** Porcentaje masa vs max payload. */
  massPercent: number;
  /** True si supera capacidad de masa. */
  overweight: boolean;
}

export function computeUtilization(
  placedItems: PlacedItem[],
  container: Container,
): UtilizationStats {
  const containerVolume =
    container.dimensions.x * container.dimensions.y * container.dimensions.z;
  let loadedVolume = 0;
  let loadedMass = 0;
  for (const p of placedItems) {
    loadedVolume += p.item.dimensions.x * p.item.dimensions.y * p.item.dimensions.z;
    loadedMass += p.item.mass;
  }
  return {
    loadedVolume,
    containerVolume,
    volumePercent:
      containerVolume > 0 ? Math.round((loadedVolume / containerVolume) * 100) : 0,
    loadedMass,
    massPercent:
      container.maxPayloadKg > 0
        ? Math.round((loadedMass / container.maxPayloadKg) * 100)
        : 0,
    overweight: loadedMass > container.maxPayloadKg,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 4. 3D Bin Packing FFD heurístico
// ────────────────────────────────────────────────────────────────────────

/**
 * Devuelve true si dos cajas (alineadas a ejes) se intersectan.
 */
function boxesIntersect(
  posA: Vec3,
  dimA: Vec3,
  posB: Vec3,
  dimB: Vec3,
): boolean {
  return (
    posA.x < posB.x + dimB.x &&
    posA.x + dimA.x > posB.x &&
    posA.y < posB.y + dimB.y &&
    posA.y + dimA.y > posB.y &&
    posA.z < posB.z + dimB.z &&
    posA.z + dimA.z > posB.z
  );
}

function fitsInContainer(pos: Vec3, dim: Vec3, container: Container): boolean {
  return (
    pos.x >= 0 &&
    pos.y >= 0 &&
    pos.z >= 0 &&
    pos.x + dim.x <= container.dimensions.x &&
    pos.y + dim.y <= container.dimensions.y &&
    pos.z + dim.z <= container.dimensions.z
  );
}

export interface StowageResult {
  placed: PlacedItem[];
  unplaced: CargoItem[];
  utilization: UtilizationStats;
}

/**
 * Empaqueta items en el contenedor con heurística FFD:
 *  1) Ordena items por volumen descendente
 *  2) Para cada item, prueba esquinas candidatas (origen, esquinas de items
 *     ya colocados) y elige la primera que no choque y entre en el container.
 *  3) Respeta cannotBeStacked (z=0 forzado) y fragile (no apilar nada encima).
 *
 * No es óptimo (3DBPP es NP-completo), pero da resultado viable en O(n²).
 */
export function packCargoFFD(
  items: CargoItem[],
  container: Container,
): StowageResult {
  const sorted = [...items].sort(
    (a, b) =>
      b.dimensions.x * b.dimensions.y * b.dimensions.z -
      a.dimensions.x * a.dimensions.y * a.dimensions.z,
  );

  const placed: PlacedItem[] = [];
  const unplaced: CargoItem[] = [];

  // Track fragile cells: si un item es fragile, marcamos sus voxels para
  // que no se apile arriba. Implementación simple: lista de "top-z" de
  // fragile items y prohibición de colocar algo arriba si z_floor ≤ top.

  for (const item of sorted) {
    // Conjunto inicial de posiciones candidatas:
    const candidates: Vec3[] = [{ x: 0, y: 0, z: 0 }];
    // Esquinas (max corners) de items ya colocados como inicio de los siguientes.
    for (const p of placed) {
      candidates.push({
        x: p.position.x + p.item.dimensions.x,
        y: p.position.y,
        z: p.position.z,
      });
      candidates.push({
        x: p.position.x,
        y: p.position.y + p.item.dimensions.y,
        z: p.position.z,
      });
      // Si el item puede apilar y la cara superior no es fragile, agregar arriba.
      if (!p.item.fragile) {
        candidates.push({
          x: p.position.x,
          y: p.position.y,
          z: p.position.z + p.item.dimensions.z,
        });
      }
    }

    let placedAt: Vec3 | null = null;
    // Probar candidatos por orden (heurística simple: z ascendente, luego x, luego y)
    const sortedCandidates = candidates.sort(
      (a, b) => a.z - b.z || a.x - b.x || a.y - b.y,
    );
    for (const c of sortedCandidates) {
      if (item.cannotBeStacked && c.z > 0) continue;
      if (!fitsInContainer(c, item.dimensions, container)) continue;
      let collision = false;
      for (const p of placed) {
        if (boxesIntersect(c, item.dimensions, p.position, p.item.dimensions)) {
          collision = true;
          break;
        }
      }
      if (collision) continue;
      placedAt = c;
      break;
    }

    if (placedAt) {
      placed.push({ item, position: placedAt });
    } else {
      unplaced.push(item);
    }
  }

  return {
    placed,
    unplaced,
    utilization: computeUtilization(placed, container),
  };
}
