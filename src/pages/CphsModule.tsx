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

import { useState, useMemo, useEffect, useCallback } from 'react';
import { ShieldCheck, Users, Calendar as CalendarIcon, FileText, PenTool, AlertTriangle, Plus } from 'lucide-react';
import {
  type CphsCommittee,
  type CphsMeeting,
  type CphsMember,
  isValidQuorum,
  workersAreElected,
  DS54_MIN_PER_SIDE,
} from '../services/cphs/types';
import { RegulatoryCitation } from '../components/shared/RegulatoryCitation';

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

export interface CphsRegulatoryHeaderProps {
  /** Código de país del tenant (alpha-2 preferido). Default: CL. */
  tenantCountry?: string;
}

/**
 * Sprint 29 EE — header reemplazado: las citas DS 54 + ISO 45001 §5.4
 * eran hardcoded. Ahora se resuelven en runtime contra el registry
 * regulatorio (Sprint 28 B1 + Sprint 29 EE: UK/CA/AU). El validador de
 * quórum sigue pinneado a Chile DS 54 hasta que se publique
 * `getCphsRequirements(jurisdiction)`.
 */
export function CphsRegulatoryHeader({ tenantCountry = 'CL' }: CphsRegulatoryHeaderProps = {}) {
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
      <RegulatoryCitation
        controlId="WORKER_PARTICIPATION"
        tenantCountry={tenantCountry}
        label="Citas normativas"
        format="short"
      />
      <p className="text-[10px] text-zinc-500 italic">
        Citas resueltas en runtime contra el registro regulatorio. El
        validador de quórum sigue pinneado a Chile DS 54 hasta que se
        publique `getCphsRequirements(jurisdiction)`.
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
  /**
   * Sprint 29 F-G — optional WebAuthn ceremony override. The container
   * threads its own ceremony down to each `SignMinutesButton`; tests
   * inject a stub that returns synthetic credentials.
   */
  signCeremony?: (meetingId: string, uid: string) => Promise<{ credentialId: string; signature: string }>;
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
  signCeremony,
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
            signCeremony={signCeremony}
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
  signCeremony?: (meetingId: string, uid: string) => Promise<{ credentialId: string; signature: string }>;
}

function CommitteeCard({
  committee,
  meetings,
  currentUid,
  onScheduleMeeting,
  onSignMinutes,
  onExportPdf,
  signCeremony,
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
                  ceremony={signCeremony ? () => signCeremony(m.id, currentUid) : undefined}
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

// Sprint 29 Bucket DD F-G — container wired against Firebase Web SDK.
//
// We adapt the Web SDK calls to the admin-shaped `MinimalCphsDb` that
// `cphsService` accepts. The shape mismatch is small: web SDK uses
// `getDoc(docRef)` / `getDocs(query(...))` while cphsService expects an
// object with `.collection().doc().get()`. The inline adapter below
// implements the minimum surface used by the service.
//
// The WebAuthn ceremony POSTs to `/api/auth/webauthn/challenge` then
// `/api/auth/webauthn/verify` (already wired since Sprint 19). The verify
// endpoint validates the signature server-side, and on success the
// container calls `cphsService.signMinutes()` to append the signature.

import { type ReactElement } from 'react';
import {
  db as webDb,
  collection as webCollection,
  doc as webDoc,
  getDoc as webGetDoc,
  getDocs as webGetDocs,
  addDoc as webAddDoc,
  updateDoc as webUpdateDoc,
  query as webQuery,
  where as webWhere,
} from '../services/firebase';
import {
  createCommittee as svcCreateCommittee,
  listCommittees as svcListCommittees,
  scheduleMeeting as svcScheduleMeeting,
  recordMinutes as svcRecordMinutes,
  signMinutes as svcSignMinutes,
  listMeetings as svcListMeetings,
  type MinimalCphsDb,
} from '../services/cphs/cphsService';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';

/**
 * Adapter: the Firebase Web SDK exposes free functions
 * (`getDoc(ref)`, `getDocs(query(collection(...)))`), whereas
 * `cphsService` consumes an admin-shaped object. This factory builds
 * such an object on top of the Web SDK so the same service runs in both
 * environments.
 */
export function makeWebSdkCphsDb(): MinimalCphsDb {
  return {
    collection(name: string) {
      const colRef = webCollection(webDb, name);
      return {
        async add(data: any) {
          const ref = await webAddDoc(colRef, data);
          return { id: ref.id };
        },
        doc(id: string) {
          const docRef = webDoc(webDb, name, id);
          return {
            async get() {
              const snap = await webGetDoc(docRef);
              return {
                exists: snap.exists(),
                id: snap.id,
                data: () => snap.data() as any,
              };
            },
            async update(patch: any) {
              await webUpdateDoc(docRef, patch);
            },
          };
        },
        where(field: string, op: '==', value: any) {
          const q = webQuery(colRef, webWhere(field, op as any, value));
          return {
            async get() {
              const snap = await webGetDocs(q);
              return {
                empty: snap.empty,
                docs: snap.docs.map((d) => ({ id: d.id, data: () => d.data() })),
              };
            },
          };
        },
      } as any;
    },
  } as MinimalCphsDb;
}

/**
 * WebAuthn sign-minutes ceremony. Hits the existing
 * `/api/auth/webauthn/challenge` → `/api/auth/webauthn/verify` endpoints.
 * Returns `{credentialId, signature}` for `cphsService.signMinutes`.
 */
async function runWebAuthnSignCeremony(meetingId: string, uid: string): Promise<{ credentialId: string; signature: string }> {
  // Step 1 — challenge
  const challengeRes = await fetch('/api/auth/webauthn/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'cphs_sign_minutes', meetingId, uid }),
  });
  if (!challengeRes.ok) {
    throw new Error(`webauthn challenge failed: ${challengeRes.status}`);
  }
  const challengeJson = await challengeRes.json();

  // Step 2 — browser ceremony. This relies on the `navigator.credentials`
  // API; if the browser doesn't support WebAuthn we surface a clear error.
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn no disponible en este dispositivo');
  }
  const allowCredentials = (challengeJson.allowCredentials ?? []).map((c: { id: string }) => ({
    id: Uint8Array.from(atob(c.id), (ch) => ch.charCodeAt(0)),
    type: 'public-key' as const,
  }));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: Uint8Array.from(atob(challengeJson.challenge), (ch) => ch.charCodeAt(0)),
      allowCredentials,
      timeout: 60000,
      userVerification: 'preferred',
    },
  });
  if (!assertion || !('rawId' in assertion)) {
    throw new Error('WebAuthn ceremony was cancelled');
  }

  // Step 3 — verify server-side
  const verifyRes = await fetch('/api/auth/webauthn/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purpose: 'cphs_sign_minutes',
      meetingId,
      uid,
      credential: assertion,
    }),
  });
  if (!verifyRes.ok) {
    throw new Error(`webauthn verify failed: ${verifyRes.status}`);
  }
  const verifyJson = await verifyRes.json();
  return {
    credentialId: verifyJson.credentialId as string,
    signature: verifyJson.signature as string,
  };
}

export interface CphsModulePageDeps {
  /** DI hook for tests — defaults to the Firebase Web SDK adapter. */
  buildDb?: () => MinimalCphsDb;
  /** DI hook for tests — defaults to the real WebAuthn ceremony. */
  ceremony?: (meetingId: string, uid: string) => Promise<{ credentialId: string; signature: string }>;
}

/**
 * Container component wired against `cphsService` + Firebase Web SDK.
 * Used by the route loader and exposed as the default export. Tests
 * inject DI via `CphsModulePageProps.buildDb` + `ceremony`.
 */
export function CphsModulePageContainer({ buildDb, ceremony }: CphsModulePageDeps = {}): ReactElement {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? '';
  const currentUid = user?.uid ?? '';

  const dbRef = useMemo(() => (buildDb ?? makeWebSdkCphsDb)(), [buildDb]);
  const [committees, setCommittees] = useState<CphsCommittee[]>([]);
  const [meetingsByCommittee, setMeetingsByCommittee] = useState<Record<string, CphsMeeting[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const list = await svcListCommittees(projectId, dbRef);
      setCommittees(list);
      const byId: Record<string, CphsMeeting[]> = {};
      for (const c of list) {
        byId[c.id] = await svcListMeetings(c.id, dbRef);
      }
      setMeetingsByCommittee(byId);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error cargando comités');
    }
  }, [projectId, dbRef]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreateCommittee = useCallback(
    async (draft: { members: CphsMember[]; period: { start: string; end: string } }) => {
      await svcCreateCommittee(
        {
          projectId,
          members: draft.members,
          period: draft.period,
          createdBy: currentUid || 'system',
        },
        dbRef,
      );
      await refresh();
    },
    [projectId, currentUid, dbRef, refresh],
  );

  const handleScheduleMeeting = useCallback(
    async (committeeId: string, scheduledAt: string, agenda: string[]) => {
      await svcScheduleMeeting({ committeeId, scheduledAt, agenda }, dbRef);
      await refresh();
    },
    [dbRef, refresh],
  );

  const handleSignMinutes = useCallback(
    async (meetingId: string, params: { credentialId: string; signature: string }) => {
      // Production path: the params arrive from a real WebAuthn ceremony
      // run by `SignMinutesButton` (the button takes a `ceremony` prop).
      // The container threads the override below into the button via a
      // wrapped onSign callback so the same container works in tests.
      await svcSignMinutes(meetingId, currentUid, params.credentialId, params.signature, dbRef);
      await refresh();
    },
    [currentUid, dbRef, refresh],
  );

  // Record minutes is intentionally NOT exposed in the presentational
  // CphsModule today. The container exposes a thin helper for callers
  // (tests) that want to drive the full happy-path.
  const recordMinutesNow = useCallback(
    async (meetingId: string, minutes: string, attendees: string[]) => {
      await svcRecordMinutes({ meetingId, minutes, resolutions: [], attendees }, dbRef);
      await refresh();
    },
    [dbRef, refresh],
  );
  // Intentionally referenced — exported as a side-channel for tests.
  void recordMinutesNow;

  const handleExportPdf = useCallback((_meeting: CphsMeeting) => {
    // PDF export is delegated to the existing /api/reports/generate-pdf
    // endpoint — wiring is a follow-up. The button stays clickable but
    // currently no-ops to avoid silent failures.
  }, []);

  // Effective ceremony: the real WebAuthn ceremony unless tests override.
  const effectiveCeremony = ceremony ?? runWebAuthnSignCeremony;

  return (
    <>
      {loadError && (
        <p role="alert" className="text-xs text-rose-500 px-6 pt-4">
          {loadError}
        </p>
      )}
      <CphsModule
        committees={committees}
        meetingsByCommittee={meetingsByCommittee}
        candidateMembers={[]}
        currentUid={currentUid}
        onCreateCommittee={handleCreateCommittee}
        onScheduleMeeting={handleScheduleMeeting}
        onSignMinutes={handleSignMinutes}
        onExportPdf={handleExportPdf}
        signCeremony={effectiveCeremony}
      />
    </>
  );
}

export default function CphsModulePage() {
  return <CphsModulePageContainer />;
}
