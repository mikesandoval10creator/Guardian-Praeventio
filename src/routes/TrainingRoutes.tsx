import { lazy } from 'react';
import { Route } from 'react-router-dom';

const Training = lazy(() => import('../pages/Training').then(module => ({ default: module.Training })));
const Gamification = lazy(() => import('../pages/Gamification').then(module => ({ default: module.Gamification })));
const ArcadeGames = lazy(() => import('../pages/ArcadeGames').then(module => ({ default: module.ArcadeGames })));
const PortableCurriculum = lazy(() => import('../pages/PortableCurriculum').then(module => ({ default: module.PortableCurriculum })));

export const TrainingRoutes = [
  <Route key="training" path="training" element={<Training />} />,
  <Route key="gamification" path="gamification" element={<Gamification />} />,
  <Route key="arcade-games" path="arcade-games" element={<ArcadeGames />} />,
  <Route key="curriculum" path="curriculum" element={<PortableCurriculum />} />,
];
