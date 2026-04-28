import { describe, it, expect } from 'vitest';
import {
  routeForCollection,
  KNOWN_SYNC_COLLECTIONS,
} from './syncConflictRoutes';

describe('routeForCollection', () => {
  // Use an id with characters that must be percent-encoded so the test
  // verifies that callers don't have to encode in advance.
  const ID = 'doc id/1';
  const ENC = encodeURIComponent(ID);

  it('maps iper_nodes to the Risks listing with a node query param', () => {
    expect(routeForCollection('iper_nodes', ID)).toBe(`/risks?node=${ENC}`);
  });

  it('maps nodes to /risk-network with a node query param', () => {
    expect(routeForCollection('nodes', ID)).toBe(`/risk-network?node=${ENC}`);
  });

  it('maps audits to the Audits listing with an id query param', () => {
    expect(routeForCollection('audits', ID)).toBe(`/audits?id=${ENC}`);
  });

  it('maps workers to the Workers listing with an id query param', () => {
    expect(routeForCollection('workers', ID)).toBe(`/workers?id=${ENC}`);
  });

  it('maps documents to the documents detail route', () => {
    expect(routeForCollection('documents', ID)).toBe(`/documents/${ENC}`);
  });

  it('maps projects to the Projects listing with an id query param', () => {
    expect(routeForCollection('projects', ID)).toBe(`/projects?id=${ENC}`);
  });

  it('maps findings to the Findings listing with an id query param', () => {
    expect(routeForCollection('findings', ID)).toBe(`/findings?id=${ENC}`);
  });

  it('returns null for an unknown collection name', () => {
    expect(routeForCollection('unknown_collection_xyz', 'whatever')).toBeNull();
  });

  it('returns null for an empty collection name', () => {
    expect(routeForCollection('', 'whatever')).toBeNull();
  });

  it('exposes the full set of supported collections via KNOWN_SYNC_COLLECTIONS', () => {
    expect(new Set(KNOWN_SYNC_COLLECTIONS)).toEqual(
      new Set([
        'iper_nodes',
        'nodes',
        'audits',
        'workers',
        'documents',
        'projects',
        'findings',
      ]),
    );
  });
});
