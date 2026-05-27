// Praeventio Guard — Sprint 39 Fase G.11 — Mobile check-in widget.
//
// Big-button-first widget for a worker in a remote/solo faena. The widget
// shows the time-remaining-until-overdue, a giant "Check-in" CTA, and a
// secondary "Pedir ayuda" button that flips the session into help_requested
// state. End-session is exposed as a tertiary action.
//
// Props are intentionally narrow: the parent (mobile shell) holds the
// session in state, computes the projectId from the auth context, and
// hands us the current LoneWorkerSession. We post via useLoneWorker.

import { useEffect, useMemo, useState } from 'react';
import { Siren, CheckCircle2, Square, Clock } from 'lucide-react';
import type { LoneWorkerSession } from '../../services/loneWorker/loneWorkerService';
import {
  recordLoneWorkerCheckIn,
  endLoneWorkerSession,
} from '../../hooks/useLoneWorker';

export interface LoneWorkerCheckInWidgetProps {
  projectId: string;
  session: LoneWorkerSession;
  onSessionUpdated: (next: LoneWorkerSession) => void;
  onError?: (message: string) => void;
  /** Override the clock (tests only). */
  nowProvider?: () => Date;
}

function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export function LoneWorkerCheckInWidget({
  projectId,
  session,
  onSessionUpdated,
  onError,
  nowProvider,
}: LoneWorkerCheckInWidgetProps) {
  const [busy, setBusy] = useState<'idle' | 'check-in' | 'help' | 'end'>('idle');
  const [tick, setTick] = useState<number>(0);

  // Re-render every second so the countdown stays live without owning a
  // separate setInterval per child.
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const { secondsUntilOverdue, isOverdue } = useMemo(() => {
    const now = (nowProvider ?? (() => new Date()))();
    const lastEventAt =
      session.checkIns.length > 0
        ? session.checkIns[session.checkIns.length - 1].at
        : session.startedAt;
    const elapsedSec = (now.getTime() - Date.parse(lastEventAt)) / 1000;
    const intervalSec = session.checkInIntervalMin * 60;
    const remaining = intervalSec - elapsedSec;
    return {
      secondsUntilOverdue: remaining,
      isOverdue: remaining <= 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, tick, nowProvider]);

  const isClosed = Boolean(session.endedAt) || session.status === 'ended';

  async function handleCheckIn(kind: 'ok' | 'help') {
    if (busy !== 'idle' || isClosed) return;
    setBusy(kind === 'ok' ? 'check-in' : 'help');
    try {
      const idk = `lw-checkin-${session.id}-${Date.now()}`;
      const res = await recordLoneWorkerCheckIn(
        projectId,
        { session, checkIn: { status: kind } },
        idk,
      );
      onSessionUpdated(res.session);
    } catch (err) {
      onError?.((err as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  async function handleEnd() {
    if (busy !== 'idle' || isClosed) return;
    setBusy('end');
    try {
      const idk = `lw-end-${session.id}-${Date.now()}`;
      const res = await endLoneWorkerSession(projectId, { session }, idk);
      onSessionUpdated(res.session);
    } catch (err) {
      onError?.((err as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  const timerTone = isOverdue
    ? 'text-rose-600 dark:text-rose-400'
    : secondsUntilOverdue < 60
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-teal-700 dark:text-teal-300';

  return (
    <section
      className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-5 shadow-sm"
      data-testid="loneWorker.widget"
      aria-label="Check-in trabajo solitario"
    >
      <header className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-zinc-500" aria-hidden="true" />
        <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-200">
          Trabajo solitario
        </h2>
        <span
          className="ml-auto text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
          data-testid="loneWorker.widget.intervalLabel"
        >
          {session.checkInIntervalMin} min
        </span>
      </header>

      <div
        className="text-center py-2"
        data-testid="loneWorker.widget.timer"
        aria-live="polite"
      >
        <p className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {isOverdue ? 'Check-in atrasado' : 'Próximo check-in en'}
        </p>
        <p className={`text-5xl font-mono font-bold tabular-nums ${timerTone}`}>
          {formatMmSs(secondsUntilOverdue)}
        </p>
      </div>

      <button
        type="button"
        onClick={() => void handleCheckIn('ok')}
        disabled={busy !== 'idle' || isClosed}
        data-testid="loneWorker.widget.checkIn"
        className="w-full rounded-2xl bg-teal-500 hover:bg-teal-600 active:bg-teal-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-6 text-lg flex items-center justify-center gap-2 transition-colors min-h-[72px]"
      >
        <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
        {busy === 'check-in' ? 'Enviando…' : 'Estoy bien — Check-in'}
      </button>

      <button
        type="button"
        onClick={() => void handleCheckIn('help')}
        disabled={busy !== 'idle' || isClosed}
        data-testid="loneWorker.widget.help"
        className="w-full rounded-2xl bg-rose-500 hover:bg-rose-600 active:bg-rose-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-bold py-4 flex items-center justify-center gap-2 transition-colors"
      >
        <Siren className="w-5 h-5" aria-hidden="true" />
        {busy === 'help' ? 'Enviando…' : 'Pedir ayuda'}
      </button>

      <button
        type="button"
        onClick={() => void handleEnd()}
        disabled={busy !== 'idle' || isClosed}
        data-testid="loneWorker.widget.end"
        className="w-full rounded-2xl border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 font-medium py-3 flex items-center justify-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
      >
        <Square className="w-4 h-4" aria-hidden="true" />
        {busy === 'end' ? 'Cerrando…' : 'Finalizar sesión'}
      </button>

      <footer className="text-[11px] text-zinc-500 dark:text-zinc-400 text-center">
        {session.checkIns.length} check-in{session.checkIns.length === 1 ? '' : 's'} registrado{session.checkIns.length === 1 ? '' : 's'}
      </footer>
    </section>
  );
}
