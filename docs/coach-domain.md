# Coach IA por dominio especializado

Este documento describe cómo agregar nuevos dominios al sistema Coach IA
(`src/services/coach/`) y cómo mantener el corpus normativo CL.

## Arquitectura

```
src/services/coach/
  prompts.ts           # DomainPrompt definitions (chemical/medicine/legal)
  normativeRag.ts      # NormativeRagService (Pinecone + in-memory fallback)
  prompts.test.ts
  normativeRag.test.ts
```

Los tres backends especializados (`chemicalBackend.ts`, `medicineBackend.ts`,
`legalBackend.ts`) consumen estos módulos así:

1. Importan su `DomainPrompt` correspondiente.
2. Construyen una instancia singleton de `NormativeRagService.fromEnv()`.
3. Antes de cada llamada a Gemini, recuperan top-K chunks del dominio y
   los inyectan como contexto en el prompt.
4. Anexan al output un array `citations` con las normas usadas.

## Agregar un nuevo dominio

Ejemplo: dominio `ergonomia`.

### 1. Definir el `DomainPrompt`

En `src/services/coach/prompts.ts`:

```ts
export const ERGONOMIA_PROMPT: DomainPrompt = {
  systemPrompt: `Eres ergónomo certificado CL. Cumples Ley 20.001 + DS 63
(carga manual), TMERT-EESS (MINSAL), NCh-ISO 11226 (postura estática).
NUNCA recomiendas sin citar el método de evaluación (RULA, REBA, NIOSH).`,
  examples: [
    { input: '...', output: '...' },
    { input: '...', output: '...' },
  ],
  rule: 'Si carga > 25 kg (hombre) o > 20 kg (mujer/menor) → ...',
  citations: ['Ley 20.001/2005', 'DS 63/2005', 'TMERT-EESS', 'NCh-ISO 11226'],
};
```

Y agregarlo al lookup:

```ts
export const DOMAIN_PROMPTS = {
  chemical: CHEMICAL_PROMPT,
  medicine: MEDICINE_PROMPT,
  legal: LEGAL_PROMPT,
  ergonomia: ERGONOMIA_PROMPT, // NEW
} as const;
```

`CoachDomain` se actualiza automáticamente vía `keyof typeof DOMAIN_PROMPTS`.

### 2. Etiquetar chunks del dominio en `normativeRag.ts`

Editar `domainByRegId` y/o agregar chunks curados con `domains: ['ergonomia']`.

```ts
const ERGONOMIA_DETAIL_CHUNKS: NormativeChunk[] = [
  {
    id: 'detail-tmert-niveles',
    source: 'MINSAL',
    citation: 'TMERT-EESS MINSAL',
    text: 'Niveles de acción TMERT: verde (<25), amarillo (25-50)...',
    domains: ['ergonomia', 'medicine'],
  },
];
```

### 3. Crear el backend

`src/services/ergonomiaBackend.ts` — sigue la plantilla de los tres
backends existentes:

```ts
import { ERGONOMIA_PROMPT } from './coach/prompts.js';
import { NormativeRagService } from './coach/normativeRag.js';

let ragSingleton: NormativeRagService | null = null;
const getRag = () => (ragSingleton ??= NormativeRagService.fromEnv());

export const evaluateErgonomicTask = async (...) => {
  const rag = getRag();
  const chunks = await rag.searchTopK(query, 'ergonomia', 5);
  // ... build prompt with persona header + RAG context, call Gemini
};
```

### 4. Tests

Replicar el patrón de `prompts.test.ts` y `normativeRag.test.ts`:

- `prompts.test.ts` — agregar casos para el nuevo `DomainPrompt`.
- `normativeRag.test.ts` — agregar test que verifique que `searchTopK` con
  el nuevo dominio recupera chunks etiquetados con él.

## Configurar Pinecone (modo producción)

Variables de entorno:

```
PINECONE_API_KEY=...
PINECONE_INDEX=guardian-normativa
PINECONE_ENDPOINT=https://guardian-normativa-XXX.svc.pinecone.io   # opcional
GEMINI_API_KEY=...   # para text-embedding-004
```

Si `PINECONE_API_KEY` o `PINECONE_INDEX` faltan, `fromEnv()` cae a modo
in-memory (seeded desde `src/data/normativa/cl.ts`). Esto permite que
desarrollo y CI corran sin dependencias externas.

### Cargar el corpus inicial a Pinecone

```ts
const rag = NormativeRagService.fromEnv();
const seed = await import('./seedScript.js'); // tu pipeline
for (const chunk of seed.chunks) {
  await rag.ingestChunk(chunk);
}
```

## Reglas duras

- **El kernel Zettelkasten NUNCA se expone vía RAG ni Pinecone.** Solo
  normativa pública (BCN, MINSAL, INE, DT, SUSESO, ISP).
- **Cada respuesta del coach DEBE incluir `citations`.** Si Gemini omite
  el campo, los backends lo rellenan con las normas que aportó el RAG.
- **No introducir dependencia circular.** `prompts.ts` no importa de
  `normativeRag.ts` y viceversa; los backends son los únicos que combinan
  ambos.

## Verificación local

```bash
cd "D:/Guardian Praeventio/repo"
npx vitest run src/services/coach/
npm run typecheck
```
