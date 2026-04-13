import { lazy } from 'react';
import { Route } from 'react-router-dom';

const Hygiene = lazy(() => import('../pages/Hygiene').then(module => ({ default: module.Hygiene })));
const Medicine = lazy(() => import('../pages/Medicine').then(module => ({ default: module.Medicine })));
const Ergonomics = lazy(() => import('../pages/Ergonomics').then(module => ({ default: module.Ergonomics })));
const Psychosocial = lazy(() => import('../pages/Psychosocial').then(module => ({ default: module.Psychosocial })));
const BioAnalysis = lazy(() => import('../pages/BioAnalysis').then(module => ({ default: module.BioAnalysis })));
const HumanBodyViewer = lazy(() => import('../pages/HumanBodyViewer').then(module => ({ default: module.HumanBodyViewer })));

export const HealthRoutes = [
  <Route key="hygiene" path="hygiene" element={<Hygiene />} />,
  <Route key="medicine" path="medicine" element={<Medicine />} />,
  <Route key="ergonomics" path="ergonomics" element={<Ergonomics />} />,
  <Route key="psychosocial" path="psychosocial" element={<Psychosocial />} />,
  <Route key="bio-analysis" path="bio-analysis" element={<BioAnalysis />} />,
  <Route key="human-body" path="human-body" element={<HumanBodyViewer />} />,
];
