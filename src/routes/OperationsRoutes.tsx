import { lazy } from 'react';
import { Route } from 'react-router-dom';

const Projects = lazy(() => import('../pages/Projects').then(module => ({ default: module.Projects })));
const Documents = lazy(() => import('../pages/Documents').then(module => ({ default: module.Documents })));
const DocumentViewer = lazy(() => import('../pages/DocumentViewer').then(module => ({ default: module.DocumentViewer })));
const Calendar = lazy(() => import('../pages/Calendar').then(module => ({ default: module.Calendar })));
const Assets = lazy(() => import('../pages/Assets').then(module => ({ default: module.Assets })));
const SiteMap = lazy(() => import('../pages/SiteMap').then(module => ({ default: module.SiteMap })));
const Attendance = lazy(() => import('../pages/Attendance').then(module => ({ default: module.Attendance })));
// Mantenimiento Preventivo — mounts the orphan MaintenanceTaskList over the real
// listMaintenanceTasks endpoint (horómetro-threshold preventive tasks per equipo).
const MantenimientoPreventivo = lazy(() => import('../pages/MantenimientoPreventivo').then(module => ({ default: module.MantenimientoPreventivo })));
// Fase 5 D2 slice 1 (2026-06-11) — re-pathed from `safe-driving` to
// `driving-incidents` to resolve the route COLLISION with App.tsx, which
// mounts `SafeDrivingMode` (SOS driver mode — life-safety) at
// `safe-driving`. This route group is spread BEFORE the inline App route,
// so the duplicate path here shadowed SafeDrivingMode entirely. The
// SafeDriving page core is incident reporting + pre-drive checklist, so
// `driving-incidents` is the semantic home. Pinned by
// OperationsRoutes.test.tsx.
const SafeDriving = lazy(() => import('../pages/SafeDriving').then(module => ({ default: module.SafeDriving })));
const Telemetry = lazy(() => import('../pages/Telemetry').then(module => ({ default: module.Telemetry })));
const DocumentOCRManager = lazy(() => import('../pages/DocumentOCRManager').then(module => ({ default: module.DocumentOCRManager })));
const AutoCADViewer = lazy(() => import('../pages/AutoCADViewer').then(module => ({ default: module.AutoCADViewer })));
const BlueprintViewer = lazy(() => import('../pages/BlueprintViewer').then(module => ({ default: module.BlueprintViewer })));
const ERPIntegration = lazy(() => import('../pages/ERPIntegration').then(module => ({ default: module.ERPIntegration })));
const Workers = lazy(() => import('../pages/Workers').then(module => ({ default: module.Workers })));
const CriticalRolesPage = lazy(() => import('../pages/CriticalRolesPage').then(module => ({ default: module.CriticalRolesPage })));
const DigitalTwinFaena = lazy(() => import('../pages/DigitalTwinFaena').then(module => ({ default: module.DigitalTwinFaena })));
const DigitalTwinAR = lazy(() => import('../pages/DigitalTwinAR').then(module => ({ default: module.DigitalTwinAR })));
// Sprint G follow-up — admin-only dev tool para regenerar embeddings
// de afiches usando la MISMA MediaPipe que el ARPosterScanner runtime.
// Gated por PremiumFeatureGuard dentro del componente.
const DevPosterSeeder = lazy(() => import('../pages/DevPosterSeeder').then(module => ({ default: module.DevPosterSeeder })));
// Sprint mobile FGS — Lone worker landing page. Wires the native Android
// Foreground Service to keep the check-in alive when the WebView is
// backgrounded; no-op on web/iOS.
const LoneWorker = lazy(() => import('../pages/LoneWorker').then(module => ({ default: module.LoneWorker })));
const RestrictedZonesEditor = lazy(() => import('../pages/RestrictedZonesEditor').then(module => ({ default: module.RestrictedZonesEditor })));
// OLA 1 (VIDA visible) — worker-facing restricted-zones surface: map overlay
// + informed-entry gate (both orphan components, now mounted). Counterpart to
// the admin editor above.
const ZoneEntryView = lazy(() => import('../pages/ZoneEntryView').then(module => ({ default: module.ZoneEntryView })));
// §201-210 — Agenda con Bloques de Foco. Tiempo protegido (inspección,
// capacitación, auditoría, admin) que el prevencionista reserva para no
// ser interrumpido. Core wave: vista semanal + form de creación; las
// futuras añaden recurrencia y drag-resize.
const FocusAgenda = lazy(() => import('../pages/FocusAgenda').then(module => ({ default: module.FocusAgenda })));
// Sprint K wire UI (2026-05-23) — Bitácora de obra DS 76 + Cambio de turno.
// Servicios siteBookService.ts + shiftHandoverService.ts + cards existían
// sin page consumidor.
const SiteBook = lazy(() => import('../pages/SiteBook').then(module => ({ default: module.SiteBook })));
const ShiftHandover = lazy(() => import('../pages/ShiftHandover').then(module => ({ default: module.ShiftHandover })));
// Fase 5 B8 — LOTO Digital (Lock-Out/Tag-Out). Engine + adapter + write
// endpoints (loto.ts) + LotoStatusPanel existían sin page consumidor.
const Loto = lazy(() => import('../pages/Loto').then(module => ({ default: module.Loto })));
// Bloque D Rama 2 — wire the orphan deduplication surface. The server router
// (src/server/routes/deduplication.ts) + client hook
// (src/hooks/useDeduplication.ts) existed with no page/route;
// DeduplicationPage closes the gap (duplicate detection + merge planning).
const DeduplicationPage = lazy(() => import('../pages/DeduplicationPage').then(module => ({ default: module.DeduplicationPage })));
// Wire UI #80 — CargoCogPanel orphan → page + route. Superficie de
// estiba/cargo que monta el componente con el servicio stowageOptimizer
// (packCargoFFD + COG + utilization). Datos reales, no mocks.
const CargoCogPage = lazy(() => import('../pages/CargoCogPage').then(module => ({ default: module.CargoCogPage })));

export const OperationsRoutes = [
  <Route key="projects" path="projects" element={<Projects />} />,
  <Route key="documents" path="documents" element={<Documents />} />,
  <Route key="documents-viewer" path="documents/:id" element={<DocumentViewer />} />,
  <Route key="calendar" path="calendar" element={<Calendar />} />,
  <Route key="assets" path="assets" element={<Assets />} />,
  <Route key="site-map" path="site-map" element={<SiteMap />} />,
  <Route key="attendance" path="attendance" element={<Attendance />} />,
  <Route key="driving-incidents" path="driving-incidents" element={<SafeDriving />} />,
  <Route key="telemetry" path="telemetry" element={<Telemetry />} />,
  <Route key="document-ocr" path="document-ocr" element={<DocumentOCRManager />} />,
  <Route key="autocad" path="autocad" element={<AutoCADViewer />} />,
  <Route key="blueprint-viewer" path="blueprint-viewer" element={<BlueprintViewer />} />,
  <Route key="erp-integration" path="erp-integration" element={<ERPIntegration />} />,
  <Route key="workers" path="workers" element={<Workers />} />,
  <Route key="critical-roles" path="critical-roles" element={<CriticalRolesPage />} />,
  <Route key="digital-twin" path="digital-twin" element={<DigitalTwinFaena />} />,
  <Route key="digital-twin-ar" path="digital-twin/ar" element={<DigitalTwinAR />} />,
  <Route key="dev-poster-seeder" path="dev/poster-seeder" element={<DevPosterSeeder />} />,
  // Worker-facing check-in surface (big-button + Android FGS). Distinct path
  // from the supervisor monitor at /lone-worker (EmergencyRoutes), which used
  // to SHADOW this route — both declared `lone-worker`, first-match won, so
  // this worker page was unreachable. Split to /lone-worker/check-in.
  <Route key="lone-worker-checkin" path="lone-worker/check-in" element={<LoneWorker />} />,
  // OLA 1 — admin/supervisor define restricted zones (map-draw) that drive the
  // geofence→SOS escalation. Server enforces the write role.
  <Route key="restricted-zones" path="restricted-zones" element={<RestrictedZonesEditor />} />,
  <Route key="zone-entry" path="zone-entry" element={<ZoneEntryView />} />,
  <Route key="focus-agenda" path="focus-agenda" element={<FocusAgenda />} />,
  <Route key="site-book" path="site-book" element={<SiteBook />} />,
  <Route key="shift-handover" path="shift-handover" element={<ShiftHandover />} />,
  <Route key="loto" path="loto" element={<Loto />} />,
  <Route key="mantenimiento-preventivo" path="mantenimiento-preventivo" element={<MantenimientoPreventivo />} />,
  <Route key="deduplication" path="deduplication" element={<DeduplicationPage />} />,
  <Route key="cargo-cog" path="cargo-cog" element={<CargoCogPage />} />,
];
