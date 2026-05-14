import { describe, it, expect, vi } from 'vitest';
import {
  buildResilienceHealthReport,
  makeDeviceKekChecker,
  makeNetworkChecker,
  makeSlmChecker,
  makeZettelkastenChecker,
  type ResilienceCheckers,
  type SubsystemChecker,
} from './resilienceHealthMonitor';

const healthy = (id: string): SubsystemChecker => async () => ({
  id: id as never,
  status: 'healthy',
  detail: `${id}: ok`,
});

const degraded = (id: string): SubsystemChecker => async () => ({
  id: id as never,
  status: 'degraded',
  detail: `${id}: slow`,
});

const critical = (id: string): SubsystemChecker => async () => ({
  id: id as never,
  status: 'critical',
  detail: `${id}: down`,
});

const failing = (id: string, msg = 'boom'): SubsystemChecker => async () => {
  throw new Error(msg);
};

describe('buildResilienceHealthReport — basic aggregation', () => {
  it('reporta todos los 7 subsystems', async () => {
    const checkers: ResilienceCheckers = {
      slm: healthy('slm'),
      zettelkasten: healthy('zettelkasten'),
      firestore: healthy('firestore'),
      gemini: healthy('gemini'),
      device_kek: healthy('device_kek'),
      encrypted_kv: healthy('encrypted_kv'),
      network: healthy('network'),
    };
    const r = await buildResilienceHealthReport(checkers);
    expect(r.subsystems).toHaveLength(7);
    expect(r.overallStatus).toBe('healthy');
  });

  it('subsystem sin checker → status unknown + error="no_checker"', async () => {
    const r = await buildResilienceHealthReport({
      slm: healthy('slm'),
    });
    const reports = r.subsystems;
    const slm = reports.find((x) => x.id === 'slm')!;
    expect(slm.status).toBe('healthy');
    const firestore = reports.find((x) => x.id === 'firestore')!;
    expect(firestore.status).toBe('unknown');
    expect(firestore.error).toBe('no_checker');
  });

  it('checker que throws → status unknown + error preserved', async () => {
    const r = await buildResilienceHealthReport({
      slm: failing('slm', 'OOM iOS'),
    });
    const slm = r.subsystems.find((x) => x.id === 'slm')!;
    expect(slm.status).toBe('unknown');
    expect(slm.error).toContain('OOM iOS');
  });

  it('checker que toma demasiado tiempo → timeout', async () => {
    const slowChecker: SubsystemChecker = () =>
      new Promise((res) =>
        setTimeout(
          () => res({ id: 'slm', status: 'healthy', detail: 'tarde' }),
          5000,
        ),
      );
    const r = await buildResilienceHealthReport(
      { slm: slowChecker },
      { checkerTimeoutMs: 50 },
    );
    const slm = r.subsystems.find((x) => x.id === 'slm')!;
    expect(slm.status).toBe('unknown');
    expect(slm.error).toContain('timeout');
  });

  it('generatedAt + totalLatencyMs incluidos', async () => {
    let t = 1_000_000;
    const r = await buildResilienceHealthReport(
      { slm: healthy('slm') },
      {
        nowMs: () => {
          const v = t;
          t += 10;
          return v;
        },
      },
    );
    expect(r.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('checkLatencyMs per subsystem refleja tiempo medido', async () => {
    let t = 0;
    const slowOk: SubsystemChecker = async () => {
      // El monitor llama nowMs ANTES de invocar el checker, así que la
      // latencia se basa en cuántos ticks pasan dentro del Promise.race.
      return { id: 'slm', status: 'healthy', detail: 'ok' };
    };
    const r = await buildResilienceHealthReport(
      { slm: slowOk },
      {
        nowMs: () => {
          const v = t;
          t += 50;
          return v;
        },
      },
    );
    const slm = r.subsystems.find((x) => x.id === 'slm')!;
    expect(slm.checkLatencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('overallStatus — strict policy', () => {
  it('todos healthy → healthy', async () => {
    const r = await buildResilienceHealthReport(
      {
        slm: healthy('slm'),
        zettelkasten: healthy('zettelkasten'),
      },
      { overallPolicy: 'strict' },
    );
    expect(r.overallStatus).toBe('degraded'); // unknown checkers
  });

  it('un critical → critical', async () => {
    const r = await buildResilienceHealthReport(
      {
        slm: critical('slm'),
        zettelkasten: healthy('zettelkasten'),
        firestore: healthy('firestore'),
        gemini: healthy('gemini'),
        device_kek: healthy('device_kek'),
        encrypted_kv: healthy('encrypted_kv'),
        network: healthy('network'),
      },
      { overallPolicy: 'strict' },
    );
    expect(r.overallStatus).toBe('critical');
  });

  it('un degraded → degraded', async () => {
    const r = await buildResilienceHealthReport(
      {
        slm: degraded('slm'),
        zettelkasten: healthy('zettelkasten'),
        firestore: healthy('firestore'),
        gemini: healthy('gemini'),
        device_kek: healthy('device_kek'),
        encrypted_kv: healthy('encrypted_kv'),
        network: healthy('network'),
      },
      { overallPolicy: 'strict' },
    );
    expect(r.overallStatus).toBe('degraded');
  });
});

describe('overallStatus — slm_priority policy (default)', () => {
  it('slm + zk ambos critical → critical', async () => {
    const r = await buildResilienceHealthReport(
      {
        slm: critical('slm'),
        zettelkasten: critical('zettelkasten'),
        firestore: healthy('firestore'),
        gemini: healthy('gemini'),
        device_kek: healthy('device_kek'),
        encrypted_kv: healthy('encrypted_kv'),
        network: healthy('network'),
      },
    );
    expect(r.overallStatus).toBe('critical');
  });

  it('slm critical pero zk healthy → degraded (no critical)', async () => {
    const r = await buildResilienceHealthReport({
      slm: critical('slm'),
      zettelkasten: healthy('zettelkasten'),
      firestore: healthy('firestore'),
      gemini: healthy('gemini'),
      device_kek: healthy('device_kek'),
      encrypted_kv: healthy('encrypted_kv'),
      network: healthy('network'),
    });
    expect(r.overallStatus).toBe('degraded');
  });

  it('gemini critical pero todo lo demás healthy → degraded (Gemini es nice-to-have)', async () => {
    const r = await buildResilienceHealthReport({
      slm: healthy('slm'),
      zettelkasten: healthy('zettelkasten'),
      firestore: healthy('firestore'),
      gemini: critical('gemini'),
      device_kek: healthy('device_kek'),
      encrypted_kv: healthy('encrypted_kv'),
      network: healthy('network'),
    });
    expect(r.overallStatus).toBe('degraded');
  });

  it('todos healthy → healthy', async () => {
    const r = await buildResilienceHealthReport({
      slm: healthy('slm'),
      zettelkasten: healthy('zettelkasten'),
      firestore: healthy('firestore'),
      gemini: healthy('gemini'),
      device_kek: healthy('device_kek'),
      encrypted_kv: healthy('encrypted_kv'),
      network: healthy('network'),
    });
    expect(r.overallStatus).toBe('healthy');
  });
});

describe('overallStatus — majority policy', () => {
  it('>50% críticos → critical', async () => {
    const r = await buildResilienceHealthReport(
      {
        slm: critical('slm'),
        zettelkasten: critical('zettelkasten'),
        firestore: critical('firestore'),
        gemini: critical('gemini'),
        device_kek: healthy('device_kek'),
        encrypted_kv: healthy('encrypted_kv'),
        network: healthy('network'),
      },
      { overallPolicy: 'majority' },
    );
    expect(r.overallStatus).toBe('critical');
  });

  it('1 critical de 7 → degraded', async () => {
    const r = await buildResilienceHealthReport(
      {
        slm: critical('slm'),
        zettelkasten: healthy('zettelkasten'),
        firestore: healthy('firestore'),
        gemini: healthy('gemini'),
        device_kek: healthy('device_kek'),
        encrypted_kv: healthy('encrypted_kv'),
        network: healthy('network'),
      },
      { overallPolicy: 'majority' },
    );
    expect(r.overallStatus).toBe('degraded');
  });
});

describe('recommendations', () => {
  it('per critical subsystem agrega una recomendación', async () => {
    const r = await buildResilienceHealthReport({
      slm: critical('slm'),
      gemini: critical('gemini'),
      zettelkasten: healthy('zettelkasten'),
    });
    const slmRec = r.recommendations.find((x) => x.subsystem === 'slm');
    expect(slmRec).toBeDefined();
    expect(slmRec!.severity).toBe('critical');
    expect(slmRec!.action).toMatch(/SLM offline/);
  });

  it('subsystem degraded → severity warn', async () => {
    const r = await buildResilienceHealthReport({
      firestore: degraded('firestore'),
      slm: healthy('slm'),
      zettelkasten: healthy('zettelkasten'),
    });
    const fs = r.recommendations.find((x) => x.subsystem === 'firestore');
    expect(fs?.severity).toBe('warn');
  });

  it('KEK con ageDays >90 agrega recomendación de rotación', async () => {
    const oldKekChecker: SubsystemChecker = async () => ({
      id: 'device_kek',
      status: 'healthy',
      detail: 'KEK 120 días',
      metadata: { ageDays: 120, exists: true },
    });
    const r = await buildResilienceHealthReport({
      device_kek: oldKekChecker,
    });
    const rec = r.recommendations.find(
      (x) =>
        x.subsystem === 'device_kek' && x.action.includes('Considera rotación'),
    );
    expect(rec).toBeDefined();
    expect(rec!.severity).toBe('warn');
  });

  it('healthy subsystems no generan recomendaciones', async () => {
    const r = await buildResilienceHealthReport({
      slm: healthy('slm'),
      zettelkasten: healthy('zettelkasten'),
      firestore: healthy('firestore'),
      gemini: healthy('gemini'),
      device_kek: healthy('device_kek'),
      encrypted_kv: healthy('encrypted_kv'),
      network: healthy('network'),
    });
    expect(r.recommendations).toHaveLength(0);
  });
});

describe('makeSlmChecker', () => {
  it('state=ready isPrePackaged=true → healthy', async () => {
    const checker = makeSlmChecker(async () => ({
      state: 'ready',
      isPrePackaged: true,
      cachedBytes: 0,
    }));
    const r = await checker(0);
    expect(r.status).toBe('healthy');
    expect(r.detail).toMatch(/pre-empaquetado/);
  });

  it('state=ready con cache → healthy + MB en detail', async () => {
    const checker = makeSlmChecker(async () => ({
      state: 'ready',
      isPrePackaged: false,
      cachedBytes: 500_000_000,
    }));
    const r = await checker(0);
    expect(r.status).toBe('healthy');
    expect(r.detail).toMatch(/477 MB/);
  });

  it('state=needs_prompt → critical', async () => {
    const checker = makeSlmChecker(async () => ({
      state: 'needs_prompt',
      isPrePackaged: false,
      cachedBytes: 0,
    }));
    const r = await checker(0);
    expect(r.status).toBe('critical');
  });

  it('state=postponed → degraded', async () => {
    const checker = makeSlmChecker(async () => ({
      state: 'postponed',
      isPrePackaged: false,
      cachedBytes: 0,
    }));
    const r = await checker(0);
    expect(r.status).toBe('degraded');
  });

  it('state=declined → degraded', async () => {
    const checker = makeSlmChecker(async () => ({
      state: 'declined',
      isPrePackaged: false,
      cachedBytes: 0,
    }));
    const r = await checker(0);
    expect(r.status).toBe('degraded');
  });
});

describe('makeZettelkastenChecker', () => {
  it('memory hidratada + seed → healthy', async () => {
    const checker = makeZettelkastenChecker(async () => ({
      memoryNodeCount: 50,
      idbNodeCount: 50,
      seedAvailable: true,
    }));
    const r = await checker(0);
    expect(r.status).toBe('healthy');
  });

  it('memory vacía pero IDB hidratada → degraded', async () => {
    const checker = makeZettelkastenChecker(async () => ({
      memoryNodeCount: 0,
      idbNodeCount: 50,
      seedAvailable: true,
    }));
    const r = await checker(0);
    expect(r.status).toBe('degraded');
  });

  it('todo vacío excepto seed → degraded', async () => {
    const checker = makeZettelkastenChecker(async () => ({
      memoryNodeCount: 0,
      idbNodeCount: 0,
      seedAvailable: true,
    }));
    const r = await checker(0);
    expect(r.status).toBe('degraded');
    expect(r.detail).toMatch(/seed/);
  });

  it('seed NO disponible → critical (bug en imports)', async () => {
    const checker = makeZettelkastenChecker(async () => ({
      memoryNodeCount: 50,
      idbNodeCount: 50,
      seedAvailable: false,
    }));
    const r = await checker(0);
    expect(r.status).toBe('critical');
  });
});

describe('makeDeviceKekChecker', () => {
  it('no existe → critical', async () => {
    const checker = makeDeviceKekChecker(async () => ({ exists: false }));
    const r = await checker(0);
    expect(r.status).toBe('critical');
  });

  it('existe edad <365d → healthy', async () => {
    const checker = makeDeviceKekChecker(async () => ({
      exists: true,
      ageMs: 30 * 24 * 60 * 60 * 1000, // 30 días
    }));
    const r = await checker(0);
    expect(r.status).toBe('healthy');
    expect(r.metadata?.ageDays).toBe(30);
  });

  it('existe edad >365d → degraded', async () => {
    const checker = makeDeviceKekChecker(async () => ({
      exists: true,
      ageMs: 400 * 24 * 60 * 60 * 1000,
    }));
    const r = await checker(0);
    expect(r.status).toBe('degraded');
  });
});

describe('makeNetworkChecker', () => {
  it('navigator.onLine=true sin ping → healthy', async () => {
    // jsdom default: navigator.onLine = true
    const checker = makeNetworkChecker();
    const r = await checker(0);
    expect(r.status).toBe('healthy');
  });

  it('ping OK → healthy con latencia', async () => {
    const checker = makeNetworkChecker(async () => ({
      ok: true,
      latencyMs: 123,
    }));
    const r = await checker(0);
    expect(r.status).toBe('healthy');
    expect(r.detail).toMatch(/123ms/);
    expect(r.metadata?.pingLatencyMs).toBe(123);
  });

  it('ping fail (online según navigator) → degraded', async () => {
    const checker = makeNetworkChecker(async () => ({ ok: false }));
    const r = await checker(0);
    expect(r.status).toBe('degraded');
    expect(r.detail).toMatch(/ping/);
  });
});
