// SPDX-License-Identifier: MIT
// Static catalog for the PERSONAL & EPP family (50 nodes).

import type { FamilyNodeSpec } from './climateNodeRegistry';

const ROW = (id: string, description: string, source: string, producer = 'src/pages/Workers.tsx', consumers: readonly string[] = ['src/pages/RiskNetwork.tsx']): FamilyNodeSpec => ({
  id, description, producerHint: producer, consumerHints: consumers, source,
});

export const PERSONAL_EPP_NODES: ReadonlyArray<FamilyNodeSpec> = [
  ROW('worker-profile', 'Perfil de trabajador con rol y faenas activas.', 'internal'),
  ROW('worker-medical-clearance', 'Aptitud medica vigente del trabajador.', 'DS-594', 'src/pages/BioAnalysis.tsx'),
  ROW('worker-altitude-clearance', 'Aptitud medica para faena sobre 3000m.', 'DS-28', 'src/pages/BioAnalysis.tsx'),
  ROW('worker-confined-space-clearance', 'Aptitud para entrada a espacio confinado.', 'OSHA-1910-146', 'src/pages/BioAnalysis.tsx'),
  ROW('worker-hot-work-permit', 'Permiso vigente para trabajos en caliente.', 'NFPA-51B', 'src/pages/Permits.tsx'),
  ROW('worker-hv-electrical-permit', 'Permiso para trabajos electricos en alta tension.', 'NCh-Elec-4', 'src/pages/Permits.tsx'),
  ROW('epp-helmet', 'Casco de seguridad asignado.', 'NCh-461'),
  ROW('epp-harness', 'Arnes de cuerpo entero para trabajo en altura.', 'OSHA-1926-451'),
  ROW('epp-respirator-half', 'Respirador media cara.', 'NIOSH-42-CFR-84'),
  ROW('epp-respirator-full', 'Respirador cara completa.', 'NIOSH-42-CFR-84'),
  ROW('epp-respirator-papr', 'Respirador motorizado purificador de aire.', 'NIOSH-42-CFR-84'),
  ROW('epp-eye-protection', 'Proteccion ocular (lentes/goggles/face shield).', 'ANSI-Z87.1'),
  ROW('epp-hearing-double', 'Doble proteccion auditiva (tapon + orejera).', 'DS-594'),
  ROW('epp-hearing-single', 'Proteccion auditiva simple.', 'DS-594'),
  ROW('epp-gloves-cut-A', 'Guantes anticorte nivel A (EN-388).', 'EN-388'),
  ROW('epp-gloves-chemical', 'Guantes para riesgo quimico (EN-374).', 'EN-374'),
  ROW('epp-boots-dielectric', 'Calzado de seguridad dielectrico.', 'NCh-Elec-4'),
  ROW('epp-boots-steel', 'Calzado de seguridad con punta de acero.', 'EN-12568'),
  ROW('epp-flame-retardant', 'Vestuario ignifugo (FR).', 'NFPA-2112'),
  ROW('epp-arc-flash', 'Traje contra arco electrico.', 'NFPA-70E'),
  ROW('epp-hi-vis', 'Vestuario de alta visibilidad.', 'EN-ISO-20471'),
  ROW('epp-fall-arrest', 'Sistema de detencion de caidas (linea de vida + arnes).', 'OSHA-1926-451'),
  ROW('cert-iperc', 'Certificacion IPERC del trabajador.', 'internal'),
  ROW('cert-altura', 'Certificacion de trabajo en altura.', 'DS-594'),
  ROW('cert-confinado', 'Certificacion de trabajo en espacio confinado.', 'OSHA-1910-146'),
  ROW('cert-rigger', 'Certificacion de rigger/aparejador.', 'ASME-B30'),
  ROW('cert-grua', 'Certificacion de operador de grua.', 'ASME-B30'),
  ROW('cert-soldador', 'Certificacion AWS/IIW de soldador.', 'AWS-D1.1'),
  ROW('exam-audiometria', 'Examen de audiometria ocupacional.', 'SUSESO', 'src/pages/BioAnalysis.tsx'),
  ROW('exam-espirometria', 'Examen de espirometria ocupacional.', 'SUSESO', 'src/pages/BioAnalysis.tsx'),
  ROW('exam-vista', 'Examen de visiometria.', 'SUSESO', 'src/pages/BioAnalysis.tsx'),
  ROW('exam-altura-geografica', 'Examen pre-ocupacional para altura geografica.', 'DS-28', 'src/pages/BioAnalysis.tsx'),
  ROW('exam-musculo-esqueletico', 'Examen musculoesqueletico (TMERT).', 'SUSESO', 'src/pages/BioAnalysis.tsx'),
  ROW('exam-psicosensometrico', 'Examen psicosensometrico.', 'SUSESO', 'src/pages/BioAnalysis.tsx'),
  ROW('training-induccion', 'Capacitacion de induccion hombre nuevo.', 'DS-40', 'src/pages/Training.tsx'),
  ROW('training-charla-5min', 'Charla diaria de seguridad de 5 minutos.', 'internal', 'src/pages/Training.tsx'),
  ROW('training-evacuacion', 'Capacitacion en plan de evacuacion.', 'DS-594', 'src/pages/Training.tsx'),
  ROW('fatigue-alert', 'Alerta de fatiga del trabajador.', 'SUSESO', 'src/services/zettelkasten/bernoulli/respiratorFatigue.ts'),
  ROW('biometric-anomaly', 'Anomalia biometrica (HR, SpO2, HRV).', 'internal', 'src/pages/BioAnalysis.tsx'),
  ROW('manual-handling-load', 'Carga de manipulacion manual sobre limite.', 'Ley-20949'),
  ROW('epp-exposure-pairing', 'Pareo entre EPP asignado y exposicion del trabajador.', 'DS-594'),
  ROW('epp-fit-test', 'Resultado de fit-test cualitativo/cuantitativo.', 'NIOSH-42-CFR-84'),
  ROW('epp-replacement-due', 'EPP cuya vida util ha vencido.', 'NIOSH-42-CFR-84'),
  ROW('epp-stockout-warning', 'Advertencia de quiebre de stock de EPP.', 'internal', 'src/pages/Inventory.tsx'),
  ROW('epp-non-compliance-detected', 'No conformidad detectada en uso de EPP (vision).', 'DS-594', 'src/services/visionAnalyzer.ts'),
  ROW('worker-vacation-window', 'Ventana de vacaciones del trabajador.', 'internal'),
  ROW('worker-shift-pattern', 'Patron de turnos del trabajador.', 'Ley-20949'),
  ROW('worker-overtime-alert', 'Alerta de sobretiempo sostenido.', 'Ley-20949'),
  ROW('subcontractor-credential', 'Credencial vigente de subcontratista.', 'DS-76'),
  ROW('visitor-induction', 'Induccion entregada a visitante en faena.', 'DS-40'),
  // EPP Inspection & Purchase Flow (Bloque 4.2) — 2 specs (epp side).
  // Flow: EppInspectionForm.tsx -> useEppFlow.submitEppInspection ->
  //       routes/eppFlow.ts POST /epp-flow/inspection ->
  //       eppInventoryPurchaseFlow.onEppInspectionCompleted produces this
  //       chain. Each node references the previous via `connections` and
  //       the edges are persisted in zettelkasten_edges via createEdge.
  ROW(
    'epp-inspection-event',
    'Inspeccion EPP completada por trabajador en faena (mobile-first).',
    'internal',
    'src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts',
    ['src/components/eppFlow/EppInspectionForm.tsx', 'src/pages/RiskNetwork.tsx'],
  ),
  ROW(
    'epp-item-failed',
    'EPP individual reportado como failed (vencido/danado/perdido/contaminado).',
    'NIOSH-42-CFR-84',
    'src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts',
    ['src/components/eppFlow/PendingPurchaseOrdersPanel.tsx', 'src/pages/RiskNetwork.tsx'],
  ),
];
