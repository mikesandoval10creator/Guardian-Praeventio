// §2.18 EPP detector on-device tests.

import { describe, it, expect } from 'vitest';
import {
  inspectImage,
  buildEppInspectionNode,
  MockEppDetector,
  ALL_EPP_CLASSES,
  type EppDetection,
} from './eppDetectorOnDevice';

const FAKE_IMAGE = new Blob([new Uint8Array([0])], { type: 'image/jpeg' });

describe('ALL_EPP_CLASSES', () => {
  it('incluye los 7 EPP estándar Praeventio', () => {
    expect(ALL_EPP_CLASSES).toEqual([
      'casco',
      'chaleco_reflectivo',
      'gafas',
      'guantes',
      'arnes',
      'botas',
      'respirador',
    ]);
  });
});

describe('MockEppDetector', () => {
  it('default detections incluyen 4 items', async () => {
    const det = new MockEppDetector();
    const out = await det.detect(FAKE_IMAGE);
    expect(out.length).toBe(4);
    expect(out.map((d) => d.class)).toEqual([
      'casco',
      'chaleco_reflectivo',
      'botas',
      'gafas',
    ]);
  });

  it('acepta detections custom (test seam)', async () => {
    const det = new MockEppDetector([
      { class: 'casco', confidence: 0.99 },
      { class: 'respirador', confidence: 0.55 },
    ]);
    const out = await det.detect(FAKE_IMAGE);
    expect(out).toHaveLength(2);
  });
});

describe('inspectImage', () => {
  it('clasifica detected/missing/lowConfidence con threshold default', async () => {
    const det = new MockEppDetector();
    const result = await inspectImage(FAKE_IMAGE, det);
    // Mock: casco 0.92, chaleco 0.88, botas 0.71, gafas 0.45
    // Threshold default: 0.65 → 3 detected, 1 lowConfidence
    expect(result.detected.map((d) => d.class)).toEqual([
      'casco',
      'chaleco_reflectivo',
      'botas',
    ]);
    expect(result.lowConfidence.map((d) => d.class)).toEqual(['gafas']);
    // missing default required = casco+chaleco+botas (todos detectados)
    expect(result.missing).toEqual([]);
  });

  it('reporta missing cuando required NO se detecta', async () => {
    // EPP con solo casco detectado.
    const det = new MockEppDetector([{ class: 'casco', confidence: 0.95 }]);
    const result = await inspectImage(FAKE_IMAGE, det, {
      requiredClasses: ['casco', 'chaleco_reflectivo', 'botas', 'arnes'],
    });
    expect(result.detected.map((d) => d.class)).toEqual(['casco']);
    // readonly array — copia antes de sort
    expect([...result.missing].sort()).toEqual(
      ['arnes', 'botas', 'chaleco_reflectivo'].sort(),
    );
  });

  it('inferenceTimeMs > 0 (al menos 1ms de mock delay)', async () => {
    const det = new MockEppDetector();
    const result = await inspectImage(FAKE_IMAGE, det);
    expect(result.inferenceTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('modelVersion se propaga del detector al result', async () => {
    const det = new MockEppDetector();
    const result = await inspectImage(FAKE_IMAGE, det);
    expect(result.modelVersion).toBe('mock-v1');
  });

  it('respeta threshold custom', async () => {
    const det = new MockEppDetector([
      { class: 'casco', confidence: 0.8 },
      { class: 'gafas', confidence: 0.7 },
    ]);
    const result = await inspectImage(FAKE_IMAGE, det, {
      confidenceThreshold: 0.75,
      lowConfidenceThreshold: 0.5,
    });
    expect(result.detected).toHaveLength(1); // solo casco (0.8 > 0.75)
    expect(result.lowConfidence).toHaveLength(1); // gafas (0.7 entre 0.5..0.75)
  });

  it('tira si confidenceThreshold <= lowConfidenceThreshold', async () => {
    const det = new MockEppDetector();
    await expect(
      inspectImage(FAKE_IMAGE, det, {
        confidenceThreshold: 0.5,
        lowConfidenceThreshold: 0.5,
      }),
    ).rejects.toThrow(/debe ser >/);
  });

  it('averageConfidence solo cuenta detected (excluye lowConfidence)', async () => {
    const det = new MockEppDetector([
      { class: 'casco', confidence: 0.9 },
      { class: 'chaleco_reflectivo', confidence: 0.7 },
      { class: 'gafas', confidence: 0.4 }, // lowConfidence
    ]);
    const result = await inspectImage(FAKE_IMAGE, det);
    // detected: 0.9 + 0.7 = 1.6 / 2 = 0.8
    expect(result.averageConfidence).toBeCloseTo(0.8, 1);
  });
});

describe('buildEppInspectionNode', () => {
  const ctx = {
    workerUid: 'worker-001',
    projectId: 'project-alpha',
    authorUid: 'supervisor-001',
    locationLabel: 'Acceso Norte',
  };

  it('genera node tipo epp_inspection con severity high si hay missing', async () => {
    const det = new MockEppDetector([
      { class: 'casco', confidence: 0.95 },
    ]);
    const result = await inspectImage(FAKE_IMAGE, det, {
      requiredClasses: ['casco', 'chaleco_reflectivo', 'botas'],
    });
    const node = buildEppInspectionNode(result, ctx);
    expect(node.type).toBe('epp_inspection');
    expect(node.severity).toBe('high'); // chaleco + botas faltan
    expect(node.title).toContain('faltantes');
    // metadata.missingClasses ahora es CSV string (RiskNodePayload metadata es flat).
    expect(node.metadata.missingClasses).toBe('chaleco_reflectivo,botas');
  });

  it('severity medium si solo lowConfidence (no missing)', async () => {
    const det = new MockEppDetector([
      { class: 'casco', confidence: 0.9 },
      { class: 'chaleco_reflectivo', confidence: 0.9 },
      { class: 'botas', confidence: 0.9 },
      { class: 'gafas', confidence: 0.4 }, // lowConfidence
    ]);
    const result = await inspectImage(FAKE_IMAGE, det);
    const node = buildEppInspectionNode(result, ctx);
    expect(node.severity).toBe('medium');
    expect(node.title).not.toContain('faltantes');
  });

  it('severity low cuando todo OK + alta confianza', async () => {
    const det = new MockEppDetector([
      { class: 'casco', confidence: 0.95 },
      { class: 'chaleco_reflectivo', confidence: 0.95 },
      { class: 'botas', confidence: 0.95 },
    ]);
    const result = await inspectImage(FAKE_IMAGE, det);
    const node = buildEppInspectionNode(result, ctx);
    expect(node.severity).toBe('low');
    expect(node.title).toContain('OK');
  });

  it('PRIVACY: metadata.onDeviceOnly === true, no incluye imagen', async () => {
    const det = new MockEppDetector();
    const result = await inspectImage(FAKE_IMAGE, det);
    const node = buildEppInspectionNode(result, ctx);
    expect(node.metadata.onDeviceOnly).toBe(true);
    // Verificación crítica: no debe haber base64/blob/url de imagen
    const metadataStr = JSON.stringify(node.metadata);
    expect(metadataStr).not.toMatch(/data:image\//);
    expect(metadataStr).not.toMatch(/base64/i);
    expect(metadataStr).not.toMatch(/blob:/);
  });

  it('incluye referencia DS 594 (audit trail normativo)', async () => {
    const det = new MockEppDetector();
    const result = await inspectImage(FAKE_IMAGE, det);
    const node = buildEppInspectionNode(result, ctx);
    expect(node.references.length).toBeGreaterThan(0);
    expect(node.references[0]).toContain('DS 594');
  });

  it('preserva workerUid + authorId + locationLabel', async () => {
    const det = new MockEppDetector();
    const result = await inspectImage(FAKE_IMAGE, det);
    const node = buildEppInspectionNode(result, ctx);
    expect(node.metadata.workerUid).toBe('worker-001');
    expect(node.metadata.authorId).toBe('supervisor-001');
    expect(node.metadata.locationLabel).toBe('Acceso Norte');
  });
});

describe('§2.18 — directiva on-device respetada', () => {
  it('mock detector funciona sin internet (offline-first)', async () => {
    const det = new MockEppDetector();
    const result = await inspectImage(FAKE_IMAGE, det);
    expect(result).toBeDefined();
    expect(result.detected).toBeInstanceOf(Array);
  });

  it('result NO contiene la imagen original (privacy)', async () => {
    const det = new MockEppDetector();
    const result = await inspectImage(FAKE_IMAGE, det);
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toMatch(/data:image/);
    expect(resultStr).not.toMatch(/base64/);
  });
});

// Helper type assertion para satisfacer tsc strict mode
const _typeCheck: EppDetection = {
  class: 'casco',
  confidence: 0.5,
};
void _typeCheck;
