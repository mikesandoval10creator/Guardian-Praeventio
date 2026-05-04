# Catálogos médicos bundled (offline-first)

Sprint 21 · Bucket R · Datos reales que reemplazan los catálogos hardcoded
de los componentes `DifferentialDiagnosis`, `DrugInteractions`, `AnatomyLibrary`
y `VitalityMonitor`.

## Archivos

| Archivo | Entradas | Licencia | Fuente principal |
|---|---|---|---|
| `src/data/medical/diagnoses.json` | ~70 | CC0 (códigos CIE-10 son dominio público — WHO) | WHO ICD-10 + DS 109 / Ley 16.744 Chile |
| `src/data/medical/drugs.json` | ~70 | CC0 (códigos ATC — WHO Collaborating Centre) | WHO ATC/DDD + DrugBank Open Data v5.1 + Vademécum ISP Chile |
| `src/data/medical/anatomy.json` | ~50 | CC BY-SA 4.0 (descripciones derivadas de Wikipedia) | Wikipedia ES + DS 594 |

Cada archivo lleva un bloque `_meta` con `name`, `version`, `license`, `source`,
`scope`, `disclaimer` y `lastUpdated`. Los componentes lo leen y lo muestran
en el footer del browser de catálogo.

## API

```ts
import {
  diagnoses, drugs, anatomy,
  diagnosesMeta, drugsMeta, anatomyMeta,
  type DiagnosisEntry, type DrugEntry, type AnatomyEntry,
} from '@/src/data/medical';
```

El loader `src/data/medical/index.ts` valida los tipos y normaliza el formato.
La búsqueda fuzzy se hace con Fuse.js a través del componente reutilizable
`src/components/medicine/CatalogBrowser.tsx`.

## Schema

### DiagnosisEntry (CIE-10)

```ts
{
  code: string;          // J62.8 — formato /^[A-Z]\d{2}(\.\d+)?$/
  name: string;          // "Neumoconiosis por otros polvos con sílice"
  category: string;      // respiratorio | musculoesquelético | mental | …
  occupational: boolean; // true si está en DS 109 / Ley 16.744
  riskAgents: string[];  // ["sílice cristalina", "minería"]
  description: string;   // Descripción + referencia normativa Chile
}
```

### DrugEntry (ATC)

```ts
{
  name: string;
  atc: string;                   // R03AC02
  category: string;              // broncodilatador | AINE | ISRS | …
  occupationalRelevance: string; // Indicación SST + restricciones
  interactions?: string[];       // Interacciones clínicas relevantes
}
```

### AnatomyEntry

```ts
{
  id: string;
  name: string;
  system: string;                 // musculoesquelético | respiratorio | …
  occupationalRisks: string[];
  commonInjuries: string[];       // referencia con código CIE-10 entre paréntesis
  description: string;
  wikipediaUrl?: string;
}
```

## Cómo agregar entradas

1. Edita el JSON correspondiente respetando el schema y el formato del código.
2. Si es un nuevo CIE-10, valida con la regex `^[A-Z]\d{2}(\.\d+)?$`.
3. Mantén las descripciones cortas (<200 chars) y referencia legislación Chile
   cuando aplique (DS 594, DS 109, Ley 16.744).
4. Corre `npx vitest run src/data/medical/medicalCatalogs.test.ts`.

## Cómo regenerar desde fuentes

El subset actual fue curado a mano para garantizar relevancia SST. Para expandir
a la cobertura completa CIE-10 (~14000 códigos):

1. Descargar el dump CIE-10 oficial de WHO o el mirror CC0
   <https://github.com/Bobliuuu/ICD-10>.
2. Filtrar por capítulos relevantes (F, J, M, S, T, H, I, L, C, B).
3. Mantener `occupational: true` solo para códigos en DS 109.
4. Generar el JSON con `scripts/generate-medical-catalogs.mjs` (TODO Ola 5b
   cuando se autorice descarga en CI).

Para fármacos: WHO ATC index público está en
<https://www.whocc.no/atc_ddd_index/> (no permite scraping masivo automatizado;
usar dump del paquete `@himedoc/atc-codes` o equivalente CC0 si se autoriza).

## Disclaimer

> Este catálogo NO sustituye juicio clínico profesional, diagnóstico médico ni
> prescripción farmacológica. La calificación final de enfermedad profesional en
> Chile la realiza la mutualidad correspondiente (Mutual de Seguridad, ACHS, IST)
> y SUSESO/COMPIN. Verificar siempre con Vademécum oficial (ISP Chile) antes de
> prescribir.

## Mantenimiento

- **Owner:** equipo médico Praeventio.
- **Revisión:** anual (alineada con actualizaciones DS 594/DS 109).
- **Tests:** `src/data/medical/medicalCatalogs.test.ts` valida carga, schema,
  formato CIE-10 e identificadores únicos en anatomy.
