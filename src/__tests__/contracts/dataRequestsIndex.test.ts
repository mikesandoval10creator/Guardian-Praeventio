import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REQUESTS_COLLECTION } from '../../services/compliance/ley19628.js';

describe('ARCO history index configuration', () => {
  it('declares the collection index for the subject filter and newest-first order', () => {
    const firebase = JSON.parse(readFileSync('firebase.json', 'utf8'));
    const manifest = JSON.parse(readFileSync(firebase.firestore.indexes, 'utf8'));
    expect(manifest.indexes).toContainEqual({
      collectionGroup: REQUESTS_COLLECTION,
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'uid', order: 'ASCENDING' },
        { fieldPath: 'requestedAt', order: 'DESCENDING' },
      ],
    });
  });
});
