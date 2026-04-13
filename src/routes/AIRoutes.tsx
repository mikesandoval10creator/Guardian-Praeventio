import { lazy } from 'react';
import { Route } from 'react-router-dom';

const AIHub = lazy(() => import('../pages/AIHub').then(module => ({ default: module.AIHub })));
const ModuleHub = lazy(() => import('../pages/ModuleHub').then(module => ({ default: module.ModuleHub })));
const PredictiveGuard = lazy(() => import('../pages/PredictiveGuard').then(module => ({ default: module.PredictiveGuard })));
const KnowledgeIngestion = lazy(() => import('../pages/KnowledgeIngestion').then(module => ({ default: module.KnowledgeIngestion })));
const AcademicProcessor = lazy(() => import('../pages/AcademicProcessor').then(module => ({ default: module.AcademicProcessor })));
const RiskNetwork = lazy(() => import('../pages/RiskNetwork').then(module => ({ default: module.RiskNetwork })));
const Glossary = lazy(() => import('../pages/Glossary').then(module => ({ default: module.Glossary })));

export const AIRoutes = [
  <Route key="ai-hub" path="ai-hub" element={<AIHub />} />,
  <Route key="hub-id" path="hub/:id" element={<ModuleHub />} />,
  <Route key="predictive-guard" path="predictive-guard" element={<PredictiveGuard />} />,
  <Route key="knowledge-ingestion" path="knowledge-ingestion" element={<KnowledgeIngestion />} />,
  <Route key="academic-processor" path="academic-processor" element={<AcademicProcessor />} />,
  <Route key="risk-network" path="risk-network" element={<RiskNetwork />} />,
  <Route key="glossary" path="glossary" element={<Glossary />} />,
];
