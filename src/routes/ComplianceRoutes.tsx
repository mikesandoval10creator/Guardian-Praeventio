import { lazy } from 'react';
import { Route } from 'react-router-dom';

const Normatives = lazy(() => import('../pages/Normatives').then(module => ({ default: module.Normatives })));
const NormativeDetail = lazy(() => import('../pages/NormativeDetail').then(module => ({ default: module.NormativeDetail })));
const MinsalProtocols = lazy(() => import('../pages/MinsalProtocols').then(module => ({ default: module.MinsalProtocols })));
const Audits = lazy(() => import('../pages/Audits').then(module => ({ default: module.Audits })));
const AuditTrail = lazy(() => import('../pages/AuditTrail').then(module => ({ default: module.AuditTrail })));
const ComiteParitario = lazy(() => import('../pages/ComiteParitario').then(module => ({ default: module.ComiteParitario })));
const SusesoReports = lazy(() => import('../pages/SusesoReports').then(module => ({ default: module.SusesoReports })));

export const ComplianceRoutes = [
  <Route key="normatives" path="normatives" element={<Normatives />} />,
  <Route key="normatives-detail" path="normatives/:id" element={<NormativeDetail />} />,
  <Route key="minsal-protocols" path="minsal-protocols" element={<MinsalProtocols />} />,
  <Route key="audits" path="audits" element={<Audits />} />,
  <Route key="audit-trail" path="audit-trail" element={<AuditTrail />} />,
  <Route key="comite-paritario" path="comite-paritario" element={<ComiteParitario />} />,
  <Route key="suseso" path="suseso" element={<SusesoReports />} />,
];
