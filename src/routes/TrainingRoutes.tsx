import { lazy } from 'react';
import { Route } from 'react-router-dom';

const Training = lazy(() => import('../pages/Training').then(module => ({ default: module.Training })));
const Gamification = lazy(() => import('../pages/Gamification').then(module => ({ default: module.Gamification })));
const ArcadeGames = lazy(() => import('../pages/ArcadeGames').then(module => ({ default: module.ArcadeGames })));
const ClawMachine = lazy(() => import('../pages/ClawMachine').then(module => ({ default: module.ClawMachine })));
const PoolGame = lazy(() => import('../pages/PoolGame').then(module => ({ default: module.PoolGame })));
const PortableCurriculum = lazy(() => import('../pages/PortableCurriculum').then(module => ({ default: module.PortableCurriculum })));

export const TrainingRoutes = [
  <Route key="training" path="training" element={<Training />} />,
  <Route key="gamification" path="gamification" element={<Gamification />} />,
  <Route key="arcade-games" path="arcade-games" element={<ArcadeGames />} />,
  <Route key="clawmachine" path="clawmachine" element={<ClawMachine />} />,
  <Route key="poolgame" path="poolgame" element={<PoolGame />} />,
  <Route key="curriculum" path="curriculum" element={<PortableCurriculum />} />,
];
