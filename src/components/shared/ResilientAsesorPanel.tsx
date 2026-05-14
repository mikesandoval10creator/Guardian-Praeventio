// Praeventio Guard — Wire UI: <ResilientAsesorPanel />
//
// Host conectado que reemplaza al `<AsesorChat>` legacy con el
// pipeline resiliente del orchestrator (#221). Cablea:
//   - useUniversalKnowledge (memory ZK source)
//   - useProject (tenantId, projectId)
//   - useFirebase (userUid)
//   - searchFirestoreKnowledge: query de FAQ/procedimientos del tenant
//   - callGeminiServer: endpoint /api/ai/gemini
//
// El panel se monta detrás de un feature flag (`useResilientAsesorFlag`)
// para que coexista con `<AsesorChat>` legacy durante la migración.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ResilientAiAssistantPanel } from '../ai/ResilientAiAssistantPanel';
import { buildAsesorAdapters } from '../../services/ai/asesorAdaptersFactory';
import type { AiDomain } from '../../services/ai/resilientAiOrchestrator';

interface ResilientAsesorPanelProps {
  /** ZK nodes en memoria (de useUniversalKnowledge). */
  zkNodes?: ReadonlyArray<{
    id: string;
    type: string;
    title?: string;
    description?: string;
    tags?: string[];
    connections?: string[];
  }>;
  /** Tenant id (caller-provided desde context). */
  tenantId?: string;
  /** User uid. */
  userUid?: string;
  /** Dominio default. Si no se pasa, se detecta del prompt. */
  defaultDomain?: AiDomain;
  /**
   * Función que busca FAQ/procedimientos en Firestore. Caller
   * implementa con su firestore instance + colección del tenant.
   */
  searchFirestoreKnowledge?: (
    keyword: string,
  ) => Promise<
    Array<{
      id: string;
      title: string;
      content: string;
    }>
  >;
  /** Función IDB para fallback offline de knowledge base. */
  searchOfflineKnowledge?: (
    keyword: string,
  ) => Promise<
    Array<{
      id: string;
      title: string;
      content: string;
    }>
  >;
  /**
   * Endpoint Gemini server-side. Caller decide path + headers.
   * Si no se provee, gemini tier queda deshabilitado.
   */
  callGeminiServer?: (
    prompt: string,
    context?: Record<string, unknown>,
  ) => Promise<{
    text: string;
    citations?: Array<{ uri: string; title?: string }>;
  }>;
  /** Sugerencias prompts. */
  suggestions?: string[];
  /** Cap de history. Default 5. */
  maxHistory?: number;
  /** Callback citation click (e.g. navegar al nodo). */
  onCitationClick?: (citation: {
    kind: string;
    ref: string;
    label?: string;
  }) => void;
}

export function ResilientAsesorPanel({
  zkNodes,
  tenantId,
  userUid,
  defaultDomain,
  searchFirestoreKnowledge,
  searchOfflineKnowledge,
  callGeminiServer,
  suggestions,
  maxHistory,
  onCitationClick,
}: ResilientAsesorPanelProps) {
  const { t } = useTranslation();

  // Memoize los adapters: si las dependencias cambian (proyecto switch,
  // user logout), reconstruimos. La factory es cheap (cierre + dynamic
  // imports). El hook downstream usa useMemo internamente.
  const adapters = useMemo(
    () =>
      buildAsesorAdapters({
        zkNodes,
        searchFirestoreKnowledge,
        searchOfflineKnowledge,
        callGeminiServer,
      }),
    [
      zkNodes,
      searchFirestoreKnowledge,
      searchOfflineKnowledge,
      callGeminiServer,
    ],
  );

  const defaultSuggestions = useMemo(
    () =>
      suggestions ?? [
        t('asesor.sug1', '¿Cómo activo el SOS?'),
        t('asesor.sug2', '¿Qué EPP necesito para trabajo en altura?'),
        t('asesor.sug3', '¿Cuándo declaro DIAT?'),
        t('asesor.sug4', '¿Qué dice el DS 594 sobre ruido?'),
      ],
    [suggestions, t],
  );

  return (
    <ResilientAiAssistantPanel
      adapters={adapters}
      tenantId={tenantId}
      userUid={userUid}
      defaultDomain={defaultDomain}
      suggestions={defaultSuggestions as string[]}
      maxHistory={maxHistory}
      onCitationClick={
        onCitationClick
          ? (c) => onCitationClick({ kind: c.kind, ref: c.ref, label: c.label })
          : undefined
      }
    />
  );
}
