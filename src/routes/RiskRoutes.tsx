import { lazy } from 'react';
import { Route } from 'react-router-dom';

const Risks = lazy(() => import('../pages/Risks').then(module => ({ default: module.Risks })));
const Matrix = lazy(() => import('../pages/Matrix').then(module => ({ default: module.Matrix })));
const EPP = lazy(() => import('../pages/EPP').then(module => ({ default: module.EPP })));
const PTSGenerator = lazy(() => import('../pages/PTSGenerator').then(module => ({ default: module.PTSGenerator })));
const Diagnostico = lazy(() => import('../pages/Diagnostico').then(module => ({ default: module.Diagnostico })));
const MuralDinamico = lazy(() => import('../pages/MuralDinamico').then(module => ({ default: module.MuralDinamico })));
const ControlsAndMaterials = lazy(() => import('../pages/ControlsAndMaterials').then(module => ({ default: module.ControlsAndMaterials })));
const SecurityShield = lazy(() => import('../pages/SecurityShield').then(module => ({ default: module.SecurityShield })));
const LightPollutionAudit = lazy(() => import('../pages/LightPollutionAudit').then(module => ({ default: module.LightPollutionAudit })));
const Findings = lazy(() => import('../pages/Findings').then(module => ({ default: module.Findings })));
const AfichesSeguridad = lazy(() => import('../pages/AfichesSeguridad').then(module => ({ default: module.AfichesSeguridad })));
// Sprint K vidas críticas (2026-05-22) — wire UI CriticalControlsView +
// RootCauseInvestigation. Services existían sin page consumidor; aquí
// se cierra el gap del Sprint K wire UI restante del plan integrado.
const CriticalControlsView = lazy(() => import('../pages/CriticalControlsView').then(module => ({ default: module.CriticalControlsView })));
const RootCauseInvestigation = lazy(() => import('../pages/RootCauseInvestigation').then(module => ({ default: module.RootCauseInvestigation })));

export const RiskRoutes = [
  <Route key="risks" path="risks" element={<Risks />} />,
  <Route key="matrix" path="matrix" element={<Matrix />} />,
  <Route key="epp" path="epp" element={<EPP />} />,
  <Route key="pts" path="pts" element={<PTSGenerator />} />,
  <Route key="diagnostico" path="diagnostico" element={<Diagnostico />} />,
  <Route key="mural" path="mural" element={<MuralDinamico />} />,
  <Route key="controls-materials" path="controls-materials" element={<ControlsAndMaterials />} />,
  <Route key="security-shield" path="security-shield" element={<SecurityShield />} />,
  <Route key="light-pollution" path="light-pollution" element={<LightPollutionAudit />} />,
  <Route key="findings" path="findings" element={<Findings />} />,
  <Route key="afiches-seguridad" path="afiches-seguridad" element={<AfichesSeguridad />} />,
  <Route key="critical-controls" path="critical-controls" element={<CriticalControlsView />} />,
  <Route key="root-cause" path="root-cause" element={<RootCauseInvestigation />} />,
];
