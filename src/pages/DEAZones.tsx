import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  HeartPulse,
  MapPin,
  Battery,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Calendar,
  ShieldAlert,
  Activity,
  FileText,
} from 'lucide-react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { Card, Button } from '../components/shared/Card';
import {
  computeDeaStatus,
  isChecklistComplete,
  type Dea,
  type DeaInspection,
  type DeaStatus,
} from '../services/dea/deaService';
import { logger } from '../utils/logger';

// 2026-05-15 (Sprint C): wire real a Firestore.
//
// Antes este archivo tenía un MOCK_DEAS hardcoded con 3 DEAs ficticios
// y aprobaciones de inspección que NO persistían — un fake crítico
// porque Ley 21.156 exige registro y mantenimiento documentado.
//
// Ahora:
//   - DEAs leen reactivamente de Firestore (`projects/{pid}/deas`).
//   - El status se calcula determinísticamente desde
//     batteryExpiry/padsExpiry/lastCheck via `computeDeaStatus`.
//   - La inspección persiste como subdocumento + actualiza `lastCheck`.
//   - Sin DEAs registrados: empty state con CTA real para crear el primero.

interface ChecklistState {
  statusLightGreen: boolean;
  batteryConnectedValid: boolean;
  padsSealedValid: boolean;
  responseKitComplete: boolean;
  cabinetIntactAlarmOperative: boolean;
}

const EMPTY_CHECKLIST: ChecklistState = {
  statusLightGreen: false,
  batteryConnectedValid: false,
  padsSealedValid: false,
  responseKitComplete: false,
  cabinetIntactAlarmOperative: false,
};

interface RegisterForm {
  location: string;
  description: string;
  batteryExpiry: string;
  padsExpiry: string;
  assignedToName: string;
}

const EMPTY_REGISTER: RegisterForm = {
  location: '',
  description: '',
  batteryExpiry: '',
  padsExpiry: '',
  assignedToName: '',
};

export function DEAZones() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { user } = useFirebase();

  const deasPath = selectedProject ? `projects/${selectedProject.id}/deas` : null;
  const { data: deas, loading } = useFirestoreCollection<Dea>(deasPath);

  const [selectedDEA, setSelectedDEA] = useState<Dea | null>(null);
  const [isChecklistOpen, setIsChecklistOpen] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistState>(EMPTY_CHECKLIST);
  const [submitting, setSubmitting] = useState(false);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState<RegisterForm>(EMPTY_REGISTER);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * Cada DEA viene crudo de Firestore; le agregamos el status calculado
   * para que el UI no tenga que recalcularlo en cada render. Memo evita
   * recompute si la lista no cambió.
   */
  const enrichedDeas = useMemo(() => {
    const list = deas ?? [];
    return list.map((dea) => ({
      ...dea,
      status: computeDeaStatus(dea) as DeaStatus,
    }));
  }, [deas]);

  const getStatusColor = (status: DeaStatus) => {
    switch (status) {
      case 'operational':
        return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case 'warning':
        return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'critical':
        return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
    }
  };

  const getStatusIcon = (status: DeaStatus) => {
    switch (status) {
      case 'operational':
        return <CheckCircle2 className="w-5 h-5" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5" />;
      case 'critical':
        return <ShieldAlert className="w-5 h-5" />;
    }
  };

  const handlePerformCheck = (dea: Dea) => {
    setSelectedDEA(dea);
    setChecklist(EMPTY_CHECKLIST);
    setIsChecklistOpen(true);
    setErrorMessage(null);
  };

  const handleRegisterNew = () => {
    setRegisterForm(EMPTY_REGISTER);
    setIsRegisterOpen(true);
    setErrorMessage(null);
  };

  const submitChecklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDEA || !selectedProject || !user) return;
    if (submitting) return;

    const completedOk = isChecklistComplete(checklist);
    const performedAt = new Date().toISOString().split('T')[0];
    const inspection: DeaInspection = {
      id: `ins-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      deaId: selectedDEA.id,
      performedAt,
      performedByUid: user.uid,
      performedByName: user.displayName ?? user.email ?? user.uid,
      checklist,
    };

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const basePath = `projects/${selectedProject.id}/deas`;
      // 1) Append inspection a subcollection (registro inmutable)
      await setDoc(
        doc(db, `${basePath}/${selectedDEA.id}/inspections/${inspection.id}`),
        { ...inspection, createdAt: serverTimestamp() },
      );
      // 2) Update lastCheck del DEA master + flag criticalOverride
      await setDoc(
        doc(db, `${basePath}/${selectedDEA.id}`),
        {
          lastCheck: performedAt,
          criticalOverride: !completedOk,
        },
        { merge: true },
      );
      setIsChecklistOpen(false);
      setSelectedDEA(null);
      setChecklist(EMPTY_CHECKLIST);
    } catch (err) {
      logger.error('Error registrando inspección DEA:', err);
      setErrorMessage(
        t(
          'deaZones.errorInspection',
          'No pudimos guardar la inspección. Reintenta en unos segundos.',
        ) as string,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !user) return;
    if (submitting) return;
    if (
      !registerForm.location.trim() ||
      !registerForm.batteryExpiry ||
      !registerForm.padsExpiry ||
      !registerForm.assignedToName.trim()
    ) {
      setErrorMessage(
        t('deaZones.formIncomplete', 'Completa ubicación, fechas y responsable.') as string,
      );
      return;
    }

    const id = `dea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const today = new Date().toISOString().split('T')[0];
    const newDea: Dea = {
      id,
      location: registerForm.location.trim(),
      description: registerForm.description.trim(),
      batteryExpiry: registerForm.batteryExpiry,
      padsExpiry: registerForm.padsExpiry,
      lastCheck: today,
      assignedToUid: user.uid, // Por ahora: creador = responsable (mejorable con picker)
      assignedToName: registerForm.assignedToName.trim(),
      createdAt: new Date().toISOString(),
      createdBy: user.uid,
    };

    setSubmitting(true);
    setErrorMessage(null);
    try {
      await setDoc(
        doc(db, `projects/${selectedProject.id}/deas/${id}`),
        newDea,
      );
      setIsRegisterOpen(false);
      setRegisterForm(EMPTY_REGISTER);
    } catch (err) {
      logger.error('Error registrando nuevo DEA:', err);
      setErrorMessage(
        t(
          'deaZones.errorRegister',
          'No pudimos registrar el DEA. Verifica tu permiso en este proyecto.',
        ) as string,
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────

  if (!selectedProject) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        <Card className="p-6 border-amber-500/20 bg-amber-500/5">
          <p className="text-amber-200">
            {t(
              'deaZones.noProject',
              'Selecciona un proyecto para gestionar sus DEAs.',
            )}
          </p>
        </Card>
      </div>
    );
  }

  const operationalCount = enrichedDeas.filter((d) => d.status === 'operational').length;
  const warningCount = enrichedDeas.filter((d) => d.status === 'warning').length;
  const criticalCount = enrichedDeas.filter((d) => d.status === 'critical').length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <HeartPulse className="w-8 h-8 text-rose-500" />
            {t('deaZones.title', 'Zonas DEA')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t(
              'deaZones.subtitle',
              'Ley 21.156 - Desfibriladores Externos Automáticos',
            )}
          </p>
        </div>
        <Button className="shrink-0" onClick={handleRegisterNew}>
          <Plus className="w-4 h-4 mr-2" />
          {t('deaZones.registerNew', 'Registrar Nuevo DEA')}
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 border-emerald-500/20 bg-emerald-500/5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/20 rounded-xl">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-black text-white">{operationalCount}</p>
              <p className="text-xs font-bold text-emerald-500 uppercase tracking-wider">
                {t('deaZones.statsOperational', 'Operativos')}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4 border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/20 rounded-xl">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-black text-white">{warningCount}</p>
              <p className="text-xs font-bold text-amber-500 uppercase tracking-wider">
                {t('deaZones.statsWarning', 'Por Vencer')}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4 border-rose-500/20 bg-rose-500/5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-rose-500/20 rounded-xl">
              <ShieldAlert className="w-6 h-6 text-rose-500" />
            </div>
            <div>
              <p className="text-2xl font-black text-white">{criticalCount}</p>
              <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">
                {t('deaZones.statsCritical', 'Críticos')}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Empty state vs grid */}
      {loading ? (
        <Card className="p-8 text-center">
          <p className="text-zinc-400 text-sm">
            {t('deaZones.loading', 'Cargando DEAs...')}
          </p>
        </Card>
      ) : enrichedDeas.length === 0 ? (
        <Card className="p-12 text-center border-zinc-700/50 bg-zinc-900/30">
          <HeartPulse className="w-16 h-16 mx-auto text-zinc-600 mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">
            {t('deaZones.emptyTitle', 'Sin DEAs registrados')}
          </h3>
          <p className="text-sm text-zinc-400 mb-6 max-w-md mx-auto">
            {t(
              'deaZones.emptyBody',
              'Empieza el registro de los desfibriladores instalados en este proyecto. Ley 21.156 requiere inventario documentado y mantenimiento mensual.',
            )}
          </p>
          <Button onClick={handleRegisterNew}>
            <Plus className="w-4 h-4 mr-2" />
            {t('deaZones.emptyCTA', 'Registrar Primer DEA')}
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {enrichedDeas.map((dea, index) => (
            <motion.div
              key={dea.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card
                className={`p-6 border ${getStatusColor(dea.status)} transition-all hover:scale-[1.02]`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-lg bg-zinc-900/50 border ${getStatusColor(dea.status)}`}
                    >
                      {getStatusIcon(dea.status)}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">{dea.location}</h3>
                      <p className="text-xs text-zinc-400">{dea.description}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 mb-6">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500 flex items-center gap-2">
                      <Battery className="w-4 h-4" /> {t('deaZones.battery', 'Batería')}
                    </span>
                    <span className="text-white font-medium">{dea.batteryExpiry}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500 flex items-center gap-2">
                      <Activity className="w-4 h-4" /> {t('deaZones.pads', 'Parches')}
                    </span>
                    <span className="text-white font-medium">{dea.padsExpiry}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500 flex items-center gap-2">
                      <Calendar className="w-4 h-4" />{' '}
                      {t('deaZones.lastCheck', 'Última Rev.')}
                    </span>
                    <span className="text-white font-medium">{dea.lastCheck}</span>
                  </div>
                </div>

                <Button
                  className="w-full"
                  variant={dea.status === 'critical' ? 'primary' : 'secondary'}
                  onClick={() => handlePerformCheck(dea)}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  {t('deaZones.inspect', 'Realizar Inspección')}
                </Button>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Checklist Modal */}
      {isChecklistOpen && selectedDEA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-xl font-bold text-white mb-2">
              {t('deaZones.inspectModal', 'Inspección Mensual DEA')}
            </h2>
            <p className="text-sm text-zinc-400 mb-6 flex items-center gap-2">
              <MapPin className="w-4 h-4" /> {selectedDEA.location}
            </p>

            <form onSubmit={submitChecklist} className="space-y-4">
              {[
                {
                  key: 'statusLightGreen' as const,
                  label: t(
                    'deaZones.checkItem1',
                    'Luz indicadora de estado parpadeando en verde',
                  ),
                },
                {
                  key: 'batteryConnectedValid' as const,
                  label: t(
                    'deaZones.checkItem2',
                    'Batería conectada y dentro de fecha útil',
                  ),
                },
                {
                  key: 'padsSealedValid' as const,
                  label: t(
                    'deaZones.checkItem3',
                    'Parches pediátricos y adultos sellados y vigentes',
                  ),
                },
                {
                  key: 'responseKitComplete' as const,
                  label: t(
                    'deaZones.checkItem4',
                    'Kit de respuesta (tijeras, rasuradora, mascarilla) completo',
                  ),
                },
                {
                  key: 'cabinetIntactAlarmOperative' as const,
                  label: t(
                    'deaZones.checkItem5',
                    'Gabinete sin daños y alarma sonora operativa',
                  ),
                },
              ].map((item) => (
                <label
                  key={item.key}
                  className="flex items-start gap-3 p-3 rounded-xl bg-zinc-800/50 border border-white/5 cursor-pointer hover:bg-zinc-800 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checklist[item.key]}
                    onChange={(e) =>
                      setChecklist((prev) => ({ ...prev, [item.key]: e.target.checked }))
                    }
                    className="mt-1 w-4 h-4 rounded border-zinc-600 text-emerald-500 focus:ring-emerald-500/50 bg-zinc-900"
                  />
                  <span className="text-sm text-zinc-300">{String(item.label)}</span>
                </label>
              ))}

              {errorMessage && (
                <p className="text-sm text-rose-400" role="alert">
                  {errorMessage}
                </p>
              )}

              <div className="pt-4 flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setIsChecklistOpen(false);
                    setSelectedDEA(null);
                    setChecklist(EMPTY_CHECKLIST);
                  }}
                  disabled={submitting}
                >
                  {t('common.cancel', 'Cancelar')}
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-[#4db6ac] hover:bg-[#3a9e95] text-white"
                  disabled={submitting}
                >
                  {submitting
                    ? t('deaZones.saving', 'Guardando...')
                    : t('deaZones.approveInspection', 'Guardar Inspección')}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Register Modal */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-xl font-bold text-white mb-6">
              {t('deaZones.registerModal', 'Registrar Nuevo DEA')}
            </h2>

            <form onSubmit={submitRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">
                  {t('deaZones.fieldLocation', 'Ubicación')}
                </label>
                <input
                  type="text"
                  value={registerForm.location}
                  onChange={(e) =>
                    setRegisterForm((prev) => ({ ...prev, location: e.target.value }))
                  }
                  placeholder="Recepción Principal"
                  required
                  className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">
                  {t('deaZones.fieldDescription', 'Detalle de Posición')}
                </label>
                <input
                  type="text"
                  value={registerForm.description}
                  onChange={(e) =>
                    setRegisterForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Muro este, junto a extintor"
                  className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">
                  {t('deaZones.fieldBattery', 'Vencimiento Batería')}
                </label>
                <input
                  type="date"
                  value={registerForm.batteryExpiry}
                  onChange={(e) =>
                    setRegisterForm((prev) => ({ ...prev, batteryExpiry: e.target.value }))
                  }
                  required
                  className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">
                  {t('deaZones.fieldPads', 'Vencimiento Parches')}
                </label>
                <input
                  type="date"
                  value={registerForm.padsExpiry}
                  onChange={(e) =>
                    setRegisterForm((prev) => ({ ...prev, padsExpiry: e.target.value }))
                  }
                  required
                  className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wide mb-1.5">
                  {t('deaZones.fieldAssignee', 'Responsable de Mantenimiento')}
                </label>
                <input
                  type="text"
                  value={registerForm.assignedToName}
                  onChange={(e) =>
                    setRegisterForm((prev) => ({ ...prev, assignedToName: e.target.value }))
                  }
                  placeholder="Nombre del responsable"
                  required
                  className="w-full px-3 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {errorMessage && (
                <p className="text-sm text-rose-400" role="alert">
                  {errorMessage}
                </p>
              )}

              <div className="pt-4 flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setIsRegisterOpen(false);
                    setRegisterForm(EMPTY_REGISTER);
                  }}
                  disabled={submitting}
                >
                  {t('common.cancel', 'Cancelar')}
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-[#4db6ac] hover:bg-[#3a9e95] text-white"
                  disabled={submitting}
                >
                  {submitting
                    ? t('deaZones.saving', 'Guardando...')
                    : t('deaZones.register', 'Registrar DEA')}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
