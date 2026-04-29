import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Award, Star, Clock, FileText, Briefcase, AlertTriangle, FolderOpen, Target, Plus, BadgeCheck } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useFirebase } from '../contexts/FirebaseContext';
import { ClaimForm } from '../components/curriculum/ClaimForm';
import { ClaimStatus } from '../components/curriculum/ClaimStatus';
import { auth, db } from '../services/firebase';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import type { CurriculumClaim } from '../services/curriculum/claims';
import {
  aggregateUserHistory,
  type AuditLogRow,
  type CurriculumHistoryEvent,
  type GamificationScoreRow,
} from '../services/curriculum/historyAggregator';
import { logger } from '../utils/logger';

// ── Round 17 (R5) — wires the Firestore reads documented in Round 16 (R1).
//
// We now hydrate badges, history, skills and stats from real Firestore
// rows (subject to firestore.rules). Each source is independently
// resilient: a missing collection, an empty result, or an outright read
// error degrades gracefully to an honest "Sin datos aún" empty state
// instead of fabricating CV content.
//
// Firestore paths used:
//   badges  → users/{uid}/awards            (subcollection)
//   history → audit_logs WHERE userId == uid + safety/training/curriculum/
//             gamification action prefixes (filtered + ordered + limit 20
//             via the pure aggregator at services/curriculum/historyAggregator.ts)
//   skills  → users/{uid}.profile.skills    (array field on user doc)
//   stats   → derived (level/xp from gamification_scores; counts from audit_logs)

interface CurriculumBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

interface CurriculumSkill {
  id: string;
  name: string;
  level: number;
  max: number;
  icon: typeof ShieldCheck;
  color: string;
}

// Map an audit-log action to a human-readable history entry. Pure UI
// projection — keeps the Spanish-CL copy out of the aggregator.
function describeEvent(ev: CurriculumHistoryEvent): {
  project: string;
  role: string;
  duration: string;
  incidentFree: boolean;
  date: string;
} {
  const date = ev.timestamp ? new Date(ev.timestamp as any).toLocaleDateString('es-CL') : '';
  const action = ev.action;
  let project = action;
  let role = ev.module ?? 'Praeventio';
  let incidentFree = true;
  if (action.startsWith('training.') && action.endsWith('.completed')) {
    project = 'Capacitación completada';
  } else if (action.startsWith('safety.iper.')) {
    project = 'Evaluación IPER';
    incidentFree = ((ev.details as any)?.level ?? '') !== 'CRITICO';
  } else if (action.startsWith('safety.ergonomic.')) {
    project = 'Evaluación ergonómica';
    const score = Number((ev.details as any)?.score);
    incidentFree = !(Number.isFinite(score) && score >= 11);
  } else if (action.startsWith('safety.report.')) {
    project = 'Reporte de seguridad';
  } else if (action.startsWith('curriculum.')) {
    project = 'Claim verificable';
  } else if (action.startsWith('gamification.')) {
    project = 'Logro / medalla';
  }
  return { project, role, duration: '', incidentFree, date };
}

const SKILL_ICONS: Record<string, typeof ShieldCheck> = {
  safety: ShieldCheck,
  training: Target,
  default: Star,
};

export function PortableCurriculum() {
  const { user } = useFirebase();

  // ── Round 14 (R5): worker's verifiable claims (anti-fraud experience). ──
  const [claims, setClaims] = useState<CurriculumClaim[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // ── Round 17 (R5): real Firestore reads (cancelled-flag pattern, mirrors
  // UserProfileModal.tsx Round 16). Each source degrades independently:
  // a user with badges but no audit_logs still sees their badges; a user
  // with audit_logs but no gamification_scores sees a level-1/xp-0 baseline.
  const [badges, setBadges] = useState<CurriculumBadge[]>([]);
  const [history, setHistory] = useState<CurriculumHistoryEvent[]>([]);
  const [skills, setSkills] = useState<CurriculumSkill[]>([]);
  const [stats, setStats] = useState({
    level: 1,
    xp: 0,
    nextLevelXp: 1000,
    safeHours: 0,
    coursesCompleted: 0,
    perfectChecks: 0,
  });

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    const uid = user.uid;
    async function loadCurriculum() {
      // Read each source independently so a single failure (e.g. missing
      // index, rules denial) doesn't black out the whole page.
      let auditRows: AuditLogRow[] = [];
      let gamRows: GamificationScoreRow[] = [];
      try {
        const auditQ = query(
          collection(db, 'audit_logs'),
          where('userId', '==', uid),
          limit(200),
        );
        const auditSnap = await getDocs(auditQ);
        auditRows = auditSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      } catch (err) {
        logger.warn('curriculum_audit_logs_load_failed', {
          uid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        const gamQ = query(collection(db, 'gamification_scores'), where('userId', '==', uid));
        const gamSnap = await getDocs(gamQ);
        gamRows = gamSnap.docs.map((d) => d.data() as any);
      } catch (err) {
        logger.warn('curriculum_gamification_load_failed', {
          uid,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      let awardsList: CurriculumBadge[] = [];
      try {
        const awardsSnap = await getDocs(collection(db, 'users', uid, 'awards'));
        awardsList = awardsSnap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: String(data.name ?? data.title ?? 'Medalla'),
            description: String(data.description ?? ''),
            icon: String(data.icon ?? '🏅'),
            color: String(data.color ?? 'bg-amber-500/20 text-amber-500'),
          };
        });
      } catch (err) {
        logger.warn('curriculum_awards_load_failed', {
          uid,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      let skillsList: CurriculumSkill[] = [];
      try {
        const userSnap = await getDoc(doc(db, 'users', uid));
        const profileSkills = (userSnap.data() as any)?.profile?.skills;
        if (Array.isArray(profileSkills)) {
          skillsList = profileSkills
            .filter((s) => s && typeof s === 'object' && typeof s.name === 'string')
            .map((s, idx) => {
              const cat = String(s.category ?? 'default');
              return {
                id: String(s.id ?? `skill-${idx}`),
                name: String(s.name),
                level: Math.max(0, Number(s.level) || 0),
                max: Math.max(1, Number(s.max) || 5),
                icon: SKILL_ICONS[cat] ?? SKILL_ICONS.default,
                color: String(s.color ?? 'text-indigo-500'),
              };
            });
        }
      } catch (err) {
        logger.warn('curriculum_skills_load_failed', {
          uid,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (cancelled) return;

      const aggregated = aggregateUserHistory(auditRows, gamRows);
      setHistory(aggregated.events);
      setBadges(awardsList);
      setSkills(skillsList);

      // nextLevelXp follows the same /1000 ladder as the aggregator.
      const xp = aggregated.stats.xp;
      const level = aggregated.stats.level;
      setStats({
        level,
        xp,
        nextLevelXp: level * 1000,
        safeHours: 0, // placeholder — wire when audit emits training.*.duration.
        coursesCompleted: aggregated.stats.completedTrainings,
        perfectChecks: Math.max(0, aggregated.events.length - aggregated.stats.criticalAssessments),
      });
    }
    loadCurriculum();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  async function fetchClaims() {
    if (!auth.currentUser) return;
    setClaimsLoading(true);
    setClaimsError(null);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/curriculum/claims', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error('No se pudieron cargar los claims.');
      const data = await res.json();
      setClaims(Array.isArray(data?.claims) ? data.claims : []);
    } catch (err: any) {
      setClaimsError(err?.message || 'Error al cargar los claims.');
    } finally {
      setClaimsLoading(false);
    }
  }

  useEffect(() => {
    if (user) fetchClaims();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header Profile */}
      <div className="flex flex-col md:flex-row items-center md:items-start gap-6 bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200 dark:border-white/10 shadow-xl">
        <div className="relative">
          <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-gradient-to-br from-emerald-400 to-blue-500 p-1">
            <div className="w-full h-full rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center overflow-hidden">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <ShieldCheck className="w-12 h-12 text-emerald-500" />
              )}
            </div>
          </div>
          <div className="absolute -bottom-2 -right-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-black px-3 py-1 rounded-full border-2 border-white dark:border-zinc-900 shadow-lg">
            NIVEL {stats.level}
          </div>
        </div>

        <div className="flex-1 text-center md:text-left space-y-2">
          <h1 className="text-2xl sm:text-3xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">
            {user?.displayName || 'Usuario Guardián'}
          </h1>
          <p className="text-sm font-medium text-zinc-500 uppercase tracking-widest flex items-center justify-center md:justify-start gap-2">
            <Briefcase className="w-4 h-4" /> Especialista en Prevención
          </p>

          <div className="mt-4 max-w-md">
            <div className="flex justify-between text-xs font-bold text-zinc-500 mb-1">
              <span>PROGRESO XP</span>
              <span>{stats.xp} / {stats.nextLevelXp}</span>
            </div>
            <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-blue-500"
                style={{ width: `${(stats.xp / stats.nextLevelXp) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-row md:flex-col gap-4">
          <div className="text-center p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-white/5">
            <p className="text-2xl font-black text-emerald-500">{stats.safeHours}</p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Horas Seguras</p>
          </div>
          <div className="text-center p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-white/5">
            <p className="text-2xl font-black text-blue-500">{stats.perfectChecks}</p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Fast Checks</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Badges & Courses */}
        <div className="space-y-6">
          <Card className="p-6 space-y-4">
            <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
              <Target className="w-5 h-5 text-indigo-500" />
              Árbol de Habilidades
            </h2>
            <div className="space-y-4">
              {skills.length === 0 ? (
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Aún no tenés habilidades registradas. Tu perfil se irá completando a medida que rindas capacitaciones y tus referencias firmen claims.
                </p>
              ) : (
                skills.map(skill => (
                  <div key={skill.id} className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <skill.icon className={`w-3.5 h-3.5 ${skill.color}`} />
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{skill.name}</span>
                      </div>
                      <span className="text-[10px] font-black text-zinc-900 dark:text-white">Lvl {skill.level}</span>
                    </div>
                    <div className="flex gap-1">
                      {Array.from({ length: skill.max }).map((_, i) => (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 rounded-full ${
                            i < skill.level ? 'bg-indigo-500' : 'bg-zinc-100 dark:bg-zinc-800'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-500" />
              Medallas Obtenidas
            </h2>
            {badges.length === 0 ? (
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Todavía no obtuviste medallas. Las medallas se otorgan al completar simuladores, capacitaciones y rachas de Fast Checks sin error.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {badges.map(badge => (
                  <div key={badge.id} className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 text-center group hover:border-amber-500/50 transition-colors cursor-default">
                    <div className={`w-10 h-10 mx-auto rounded-full flex items-center justify-center text-xl mb-2 ${badge.color}`}>
                      {badge.icon}
                    </div>
                    <p className="text-xs font-bold text-zinc-900 dark:text-white mb-1">{badge.name}</p>
                    <p className="text-[9px] text-zinc-500 leading-tight opacity-0 group-hover:opacity-100 transition-opacity absolute bg-white dark:bg-zinc-900 p-2 rounded shadow-xl z-10 w-40 -ml-10">
                      {badge.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" />
              Capacitaciones ({stats.coursesCompleted})
            </h2>
            {stats.coursesCompleted === 0 ? (
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Aún no completaste capacitaciones registradas en el sistema.
              </p>
            ) : (
              <div className="space-y-3">
                {/*
                  Round 16 (R1) — once `audit_logs` filtered by
                  action='training.*.completed' lands as a Firestore
                  reader hook (deferred), this list will render real
                  rows. Until then we only show the count, not
                  fabricated rows.
                */}
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Tenés {stats.coursesCompleted} capacitaciones registradas. El detalle aparecerá acá próximamente.
                </p>
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Work History (Folder UI for ISO Mobile Standards) */}
        <div className="lg:col-span-2">
          <Card className="p-6 h-full space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-emerald-500" />
                Dossier de Proyectos (CV)
              </h2>
              <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-full uppercase tracking-wider">
                Verificado por Praeventio
              </span>
            </div>

            {history.length === 0 ? (
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Sin proyectos verificados aún. Tu CV portable se construye automáticamente al registrarte en proyectos y al recibir co-firmas de tus referencias.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {history.map((event, index) => {
                  const item = describeEvent(event);
                  const key = `${event.action}-${event.timestamp ?? index}-${index}`;
                  return (
                    <motion.div
                      key={key}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="relative group cursor-pointer"
                    >
                      {/* Folder Tab */}
                      <div className="w-1/3 h-4 bg-zinc-200 dark:bg-zinc-800 rounded-t-lg ml-3 transition-colors group-hover:bg-emerald-500/20" />

                      {/* Folder Body */}
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-2xl rounded-tl-none p-5 shadow-sm hover:shadow-md transition-all group-hover:border-emerald-500/30 min-h-[160px] flex flex-col justify-between">
                        <div>
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-3">
                              <div className={`p-2.5 rounded-xl ${item.incidentFree ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                                <FolderOpen className="w-6 h-6" />
                              </div>
                              <div>
                                <h3 className="font-black text-zinc-900 dark:text-white text-sm leading-tight">{item.project}</h3>
                                <p className="text-xs text-zinc-500 font-medium mt-0.5">{item.role}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" /> {item.date || 'Sin fecha'}
                            </span>
                          </div>
                          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider w-fit ${
                            item.incidentFree ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                          }`}>
                            {item.incidentFree ? <Star className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                            {item.incidentFree ? 'Cero Incidentes' : 'Hallazgo crítico'}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Round 14 (R5): Verifiable claims section ─────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <BadgeCheck className="w-5 h-5 text-emerald-500" />
            <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest">
              Mis claims verificados
            </h2>
          </div>
          {!showForm && (
            <Button onClick={() => setShowForm(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Crear nuevo claim
            </Button>
          )}
        </div>

        {showForm && (
          <ClaimForm
            onCreated={() => {
              setShowForm(false);
              fetchClaims();
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {claimsLoading && (
          <Card className="p-6 text-center text-xs text-zinc-500">Cargando claims...</Card>
        )}
        {claimsError && (
          <Card className="p-4 text-xs text-rose-500 bg-rose-500/5 border-rose-500/20">
            {claimsError}
          </Card>
        )}
        {!claimsLoading && claims.length === 0 && !claimsError && !showForm && (
          <Card className="p-6 text-center text-xs text-zinc-500 space-y-2">
            <p>Todavía no creaste ningún claim verificable.</p>
            <p className="text-[10px] text-zinc-400">
              Un claim es algo verificable sobre tu experiencia (años de trabajo, certificaciones, registro de incidentes) que firmarás con huella y será co-firmado por 2 referencias.
            </p>
          </Card>
        )}
        {claims.map((c) => (
          <ClaimStatus key={c.id} claim={c} />
        ))}
      </div>
    </div>
  );
}
