// Tests para versionedPrompts.ts — Sprint K §156.

import { describe, it, expect } from 'vitest';
import {
  getPrompt,
  getLatestVersion,
  getCatalog,
  listVersions,
  listPromptIds,
  UnknownPromptError,
} from './versionedPrompts.ts';

describe('versionedPrompts.getPrompt', () => {
  it('recupera prompt existente por id + version', () => {
    const p = getPrompt('rag.zk.query', '1.0.0');
    expect(p.id).toBe('rag.zk.query');
    expect(p.version).toBe('1.0.0');
    expect(p.body).toContain('Pregunta:');
    expect(p.citations).toBe('required');
    expect(p.maxTokens).toBeGreaterThan(0);
  });

  it('lanza UnknownPromptError si el id no existe', () => {
    expect(() => getPrompt('inexistente', '1.0.0')).toThrowError(UnknownPromptError);
  });

  it('lanza UnknownPromptError si la version no existe', () => {
    expect(() => getPrompt('rag.zk.query', '99.0.0')).toThrowError(/unknown prompt/);
  });

  it('distintas versiones del mismo id retornan bodies distintos', () => {
    const v1 = getPrompt('rag.zk.query', '1.0.0');
    const v2 = getPrompt('rag.zk.query', '2.0.0');
    expect(v1.body).not.toBe(v2.body);
  });
});

describe('versionedPrompts.listVersions', () => {
  it('cada prompt tiene al menos 3 versiones (política mínima)', () => {
    const ids = listPromptIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const versions = listVersions(id);
      expect(
        versions.length,
        `prompt '${id}' debe tener ≥ 3 versiones, tiene ${versions.length}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('retorna [] para id desconocido (no lanza)', () => {
    expect(listVersions('inexistente')).toEqual([]);
  });

  it('versiones se devuelven en orden de aparición', () => {
    const versions = listVersions('rag.zk.query');
    expect(versions[0]).toBe('1.0.0');
    expect(versions[versions.length - 1]).toBe('2.0.0');
  });
});

describe('versionedPrompts.getLatestVersion', () => {
  it('retorna la última versión registrada', () => {
    const latest = getLatestVersion('rag.zk.query');
    expect(latest.version).toBe('2.0.0');
  });

  it('lanza si el id no existe', () => {
    expect(() => getLatestVersion('inexistente')).toThrowError(UnknownPromptError);
  });
});

describe('versionedPrompts.listPromptIds', () => {
  it('retorna ids únicos del catálogo', () => {
    const ids = listPromptIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('rag.zk.query');
    expect(ids).toContain('safety.epp.suggest');
    expect(ids).toContain('incidents.summarize');
  });
});

describe('versionedPrompts.getCatalog', () => {
  it('retorna entries con todos los campos requeridos', () => {
    const cat = getCatalog();
    expect(cat.length).toBeGreaterThan(0);
    for (const p of cat) {
      expect(p.id).toBeTruthy();
      expect(p.version).toBeTruthy();
      expect(p.body).toBeTruthy();
      expect(Array.isArray(p.allowedTools)).toBe(true);
      expect(p.maxTokens).toBeGreaterThan(0);
      expect(['required', 'optional']).toContain(p.citations);
    }
  });
});
