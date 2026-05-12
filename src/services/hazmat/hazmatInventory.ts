// Praeventio Guard — Sprint 39 Fase G.7: Control de sustancias peligrosas.
//
// Cierra: Documento usuario "Recomendaciones nuevas §33, §34, §35"
//         Plan integral Top 15 #7
//
// Inventario de sustancias + compatibilidad química + plan de derrames.
// Determinístico, sin LLM.

export type HazmatClass =
  | 'oxidizer' // 5.1, 5.2 — alimenta combustión
  | 'flammable' // 3 — líquidos inflamables
  | 'corrosive' // 8 — ácidos/bases
  | 'toxic' // 6.1 — tóxicos
  | 'reactive_water' // 4.3 — reacciona con agua
  | 'compressed_gas' // 2 — cilindros
  | 'explosive' // 1 — explosivos
  | 'radioactive' // 7
  | 'biohazard' // 6.2
  | 'other';

export interface HazmatItem {
  id: string;
  name: string;
  cas?: string; // CAS number
  unNumber?: string; // UN number 4-digit
  hazardClasses: HazmatClass[];
  /** Stock actual (litros, kg, unidades). */
  stockQty: number;
  stockUnit: 'L' | 'kg' | 'unit';
  /** Ubicación de almacenamiento. */
  locationId: string;
  /** Fecha vencimiento (HDS o producto). */
  expiresAt?: string;
  /** EPP requerido para manipular (labels). */
  requiredEpp: string[];
  /** URL hoja de seguridad (HDS/SDS). */
  sdsUrl?: string;
}

/**
 * Matriz de incompatibilidad química. Cada par de clases tiene un nivel:
 *   'incompatible' — no almacenar juntos (separar por barrera o sector)
 *   'caution' — distancia mínima 3m + ventilación
 *   'compatible' — pueden estar juntas
 *
 * Basado en SDS internacional + DS 78 + NCh 2245.
 */
const INCOMPATIBILITY: Array<[HazmatClass, HazmatClass, 'incompatible' | 'caution']> = [
  ['oxidizer', 'flammable', 'incompatible'],
  ['oxidizer', 'reactive_water', 'incompatible'],
  ['flammable', 'explosive', 'incompatible'],
  ['flammable', 'corrosive', 'caution'],
  ['corrosive', 'toxic', 'caution'],
  ['reactive_water', 'corrosive', 'incompatible'],
  ['explosive', 'oxidizer', 'incompatible'],
  ['compressed_gas', 'flammable', 'caution'],
  ['radioactive', 'biohazard', 'caution'],
];

export type CompatibilityLevel = 'incompatible' | 'caution' | 'compatible';

export function checkPairCompatibility(
  a: HazmatClass,
  b: HazmatClass,
): CompatibilityLevel {
  for (const [c1, c2, level] of INCOMPATIBILITY) {
    if ((c1 === a && c2 === b) || (c1 === b && c2 === a)) {
      return level;
    }
  }
  return 'compatible';
}

export interface CompatibilityIssue {
  itemA: HazmatItem;
  itemB: HazmatItem;
  level: 'incompatible' | 'caution';
  reason: string;
}

/**
 * Audita un grupo de items que comparten ubicación. Devuelve
 * incompatibilidades detectadas (lista vacía = todo OK).
 */
export function auditStorageLocation(items: HazmatItem[]): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.locationId !== b.locationId) continue;
      for (const classA of a.hazardClasses) {
        for (const classB of b.hazardClasses) {
          const level = checkPairCompatibility(classA, classB);
          if (level !== 'compatible') {
            issues.push({
              itemA: a,
              itemB: b,
              level,
              reason: `Clase ${classA} + ${classB} en ${a.locationId}`,
            });
          }
        }
      }
    }
  }
  return issues;
}

// ────────────────────────────────────────────────────────────────────────
// Plan de derrames
// ────────────────────────────────────────────────────────────────────────

export interface SpillResponsePlan {
  itemName: string;
  steps: string[];
  requiredEpp: string[];
  absorbentMaterial: string;
  disposalRoute: string;
  emergencyContact: string;
}

const SPILL_PROCEDURES: Partial<Record<HazmatClass, Omit<SpillResponsePlan, 'itemName' | 'requiredEpp'>>> = {
  flammable: {
    steps: [
      'Cortar fuentes de ignición en 20m a la redonda',
      'Ventilar el área',
      'Absorber con material no metálico (arena, vermiculita)',
      'No usar agua sobre el derrame',
      'Recoger en contenedor metálico cerrado',
    ],
    absorbentMaterial: 'Arena seca o vermiculita',
    disposalRoute: 'Residuo peligroso categoría inflamable — transporte autorizado',
    emergencyContact: 'Bomberos 132',
  },
  corrosive: {
    steps: [
      'Aislar zona en radio 5m',
      'Neutralizar (carbonato de sodio para ácidos, bicarbonato para bases)',
      'Absorber con material inerte',
      'NO mezclar ácidos con bases sin protocolo',
      'Enjuagar piel afectada 15 min',
    ],
    absorbentMaterial: 'Material inerte neutralizado',
    disposalRoute: 'Residuo peligroso categoría corrosivo — manifiesto SUSESO',
    emergencyContact: 'SAMU 131',
  },
  toxic: {
    steps: [
      'Evacuar personal no esencial',
      'Usar respirador con filtro adecuado',
      'Contener el derrame, no esparcir',
      'Sellar contenedor en doble bolsa',
    ],
    absorbentMaterial: 'Absorbente para sustancias tóxicas',
    disposalRoute: 'Residuo peligroso categoría tóxico — manifiesto sectorial',
    emergencyContact: 'SAMU 131 + Bomberos 132',
  },
  oxidizer: {
    steps: [
      'Aislar de combustibles inmediatamente',
      'No usar trapo o material orgánico',
      'Diluir con agua abundante si SDS lo indica',
    ],
    absorbentMaterial: 'Material inerte mineral',
    disposalRoute: 'Residuo peligroso categoría oxidante',
    emergencyContact: 'Bomberos 132',
  },
};

export function buildSpillPlan(item: HazmatItem): SpillResponsePlan {
  // Tomamos la primera clase con plan específico; fallback genérico.
  for (const cls of item.hazardClasses) {
    const tpl = SPILL_PROCEDURES[cls];
    if (tpl) {
      return {
        itemName: item.name,
        steps: tpl.steps,
        requiredEpp: item.requiredEpp,
        absorbentMaterial: tpl.absorbentMaterial,
        disposalRoute: tpl.disposalRoute,
        emergencyContact: tpl.emergencyContact,
      };
    }
  }
  return {
    itemName: item.name,
    steps: [
      'Aislar zona',
      'Consultar SDS específica',
      'Contactar especialista HAZMAT',
    ],
    requiredEpp: item.requiredEpp,
    absorbentMaterial: 'Consultar SDS',
    disposalRoute: 'Consultar SDS',
    emergencyContact: 'Bomberos 132',
  };
}
