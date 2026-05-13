import { describe, it, expect } from 'vitest';
import {
  bumpVersion,
  parseSemver,
  buildNextVersion,
  pickLatestVersion,
  pickActiveVersion,
  validateChain,
  diffVersions,
  buildChangelog,
  VersionImmutabilityError,
  type VersionChain,
  type DocumentVersion,
} from './documentVersioning.js';

function v(over: Partial<DocumentVersion> & Pick<DocumentVersion, 'versionId'>): DocumentVersion {
  return {
    documentId: 'doc-1',
    content: 'contenido v' + over.versionId,
    contentHash: 'hash-' + over.versionId,
    status: 'approved',
    authorUid: 'u1',
    approvedByUid: 'u2',
    approvedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('parseSemver / bumpVersion', () => {
  it('parsea 1.2.3', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });
  it('rechaza malformado', () => {
    expect(parseSemver('1.2')).toBeNull();
  });
  it('bump patch', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });
  it('bump minor resetea patch', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
  });
  it('bump major resetea minor + patch', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });
  it('arranca desde 0.0.0 si no es semver válido', () => {
    expect(bumpVersion('invalid', 'minor')).toBe('0.1.0');
  });
});

describe('buildNextVersion', () => {
  it('primer documento → 1.0.0', () => {
    const chain: VersionChain = { documentId: 'd', versions: [] };
    const next = buildNextVersion({
      chain,
      newContent: 'hola',
      newContentHash: 'h',
      authorUid: 'u',
      bumpKind: 'major',
      now: new Date('2026-05-12T00:00:00Z'),
    });
    expect(next.versionId).toBe('1.0.0');
    expect(next.status).toBe('draft');
    expect(next.replacesVersionId).toBeUndefined();
  });

  it('bump minor desde 1.0.0', () => {
    const chain: VersionChain = {
      documentId: 'd',
      versions: [v({ versionId: '1.0.0' })],
    };
    const next = buildNextVersion({
      chain,
      newContent: 'nuevo',
      newContentHash: 'h2',
      authorUid: 'u',
      bumpKind: 'minor',
    });
    expect(next.versionId).toBe('1.1.0');
    expect(next.replacesVersionId).toBe('1.0.0');
  });

  it('rechaza si latest está draft', () => {
    const chain: VersionChain = {
      documentId: 'd',
      versions: [v({ versionId: '1.0.0', status: 'draft' })],
    };
    expect(() =>
      buildNextVersion({
        chain,
        newContent: 'x',
        newContentHash: 'h',
        authorUid: 'u',
        bumpKind: 'patch',
      }),
    ).toThrowError(VersionImmutabilityError);
  });

  it('NO muta la chain entrante', () => {
    const chain: VersionChain = {
      documentId: 'd',
      versions: [v({ versionId: '1.0.0' })],
    };
    const originalLen = chain.versions.length;
    buildNextVersion({
      chain,
      newContent: 'x',
      newContentHash: 'h',
      authorUid: 'u',
      bumpKind: 'patch',
    });
    expect(chain.versions.length).toBe(originalLen);
  });
});

describe('pickLatestVersion / pickActiveVersion', () => {
  it('latest devuelve la versión semver más alta', () => {
    const chain: VersionChain = {
      documentId: 'd',
      versions: [v({ versionId: '1.0.0' }), v({ versionId: '2.1.3' }), v({ versionId: '1.5.0' })],
    };
    expect(pickLatestVersion(chain)?.versionId).toBe('2.1.3');
  });

  it('active ignora drafts y superseded', () => {
    const chain: VersionChain = {
      documentId: 'd',
      versions: [
        v({ versionId: '1.0.0', status: 'approved', supersededByVersionId: '2.0.0' }),
        v({ versionId: '2.0.0', status: 'approved' }),
        v({ versionId: '3.0.0', status: 'draft' }),
      ],
    };
    expect(pickActiveVersion(chain)?.versionId).toBe('2.0.0');
  });

  it('active null si no hay approved', () => {
    const chain: VersionChain = {
      documentId: 'd',
      versions: [v({ versionId: '1.0.0', status: 'draft', approvedByUid: undefined, approvedAt: undefined })],
    };
    expect(pickActiveVersion(chain)).toBeNull();
  });
});

describe('validateChain', () => {
  it('valida cadena correcta', () => {
    const chain: VersionChain = {
      documentId: 'd',
      versions: [
        v({ versionId: '1.0.0' }),
        v({ versionId: '1.1.0', replacesVersionId: '1.0.0' }),
      ],
    };
    expect(validateChain(chain).valid).toBe(true);
  });

  it('rechaza duplicado de versionId', () => {
    const chain: VersionChain = {
      documentId: 'd',
      versions: [v({ versionId: '1.0.0' }), v({ versionId: '1.0.0' })],
    };
    const r = validateChain(chain);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Duplicate/);
  });

  it('rechaza approved sin approvedByUid', () => {
    const chain: VersionChain = {
      documentId: 'd',
      versions: [v({ versionId: '1.0.0', status: 'approved', approvedByUid: undefined })],
    };
    expect(validateChain(chain).valid).toBe(false);
  });

  it('rechaza replacesVersionId desconocido', () => {
    const chain: VersionChain = {
      documentId: 'd',
      versions: [v({ versionId: '2.0.0', replacesVersionId: '1.0.0' })],
    };
    const r = validateChain(chain);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unknown/);
  });
});

describe('diffVersions', () => {
  it('detecta líneas agregadas y removidas', () => {
    const a = v({ versionId: '1.0.0', content: 'linea1\nlinea2\nlinea3', contentHash: 'a' });
    const b = v({ versionId: '1.1.0', content: 'linea1\nlinea2-edit\nlinea3\nlinea4', contentHash: 'b' });
    const d = diffVersions(a, b);
    expect(d.contentChanged).toBe(true);
    expect(d.addedLines).toContain('linea2-edit');
    expect(d.addedLines).toContain('linea4');
    expect(d.removedLines).toContain('linea2');
  });

  it('contentChanged false si hash igual', () => {
    const a = v({ versionId: '1.0.0', content: 'x', contentHash: 'h' });
    const b = v({ versionId: '1.1.0', content: 'x', contentHash: 'h' });
    expect(diffVersions(a, b).contentChanged).toBe(false);
  });

  it('Codex P2 PR #104: detecta duplicate-line añadida (A\\nB → A\\nB\\nB)', () => {
    const a = v({ versionId: '1.0.0', content: 'A\nB', contentHash: 'h1' });
    const b = v({ versionId: '1.1.0', content: 'A\nB\nB', contentHash: 'h2' });
    const d = diffVersions(a, b);
    expect(d.addedLines).toEqual(['B']);
    expect(d.removedLines).toEqual([]);
    expect(d.charsAdded).toBe(1);
  });

  it('Codex P2 PR #104: detecta duplicate-line removida (A\\nB\\nB → A\\nB)', () => {
    const a = v({ versionId: '1.0.0', content: 'A\nB\nB', contentHash: 'h1' });
    const b = v({ versionId: '1.1.0', content: 'A\nB', contentHash: 'h2' });
    const d = diffVersions(a, b);
    expect(d.removedLines).toEqual(['B']);
    expect(d.addedLines).toEqual([]);
  });
});

describe('buildChangelog', () => {
  it('ordena por versionId desc + incluye notes', () => {
    const chain: VersionChain = {
      documentId: 'd',
      versions: [
        v({ versionId: '1.0.0', changeNotes: 'inicial' }),
        v({ versionId: '2.0.0', changeNotes: 'major refactor' }),
        v({ versionId: '1.5.0', changeNotes: 'minor' }),
      ],
    };
    const log = buildChangelog(chain);
    expect(log[0].versionId).toBe('2.0.0');
    expect(log[0].changeNotes).toBe('major refactor');
  });
});
