import { describe, it, expect } from 'vitest';
import { predictUpcomingActivities, type CalendarEvent } from './predictions';

const NOW = new Date('2026-04-28T12:00:00.000Z');

function daysAgo(n: number): Date {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

describe('predictUpcomingActivities', () => {
  it('1) suggests cphs-meeting within 7 days when last meeting was 35 days ago', () => {
    const projects = [{ id: 'p1', lastCphsMeeting: daysAgo(35) }];
    const out = predictUpcomingActivities([], projects, NOW);
    const cphs = out.find(a => a.type === 'cphs-meeting' && a.projectId === 'p1');
    expect(cphs).toBeDefined();
    const diff = cphs!.recommendedDate.getTime() - NOW.getTime();
    expect(diff).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);
    expect(cphs!.legalReference).toMatch(/DS 54/);
  });

  it('2) does not suggest cphs-meeting when last was only 25 days ago', () => {
    const projects = [{ id: 'p1', lastCphsMeeting: daysAgo(25) }];
    const out = predictUpcomingActivities([], projects, NOW);
    expect(out.find(a => a.type === 'cphs-meeting' && a.projectId === 'p1')).toBeUndefined();
  });

  it('3) suggests odi-training when lastOdi is 200 days ago (Ley 16.744 semestral)', () => {
    const projects = [{ id: 'p2', lastOdi: daysAgo(200) }];
    const out = predictUpcomingActivities([], projects, NOW);
    const odi = out.find(a => a.type === 'odi-training' && a.projectId === 'p2');
    expect(odi).toBeDefined();
    expect(odi!.legalReference).toMatch(/16\.?744/);
  });

  it('4) does not suggest cphs when one is already scheduled in next 14 days', () => {
    const projects = [{ id: 'p1', lastCphsMeeting: daysAgo(35) }];
    const events: CalendarEvent[] = [
      {
        id: 'evt-1',
        title: 'Reunión CPHS Mensual proyecto p1',
        startTime: daysFromNow(5),
        endTime: new Date(daysFromNow(5).getTime() + 3600 * 1000),
      },
    ];
    const out = predictUpcomingActivities(events, projects, NOW);
    expect(out.find(a => a.type === 'cphs-meeting' && a.projectId === 'p1')).toBeUndefined();
  });

  it('5) suggests management-review-iso45001 when no review in past 11 months', () => {
    const projects = [{ id: 'p3', lastManagementReview: daysAgo(11 * 30) }];
    const out = predictUpcomingActivities([], projects, NOW);
    const mr = out.find(a => a.type === 'management-review-iso45001' && a.projectId === 'p3');
    expect(mr).toBeDefined();
    const diff = mr!.recommendedDate.getTime() - NOW.getTime();
    expect(diff).toBeLessThanOrEqual(30 * 24 * 3600 * 1000);
    expect(mr!.legalReference).toMatch(/45001|9\.3/);
  });

  it('6) returns empty array on empty input', () => {
    expect(predictUpcomingActivities([], [], NOW)).toEqual([]);
  });
});
