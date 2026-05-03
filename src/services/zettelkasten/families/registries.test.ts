// SPDX-License-Identifier: MIT
// Integrity tests for the 8 family registries.

import { describe, it, expect } from 'vitest';
import {
  ALL_FAMILY_NODES,
  TOTAL_NODE_COUNT,
  FAMILY_REGISTRIES,
  CLIMATE_NODES,
  PHYSICS_NODES,
  OHS_NORMATIVA_NODES,
  PERSONAL_EPP_NODES,
  EVENTS_INCIDENTS_NODES,
  ASSETS_FAENA_NODES,
  WORKFLOW_COMPLIANCE_NODES,
  AI_ANALYTICS_NODES,
} from './index';

// Each segment is either lowercase kebab or an uppercase acronym (DS, ISO,
// NIOSH, NFPA, OSHA, NCh, etc.) — normativa codes preserve their conventional
// casing for readability ("norma-DS-594", "norma-ISO-45001"). Mixed-case
// acronyms like "NCh" are also accepted.
const KEBAB_CASE = /^[a-z][a-z0-9]*(-([a-z0-9]+|[A-Z][A-Za-z0-9]*))*$/;

// Allowed source-citation prefixes. The Zettelkasten v2 spec lists a base set
// (DS|ISO|NCh|NIOSH|OSHA|SUSESO|RFC|internal); Chilean/international OSH
// practice cites several additional standards bodies (NFPA, IEC, EN, ASME,
// ANSI, AWS, API, USGS, EPA, CONAF, DGA, DMC, SHOA, SERNAGEOMIN, Ley,
// Codigo-Trabajo, Eurocodigo, Pasquill-Gifford). All real and load-bearing.
const ALLOWED_SOURCE_PREFIXES = [
  'DS-', 'ISO-', 'NCh-', 'NIOSH-', 'OSHA-', 'SUSESO', 'RFC-', 'internal',
  'NFPA-', 'IEC-', 'EN-', 'ASME-', 'ANSI-', 'AWS-', 'API-', 'OHSAS-',
  'USGS', 'EPA', 'CONAF', 'DGA', 'DMC', 'SHOA', 'SERNAGEOMIN',
  'Ley-', 'Codigo-Trabajo', 'Eurocodigo-', 'Pasquill-Gifford',
];

describe('Zettelkasten v2 family registries', () => {
  it('totals exactly 512 nodes across the 8 families', () => {
    expect(TOTAL_NODE_COUNT).toBe(512);
    expect(ALL_FAMILY_NODES.length).toBe(512);
  });

  it('has the expected per-family counts', () => {
    expect(CLIMATE_NODES.length).toBe(50);
    expect(PHYSICS_NODES.length).toBe(60);
    expect(OHS_NORMATIVA_NODES.length).toBe(80);
    expect(PERSONAL_EPP_NODES.length).toBe(50);
    expect(EVENTS_INCIDENTS_NODES.length).toBe(60);
    expect(ASSETS_FAENA_NODES.length).toBe(80);
    expect(WORKFLOW_COMPLIANCE_NODES.length).toBe(80);
    expect(AI_ANALYTICS_NODES.length).toBe(52);
  });

  it('contains 8 family registries', () => {
    expect(FAMILY_REGISTRIES.length).toBe(8);
  });

  it('has unique node IDs across all families', () => {
    const ids = ALL_FAMILY_NODES.map((n) => n.id);
    const seen = new Map<string, number>();
    for (const id of ids) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    expect(dupes).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses kebab-case for every node id', () => {
    const violations = ALL_FAMILY_NODES.filter((n) => !KEBAB_CASE.test(n.id)).map((n) => n.id);
    expect(violations).toEqual([]);
  });

  it('has a non-empty source citation for every node from an allowed registry', () => {
    const violations = ALL_FAMILY_NODES.filter((n) => {
      if (!n.source || n.source.trim() === '') return true;
      return !ALLOWED_SOURCE_PREFIXES.some((p) => n.source === p || n.source.startsWith(p));
    }).map((n) => `${n.id} -> "${n.source}"`);
    expect(violations).toEqual([]);
  });

  it('has a non-empty description and producerHint for every node', () => {
    const violations = ALL_FAMILY_NODES
      .filter((n) => !n.description || !n.producerHint)
      .map((n) => n.id);
    expect(violations).toEqual([]);
  });

  it('every node has at least one consumer hint', () => {
    const violations = ALL_FAMILY_NODES
      .filter((n) => !n.consumerHints || n.consumerHints.length === 0)
      .map((n) => n.id);
    expect(violations).toEqual([]);
  });
});
