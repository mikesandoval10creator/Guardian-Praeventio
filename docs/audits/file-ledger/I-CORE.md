# File ledger — I-CORE (53 files)

Mechanical per-file extraction (purpose = file's own header comment; exports from source). Part of the file-by-file context audit.

| Archivo | Bloque | LOC | Test | Propósito / exports |
|---|---|---:|:--:|---|
| `src/App.tsx` |  | 566 |  | _exports:_ App |
| `src/constants.ts` |  | 298 |  | _exports:_ INDUSTRY_SECTORS, INDUSTRIES, EPP_BY_SECTOR, EPP_DEFAULT, RISK_LEVELS |
| `src/constants/glossary.ts` |  | 278 |  | _exports:_ SAFETY_GLOSSARY |
| `src/contexts/AccessibilityContext.tsx` |  | 211 | ✓ | AccessibilityContext — Sprint K §139-145. |
| `src/contexts/AppModeContext.tsx` |  | 277 |  | _exports:_ AppMode, AppAppearance, AppModeProvider, useAppMode |
| `src/contexts/EmergencyContext.tsx` | B1-Emergencia | 236 |  | _exports:_ EmergencyProvider, useEmergency |
| `src/contexts/FirebaseContext.tsx` | B3-Ergonomia | 215 |  | _exports:_ FirebaseProvider, useFirebase |
| `src/contexts/LanguageProvider.tsx` |  | 287 | ✓ | _exports:_ SUPPORTED_LOCALES, SupportedLocale, LOCALE_DISPLAY, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, normalizeLocale, resolveInitialLanguage, LanguageProvider, useLanguage |
| `src/contexts/NormativeContext.tsx` |  | 582 |  | _exports:_ Normative, Protocol, NormativeContextType, NormativeProvider, useNormative, NormativeEntry, NORMATIVE_DB, getComprehensiveNormativeContext |
| `src/contexts/NotificationContext.tsx` |  | 211 |  | _exports:_ NotificationType, NotificationProvider, useNotifications |
| `src/contexts/ProjectContext.tsx` |  | 338 |  | _exports:_ ProjectProvider, useProject |
| `src/contexts/SensorContext.tsx` |  | 140 |  | _exports:_ SensorProvider, useSensors |
| `src/contexts/SubscriptionContext.tsx` | B15-Billing | 257 | ✓ | _exports:_ SubscriptionFeatures, getFeaturesForPlan, SubscriptionProvider, useSubscription |
| `src/contexts/SystemEngineProvider.tsx` |  | 185 | ✓ | SystemEngine — React provider. |
| `src/contexts/ThemeContext.tsx` |  | 123 |  | _exports:_ ThemeProvider, useTheme |
| `src/contexts/UniversalKnowledgeContext.tsx` |  | 296 |  | _exports:_ KnowledgeGraph, UniversalKnowledgeProvider, useUniversalKnowledge |
| `src/index.css` |  | 398 |  | Custom Brand Colors — caballito de batalla teal #4db6ac (light) + petroleum + gold (dark) |
| `src/lib/apiAuth.ts` |  | 118 | ✓ | Praeventio Guard — §2.20 fix (2026-05-21). |
| `src/lib/e2eAuth.ts` |  | 119 | ✓ | Praeventio Guard — Sprint 19 / F-B01. |
| `src/lib/i18n.ts` |  | 26 |  | Legacy i18n entry point — kept for backward compatibility. |
| `src/lib/sentry.ts` |  | 151 | ✓ | _exports:_ redactPii, initSentry, captureEmergencyError, __resetForTests |
| `src/main.tsx` |  | 205 |  | Initialise i18next BEFORE any component imports below — the |
| `src/providers/AppProviders.tsx` |  | 160 |  | _exports:_ AppProviders |
| `src/providers/MeshProvider.tsx` |  | 131 | ✓ | Sprint 35 — MeshProvider (closes ADR-0013 last-mile, Sprint 33 D3). |
| `src/store/eventBus.ts` |  | 185 | ✓ | Praeventio Guard — Sprint 39 Fase C.4: Event Bus global. |
| `src/types/globals.d.ts` |  | 58 |  | Global/window augmentation (Sprint 49 - E.5 P2 H19). |
| `src/types/index.ts` |  | 235 |  | _exports:_ RiskCategory, NodeType, RiskNode, WeatherData, SeismicData, EnvironmentContext, EPPItem, EPPAssignment, Worker, TrainingSession, SafetyPost, SafetySolution |
| `src/types/organic.ts` | B12-CPHS | 150 |  | Sprint 15 — Organic structure: Project → Crew → Process → Task. |
| `src/types/roles.ts` |  | 75 | ✓ | Single source of truth for the role identifiers used by: |
| `src/utils/aptitudeCertificate.ts` | B7-Salud | 203 | ✓ | _exports:_ AptitudeData, generateAptitudeCertificate |
| `src/utils/biometrics.ts` | B7-Salud | 99 |  | _exports:_ isBiometricSupported, registerBiometric, verifyBiometric |
| `src/utils/contentModeration.ts` |  | 77 |  | Cumplimiento Ley 20.005 (acoso laboral) y Ley 20.609 (no discriminación): |
| `src/utils/deterministicRandom.ts` |  | 129 | ✓ | Praeventio Guard — Sprint 45 E.5 P2 H32: Deterministic Seeds. |
| `src/utils/ds109Certificate.ts` |  | 529 | ✓ | Praeventio Guard — DS 109 (Calificación de Enfermedad Profesional) PDF generator. |
| `src/utils/ds67Certificate.ts` |  | 272 |  | Praeventio Guard — Sprint 31 Bucket PP. |
| `src/utils/ds67Notification.ts` |  | 425 | ✓ | Praeventio Guard — DS 67 (Notificación a la Mutual de Seguridad) PDF generator. |
| `src/utils/ds76Certificate.ts` |  | 239 |  | Praeventio Guard — Sprint 31 Bucket PP. |
| `src/utils/ds76MiningContractor.ts` | B11-Contratistas | 439 | ✓ | Praeventio Guard — DS 76 (Empresa principal contratista en faenas mineras) |
| `src/utils/haversine.ts` |  | 82 | ✓ | Haversine distance — great-circle distance between two lat/lng points |
| `src/utils/imageCompression.ts` |  | 103 |  | _exports:_ CompressionOptions, compressImage |
| `src/utils/logger.ts` |  | 131 |  | Praeventio Guard — structured logger. |
| `src/utils/networkStatus.ts` |  | 25 |  | Sprint 33 — Network status helper (ADR 0013 mesh fallback wire W10). |
| `src/utils/nodeTypeUtils.ts` |  | 175 |  | _exports:_ NODE_COLOR, NODE_ICON, getNodeBadgeClass, getNodeColor, getNodeIcon, getNodeBgClass |
| `src/utils/offlineKnowledge.ts` | B16-Offline | 126 |  | _exports:_ OfflineTopic, OFFLINE_KNOWLEDGE_BASE, getOfflineResponse, savePendingOfflineQuery, getPendingOfflineQueries, clearPendingOfflineQueries |
| `src/utils/offlineStorage.ts` | B16-Offline | 351 | ✓ | _exports:_ initDB, saveWorkerOffline, getWorkersOffline, saveMatrixOffline, getMatricesOffline, saveZettelNodeOffline, getZettelNodesOffline, addToOfflineQueue, getOfflineQueue, clearOfflineQueueItem, saveBlackBox, getBlackBoxEntries |
| `src/utils/pricingOcPdf.ts` | B15-Billing | 281 | ✓ | Praeventio Guard — Pricing Calculator OC PDF renderer. |
| `src/utils/pwa-offline.ts` | B16-Offline | 315 | ✓ | _exports:_ SyncAction, cacheAIResponse, getCachedAIResponse, saveBunkerKnowledge, getBunkerKnowledge, saveForSync, getPendingActions, removeSyncedAction, isOnline, syncWithFirebase |
| `src/utils/randomId.ts` |  | 37 | ✓ | Generates a cryptographically secure random UUID, falling back to a |
| `src/utils/rut.ts` |  | 81 | ✓ | Praeventio Guard — Chilean RUT (Rol Único Tributario) helpers. |
| `src/utils/sqliteEncryption.ts` | B16-Offline | 77 | ✓ | Praeventio Guard — P0 security fix (SQLite mobile data-at-rest encryption). |
| `src/utils/susesoCertificate.ts` | B5-Cumplimiento | 347 | ✓ | Praeventio Guard — Sprint 28 Bucket B6. |
| `src/utils/trainingCertificate.ts` | B6-Capacitacion | 112 |  | _exports:_ generateTrainingCertificate |
| `src/vite-env.d.ts` |  | 13 |  | <reference types="vite/client" /> |
