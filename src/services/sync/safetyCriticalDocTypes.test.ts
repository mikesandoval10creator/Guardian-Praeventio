// TODO.md §16.2.2 — safety-critical doc types: NEVER last-write-wins.
//
// These tests pin the canonical set of doc types whose offline-sync
// conflicts MUST be diverted to human resolution (conflict_queue), plus
// the NodeType → safety-doc-type mapping the matrixSyncManager uses to
// classify queued RiskNode operations.

import { describe, it, expect } from 'vitest';
import {
  SAFETY_CRITICAL_DOC_TYPES,
  safetyDocTypeForNodeType,
  RESOLVER_DOC_TYPE_BY_SAFETY_TYPE,
  type SafetyCriticalDocType,
} from './safetyCriticalDocTypes';
import { ALWAYS_REQUIRES_HUMAN_RESOLUTION, requiresHumanResolution } from './conflictResolver';
import { NodeType } from '../../types';

describe('SAFETY_CRITICAL_DOC_TYPES (§16.2.2)', () => {
  it('contains exactly the 5 safety-critical doc types', () => {
    expect(Array.from(SAFETY_CRITICAL_DOC_TYPES).sort()).toEqual([
      'emergency_alert',
      'incident_report',
      'inspection',
      'medical_record',
      'training_completion',
    ]);
    expect(SAFETY_CRITICAL_DOC_TYPES.size).toBe(5);
  });

  it('every safety doc type maps to a conflictResolver DocType that ALWAYS requires human resolution', () => {
    for (const docType of SAFETY_CRITICAL_DOC_TYPES) {
      const resolverType = RESOLVER_DOC_TYPE_BY_SAFETY_TYPE[docType as SafetyCriticalDocType];
      expect(resolverType, `missing resolver mapping for ${docType}`).toBeTruthy();
      expect(ALWAYS_REQUIRES_HUMAN_RESOLUTION).toContain(resolverType);
      expect(requiresHumanResolution(resolverType)).toBe(true);
    }
    // And the mapping covers the resolver list completely (no orphan).
    expect(Object.values(RESOLVER_DOC_TYPE_BY_SAFETY_TYPE).sort()).toEqual(
      [...ALWAYS_REQUIRES_HUMAN_RESOLUTION].sort(),
    );
  });
});

describe('safetyDocTypeForNodeType', () => {
  it('maps the safety-critical NodeType values to their doc types', () => {
    expect(safetyDocTypeForNodeType(NodeType.INSPECTION)).toBe('inspection');
    expect(safetyDocTypeForNodeType(NodeType.INCIDENT)).toBe('incident_report');
    expect(safetyDocTypeForNodeType(NodeType.EMERGENCY)).toBe('emergency_alert');
    expect(safetyDocTypeForNodeType(NodeType.MEDICINE)).toBe('medical_record');
    expect(safetyDocTypeForNodeType(NodeType.TRAINING)).toBe('training_completion');
  });

  it('returns null for non-critical node types (LWW path stays intact)', () => {
    expect(safetyDocTypeForNodeType(NodeType.FINDING)).toBeNull();
    expect(safetyDocTypeForNodeType(NodeType.WORKER)).toBeNull();
    expect(safetyDocTypeForNodeType(NodeType.TASK)).toBeNull();
    expect(safetyDocTypeForNodeType('whatever')).toBeNull();
    expect(safetyDocTypeForNodeType(undefined)).toBeNull();
  });
});
