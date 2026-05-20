// SPDX-License-Identifier: MIT
//
// Sprint 25 Bucket TT — Tests for runDailyClimateRiskScan.
//
// Pure DI fakes — no Firestore, no Open-Meteo, no FCM. The function under
// test is the orchestrator; the climateRiskCoupling pure module is exercised
// via its own test file. Here we verify the CHAIN: skip rules, persistence
// invocation, FCM gating, error containment, audit always logs.

import { describe, it, expect, vi } from 'vitest';
import {
  runDailyClimateRiskScan,
  type ClimateRiskScanDeps,
  type DailyScanProject,
} from './dailyClimateRiskScan';
import type { ClimateForecastDay } from '../../services/zettelkasten/climateRiskCoupling';

const FIXED_NOW = Date.UTC(2026, 4, 4, 8, 0, 0);

function dayUTC(daysFromToday: number): Date {
  return new Date(FIXED_NOW + daysFromToday * 24 * 3_600_000);
}

function makeProject(overrides: Partial<DailyScanProject> = {}): DailyScanProject {
  return {
    id: 'p1',
    tenantId: 't1',
    name: 'Faena Norte',
    geo: { lat: -33.45, lng: -70.66 },
    outdoor: true,
    workTypes: ['altura', 'andamio'],
    supervisorUids: ['sup1', 'sup2'],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ClimateRiskScanDeps> = {}): ClimateRiskScanDeps {
  return {
    listActiveProjects: async () => [],
    fetchForecast: async () => [],
    persistNodes: async () => ({ ok: true, ids: [] }),
    sendFcmMulticast: async () => ({ successCount: 0, failureCount: 0 }),
    audit: async () => {},
    now: () => FIXED_NOW,
    ...overrides,
  };
}

const STORMY_DAY: ClimateForecastDay = {
  date: dayUTC(1),
  conditionCode: 'stormy',
  temperatureC: 18,
  windKmh: 30,
  precipMm: 25,
};

const RAINY_DAY: ClimateForecastDay = {
  date: dayUTC(2),
  conditionCode: 'rainy',
  temperatureC: 12,
  windKmh: 15,
  precipMm: 5,
};

const SUNNY_DAY: ClimateForecastDay = {
  date: dayUTC(0),
  conditionCode: 'sunny',
  temperatureC: 22,
  windKmh: 5,
  precipMm: 0,
};

describe('runDailyClimateRiskScan', () => {
  it('returns zero counts when no projects are active', async () => {
    const audit = vi.fn(async () => {});
    const result = await runDailyClimateRiskScan(makeDeps({ audit }));
    expect(result.projectsScanned).toBe(0);
    expect(result.nodesGenerated).toBe(0);
    expect(result.notificationsSent).toBe(0);
    expect(audit).toHaveBeenCalledWith(
      'climate.daily_scan.completed',
      expect.objectContaining({ projectsScanned: 0, errorCount: 0 }),
    );
  });

  it('skips projects without geo coordinates', async () => {
    const fetchForecast = vi.fn();
    const persist = vi.fn();
    await runDailyClimateRiskScan(
      makeDeps({
        listActiveProjects: async () => [makeProject({ geo: undefined })],
        fetchForecast,
        persistNodes: persist,
      }),
    );
    expect(fetchForecast).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('skips indoor projects', async () => {
    const fetchForecast = vi.fn();
    await runDailyClimateRiskScan(
      makeDeps({
        listActiveProjects: async () => [makeProject({ outdoor: false })],
        fetchForecast,
      }),
    );
    expect(fetchForecast).not.toHaveBeenCalled();
  });

  it('generates and persists nodes for outdoor projects with risk', async () => {
    const persist = vi.fn(async () => ({ ok: true, ids: ['x1', 'x2'] }));
    const result = await runDailyClimateRiskScan(
      makeDeps({
        listActiveProjects: async () => [makeProject()],
        fetchForecast: async () => [STORMY_DAY, RAINY_DAY],
        persistNodes: persist,
      }),
    );
    expect(result.forecastsFetched).toBe(2);
    expect(result.nodesGenerated).toBeGreaterThan(0);
    expect(result.nodesPersisted).toBe(result.nodesGenerated);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(expect.any(Array), 'p1');
  });

  it('does not send FCM when severity is below threshold (sunny day)', async () => {
    const fcm = vi.fn(async () => ({ successCount: 0, failureCount: 0 }));
    const result = await runDailyClimateRiskScan(
      makeDeps({
        listActiveProjects: async () => [makeProject()],
        fetchForecast: async () => [SUNNY_DAY],
        sendFcmMulticast: fcm,
      }),
      { minSeverityForFcm: 'medium' },
    );
    expect(fcm).not.toHaveBeenCalled();
    expect(result.notificationsSent).toBe(0);
  });

  it('sends FCM when severity >= medium (stormy → lightning critical)', async () => {
    const fcm = vi.fn<ClimateRiskScanDeps['sendFcmMulticast']>(
      async () => ({ successCount: 2, failureCount: 0 }),
    );
    const result = await runDailyClimateRiskScan(
      makeDeps({
        listActiveProjects: async () => [makeProject()],
        fetchForecast: async () => [STORMY_DAY],
        sendFcmMulticast: fcm,
      }),
      { minSeverityForFcm: 'medium' },
    );
    expect(fcm).toHaveBeenCalledOnce();
    const call = fcm.mock.calls[0]?.[0];
    if (!call) throw new Error('fcm not called');
    expect(call.uids).toEqual(['sup1', 'sup2']);
    expect(call.data!.type).toBe('climate_risk_daily');
    expect(call.data!.projectId).toBe('p1');
    expect(call.data!.tenantId).toBe('t1');
    expect(['high', 'critical']).toContain(call.data!.topSeverity);
    expect(result.notificationsSent).toBe(2);
  });

  it('does NOT send FCM when project has no supervisors, even on storm', async () => {
    const fcm = vi.fn(async () => ({ successCount: 0, failureCount: 0 }));
    await runDailyClimateRiskScan(
      makeDeps({
        listActiveProjects: async () => [makeProject({ supervisorUids: [] })],
        fetchForecast: async () => [STORMY_DAY],
        sendFcmMulticast: fcm,
      }),
    );
    expect(fcm).not.toHaveBeenCalled();
  });

  it('error in fetchForecast for one project does not abort the others', async () => {
    const projects = [
      makeProject({ id: 'p1' }),
      makeProject({ id: 'p2' }),
      makeProject({ id: 'p3' }),
    ];
    const fetchForecast = vi.fn(async (_geo, _days) => {
      const callIdx = fetchForecast.mock.calls.length;
      if (callIdx === 2) throw new Error('upstream timeout');
      return [STORMY_DAY];
    });
    const persist = vi.fn(async () => ({ ok: true }));
    const result = await runDailyClimateRiskScan(
      makeDeps({
        listActiveProjects: async () => projects,
        fetchForecast,
        persistNodes: persist,
      }),
    );
    expect(result.projectsScanned).toBe(3);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].projectId).toBe('p2');
    // p1 and p3 still persisted
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('audit log is invoked even when projects fail', async () => {
    const audit = vi.fn(async () => {});
    await runDailyClimateRiskScan(
      makeDeps({
        listActiveProjects: async () => [makeProject()],
        fetchForecast: async () => {
          throw new Error('boom');
        },
        audit,
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      'climate.daily_scan.completed',
      expect.objectContaining({ errorCount: 1 }),
    );
  });

  it('audit log is invoked even when listActiveProjects throws', async () => {
    const audit = vi.fn<ClimateRiskScanDeps['audit']>(async () => {});
    const result = await runDailyClimateRiskScan(
      makeDeps({
        listActiveProjects: async () => {
          throw new Error('firestore down');
        },
        audit,
      }),
    );
    expect(audit).toHaveBeenCalledOnce();
    const callArgs = audit.mock.calls[0]!;
    expect(callArgs[0]).toBe('climate.daily_scan.completed');
    expect((callArgs[1] as Record<string, unknown>).fatal).toBe(
      'listActiveProjects_failed',
    );
    expect(result.errors[0].projectId).toBe('*');
  });

  it('does not throw when audit itself throws', async () => {
    const audit = vi.fn(async () => {
      throw new Error('audit unavailable');
    });
    await expect(
      runDailyClimateRiskScan(
        makeDeps({
          listActiveProjects: async () => [makeProject()],
          fetchForecast: async () => [STORMY_DAY],
          audit,
        }),
      ),
    ).resolves.toBeDefined();
  });
});
