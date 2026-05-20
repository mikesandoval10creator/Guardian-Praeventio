// SPDX-License-Identifier: MIT
// Static catalog for the ASSETS & FAENA family (84 nodes — 80 original
// + 4 added by Bloque 4.1 Horometro -> Maintenance Preventive flow).

import type { FamilyNodeSpec } from './climateNodeRegistry';

const ROW = (id: string, description: string, source: string, producer = 'src/pages/Equipment.tsx', consumers: readonly string[] = ['src/pages/RiskNetwork.tsx']): FamilyNodeSpec => ({
  id, description, producerHint: producer, consumerHints: consumers, source,
});

const SENSOR = (id: string, description: string, source: string): FamilyNodeSpec =>
  ROW(id, description, source, 'src/services/sensorIngest.ts', ['src/services/zettelkasten/climateRiskCoupling.ts', 'src/pages/RiskNetwork.tsx']);

const SITE = (id: string, description: string, source: string): FamilyNodeSpec =>
  ROW(id, description, source, 'src/pages/Sites.tsx', ['src/pages/EmergenciaAvanzada.tsx', 'src/pages/RiskNetwork.tsx']);

export const ASSETS_FAENA_NODES: ReadonlyArray<FamilyNodeSpec> = [
  // gruas (4)
  ROW('asset-grua-torre', 'Grua torre de obra.', 'NCh-432'),
  ROW('asset-grua-movil', 'Grua movil sobre camion.', 'ASME-B30'),
  ROW('asset-grua-pluma', 'Grua pluma articulada.', 'ASME-B30'),
  ROW('asset-grua-puente', 'Grua puente en nave industrial.', 'ASME-B30'),
  // andamios (3)
  ROW('asset-andamio-tubular', 'Andamio tubular de fachada.', 'OSHA-1926-451'),
  ROW('asset-andamio-colgante', 'Andamio colgante motorizado.', 'OSHA-1926-451'),
  ROW('asset-andamio-multidireccional', 'Andamio multidireccional sistema.', 'OSHA-1926-451'),
  // plataformas (3)
  ROW('asset-plataforma-elevadora', 'Plataforma elevadora movil.', 'EN-280'),
  ROW('asset-tijera', 'Plataforma de tijera.', 'EN-280'),
  ROW('asset-brazo-articulado', 'Brazo articulado tipo boom-lift.', 'EN-280'),
  // PCI (4)
  ROW('asset-hidrante', 'Hidrante de red contra incendio.', 'NCh-1646'),
  ROW('asset-bie', 'BIE — Boca de incendio equipada.', 'NCh-1646'),
  ROW('asset-rociador', 'Rociador automatico (sprinkler).', 'NFPA-13'),
  ROW('asset-extintor', 'Extintor portatil.', 'NCh-1430'),
  // tanques (3)
  ROW('asset-tanque-hazmat', 'Tanque de almacenamiento hazmat.', 'DS-43'),
  ROW('asset-tanque-combustible', 'Tanque de combustible.', 'NFPA-30'),
  ROW('asset-tanque-glp', 'Tanque de GLP.', 'NFPA-58'),
  // cilindros (2)
  ROW('asset-cilindro-gas', 'Cilindro de gas industrial.', 'NCh-1377'),
  ROW('asset-bombona-soldadura', 'Bombona de gas para soldadura.', 'AWS-D1.1'),
  // tuberias y ductos (3)
  ROW('asset-tuberia-proceso', 'Tuberia de proceso industrial.', 'ASME-B31.3'),
  ROW('asset-tuberia-incendio', 'Tuberia de red contra incendio.', 'NFPA-14'),
  ROW('asset-ducto-ventilacion', 'Ducto de ventilacion mecanica.', 'DS-594'),
  // bombas/compresores/generadores (3)
  ROW('asset-bomba-centrifuga', 'Bomba centrifuga de proceso.', 'API-610'),
  ROW('asset-compresor-aire', 'Compresor de aire industrial.', 'ASME-PTC-10'),
  ROW('asset-generador', 'Generador electrico de respaldo.', 'NFPA-110'),
  // tableros electricos (3)
  ROW('asset-tablero-electrico-bt', 'Tablero electrico baja tension.', 'NCh-Elec-4'),
  ROW('asset-tablero-electrico-mt', 'Tablero electrico media tension.', 'NCh-Elec-4'),
  ROW('asset-tablero-electrico-at', 'Tablero electrico alta tension.', 'NCh-Elec-4'),
  // transformacion (3)
  ROW('asset-transformador', 'Transformador de potencia.', 'IEC-60076'),
  ROW('asset-ups', 'UPS — Sistema de alimentacion ininterrumpida.', 'IEC-62040'),
  ROW('asset-banco-baterias', 'Banco de baterias estacionario.', 'IEC-62619'),
  // camiones (3)
  ROW('asset-camion-tolva', 'Camion tolva.', 'DS-132'),
  ROW('asset-camion-cisterna', 'Camion cisterna.', 'DS-43'),
  ROW('asset-camion-pluma', 'Camion pluma.', 'ASME-B30'),
  // movimiento de tierra (3)
  ROW('asset-cargador-frontal', 'Cargador frontal.', 'DS-132'),
  ROW('asset-bulldozer', 'Bulldozer.', 'DS-132'),
  ROW('asset-excavadora', 'Excavadora hidraulica.', 'DS-132'),
  // mineria (3)
  ROW('asset-perforadora', 'Perforadora.', 'DS-132'),
  ROW('asset-jumbo', 'Jumbo de perforacion subterranea.', 'DS-132'),
  ROW('asset-lhd', 'LHD — Cargador subterraneo.', 'DS-132'),
  // soldadura (3)
  ROW('asset-soldadora-arc', 'Maquina de soldar al arco.', 'AWS-D1.1'),
  ROW('asset-soldadora-mig', 'Maquina de soldar MIG/MAG.', 'AWS-D1.1'),
  ROW('asset-soldadora-tig', 'Maquina de soldar TIG.', 'AWS-D1.1'),
  // herramientas (3)
  ROW('asset-radial', 'Esmeril angular (radial).', 'EN-60745'),
  ROW('asset-taladro-percutor', 'Taladro percutor.', 'EN-60745'),
  ROW('asset-sierra-circular', 'Sierra circular.', 'EN-60745'),
  // sensores IoT (16)
  SENSOR('sensor-iot-co', 'Sensor IoT de monoxido de carbono.', 'DS-594'),
  SENSOR('sensor-iot-co2', 'Sensor IoT de dioxido de carbono.', 'DS-594'),
  SENSOR('sensor-iot-h2s', 'Sensor IoT de acido sulfhidrico.', 'DS-594'),
  SENSOR('sensor-iot-o2', 'Sensor IoT de oxigeno.', 'DS-594'),
  SENSOR('sensor-iot-lel', 'Sensor IoT de LEL (limite explosivo inferior).', 'OSHA-1910-146'),
  SENSOR('sensor-iot-pm25', 'Sensor IoT de PM2.5.', 'DS-594'),
  SENSOR('sensor-iot-pm10', 'Sensor IoT de PM10.', 'DS-594'),
  SENSOR('sensor-iot-noise', 'Sensor IoT de ruido.', 'DS-594'),
  SENSOR('sensor-iot-vibration', 'Sensor IoT de vibracion.', 'DS-594'),
  SENSOR('sensor-iot-temperatura', 'Sensor IoT de temperatura ambiente.', 'DS-594'),
  SENSOR('sensor-iot-humedad', 'Sensor IoT de humedad relativa.', 'DS-594'),
  SENSOR('sensor-iot-presion', 'Sensor IoT de presion (proceso o linea).', 'ASME-B31.3'),
  SENSOR('sensor-iot-flujo', 'Sensor IoT de flujo (caudal).', 'NFPA-14'),
  SENSOR('sensor-iot-piezometro', 'Sensor IoT piezometro en talud o dique.', 'DS-248'),
  SENSOR('sensor-iot-uv', 'Sensor IoT de radiacion UV.', 'DS-594'),
  SENSOR('sensor-iot-radiacion', 'Sensor IoT de radiacion ionizante.', 'DS-3'),
  // beacons (2)
  ROW('beacon-ble-mandown', 'Beacon BLE para deteccion man-down.', 'internal'),
  ROW('beacon-ble-geofence', 'Beacon BLE para geofencing.', 'internal'),
  // horometro & mantenimiento preventivo (Bloque 4.1) — 4 specs.
  // Flow: equipmentQrService.scan -> horometroService.recordReading ->
  //       horometroMaintenanceFlow.onHorometroReading produces these nodes
  //       in chain. Each node references the previous via `references`
  //       and the chain is materialized as a sequence of edges in the
  //       zk graph (writeNodes batches + edges.ts createEdge).
  ROW(
    'horometro-reading',
    'Lectura puntual del horometro de un equipo, reportada via QR + entry.',
    'internal',
    'src/services/horometro/horometroService.ts',
    ['src/services/zettelkasten/flows/horometroMaintenanceFlow.ts', 'src/components/horometro/HorometroEntryForm.tsx'],
  ),
  ROW(
    'maintenance-threshold-reached',
    'Umbral de mantenimiento alcanzado (250h / 500h / 1000h segun tipo).',
    'internal',
    'src/services/horometro/horometroService.ts',
    ['src/services/zettelkasten/flows/horometroMaintenanceFlow.ts', 'src/components/horometro/MaintenanceTaskList.tsx'],
  ),
  ROW(
    'maintenance-task-created',
    'Tarea de mantencion preventiva creada automaticamente desde umbral.',
    'internal',
    'src/services/maintenance/maintenanceScheduler.ts',
    ['src/components/horometro/MaintenanceTaskList.tsx', 'src/pages/RiskNetwork.tsx'],
  ),
  ROW(
    'maintenance-task-completed',
    'Tarea de mantencion preventiva completada con firma biometrica.',
    'internal',
    'src/services/maintenance/maintenanceScheduler.ts',
    ['src/components/horometro/MaintenanceCompleteForm.tsx', 'src/pages/RiskNetwork.tsx'],
  ),
  // EPP Inspection -> Inventario -> Orden de Compra (Bloque 4.2) — 5 specs.
  // Flow: EppInspectionForm.tsx -> useEppFlow.submitEppInspection ->
  //       routes/eppFlow.ts -> eppInventoryPurchaseFlow.onEppInspectionCompleted.
  // Cada nodo se materializa con writeNodes y se enlaza con createEdge en
  // zettelkasten_edges. NUNCA empuja al proveedor (directiva no-push).
  ROW(
    'inventory-adjusted',
    'Inventario de EPP ajustado por baja de item failed (descuenta stock).',
    'internal',
    'src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts',
    ['src/components/eppFlow/PendingPurchaseOrdersPanel.tsx', 'src/pages/RiskNetwork.tsx'],
  ),
  ROW(
    'inventory-below-threshold',
    'Stock de EPP cayo por debajo del umbral de reorden — sugerir OC.',
    'internal',
    'src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts',
    ['src/components/eppFlow/PendingPurchaseOrdersPanel.tsx', 'src/pages/RiskNetwork.tsx'],
  ),
  ROW(
    'purchase-order-suggested',
    'Orden de compra sugerida automaticamente, pendiente de firma admin.',
    'internal',
    'src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts',
    ['src/components/eppFlow/PurchaseOrderSignModal.tsx', 'src/pages/RiskNetwork.tsx'],
  ),
  ROW(
    'purchase-order-signed',
    'Orden de compra firmada por admin (WebAuthn claim-signing, Ley 19.799).',
    'Ley-19799',
    'src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts',
    ['src/components/eppFlow/PurchaseOrderSignModal.tsx', 'src/pages/RiskNetwork.tsx'],
  ),
  ROW(
    'purchase-order-pdf-generated',
    'PDF de OC generado para descarga — NO se envia al proveedor (directiva no-push).',
    'internal',
    'src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts',
    ['src/components/eppFlow/PurchaseOrderSignModal.tsx', 'src/pages/RiskNetwork.tsx'],
  ),
  // sites (16)
  SITE('site-faena', 'Faena: contenedor topologico raiz.', 'DS-76'),
  SITE('site-zona', 'Zona dentro de una faena.', 'DS-76'),
  SITE('site-frente-trabajo', 'Frente de trabajo activo.', 'DS-594'),
  SITE('site-acceso', 'Punto de acceso o portal de la faena.', 'DS-594'),
  SITE('site-bodega', 'Bodega de almacenamiento.', 'DS-43'),
  SITE('site-comedor', 'Comedor del personal.', 'DS-594'),
  SITE('site-banos', 'Servicios higienicos.', 'DS-594'),
  SITE('site-enfermeria', 'Enfermeria o policlinico de faena.', 'DS-594'),
  SITE('site-sala-mando', 'Sala de mando o control.', 'DS-594'),
  SITE('site-helipuerto', 'Helipuerto para evacuacion aeromedica.', 'internal'),
  SITE('site-punto-encuentro', 'Punto de encuentro de evacuacion.', 'DS-594'),
  SITE('site-via-evacuacion', 'Via de evacuacion senalizada.', 'DS-594'),
  SITE('site-zona-segura', 'Zona segura de evacuacion.', 'DS-594'),
  SITE('site-zona-restringida', 'Zona restringida (acceso controlado).', 'DS-132'),
  SITE('site-zona-explosion-atex', 'Zona ATEX (atmosferas explosivas).', 'IEC-60079'),
  SITE('site-zona-confinada-declarada', 'Zona declarada como espacio confinado.', 'OSHA-1910-146'),
];
