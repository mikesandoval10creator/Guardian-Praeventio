import { lazy } from 'react';
import { Route } from 'react-router-dom';

const Normatives = lazy(() => import('../pages/Normatives').then(module => ({ default: module.Normatives })));
const NormativeDetail = lazy(() => import('../pages/NormativeDetail').then(module => ({ default: module.NormativeDetail })));
const MinsalProtocols = lazy(() => import('../pages/MinsalProtocols').then(module => ({ default: module.MinsalProtocols })));
const Audits = lazy(() => import('../pages/Audits').then(module => ({ default: module.Audits })));
const AuditTrail = lazy(() => import('../pages/AuditTrail').then(module => ({ default: module.AuditTrail })));
const ComiteParitario = lazy(() => import('../pages/ComiteParitario').then(module => ({ default: module.ComiteParitario })));
const SusesoReports = lazy(() => import('../pages/SusesoReports').then(module => ({ default: module.SusesoReports })));
// Sprint 31 Bucket PP — DS 67 + DS 76 PDF builders.
const Reglamentos = lazy(() => import('../pages/Reglamentos').then(module => ({ default: module.Reglamentos })));
// Sprint 28 Bucket B5 — CPHS module formal (audit hallazgo H29 P1).
// Convive con `comite-paritario` (legacy: actas + acuerdos free-text) hasta
// que la migración de datos del próximo sprint mueva los `comite_actas` a
// `cphs_meetings` con quórum + firma WebAuthn validados.
const CphsModule = lazy(() => import('../pages/CphsModule'));
// Sprint 40 Fase F.7 — Minuta CPHS automática (borrador mensual
// determinístico desde incidentes + acciones + capacitaciones +
// inspecciones). El comité revisa y firma desde el módulo CPHS principal.
const CphsDraftMinute = lazy(() => import('../pages/CphsDraftMinute').then(m => ({ default: m.CphsDraftMinute })));
// Sprint K wire UI (2026-05-23) — Excepciones documentadas.
const ExceptionsAudit = lazy(() => import('../pages/ExceptionsAudit').then(m => ({ default: m.ExceptionsAudit })));
// Sprint K wire UI (2026-05-23) — Auditor de consistencia entre módulos.
const ConsistencyAudit = lazy(() => import('../pages/ConsistencyAudit').then(m => ({ default: m.ConsistencyAudit })));
// Sprint K wire UI (2026-05-23) — Calendario legal + Gestión de cambios MOC.
const LegalCalendar = lazy(() => import('../pages/LegalCalendar').then(m => ({ default: m.LegalCalendar })));
const OperationalChanges = lazy(() => import('../pages/OperationalChanges').then(m => ({ default: m.OperationalChanges })));
// F5(changeMgmt) — Management of Change (MOC) adapter-backed page. Monta el
// trío ChangeDeclarationForm + MOCStatusPanel + AcknowledgmentBanner sobre la
// superficie persistida /api/sprint-k/:projectId/moc/* (operationalChange.ts).
const ChangeManagement = lazy(() => import('../pages/ChangeManagement').then(m => ({ default: m.ChangeManagement })));
// Sprint K wire UI (2026-05-23) — Charlas + Portales auditor externo.
const SafetyTalks = lazy(() => import('../pages/SafetyTalks').then(m => ({ default: m.SafetyTalks })));
const AuditPortals = lazy(() => import('../pages/AuditPortals').then(m => ({ default: m.AuditPortals })));
// Sprint K wire UI (2026-05-23) — Confirmación de lectura de documentos críticos.
const DocumentReadConfirm = lazy(() => import('../pages/DocumentReadConfirm').then(m => ({ default: m.DocumentReadConfirm })));
// Épica B1 capa 2 (2026-06-11) — Simulador de cotización adicional DS 67
// desde la siniestralidad real (incidentes → días perdidos → tabla art. 5).
const Ds67Simulator = lazy(() => import('../pages/Ds67Simulator').then(m => ({ default: m.Ds67Simulator })));
// Bloque 3.15 — Escenarios de costo preventivo (loop simular→guardar→leer→tarjeta).
// Monta <CostSimulator /> + <CostScenarioCard /> sobre la superficie persistida
// real /api/sprint-k/:projectId/cost/* (preventionCost.ts → Firestore cost_scenarios).
const CostScenarios = lazy(() => import('../pages/CostScenarios').then(m => ({ default: m.CostScenarios })));
// Bloque D Rama 1 (2026-07-06) — legal orphans wired. Both pure-compute HTTP
// surfaces existed with client hooks but no page/route:
// - RetaliationProtection (Ley Karin 21.643): src/server/routes/
//   retaliationProtection.ts + src/hooks/useRetaliationProtection.ts.
// - PrivacyShield (Ley 19.628 + GDPR): src/server/routes/privacyShield.ts
//   + src/hooks/usePrivacyShield.ts.
const RetaliationProtectionPage = lazy(() => import('../pages/RetaliationProtectionPage').then(m => ({ default: m.RetaliationProtectionPage })));
const PrivacyShieldPage = lazy(() => import('../pages/PrivacyShieldPage').then(m => ({ default: m.PrivacyShieldPage })));
// Alpha41 task 395aa66d — mount 4 report orphans (MonthlyClientReportPanel,
// MonthlyClientReportCard, ReportTemplatePreview, ExplainedRecommendationCard)
// into a single Reports surface.
const ClientReports = lazy(() => import('../pages/ClientReports').then(m => ({ default: m.ClientReports })));

export const ComplianceRoutes = [
  <Route key="normatives" path="normatives" element={<Normatives />} />,
  <Route key="normatives-detail" path="normatives/:id" element={<NormativeDetail />} />,
  <Route key="minsal-protocols" path="minsal-protocols" element={<MinsalProtocols />} />,
  <Route key="audits" path="audits" element={<Audits />} />,
  <Route key="audit-trail" path="audit-trail" element={<AuditTrail />} />,
  <Route key="comite-paritario" path="comite-paritario" element={<ComiteParitario />} />,
  <Route key="cphs" path="cphs" element={<CphsModule />} />,
  <Route key="cphs-draft-minute" path="cphs/draft-minute" element={<CphsDraftMinute />} />,
  <Route key="suseso" path="suseso" element={<SusesoReports />} />,
  <Route key="reglamentos" path="reglamentos" element={<Reglamentos />} />,
  <Route key="exceptions" path="exceptions" element={<ExceptionsAudit />} />,
  <Route key="consistency-audit" path="consistency-audit" element={<ConsistencyAudit />} />,
  <Route key="legal-calendar" path="legal-calendar" element={<LegalCalendar />} />,
  <Route key="operational-changes" path="operational-changes" element={<OperationalChanges />} />,
  <Route key="change-management" path="change-management" element={<ChangeManagement />} />,
  <Route key="safety-talks" path="safety-talks" element={<SafetyTalks />} />,
  <Route key="audit-portals" path="audit-portals" element={<AuditPortals />} />,
  <Route key="document-read" path="document-read" element={<DocumentReadConfirm />} />,
  <Route key="ds67-simulator" path="ds67-simulator" element={<Ds67Simulator />} />,
  <Route key="cost-scenarios" path="cost-scenarios" element={<CostScenarios />} />,
  <Route key="retaliation-protection" path="retaliation-protection" element={<RetaliationProtectionPage />} />,
  <Route key="privacy-shield" path="privacy-shield" element={<PrivacyShieldPage />} />,
  <Route key="client-reports" path="client-reports" element={<ClientReports />} />,
];
