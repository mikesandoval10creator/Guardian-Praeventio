/**
 * Medical catalogs loader
 * Sprint 21 — Bucket R · Datos reales bundled offline-first.
 *
 * Sources (ver _meta de cada JSON):
 *   - diagnoses.json: WHO ICD-10 (CC0) + DS 109/Ley 16.744 Chile
 *   - drugs.json: WHO ATC (CC0) + DrugBank Open Data v5.1 (CC0 subset)
 *   - anatomy.json: Wikipedia ES (CC BY-SA 4.0) + DS 594
 */
import diagnosesRaw from './diagnoses.json';
import drugsRaw from './drugs.json';
import anatomyRaw from './anatomy.json';

export interface DiagnosisEntry {
  code: string;
  name: string;
  category: string;
  occupational: boolean;
  riskAgents: string[];
  description: string;
}

export interface DrugEntry {
  name: string;
  atc: string;
  category: string;
  occupationalRelevance: string;
  /** Optional — not every drug has known DDIs in this catalog. */
  interactions?: string[];
}

export interface AnatomyEntry {
  id: string;
  name: string;
  system: string;
  occupationalRisks: string[];
  commonInjuries: string[];
  description: string;
  /** Optional — Wikipedia URL when available. */
  wikipediaUrl?: string;
}

interface Catalog<T> {
  _meta: {
    name: string;
    version: string;
    license: string;
    source: string;
    scope: string;
    disclaimer: string;
    lastUpdated: string;
    todoExpand?: string;
  };
  data: T[];
}

const diagnosesCatalog = diagnosesRaw as unknown as Catalog<DiagnosisEntry>;
const drugsCatalog = drugsRaw as unknown as Catalog<DrugEntry>;
const anatomyCatalog = anatomyRaw as unknown as Catalog<AnatomyEntry>;

export const diagnoses: DiagnosisEntry[] = diagnosesCatalog.data;
export const drugs: DrugEntry[] = drugsCatalog.data;
export const anatomy: AnatomyEntry[] = anatomyCatalog.data;

export const diagnosesMeta = diagnosesCatalog._meta;
export const drugsMeta = drugsCatalog._meta;
export const anatomyMeta = anatomyCatalog._meta;
