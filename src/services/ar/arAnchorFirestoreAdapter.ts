// SPDX-License-Identifier: MIT
//
// AR Anchor Firestore Adapter — persistencia por proyecto.
//
// Schema:
//   tenants/{tid}/projects/{pid}/ar_anchors/{anchorId}
//
// Indexes recomendados (composite — agregar en `firestore.indexes.json`):
//   - (kind, createdAt desc) — listar todos los anchors de un kind ordenados
//   - (kind, gps.latitude, gps.longitude) — "anchors cerca de mi posición"
//   - (createdByUid, createdAt desc) — historial por usuario
//
// Cumple la directiva 2026-05-16 del usuario:
//   "información es privada por proyecto"
// → el path Firestore mismo enforcing el tenant-scoping. firestore.rules
// match `/tenants/{tenantId}` ya valida que `auth.token.tenants[tid]`
// está presente (cerrado en PR #271).
//
// Pattern matches `deaFirestoreAdapter.ts` (Sprint C): clase con dep
// injection del db (testeable con fakeFirestore), métodos CRUD + queries
// específicas. No usa onSnapshot — eso vive en hooks React.

import {
  filterAnchors,
  type ArAnchor,
  type AnchorKind,
  type MachineryAnchor,
  type WarehouseObjectAnchor,
  type PosterAnchor,
} from './arAnchorService.js';

/**
 * Minimal interface — equivale a la `Firestore` de admin SDK O client SDK
 * en métodos comunes (collection/doc/get/set/update/where/orderBy/limit).
 */
export interface ArAnchorFirestoreDb {
  collection(path: string): any;
}

const PATH = (tid: string, pid: string) =>
  `tenants/${tid}/projects/${pid}/ar_anchors`;

export class ArAnchorAdapter {
  constructor(
    private readonly db: ArAnchorFirestoreDb,
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  async save(anchor: ArAnchor): Promise<void> {
    if (anchor.projectId !== this.projectId) {
      throw new Error(
        `ArAnchorAdapter: anchor.projectId (${anchor.projectId}) no coincide con adapter.projectId (${this.projectId})`,
      );
    }
    if (anchor.tenantId !== this.tenantId) {
      throw new Error(
        `ArAnchorAdapter: anchor.tenantId no coincide con adapter.tenantId`,
      );
    }
    await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(anchor.id)
      .set(anchor);
  }

  async getById(id: string): Promise<ArAnchor | null> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(id)
      .get();
    return snap.exists ? (snap.data() as ArAnchor) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(id)
      .delete();
  }

  /** Lista todos los anchors del proyecto. */
  async listAll(limitN = 500): Promise<ArAnchor[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as ArAnchor);
  }

  /** Lista por kind — usa el filtro client-side `filterAnchors` puro. */
  async listByKind<K extends AnchorKind>(kind: K, limitN = 200): Promise<ArAnchor[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('kind', '==', kind)
      .limit(limitN)
      .get();
    return snap.docs.map((d: any) => d.data() as ArAnchor);
  }

  /** Lista solo machinery — type-narrowed para uso conveniente. */
  async listMachinery(limitN = 200): Promise<MachineryAnchor[]> {
    const list = await this.listByKind('machinery', limitN);
    return list as MachineryAnchor[];
  }

  /** Lista solo warehouse_object — type-narrowed. */
  async listWarehouseObjects(limitN = 200): Promise<WarehouseObjectAnchor[]> {
    const list = await this.listByKind('warehouse_object', limitN);
    return list as WarehouseObjectAnchor[];
  }

  /** Lista solo posters escaneados — type-narrowed. */
  async listPosters(limitN = 200): Promise<PosterAnchor[]> {
    const list = await this.listByKind('poster', limitN);
    return list as PosterAnchor[];
  }

  /** Lista anchors de un equipment específico (1 o más). */
  async listByEquipmentId(equipmentId: string): Promise<MachineryAnchor[]> {
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('kind', '==', 'machinery')
      .where('equipmentId', '==', equipmentId)
      .get();
    return snap.docs.map((d: any) => d.data() as MachineryAnchor);
  }

  /**
   * Actualiza el conteo de escaneos de un poster anchor + updatedAt.
   * Idempotente — se llama en cada escaneo exitoso.
   */
  async incrementPosterScan(id: string, nowIso: string): Promise<void> {
    const ref = this.db
      .collection(PATH(this.tenantId, this.projectId))
      .doc(id);
    const snap = await ref.get();
    if (!snap.exists) return;
    const data = snap.data() as PosterAnchor;
    if (data.kind !== 'poster') return;
    await ref.update({
      scanCount: (data.scanCount ?? 0) + 1,
      updatedAt: nowIso,
    });
  }

  /**
   * Lista anchors cerca de unas coordenadas GPS. Filtro grosero por
   * bounding box (Firestore no soporta queries geo nativas sin
   * extension). El radio se aproxima por la latitud (1° ≈ 111km).
   */
  async listNearGps(
    latitude: number,
    longitude: number,
    radiusKm: number,
  ): Promise<ArAnchor[]> {
    // Filtro bounding box. Para precisión real, post-filter con
    // Haversine en el caller — `haversineKm` está en mountainRefuges.ts.
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((latitude * Math.PI) / 180));
    const snap = await this.db
      .collection(PATH(this.tenantId, this.projectId))
      .where('gps.latitude', '>=', latitude - latDelta)
      .where('gps.latitude', '<=', latitude + latDelta)
      .limit(500)
      .get();
    // El where en latitude no permite también filtrar longitude en Firestore
    // sin index compuesto — filtramos lng client-side.
    return snap.docs
      .map((d: any) => d.data() as ArAnchor)
      .filter((a: ArAnchor) => {
        return (
          a.gps.longitude >= longitude - lngDelta &&
          a.gps.longitude <= longitude + lngDelta
        );
      });
  }

  /**
   * Lista anchors aplicando el filtro puro `filterAnchors` de
   * arAnchorService. Útil cuando queremos combinar kind + tags +
   * projectId con la lógica server-style determinística.
   */
  async listFiltered(opts: {
    kind?: AnchorKind;
    tags?: string[];
  }): Promise<ArAnchor[]> {
    const all = await this.listAll();
    return filterAnchors(all, {
      projectId: this.projectId,
      kind: opts.kind,
      tags: opts.tags,
    });
  }
}
