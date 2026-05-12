// SystemEngine — Adapter barrel.
//
// Each context that participates in the bus has a paired adapter hook.
// The 3 critical adapters (subscription, emergency, sensor) actively
// emit events. The remaining 8 are placeholders with documented hooks
// for the next iteration — they exist now so SystemEngineProvider has a
// single mount point and future emits can be added without restructuring
// the provider.

export { useEmergencyContextAdapter } from './emergencyContextAdapter';
export { useSensorContextAdapter } from './sensorContextAdapter';
export { useSubscriptionContextAdapter } from './subscriptionContextAdapter';

// Placeholders (no-op for now; documented hooks for follow-up iterations).
export { useNotificationContextAdapter } from './notificationContextAdapter';
export { useProjectContextAdapter } from './projectContextAdapter';
export { useUniversalKnowledgeContextAdapter } from './universalKnowledgeContextAdapter';
export { useNormativeContextAdapter } from './normativeContextAdapter';
export { useAppModeContextAdapter } from './appModeContextAdapter';
export { useFirebaseContextAdapter } from './firebaseContextAdapter';
export { useThemeContextAdapter } from './themeContextAdapter';
export { useLanguageProviderAdapter } from './languageProviderAdapter';
