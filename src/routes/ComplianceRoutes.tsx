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
// Sprint K wire UI (2026-05-23) — Confirmación de lectura de documentos
// críticos. Service readReceiptService.ts + card DocumentReadConfirmCard.tsx
// existían sin page consumidor.
const DocumentReadConfirm = lazy(() => import('../pages/DocumentReadConfirm').then(m => ({ default: m.DocumentReadConfirm })));

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
  <Route key="document-read" path="document-read" element={<DocumentReadConfirm />} />,
];
