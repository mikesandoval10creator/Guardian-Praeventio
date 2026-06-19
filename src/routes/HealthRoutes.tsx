import { lazy } from 'react';
import { Route } from 'react-router-dom';

const Hygiene = lazy(() => import('../pages/Hygiene').then(module => ({ default: module.Hygiene })));
const Medicine = lazy(() => import('../pages/Medicine').then(module => ({ default: module.Medicine })));
const Ergonomics = lazy(() => import('../pages/Ergonomics').then(module => ({ default: module.Ergonomics })));
const Psychosocial = lazy(() => import('../pages/Psychosocial').then(module => ({ default: module.Psychosocial })));
const BioAnalysis = lazy(() => import('../pages/BioAnalysis').then(module => ({ default: module.BioAnalysis })));
const HumanBodyViewer = lazy(() => import('../pages/HumanBodyViewer').then(module => ({ default: module.HumanBodyViewer })));
const SunTracker = lazy(() => import('../pages/SunTracker').then(module => ({ default: module.SunTracker })));
// Sprint K vidas críticas (Fase 3.E del plan, audit TODO §2.27) — wire UI
// FatigueMonitor. El service `src/services/fatigue/fatigueMonitor.ts`
// + componente `src/components/fatigue/FatigueAssessmentCard.tsx` existían
// pero el componente no estaba wireado a ninguna page. Esta route cierra
// el gap. Anonymous-friendly (idb-keyval); login para sync entre devices.
const FatigueMonitor = lazy(() => import('../pages/FatigueMonitor').then(module => ({ default: module.FatigueMonitor })));
// Carga mental (NASA-TLX) — on-device workload self-assessment over the real
// scoreMentalLoad engine (mounts the orphan MentalLoadSurveyForm). Wellbeing/
// ergonomics domain, alongside FatigueMonitor. No login, nothing persisted.
const CargaMental = lazy(() => import('../pages/CargaMental').then(module => ({ default: module.CargaMental })));
// B-protocols (2026-06-11) — TMERT-EESS + PREXOR get their own UI. The pure
// engines under src/services/protocols/ were "invisible": HTTP compute routes
// existed but no persistence/UI. These pages close the gap (form → server
// compute → audited history per project).
const TmertEvaluation = lazy(() => import('../pages/TmertEvaluation').then(module => ({ default: module.TmertEvaluation })));
const PrexorEvaluation = lazy(() => import('../pages/PrexorEvaluation').then(module => ({ default: module.PrexorEvaluation })));
// CEAL-SM/SUSESO (2026-06-11) — riesgos psicosociales laborales get their own
// UI (Protocolo de Vigilancia MINSAL oct. 2022; replaced SUSESO/ISTAS21 in
// 2023). Management page (campaigns + k-gated semáforo) + anonymous worker
// response flow. Engine: src/services/protocols/cealSm.ts.
const CealSmCampaigns = lazy(() => import('../pages/CealSmCampaigns').then(module => ({ default: module.CealSmCampaigns })));
const CealSmResponder = lazy(() => import('../pages/CealSmResponder').then(module => ({ default: module.CealSmResponder })));
// PLANESI module (2026-06-11) — sílice cristalina respirable gets the same
// treatment (engine src/services/protocols/planesi.ts, verified DS 594
// Art. 66 + protocolo sílice MINSAL Res. Ex. 268/2015).
const PlanesiEvaluation = lazy(() => import('../pages/PlanesiEvaluation').then(module => ({ default: module.PlanesiEvaluation })));
const WasteInventoryPage = lazy(() => import('../pages/WasteInventoryPage').then(module => ({ default: module.WasteInventoryPage })));

export const HealthRoutes = [
  <Route key="hygiene" path="hygiene" element={<Hygiene />} />,
  <Route key="medicine" path="medicine" element={<Medicine />} />,
  <Route key="ergonomics" path="ergonomics" element={<Ergonomics />} />,
  <Route key="psychosocial" path="psychosocial" element={<Psychosocial />} />,
  <Route key="bio-analysis" path="bio-analysis" element={<BioAnalysis />} />,
  <Route key="human-body" path="human-body" element={<HumanBodyViewer />} />,
  <Route key="sun-tracker" path="sun-tracker" element={<SunTracker />} />,
  <Route key="fatigue" path="fatigue" element={<FatigueMonitor />} />,
  <Route key="carga-mental" path="carga-mental" element={<CargaMental />} />,
  <Route key="tmert" path="tmert" element={<TmertEvaluation />} />,
  <Route key="prexor" path="prexor" element={<PrexorEvaluation />} />,
  <Route key="ceal-sm" path="ceal-sm" element={<CealSmCampaigns />} />,
  <Route key="ceal-sm-responder" path="ceal-sm/responder" element={<CealSmResponder />} />,
  <Route key="planesi" path="planesi" element={<PlanesiEvaluation />} />,
  <Route key="waste-inventory" path="waste-inventory" element={<WasteInventoryPage />} />,
];
