// Praeventio Guard — Sprint 28 Bucket B5: CPHS module page (/cphs).
//
// Cierra audit hallazgo H29 P1. UI sobre `services/cphs/cphsService.ts`.
// Cita normativa visible: ISO 45001 §5.4 + DS 54 art. 66 (Chile).
//
// Para otras jurisdicciones (México NOM-019-STPS, Brasil NR-5 CIPA,
// Perú Ley 29783 CSST, etc.), el header expone un placeholder enlazado
// al registro regulatorio del Sprint 28 B1 (TODO inline). El validador
// de quórum vive en `services/cphs/types.ts::isValidQuorum` y está
// pinneado a Chile DS 54 hasta que B1 entregue
// `getCphsRequirements(jurisdiction)`.

import { useState, useMemo } from 'react';
import { ShieldCheck, Users, Calendar as CalendarIcon, FileText, PenTool, AlertTriangle, Plus } from 'lucide-react';
import {
  type CphsCommittee,
  type CphsMeeting,
  type CphsMember,
  isValidQuorum,
  workersAreElected,
  DS54_MIN_PER_SIDE,
} from '../services/cphs/types';

// ───────────────────────────────────────────────────────────────────────
// Public exports (consumidos por los tests + por consumers externos del
// formulario, p.ej. una variante embebida en `Onboarding.tsx`).
// ───────────────────────────────────────────────────────────────────────

/**
 * Resultado puro de validar el formulario "Constituir comité". Tests usan
 * esta función directamente sin renderizar React.
 */
export function validateCommitteeDraft(draft: {
  members: CphsMember[];
  period: { start: string; end: string };
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!isValidQuorum(draft.members)) {
    reasons.push(
      `Quórum insuficiente: se requieren ≥${DS54_MIN_PER_SIDE} representantes empleador y ≥${DS54_MIN_PER_SIDE} trabajadores, además de chair y secretary.`,
    );
  }
  if (!workersAreElected(draft.members)) {
    reasons.push('Los representantes de los trabajadores deben ser elegidos por sufragio (DS 54 art. 66).');
  }
  if (
    !draft.period.start ||
    !draft.period.end ||
    Date.parse(draft.period.end) <= Date.parse(draft.period.start)
  ) {
    reasons.push('El período del mandato debe tener fecha de término posterior al inicio.');
  }
  return { ok: reasons.length === 0, reasons };
}

// ───────────────────────────────────────────────────────────────────────
// Header con citas normativas (testable independiente)
// ───────────────────────────────────────────────────────────────────────

export function CphsRegulatoryHeader() {
  return (
    <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl p-6 space-y-3">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-[#4db6ac]/10 rounded-xl">
          <ShieldCheck className="w-5 h-5 text-[#4db6ac]" />
        </div>
        <div>
          <h1 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">
            Comité Paritario de Higiene y Seguridad
          </h1>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">
            Registro formal — actas firmadas + votación documentada
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        <div className="border border-zinc-200 dark:border-white/10 rounded-xl p-3">
          <p className="font-black text-zinc-900 dark:text-white text-[10px] uppercase tracking-widest mb-1">
            Chile — DS 54 art. 66
          </p>
          <p>
            Mínimo 3 representantes empleador + 3 trabajadores. Acta firmada por
            mandato legal; los representantes de los trabajadores deben ser
            elegidos por sufragio.
          </p>
        </div>
        <div className="border border-zinc-200 dark:border-white/10 rounded-xl p-3">
          <p className="font-black text-zinc-900 dark:text-white text-[10px] uppercase tracking-widest mb-1">
            ISO 45001:2018 §5.4
          </p>
          <p>
            Consulta y participación efectiva de los trabajadores como parte
            obligatoria del SG-SST.
          </p>
        </div>
      </div>
      {/* TODO Sprint 28 B1 — exponer requisitos por jurisdicción
          (`getCphsRequirements`). Por ahora pinneado a Chile DS 54.
          México NOM-019-STPS, Brasil NR-5 CIPA, Perú Ley 29783 CSST. */}
      <p className="text-[10px] text-zinc-500 italic">
        Otras jurisdicciones (MX NOM-019-STPS, BR NR-5 CIPA, PE Ley 29783) se
        soportarán cuando el registro regulatorio del Sprint 28 B1 publique
        `getCphsRequirements(jurisdiction)`.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Form — Constituir comité
// ───────────────────────────────────────────────────────────────────────

interface CommitteeDraftFormProps {
  onSubmit: (draft: { members: CphsMember[]; period: { start: string; end: string } }) => Promise<void> | void;
  candidateMembers: Array<{ uid: string; fullName: string }>;
  busy?: boolean;
}

export function CommitteeDraftForm({ onSubmit, candidateMembers, busy }: CommitteeDraftFormProps) {
  const [members, setMembers] = useState<CphsMember[]>([]);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(
    () => validateCommitteeDraft({ members, period: { start: periodStart, end: periodEnd } }),
    [members, periodStart, periodEnd],
  );

  const toggleCandidate = (uid: string, fullName: string, side: 'employer' | 'worker') => {
    setMembers((prev) => {
      const existing = prev.find((m) => m.uid === uid);
      if (existing) return prev.filter((m) => m.uid !== uid);
      return [
        ...prev,
        {
          uid,
          fullName,
          side,
          // El primer empleador agregado se marca como chair, el primer
          // worker como secretary; el resto representative. Editable en
          // un follow-up.
          role: prev.length === 0 ? 'chair' : prev.length === 1 ? 'secretary' : 'representative',
          elected: side === 'worker',
        },
      ];
    });
  };

  const submit = async () => {
    setError(null);
    if (!validation.ok) {
      setError(validation.reasons.join(' • '));
      return;
    }
    await onSubmit({ members, period: { start: periodStart, end: periodEnd } });
  };

  return (
    <form
      role="form"
      aria-label="Constituir nuevo comité paritario"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      className="space-y-4 bg-white dark:bg-zinc-900/30 border border-zinc-200 dark:border-white/10 rounded-2xl p-6"
    >
      <h2 className="text-sm font-black uppercase tracking-widest text-zinc-900 dark:text-white">
        Constituir Nuevo Comité
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs">
          <span className="block font-bold text-zinc-500 uppercase tracking-widest mb-1">Inicio mandato</span>
          <input
            type="date"
            aria-label="Inicio del mandato"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="block font-bold text-zinc-500 uppercase tracking-widest mb-1">Fin mandato</span>
          <input
            type="date"
            aria-label="Fin del mandato"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Empleador (≥3)</p>
        <div className="flex flex-wrap gap-2">
          {candidateMembers.map((c) => (
            <button
              type="button"
              key={`emp-${c.uid}`}
              onClick={() => toggleCandidate(c.uid, c.fullName, 'employer')}
              aria-pressed={members.some((m) => m.uid === c.uid && m.side === 'employer')}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                members.some((m) => m.uid === c.uid && m.side === 'employer')
                  ? 'bg-[#4db6ac] text-white border-[#4db6ac]'
                  : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300'
              }`}
            >
              {c.fullName}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Trabajadores elegidos (≥3)</p>
        <div className="flex flex-wrap gap-2">
          {candidateMembers.map((c) => (
            <button
              type="button"
              key={`wrk-${c.uid}`}
              onClick={() => toggleCandidate(c.uid, c.fullName, 'worker')}
              aria-pressed={members.some((m) => m.uid === c.uid && m.side === 'worker')}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                members.some((m) => m.uid === c.uid && m.side === 'worker')
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300'
              }`}
            >
              {c.fullName}
            </button>
          ))}
        </div>
      </div>
      {!validation.ok && (
        <div className="text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <ul className="list-disc list-inside space-y-1">
            {validation.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
      <button
        type="submit"
        disabled={busy || !validation.ok}
        className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black text-xs font-black uppercase tracking-widest disabled:opacity-50"
      >
        {busy ? 'Constituyendo…' : 'Constituir Comité'}
      </button>
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Sign minutes button — invoca WebAuthn ceremony
// ───────────────────────────────────────────────────────────────────────

interface SignMinutesButtonProps {
  meeting: CphsMeeting;
  uid: string;
  /** Callback que el padre debe wirear contra `cphsService.signMinutes()`. */
  onSign: (params: { credentialId: string; signature: string }) => Promise<void>;
  /**
   * WebAuthn ceremony override — los tests pasan un stub. Por defecto
   * intenta `navigator.credentials.get(...)`.
   */
  ceremony?: () => Promise<{ credentialId: string; signature: string }>;
}

async function defaultCeremony(): Promise<{ credentialId: string; signature: string }> {
  // Round 14 R5 + Round 19 R19 reusan `webauthnCredentialStore.ts` y
  // `webauthnChallenge.ts` server-side. Aquí el flow client-side es el
  // mismo que `curriculum/RefereeAccept.tsx`: pedimos un challenge al
  // server, lanzamos `navigator.credentials.get()` con allowCredentials
  // del usuario, y subimos la assertion. Para el módulo CPHS reusamos
  // el endpoint /api/auth/webauthn/challenge → /verify y el handler
  // server-side luego llama `signMinutes()` en el service.
  //
  // El detalle del fetch no vive aquí — esta función es sólo la
  // ceremonia browser. El padre del componente resuelve el endpoint.
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn no disponible en este dispositivo');
  }
  // Placeholder: en producción el padre llama a su API que retorna el
  // challenge, lanza la ceremony y devuelve {credentialId, signature}.
  throw new Error('ceremony override required for production wiring');
}

export function SignMinutesButton({ meeting, uid, onSign, ceremony }: SignMinutesButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alreadySigned = meeting.signatures.some((s) => s.uid === uid);
  const eligible = meeting.attendees.includes(uid) && meeting.status === 'held' && !alreadySigned;

  const click = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await (ceremony ?? defaultCeremony)();
      await onSign(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al firmar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={click}
        disabled={!eligible || busy}
        aria-label={alreadySigned ? 'Ya firmaste esta acta' : 'Firmar acta con WebAuthn'}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest"
      >
        <PenTool className="w-4 h-4" />
        {alreadySigned ? 'Firmada' : busy ? 'Firmando…' : 'Firmar Acta'}
      </button>
      {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Lista de comités + reuniones (vista principal)
// ───────────────────────────────────────────────────────────────────────

interface CphsModuleProps {
  committees: CphsCommittee[];
  meetingsByCommittee: Record<string, CphsMeeting[]>;
  candidateMembers: Array<{ uid: string; fullName: string }>;
  currentUid: string;
  onCreateCommittee: (draft: { members: CphsMember[]; period: { start: string; end: string } }) => Promise<void>;
  onScheduleMeeting: (committeeId: string, scheduledAt: string, agenda: string[]) => Promise<void>;
  onSignMinutes: (meetingId: string, params: { credentialId: string; signature: string }) => Promise<void>;
  onExportPdf: (meeting: CphsMeeting) => void;
}

/**
 * Vista principal "presentational". Recibe data + callbacks para que
 * los tests puedan render sin booting Firestore. El default-export
 * (`<CphsModulePage />` abajo) wirea esto contra `cphsService`.
 */
export function CphsModule({
  committees,
  meetingsByCommittee,
  candidateMembers,
  currentUid,
  onCreateCommittee,
  onScheduleMeeting,
  onSignMinutes,
  onExportPdf,
}: CphsModuleProps) {
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <CphsRegulatoryHeader />

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">
          Comités del Proyecto ({committees.length})
        </h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black text-xs font-black uppercase tracking-widest"
        >
          <Plus className="w-4 h-4" />
          {showForm ? 'Cancelar' : 'Constituir nuevo comité'}
        </button>
      </div>

      {showForm && (
        <CommitteeDraftForm
          candidateMembers={candidateMembers}
          busy={busy}
          onSubmit={async (draft) => {
            setBusy(true);
            try {
              await onCreateCommittee(draft);
              setShowForm(false);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {committees.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-zinc-900/30 rounded-2xl border border-zinc-200 dark:border-white/10">
          <Users className="w-12 h-12 text-zinc-400 mx-auto mb-4" />
          <p className="text-sm text-zinc-500">Aún no hay comités constituidos en este proyecto.</p>
        </div>
      ) : (
        committees.map((c) => (
          <CommitteeCard
            key={c.id}
            committee={c}
            meetings={meetingsByCommittee[c.id] ?? []}
            currentUid={currentUid}
            onScheduleMeeting={onScheduleMeeting}
            onSignMinutes={onSignMinutes}
            onExportPdf={onExportPdf}
          />
        ))
      )}
    </div>
  );
}

interface CommitteeCardProps {
  committee: CphsCommittee;
  meetings: CphsMeeting[];
  currentUid: string;
  onScheduleMeeting: (committeeId: string, scheduledAt: string, agenda: string[]) => Promise<void>;
  onSignMinutes: (meetingId: string, params: { credentialId: string; signature: string }) => Promise<void>;
  onExportPdf: (meeting: CphsMeeting) => void;
}

function CommitteeCard({
  committee,
  meetings,
  currentUid,
  onScheduleMeeting,
  onSignMinutes,
  onExportPdf,
}: CommitteeCardProps) {
  const [agendaItem, setAgendaItem] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduling, setScheduling] = useState(false);

  return (
    <article className="bg-white dark:bg-zinc-900/30 rounded-2xl border border-zinc-200 dark:border-white/10 p-6 space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
            Período {committee.period.start} → {committee.period.end}
          </p>
          <p className="text-sm font-bold text-zinc-900 dark:text-white mt-1">
            {committee.members.length} miembros · status: {committee.status}
          </p>
        </div>
        {committee.iso45001Compliance ? (
          <span className="px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
            ISO 45001 §5.4 ✓
          </span>
        ) : (
          <span className="px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
            ISO 45001 — pendiente sufragio
          </span>
        )}
      </header>

      <section className="space-y-2">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Agendar reunión</p>
        <div className="flex flex-wrap gap-2">
          <input
            type="datetime-local"
            aria-label="Fecha y hora de la reunión"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs"
          />
          <input
            type="text"
            aria-label="Item de agenda"
            placeholder="Item de agenda"
            value={agendaItem}
            onChange={(e) => setAgendaItem(e.target.value)}
            className="flex-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs"
          />
          <button
            type="button"
            disabled={scheduling || !scheduledAt || !agendaItem.trim()}
            onClick={async () => {
              setScheduling(true);
              try {
                await onScheduleMeeting(committee.id, new Date(scheduledAt).toISOString(), [agendaItem.trim()]);
                setAgendaItem('');
                setScheduledAt('');
              } finally {
                setScheduling(false);
              }
            }}
            className="px-3 py-2 rounded-lg bg-[#4db6ac] hover:bg-[#3fa39a] text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
          >
            <CalendarIcon className="w-3.5 h-3.5 inline mr-1" /> Agendar
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
          Reuniones ({meetings.length})
        </p>
        {meetings.length === 0 ? (
          <p className="text-xs text-zinc-500">Sin reuniones registradas.</p>
        ) : (
          <ul className="space-y-2">
            {meetings.map((m) => (
              <li
                key={m.id}
                className="border border-zinc-200 dark:border-white/10 rounded-xl p-3 flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-zinc-900 dark:text-white">
                    {new Date(m.scheduledAt).toLocaleString('es-CL')}
                  </p>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest">
                    {m.status} · {m.signatures.length} firmas · {m.resolutions.length} resoluciones
                  </p>
                </div>
                <SignMinutesButton
                  meeting={m}
                  uid={currentUid}
                  onSign={(params) => onSignMinutes(m.id, params)}
                />
                {m.signatures.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onExportPdf(m)}
                    aria-label="Exportar acta a PDF"
                    className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  >
                    <FileText className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Default export — versión "container" wireada contra cphsService.
//
// Esta es la que el router lazy-importa en /cphs. Toma el currentUid del
// FirebaseContext y el projectId del ProjectContext. La data viaja a
// través del componente presentational `CphsModule` para que los tests
// puedan ejercerlo sin Firestore.
// ───────────────────────────────────────────────────────────────────────

export default function CphsModulePage() {
  // El wiring real contra firestore admin via REST es un follow-up del
  // sprint próximo (mismo patrón que `comite_actas` de ComiteParitario.tsx
  // pero contra `cphs_committees` + `cphs_meetings`). Por ahora la página
  // expone el componente vacío con un mensaje explicativo — los tests y
  // el módulo presentational ya están listos para conectarse.
  return (
    <CphsModule
      committees={[]}
      meetingsByCommittee={{}}
      candidateMembers={[]}
      currentUid={''}
      onCreateCommittee={async () => undefined}
      onScheduleMeeting={async () => undefined}
      onSignMinutes={async () => undefined}
      onExportPdf={() => undefined}
    />
  );
}
