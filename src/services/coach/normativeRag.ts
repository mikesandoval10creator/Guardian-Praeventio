/**
 * NormativeRagService — domain-aware retrieval over CL safety/health corpus.
 *
 * Bucket HH (item #90) companion to `./prompts.ts`. Retrieves the top-K most
 * relevant `NormativeChunk` entries for a given query, filtered by domain
 * (chemical / medicine / legal). The chunks are then injected as context
 * into Gemini prompts in the three specialized backends.
 *
 * Two execution modes:
 *   - Pinecone mode  (PINECONE_API_KEY + PINECONE_INDEX env vars present):
 *     real vector search backed by Pinecone. Uses Gemini text-embedding-004
 *     (768 dims) for both query and chunk embeddings, kept consistent with
 *     `ragService.ts`. Embeddings are persisted on `ingestChunk`.
 *   - In-memory mode (default fallback): seeded from `src/data/normativa/cl.ts`
 *     CL_PACK regulations + curated chunks. Matching uses bag-of-words
 *     overlap (a deterministic, embedding-free similarity metric so tests
 *     stay hermetic and the system never blocks on Gemini quotas during
 *     development / offline).
 *
 * Domain mapping is explicit: each chunk carries a `source` tag (BCN /
 * MINSAL / DT / SUSESO / etc.) and a list of `domains` it serves. The
 * default seed assigns CL regulations to domains based on subject matter
 * (DS 594 → all three; PREXOR → medicine; Ley 21.643 → legal+medicine).
 *
 * The Zettelkasten kernel is NEVER touched by this service (per
 * project_b2d_api_model). RAG operates only on public CL normativa.
 */

import { CL_PACK } from '../../data/normativa/cl.js';
import type { CoachDomain } from './prompts.js';
import { AI_MODEL_EMBEDDINGS } from '../../config/aiModels.js';

export type NormativeSource =
  | 'BCN'
  | 'MINSAL'
  | 'INE'
  | 'DT'
  | 'SUSESO'
  | 'INH'
  | 'ISP';

export interface NormativeChunk {
  id: string;
  source: NormativeSource;
  citation: string; // e.g. 'DS 594 art. 47'
  text: string; // chunk body, ~200-1000 chars
  domains: CoachDomain[];
  embedding?: number[]; // 768 dims, optional in in-memory mode
}

interface PineconeConfig {
  apiKey: string;
  indexName: string;
  endpoint?: string;
}

/**
 * Bag-of-words token similarity. Used by in-memory mode as a deterministic,
 * embedding-free fallback. Returns Jaccard-style overlap in [0, 1].
 *
 * Trade-off: less accurate than cosine over real embeddings, but completely
 * hermetic (no API key required) and fast enough for the small CL pack
 * (~12 regulations × a handful of chunks).
 */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function bagOfWordsScore(query: string, text: string): number {
  const q = tokenize(query);
  const d = tokenize(text);
  if (q.size === 0 || d.size === 0) return 0;
  let inter = 0;
  for (const t of q) if (d.has(t)) inter += 1;
  return inter / Math.sqrt(q.size * d.size);
}

/**
 * Default seed corpus — derived from CL_PACK. Each regulation produces one
 * chunk anchored on its `scope`. Domain assignment encodes which of the
 * three coach personas should retrieve the rule.
 */
function seedCorpusFromClPack(): NormativeChunk[] {
  const domainByRegId: Record<string, CoachDomain[]> = {
    'cl-ley-16744': ['legal', 'medicine'],
    // AUDIT-2026-06 B22 — 'cl-ds-40' era un id muerto (el pack tiene
    // cl-ds-44 desde que DS 44/2024 reemplazó al DS 40/1969 derogado).
    'cl-ds-44': ['legal'],
    'cl-ds-132': ['legal'],
    'cl-ds-76': ['legal'],
    'cl-ds-67': ['legal'],
    'cl-ds-148': ['chemical', 'legal'],
    'cl-ley-19628': ['legal', 'medicine'],
    'cl-ds-54': ['legal'],
    'cl-ds-594': ['chemical', 'medicine', 'legal'],
    'cl-ley-20123': ['legal'],
    'cl-ley-20001': ['legal', 'medicine'],
    'cl-ley-21643': ['legal', 'medicine'],
    'cl-ley-21012': ['legal'],
    'cl-ds-109': ['medicine', 'legal'],
    'cl-suseso-3241': ['medicine'],
    'cl-ds-101': ['medicine', 'legal'],
    'cl-protocolo-mineduc': ['medicine'],
  };

  const sourceByRegId: Record<string, NormativeSource> = {
    'cl-ley-16744': 'BCN',
    'cl-ds-44': 'BCN',
    'cl-ds-132': 'BCN',
    'cl-ds-76': 'BCN',
    'cl-ds-67': 'BCN',
    'cl-ds-148': 'MINSAL',
    'cl-ley-19628': 'BCN',
    'cl-ds-54': 'BCN',
    'cl-ds-594': 'MINSAL',
    'cl-ley-20123': 'BCN',
    'cl-ley-20001': 'BCN',
    'cl-ley-21643': 'BCN',
    'cl-ley-21012': 'BCN',
    'cl-ds-109': 'BCN',
    'cl-suseso-3241': 'SUSESO',
    'cl-ds-101': 'BCN',
    'cl-protocolo-mineduc': 'MINSAL',
  };

  return CL_PACK.regulations.map((reg) => ({
    id: `seed-${reg.id}`,
    source: sourceByRegId[reg.id] ?? 'BCN',
    citation: reg.title.split(' — ')[0] ?? reg.reference,
    text: `${reg.title}. ${reg.scope} (Referencia: ${reg.reference})`,
    domains: domainByRegId[reg.id] ?? ['legal'],
  }));
}

/**
 * Curated chemical-specific chunks beyond the CL_PACK overview, anchored on
 * concrete LPP / GHS rules. These give the chemical persona enough material
 * to cite without us having to re-fetch the full DS 594 from BCN at runtime.
 */
const CHEMICAL_DETAIL_CHUNKS: NormativeChunk[] = [
  {
    id: 'detail-ds594-anexo4',
    source: 'MINSAL',
    citation: 'DS 594/1999 anexo 4',
    text: 'Anexo 4 del DS 594 establece Limites Permisibles Ponderados (LPP) y Temporales (LPT) por agente quimico. Tolueno LPP-8h 50 ppm, metanol LPP-8h 200 ppm con notacion piel, monoxido de carbono LPP-8h 40 ppm. Si la concentracion ambiental supera el LPP, el empleador debe implementar controles jerarquicos antes de recurrir a EPP.',
    domains: ['chemical', 'medicine'],
  },
  {
    id: 'detail-ds148-residuos',
    source: 'MINSAL',
    citation: 'DS 148/2003 art. 13',
    text: 'DS 148/2003 articulo 13 exige segregacion de residuos peligrosos por incompatibilidad: oxidantes lejos de inflamables, acidos lejos de bases, cianuros lejos de acidos. Almacenamiento maximo 6 meses sin autorizacion sanitaria. Rotulacion SGA obligatoria.',
    domains: ['chemical'],
  },
  {
    id: 'detail-ghs-categories',
    source: 'INH',
    citation: 'GHS UN ST/SG/AC.10/30/Rev.10',
    text: 'Sistema Globalmente Armonizado clasifica liquidos inflamables en 4 categorias por punto de inflamacion (Cat 1 < 23C y Pe <= 35C; Cat 2 < 23C; Cat 3 < 60C; Cat 4 < 93C). Toxicidad aguda en 5 categorias por DL50/CL50. Pictogramas obligatorios en SDS y etiqueta del envase.',
    domains: ['chemical'],
  },
];

const MEDICINE_DETAIL_CHUNKS: NormativeChunk[] = [
  {
    id: 'detail-prexor-periodicidad',
    source: 'MINSAL',
    citation: 'Protocolo PREXOR MINSAL',
    text: 'PREXOR define periodicidad de audiometrias de seguimiento: NPSeq 85-95 dB(A) anual, NPSeq > 95 dB(A) cada 6 meses. Audiometria base obligatoria al ingreso. Confirmatoria si hay desplazamiento >= 15 dB en alguna frecuencia. Trabajadores en programa de vigilancia obligatoria si NPSeq >= 85 dB(A).',
    domains: ['medicine'],
  },
  {
    id: 'detail-ceal-sm',
    source: 'SUSESO',
    citation: 'Circular SUSESO 3.241 (CEAL-SM)',
    text: 'Circular SUSESO 3.241 establece el cuestionario CEAL-SM/SUSESO para vigilancia de factores psicosociales: 5 dimensiones (exigencias psicologicas, trabajo activo, apoyo social, compensaciones, doble presencia). Aplicacion obligatoria cada 2 anos minimo, o anual si dimensiones en riesgo alto. Reemplaza progresivamente al ISTAS-21.',
    domains: ['medicine'],
  },
];

const LEGAL_DETAIL_CHUNKS: NormativeChunk[] = [
  {
    id: 'detail-ley21643-plazos',
    source: 'BCN',
    citation: 'Ley 21.643 (Karin) art. 211-A a 211-E',
    text: 'Ley 21.643 obliga al empleador a investigar denuncia de acoso laboral, sexual o violencia en el trabajo dentro de 30 dias corridos, o derivar a Direccion del Trabajo en 3 dias si decide no investigar. Medidas de resguardo inmediatas son obligatorias. Prohibe represalias contra el denunciante. Vigente desde agosto 2024.',
    domains: ['legal', 'medicine'],
  },
  {
    id: 'detail-ley20123-sgsst',
    source: 'BCN',
    citation: 'Ley 20.123 art. 66 bis',
    text: 'Ley 20.123 articulo 66 bis exige Sistema de Gestion de Seguridad y Salud en el Trabajo (SGSST) cuando hay 50 o mas trabajadores propios y subcontratados en faena conjunta. Empresa principal asume responsabilidad solidaria sobre prevencion de subcontratistas. Multa DT 1-60 UTM por infraccion.',
    domains: ['legal'],
  },
];

export class NormativeRagService {
  private memory: NormativeChunk[];
  private pinecone?: PineconeConfig;

  constructor(opts?: { pinecone?: PineconeConfig; seed?: NormativeChunk[] }) {
    this.memory = [
      ...(opts?.seed ?? seedCorpusFromClPack()),
      ...CHEMICAL_DETAIL_CHUNKS,
      ...MEDICINE_DETAIL_CHUNKS,
      ...LEGAL_DETAIL_CHUNKS,
    ];
    this.pinecone = opts?.pinecone;
  }

  /**
   * Builds an instance from environment variables. If PINECONE_API_KEY +
   * PINECONE_INDEX are present, configures Pinecone-backed search;
   * otherwise returns an in-memory instance seeded from CL_PACK.
   */
  static fromEnv(): NormativeRagService {
    const apiKey = process.env.PINECONE_API_KEY;
    const indexName = process.env.PINECONE_INDEX;
    const endpoint = process.env.PINECONE_ENDPOINT;
    if (apiKey && indexName) {
      return new NormativeRagService({
        pinecone: { apiKey, indexName, endpoint },
      });
    }
    return new NormativeRagService();
  }

  /**
   * Retrieves the top-K chunks for a query in a given domain. In Pinecone
   * mode, queries the index with the Gemini-embedded query vector and a
   * `domains` metadata filter. In in-memory mode, scores all chunks tagged
   * with the domain via bag-of-words overlap.
   */
  async searchTopK(
    query: string,
    domain: CoachDomain,
    k = 5,
  ): Promise<NormativeChunk[]> {
    if (this.pinecone) {
      return this.searchPinecone(query, domain, k);
    }
    return this.searchInMemory(query, domain, k);
  }

  private searchInMemory(
    query: string,
    domain: CoachDomain,
    k: number,
  ): NormativeChunk[] {
    const scored = this.memory
      .filter((c) => c.domains.includes(domain))
      .map((c) => ({ chunk: c, score: bagOfWordsScore(query, c.text) }))
      .sort((a, b) => b.score - a.score);
    // If no token overlap at all (score === 0 across the board), still
    // return the first k domain-matched chunks so the persona never sees
    // an empty context window (downstream Gemini calls degrade gracefully).
    const positives = scored.filter((s) => s.score > 0);
    const pool = positives.length > 0 ? positives : scored;
    return pool.slice(0, k).map((s) => s.chunk);
  }

  private async searchPinecone(
    query: string,
    domain: CoachDomain,
    k: number,
  ): Promise<NormativeChunk[]> {
    if (!this.pinecone) return [];
    const embedding = await this.embedText(query);
    const endpoint =
      this.pinecone.endpoint ??
      `https://${this.pinecone.indexName}.svc.pinecone.io`;
    const res = await fetch(`${endpoint}/query`, {
      method: 'POST',
      headers: {
        'Api-Key': this.pinecone.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vector: embedding,
        topK: k,
        includeMetadata: true,
        filter: { domains: { $in: [domain] } },
      }),
    });
    if (!res.ok) {
      // Fall back to in-memory on transient Pinecone failures rather than
      // hard-failing the coach call.
      return this.searchInMemory(query, domain, k);
    }
    const json = (await res.json()) as {
      matches?: Array<{
        id: string;
        metadata?: Partial<NormativeChunk> & { domains?: CoachDomain[] };
      }>;
    };
    return (json.matches ?? []).map((m) => ({
      id: m.id,
      source: (m.metadata?.source as NormativeSource) ?? 'BCN',
      citation: m.metadata?.citation ?? m.id,
      text: m.metadata?.text ?? '',
      domains: m.metadata?.domains ?? [domain],
    }));
  }

  /**
   * Generates an embedding for arbitrary text using Gemini text-embedding-004
   * (768 dims) — same model used by the broader RAG service, keeping vector
   * dimensionality consistent across the codebase. In tests / offline mode
   * (no GEMINI_API_KEY) returns a deterministic 768-dim hash so callers can
   * still exercise the ingest path without network.
   */
  async embedText(text: string): Promise<number[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return this.deterministicEmbedding(text);
    }
    try {
      // Lazy import to avoid pulling @google/genai into hermetic tests.
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const res = await ai.models.embedContent({
        model: AI_MODEL_EMBEDDINGS,
        contents: text,
      });
      const values = res.embeddings?.[0]?.values;
      if (values && values.length > 0) return values;
      return this.deterministicEmbedding(text);
    } catch {
      return this.deterministicEmbedding(text);
    }
  }

  private deterministicEmbedding(text: string): number[] {
    const dims = 768;
    const out = new Array<number>(dims).fill(0);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      out[code % dims] += 1;
    }
    // L2 normalize so cosine distances are comparable.
    let norm = 0;
    for (const v of out) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    return out.map((v) => v / norm);
  }

  /**
   * Adds (or replaces) a chunk in the corpus. In Pinecone mode this upserts
   * to the index; in-memory mode pushes/replaces in the local array.
   */
  async ingestChunk(chunk: NormativeChunk): Promise<void> {
    const enriched: NormativeChunk = {
      ...chunk,
      embedding: chunk.embedding ?? (await this.embedText(chunk.text)),
    };
    if (this.pinecone) {
      const endpoint =
        this.pinecone.endpoint ??
        `https://${this.pinecone.indexName}.svc.pinecone.io`;
      await fetch(`${endpoint}/vectors/upsert`, {
        method: 'POST',
        headers: {
          'Api-Key': this.pinecone.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vectors: [
            {
              id: enriched.id,
              values: enriched.embedding,
              metadata: {
                source: enriched.source,
                citation: enriched.citation,
                text: enriched.text,
                domains: enriched.domains,
              },
            },
          ],
        }),
      });
    }
    const existing = this.memory.findIndex((c) => c.id === enriched.id);
    if (existing >= 0) this.memory[existing] = enriched;
    else this.memory.push(enriched);
  }

  /** Test helper / introspection: returns a shallow copy of the in-memory corpus. */
  listChunks(): NormativeChunk[] {
    return [...this.memory];
  }
}
