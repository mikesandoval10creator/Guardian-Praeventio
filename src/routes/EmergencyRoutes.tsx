import { lazy } from 'react';
import { Route } from 'react-router-dom';

const Emergency = lazy(() => import('../pages/Emergency').then(module => ({ default: module.Emergency })));
const EmergencyGenerator = lazy(() => import('../pages/EmergencyGenerator').then(module => ({ default: module.EmergencyGenerator })));
const Evacuation = lazy(() => import('../pages/Evacuation').then(module => ({ default: module.Evacuation })));
const DEAZones = lazy(() => import('../pages/DEAZones').then(module => ({ default: module.DEAZones })));
const InhospitableGuide = lazy(() => import('../pages/InhospitableGuide').then(module => ({ default: module.InhospitableGuide })));
const VolcanicEruptionMap = lazy(() => import('../pages/VolcanicEruptionMap').then(module => ({ default: module.VolcanicEruptionMap })));
const HazmatMap = lazy(() => import('../pages/HazmatMap').then(module => ({ default: module.HazmatMap })));
const HazmatStorage = lazy(() => import('../pages/HazmatStorage').then(module => ({ default: module.HazmatStorage })));
const MountainRefuges = lazy(() => import('../pages/MountainRefuges').then(module => ({ default: module.MountainRefuges })));
const NationalParksEmergency = lazy(() => import('../pages/NationalParksEmergency').then(module => ({ default: module.NationalParksEmergency })));
const CoastalEmergencyMap = lazy(() => import('../pages/CoastalEmergencyMap').then(module => ({ default: module.CoastalEmergencyMap })));
const EmergenciaAvanzada = lazy(() => import('../pages/EmergenciaAvanzada').then(module => ({ default: module.EmergenciaAvanzada })));
const EvacuationRoutes = lazy(() => import('../pages/EvacuationRoutes').then(module => ({ default: module.EvacuationRoutes })));
const ClimateRoutes = lazy(() => import('../pages/ClimateRoutes').then(module => ({ default: module.ClimateRoutes })));

export const EmergencyRoutes = [
  <Route key="emergency" path="emergency" element={<Emergency />} />,
  <Route key="emergency-generator" path="emergency-generator" element={<EmergencyGenerator />} />,
  <Route key="evacuation" path="evacuation" element={<Evacuation />} />,
  <Route key="dea-zones" path="dea-zones" element={<DEAZones />} />,
  <Route key="inhospitable-guide" path="inhospitable-guide" element={<InhospitableGuide />} />,
  <Route key="volcanic-eruption" path="volcanic-eruption" element={<VolcanicEruptionMap />} />,
  <Route key="hazmat-map" path="hazmat-map" element={<HazmatMap />} />,
  <Route key="hazmat-storage" path="hazmat-storage" element={<HazmatStorage />} />,
  <Route key="mountain-refuges" path="mountain-refuges" element={<MountainRefuges />} />,
  <Route key="national-parks" path="national-parks" element={<NationalParksEmergency />} />,
  <Route key="coastal-emergency" path="coastal-emergency" element={<CoastalEmergencyMap />} />,
  <Route key="emergencia-avanzada" path="emergencia-avanzada" element={<EmergenciaAvanzada />} />,
  <Route key="evacuation-routes" path="evacuation-routes" element={<EvacuationRoutes />} />,
  <Route key="climate-routes" path="climate-routes" element={<ClimateRoutes />} />,
];
