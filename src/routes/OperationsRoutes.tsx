import { lazy } from 'react';
import { Route } from 'react-router-dom';

const Projects = lazy(() => import('../pages/Projects').then(module => ({ default: module.Projects })));
const Documents = lazy(() => import('../pages/Documents').then(module => ({ default: module.Documents })));
const DocumentViewer = lazy(() => import('../pages/DocumentViewer').then(module => ({ default: module.DocumentViewer })));
const Calendar = lazy(() => import('../pages/Calendar').then(module => ({ default: module.Calendar })));
const Assets = lazy(() => import('../pages/Assets').then(module => ({ default: module.Assets })));
const SiteMap = lazy(() => import('../pages/SiteMap').then(module => ({ default: module.SiteMap })));
const Attendance = lazy(() => import('../pages/Attendance').then(module => ({ default: module.Attendance })));
const SafeDriving = lazy(() => import('../pages/SafeDriving').then(module => ({ default: module.SafeDriving })));
const Telemetry = lazy(() => import('../pages/Telemetry').then(module => ({ default: module.Telemetry })));
const DocumentOCRManager = lazy(() => import('../pages/DocumentOCRManager').then(module => ({ default: module.DocumentOCRManager })));
const AutoCADViewer = lazy(() => import('../pages/AutoCADViewer').then(module => ({ default: module.AutoCADViewer })));
const BlueprintViewer = lazy(() => import('../pages/BlueprintViewer').then(module => ({ default: module.BlueprintViewer })));
const ERPIntegration = lazy(() => import('../pages/ERPIntegration').then(module => ({ default: module.ERPIntegration })));
const Workers = lazy(() => import('../pages/Workers').then(module => ({ default: module.Workers })));

export const OperationsRoutes = [
  <Route key="projects" path="projects" element={<Projects />} />,
  <Route key="documents" path="documents" element={<Documents />} />,
  <Route key="documents-viewer" path="documents/:id" element={<DocumentViewer />} />,
  <Route key="calendar" path="calendar" element={<Calendar />} />,
  <Route key="assets" path="assets" element={<Assets />} />,
  <Route key="site-map" path="site-map" element={<SiteMap />} />,
  <Route key="attendance" path="attendance" element={<Attendance />} />,
  <Route key="safe-driving" path="safe-driving" element={<SafeDriving />} />,
  <Route key="telemetry" path="telemetry" element={<Telemetry />} />,
  <Route key="document-ocr" path="document-ocr" element={<DocumentOCRManager />} />,
  <Route key="autocad" path="autocad" element={<AutoCADViewer />} />,
  <Route key="blueprint-viewer" path="blueprint-viewer" element={<BlueprintViewer />} />,
  <Route key="erp-integration" path="erp-integration" element={<ERPIntegration />} />,
  <Route key="workers" path="workers" element={<Workers />} />,
];
