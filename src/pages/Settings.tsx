import React, { useState, useEffect, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { 
  Settings as SettingsIcon, 
  Shield, 
  Bell, 
  User, 
  Database, 
  Lock, 
  Globe, 
  Palette,
  ChevronRight,
  ChevronDown,
  Zap,
  Smartphone,
  WifiOff,
  Network,
  Fingerprint
} from 'lucide-react';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { logOut } from '../services/firebase';
import { useNotifications } from '../contexts/NotificationContext';
import { useNavigate } from 'react-router-dom';
import { useFirebase } from '../contexts/FirebaseContext';
import { useBiometricAuth } from '../hooks/useBiometricAuth';
import { useFallDetectionPreference } from '../hooks/useFallDetectionPreference';
import { BunkerManager } from '../components/BunkerManager';
// Sprint 30 Bucket KK — WebAuthn keys management UI.
import { WebAuthnKeysSection } from '../components/settings/WebAuthnKeysSection';
// Sprint 56 follow-up — KEK rotation panel (Wire UI de PR #248).
import { KekRotationPanel } from '../components/security/KekRotationPanel';
// Sprint 31 Bucket MM — privacy compliance matrix UI.
import { PrivacyComplianceMatrix } from '../components/compliance/PrivacyComplianceMatrix';
import { LocalePicker } from '../components/LocalePicker';
import { get, set } from 'idb-keyval';
import { logger } from '../utils/logger';
// Sprint 56 (stream-slm-shell) — Asistente IA manager dentro de la app.
// Renderiza el panel completo de adquisición/descarga/cambio de modelo
// SLM sin enlaces externos.
import { SlmManagerScreen } from '../components/slm/SlmManagerScreen';

/**
 * Sprint 34 D4 — IDs estables para el switch del render (audit P0 §1.4).
 * Antes el switch matcheaba contra strings ES como `case 'Perfil y Cuenta':`
 * lo cual bloqueaba el sweep i18n: cambiar el label rompía el render.
 * Ahora `activeSection` es un ID inmutable y el sidebar mapea
 * `{ id, labelKey }` para renderizar `t(labelKey)`.
 */
type SettingsSectionId =
  | 'profile'
  | 'security'
  | 'notifications'
  | 'ai'
  | 'database'
  | 'appearance'
  | 'regional'
  | 'admin';

export function Settings() {
  const { t, i18n } = useTranslation();
  const { notificationPermissionStatus, requestPermission } = usePushNotifications();
  const isOnline = useOnlineStatus();
  const { addNotification } = useNotifications();
  const navigate = useNavigate();
  const { user, isAdmin } = useFirebase();
  const { authenticate, isSupported } = useBiometricAuth();
  const { enabled: fallDetectionEnabled, setEnabled: setFallDetectionEnabled, loading: fallDetectionLoading } = useFallDetectionPreference();
  // Sprint 34 D4 — stable IDs en lugar de strings ES (audit P0 §1.4).
  // Cambiar el labelKey ya no rompe el switch del render: el
  // `activeSection` ahora referencia un ID inmutable.
  const [activeSection, setActiveSection] = useState<SettingsSectionId | null>(null);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  // Stable IDs so each <label htmlFor> binds to the matching control
  // and screen readers can announce the field name on focus.
  const usernameId = useId();
  const emailFieldId = useId();
  const sessionTimeoutId = useId();
  const aiDetailId = useId();
  const themePrefId = useId();
  const languageId = useId();
  const timezoneId = useId();
  const adminUidId = useId();
  const adminRoleId = useId();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminTargetUid, setAdminTargetUid] = useState('');
  const [adminTargetRole, setAdminTargetRole] = useState('operario');
  const [adminActionStatus, setAdminActionStatus] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      if (isSupported) {
        const success = await authenticate(t('settings.auth.confirm_identity', 'Confirme su identidad para acceder a la configuración'));
        setIsAuthenticated(success);
        if (!success) {
          addNotification({ title: t('settings.auth.failed_title', 'Autenticación fallida'), message: t('settings.auth.failed_msg', 'No se pudo verificar la identidad'), type: 'warning' });
          navigate('/');
        }
      } else {
        setIsAuthenticated(true);
      }
    };
    checkAuth();
  }, [isSupported, authenticate, navigate, addNotification, t]);

  React.useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          setIsDark(document.documentElement.classList.contains('dark'));
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  // Settings States
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState('30');
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [pushNotifs, setPushNotifs] = useState(notificationPermissionStatus === 'granted');
  const [aiDetail, setAiDetail] = useState('equilibrado');
  const [aiProactive, setAiProactive] = useState(true);
  const [language, setLanguage] = useState(i18n.language || 'es');
  const [themePref, setThemePref] = useState('system');
  const [notifPrefs, setNotifPrefs] = useState({
    emergencies: true,
    medical: true,
    training: true,
    ai_alerts: true
  });

  const updateNotifPref = async (key: keyof typeof notifPrefs, value: boolean) => {
    const newPrefs = { ...notifPrefs, [key]: value };
    setNotifPrefs(newPrefs);
    if (user) {
      import('firebase/firestore').then(({ doc, updateDoc }) => {
        import('../services/firebase').then(({ db }) => {
          updateDoc(doc(db, 'users', user.uid), {
            notificationPreferences: newPrefs
          }).catch(err => {
            logger.error("Error updating notification preferences", err);
            addNotification({title: 'Error', message: 'No se pudieron guardar las preferencias', type: 'error'});
          });
        });
      });
    }
  };

  const handleLanguageChange = (newLang: string) => {
    setLanguage(newLang);
    i18n.changeLanguage(newLang);
    addNotification({
      title: t('common.success', 'Éxito'),
      message: t('settings.regional.language_changed', 'Idioma cambiado a {{lang}}', { lang: newLang === 'es' ? 'Español' : 'English' }),
      type: 'success'
    });
  };

  useEffect(() => {
    get('theme_preference').then(val => setThemePref((val as string) || 'system'));
  }, []);

  useEffect(() => {
    if (user) {
      import('firebase/firestore').then(({ doc, getDoc }) => {
        import('../services/firebase').then(({ db }) => {
          getDoc(doc(db, 'users', user.uid)).then(docSnap => {
            if (docSnap.exists() && docSnap.data().notificationPreferences) {
              setNotifPrefs(docSnap.data().notificationPreferences);
            }
          });
        });
      });
    }
  }, [user]);

  const handleLogout = async () => {
    try {
      await logOut();
      navigate('/');
    } catch (error) {
      logger.error('Error logging out:', error);
    }
  };

  const handleSectionClick = (id: SettingsSectionId) => {
    setActiveSection(prev => prev === id ? null : id);
  };

  const handleThemeToggle = async () => {
    const root = window.document.documentElement;
    if (isDark) {
      root.classList.remove('dark');
      await set('theme', 'light');
      setIsDark(false);
    } else {
      root.classList.add('dark');
      await set('theme', 'dark');
      setIsDark(true);
    }
  };

  const renderSectionContent = (id: SettingsSectionId) => {
    switch (id) {
      case 'profile':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <div>
              <label htmlFor={usernameId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">{t('settings.profile.username', 'Nombre de Usuario')}</label>
              <input
                id={usernameId}
                type="text"
                disabled
                value={user?.displayName || 'Usuario Praeventio'}
                className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white opacity-50 cursor-not-allowed"
              />
            </div>
            <div>
              <label htmlFor={emailFieldId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">{t('settings.profile.email', 'Correo Electrónico')}</label>
              <input
                id={emailFieldId}
                type="email"
                disabled
                value={user?.email || ''}
                className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white opacity-50 cursor-not-allowed"
              />
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-500">{t('settings.profile.contact_admin', 'Para modificar estos datos, contacta al administrador del sistema o utiliza el panel de Firebase Auth.')}</p>
          </div>
        );
      case 'security':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div>
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{t('settings.security.mfa_title', 'Autenticación de Dos Factores (2FA)')}</h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-500">{t('settings.security.mfa_desc', 'Añade una capa extra de seguridad a tu cuenta.')}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={mfaEnabled}
                aria-label={t('settings.aria.toggle_mfa', 'Activar autenticación de dos factores')}
                onClick={() => setMfaEnabled(!mfaEnabled)}
                className={`w-12 h-6 rounded-full transition-colors relative ${mfaEnabled ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${mfaEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
            <div>
              <label htmlFor={sessionTimeoutId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">{t('settings.security.session_timeout', 'Tiempo de Expiración de Sesión')}</label>
              <select id={sessionTimeoutId} value={sessionTimeout} onChange={(e) => setSessionTimeout(e.target.value)} className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none">
                <option value="15">{t('settings.security.timeout_15', '15 minutos de inactividad')}</option>
                <option value="30">{t('settings.security.timeout_30', '30 minutos de inactividad')}</option>
                <option value="60">{t('settings.security.timeout_60', '1 hora de inactividad')}</option>
                <option value="never">{t('settings.security.timeout_never', 'Nunca (No recomendado)')}</option>
              </select>
            </div>
            <button onClick={() => addNotification({title: t('settings.security.password_email_title', 'Correo Enviado'), message: t('settings.security.password_email_msg', 'Se ha enviado un enlace para restablecer tu contraseña.'), type: 'success'})} className="w-full py-2 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-900 dark:text-white text-xs font-bold rounded-xl transition-colors border border-zinc-200 dark:border-white/10">
              {t('settings.security.change_password', 'Cambiar Contraseña')}
            </button>
            {/* Sprint 30 Bucket KK — WebAuthn keys (closes audit gap F-F). */}
            <div className="pt-2 border-t border-zinc-200 dark:border-white/5">
              <WebAuthnKeysSection />
            </div>
            {/* Sprint 56 follow-up — Rotación de la KEK del dispositivo
                (cierra el wire de PR #248: orchestrator + UI ya están,
                ahora visible al usuario). Solo aparece al usuario que
                tiene admin role idealmente — el componente se autocura
                renderizando "Sin clave generada" si no hay KEK aún. */}
            <div className="pt-2 border-t border-zinc-200 dark:border-white/5">
              <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-2">
                {t('settings.security.kek_title', 'Cifrado del dispositivo')}
              </h4>
              <p className="text-xs text-zinc-600 dark:text-zinc-500 mb-3">
                {t(
                  'settings.security.kek_desc',
                  'Clave maestra que envuelve los datos cifrados localmente (cache offline, sesiones, drafts). Rotación recomendada cada 90 días.',
                )}
              </p>
              <KekRotationPanel />
            </div>
            {/* End-to-end wire: link a la página de Salud del Sistema
                (que ya corre el monitor con checkers REALES). */}
            <div className="pt-2 border-t border-zinc-200 dark:border-white/5">
              <button
                type="button"
                onClick={() => navigate('/settings/system-health')}
                data-testid="settings-system-health-link"
                className="w-full flex items-center justify-between p-3 rounded-lg bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5 hover:border-teal-500/40 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-zinc-900 dark:text-white">
                    {t('settings.security.system_health_link', 'Salud del sistema')}
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-0.5">
                    {t(
                      'settings.security.system_health_desc',
                      'Estado en vivo de los 6 subsistemas: IA local, grafo, base de datos, cifrado, cache, red.',
                    )}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0 ml-2" aria-hidden="true" />
              </button>
            </div>
            {/* Sprint 31 Bucket MM — Datos personales y privacidad. */}
            <div className="pt-2 border-t border-zinc-200 dark:border-white/5">
              <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-2">{t('settings.security.privacy_title', 'Datos personales y privacidad')}</h4>
              <p className="text-xs text-zinc-600 dark:text-zinc-500 mb-3">
                {t('settings.security.privacy_desc', 'Regímenes de protección de datos aplicables a tu cuenta + plazos legales para responder solicitudes de acceso, rectificación o supresión.')}
              </p>
              <PrivacyComplianceMatrix country="CL" />
            </div>
            <div className="flex items-start justify-between p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div className="flex-1 pr-4">
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{t('settings.security.fall_detection', 'Detección de Hombre Caído')}</h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-1">
                  {t('settings.security.fall_detection_desc', 'Activa el monitoreo continuo del acelerómetro para detectar caídas. Recomendado solo si tu trabajo expone a riesgos de altura, andamios, techos o espacios confinados con desnivel.')}
                </p>
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2 font-semibold">
                  {t('settings.security.fall_detection_warn', '⚠ Consume batería en segundo plano. Manténlo apagado si tu rubro no lo requiere.')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={fallDetectionEnabled}
                aria-busy={fallDetectionLoading}
                onClick={() => setFallDetectionEnabled(!fallDetectionEnabled)}
                disabled={fallDetectionLoading}
                aria-label={t(fallDetectionEnabled ? 'settings.aria.disable_fall_detection' : 'settings.aria.enable_fall_detection', fallDetectionEnabled ? 'Desactivar detección de caída' : 'Activar detección de caída')}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 mt-1 ${fallDetectionEnabled ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'} ${fallDetectionLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${fallDetectionEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        );
      case 'notifications':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div>
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{t('settings.notifications.email_alerts', 'Alertas por Correo Electrónico')}</h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-500">{t('settings.notifications.email_alerts_desc', 'Resúmenes diarios y alertas críticas.')}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={emailNotifs}
                aria-label={t('settings.aria.toggle_email_alerts', 'Activar alertas por correo electrónico')}
                onClick={() => setEmailNotifs(!emailNotifs)}
                className={`w-12 h-6 rounded-full transition-colors relative ${emailNotifs ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${emailNotifs ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
            
            <div className="flex flex-col gap-3 p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{t('settings.notifications.push', 'Notificaciones Push')}</h4>
                  <p className="text-xs text-zinc-600 dark:text-zinc-500">{t('settings.notifications.push_desc', 'Recibe alertas instantáneas.')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={pushNotifs}
                  aria-label={t('settings.aria.toggle_push', 'Activar notificaciones push')}
                  onClick={() => {
                    setPushNotifs(!pushNotifs);
                    if (!pushNotifs && notificationPermissionStatus !== 'granted') requestPermission();
                  }}
                  className={`w-12 h-6 rounded-full transition-colors relative ${pushNotifs ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${pushNotifs ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>
              
              {/* Nested specific toggles if Push is enabled */}
              {pushNotifs && (
                <div className="pl-4 border-l-2 border-zinc-100 dark:border-white/10 space-y-4 mt-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest">{t('settings.notifications.cat_emergencies', '🚨 Emergencias (S.O.S)')}</h5>
                      <p className="text-[10px] text-zinc-500">{t('settings.notifications.cat_emergencies_desc', 'Alertas de S.O.S, evacuación y clima extremo. (No se puede desactivar por seguridad)')}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={true}
                      aria-disabled={true}
                      aria-label={t('settings.aria.emergency_always_on', 'Alertas de emergencia (siempre activas por seguridad)')}
                      disabled
                      className="w-10 h-5 rounded-full bg-red-500 opacity-50 cursor-not-allowed relative"
                    >
                      <div className="w-3 h-3 rounded-full bg-white absolute top-1 translate-x-6" />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest">{t('settings.notifications.cat_medical', '🩺 Exámenes Médicos')}</h5>
                      <p className="text-[10px] text-zinc-500">{t('settings.notifications.cat_medical_desc', 'Recordatorios de vigencia y nuevos resultados médicos.')}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notifPrefs.medical}
                      aria-label={t('settings.aria.toggle_medical', 'Notificaciones de exámenes médicos')}
                      onClick={() => updateNotifPref('medical', !notifPrefs.medical)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${notifPrefs.medical ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                    >
                      <div className={`w-3 h-3 rounded-full bg-white absolute top-1 transition-transform ${notifPrefs.medical ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest">{t('settings.notifications.cat_training', '📚 Capacitaciones')}</h5>
                      <p className="text-[10px] text-zinc-500">{t('settings.notifications.cat_training_desc', 'Asignaciones de cursos, ODI y charlas programadas.')}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notifPrefs.training}
                      aria-label={t('settings.aria.toggle_training', 'Notificaciones de capacitaciones')}
                      onClick={() => updateNotifPref('training', !notifPrefs.training)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${notifPrefs.training ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                    >
                      <div className={`w-3 h-3 rounded-full bg-white absolute top-1 transition-transform ${notifPrefs.training ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest">{t('settings.notifications.cat_ai', '🤖 Asistente IA (Guardian)')}</h5>
                      <p className="text-[10px] text-zinc-500">{t('settings.notifications.cat_ai_desc', 'Consejos predictivos y anomalías detectadas en terreno.')}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notifPrefs.ai_alerts}
                      aria-label={t('settings.aria.toggle_ai', 'Notificaciones del asistente IA')}
                      onClick={() => updateNotifPref('ai_alerts', !notifPrefs.ai_alerts)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${notifPrefs.ai_alerts ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                    >
                      <div className={`w-3 h-3 rounded-full bg-white absolute top-1 transition-transform ${notifPrefs.ai_alerts ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      case 'ai':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <div>
              <label htmlFor={aiDetailId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">{t('settings.ai.detail_level', 'Nivel de Detalle del Asistente')}</label>
              <select id={aiDetailId} value={aiDetail} onChange={(e) => setAiDetail(e.target.value)} className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none">
                <option value="conciso">{t('settings.ai.opt_concise', 'Conciso (Respuestas directas y cortas)')}</option>
                <option value="equilibrado">{t('settings.ai.opt_balanced', 'Equilibrado (Recomendado)')}</option>
                <option value="detallado">{t('settings.ai.opt_detailed', 'Detallado (Explicaciones exhaustivas y normativas)')}</option>
              </select>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div>
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{t('settings.ai.predictive_title', 'Análisis Predictivo Autónomo')}</h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-500">{t('settings.ai.predictive_desc', 'Permite a la IA analizar datos en segundo plano.')}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={aiProactive}
                aria-label={t('settings.aria.toggle_predictive_ai', 'Activar análisis predictivo autónomo')}
                onClick={() => setAiProactive(!aiProactive)}
                className={`w-12 h-6 rounded-full transition-colors relative ${aiProactive ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${aiProactive ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
            {/* Sprint 56 (stream-slm-shell) — manager dentro de la app. */}
            <div className="rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <SlmManagerScreen />
            </div>
          </div>
        );
      case 'database':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-6">
            <BunkerManager />
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5 text-center">
                <Database className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
                <span className="text-2xl font-black text-zinc-900 dark:text-white">1.2GB</span>
                <p className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest mt-1">{t('settings.database.storage', 'Almacenamiento')}</p>
              </div>
              <div className="p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5 text-center">
                <Network className="w-6 h-6 text-indigo-500 mx-auto mb-2" />
                <span className="text-2xl font-black text-zinc-900 dark:text-white">842</span>
                <p className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest mt-1">{t('settings.database.active_nodes', 'Nodos Activos')}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => addNotification({title: t('settings.database.export_title', 'Exportación Iniciada'), message: t('settings.database.export_msg', 'Tus datos se están preparando para descarga.'), type: 'success'})} className="flex-1 py-2 bg-[#4db6ac]/10 hover:bg-[#4db6ac]/20 text-[#2a8a81] dark:text-[#4db6ac] text-xs font-bold rounded-xl transition-colors border border-[#4db6ac]/20">
                {t('settings.database.export_btn', 'Exportar Datos (JSON)')}
              </button>
              <button onClick={() => addNotification({title: t('settings.database.cache_title', 'Caché Limpiada'), message: t('settings.database.cache_msg', 'Se ha liberado espacio local correctamente.'), type: 'success'})} className="flex-1 py-2 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-900 dark:text-white text-xs font-bold rounded-xl transition-colors border border-zinc-200 dark:border-white/10">
                {t('settings.database.cache_btn', 'Limpiar Caché')}
              </button>
            </div>
          </div>
        );
      case 'appearance':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <div>
              <label htmlFor={themePrefId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">{t('settings.appearance.theme', 'Preferencia de Tema')}</label>
              <select
                id={themePrefId}
                value={themePref}
                onChange={async (e) => {
                  const newPref = e.target.value;
                  setThemePref(newPref);
                  await set('theme_preference', newPref);
                  window.dispatchEvent(new Event('theme_preference_changed'));
                }}
                className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none"
              >
                <option value="light">{t('settings.appearance.theme_light', 'Claro (Fondo #4EB5AC)')}</option>
                <option value="dark">{t('settings.appearance.theme_dark', 'Oscuro')}</option>
                <option value="auto">{t('settings.appearance.theme_auto', 'Automático (Día/Noche)')}</option>
                <option value="system">{t('settings.appearance.theme_system', 'Sistema Operativo')}</option>
              </select>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div>
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{t('settings.appearance.dark_manual_title', 'Modo Oscuro Manual')}</h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-500">{t('settings.appearance.dark_manual_desc', 'Alternar rápidamente (sobrescribe la preferencia)')}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isDark}
                aria-label={t('settings.aria.toggle_dark_mode', 'Alternar modo oscuro manual')}
                onClick={async () => {
                  const root = window.document.documentElement;
                  const isCurrentlyDark = root.classList.contains('dark');
                  const newMode = isCurrentlyDark ? 'light' : 'dark';
                  await set('theme_preference', newMode);
                  window.dispatchEvent(new Event('theme_preference_changed'));
                  setIsDark(!isCurrentlyDark);
                }}
                className={`w-12 h-6 rounded-full transition-colors relative ${isDark ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${isDark ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        );
      case 'regional':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <LocalePicker label={t('settings.regional.ui_language', 'Idioma de la Interfaz')} />
            {/* LocalePicker delegates to LanguageProvider which syncs
                i18next, the RTL `<html dir>` flag, lazy locale chunks and
                the Firestore user doc. The legacy `language` /
                `handleLanguageChange` state above is retained for any
                analytics/event listeners but the dropdown UI is now the
                single source of truth. */}
            <div>
              <label htmlFor={timezoneId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">{t('settings.regional.timezone', 'Zona Horaria')}</label>
              <select id={timezoneId} className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none">
                <option value="America/Santiago">America/Santiago (GMT-4)</option>
                <option value="America/Lima">America/Lima (GMT-5)</option>
                <option value="America/Bogota">America/Bogota (GMT-5)</option>
                <option value="America/Mexico_City">America/Mexico_City (GMT-6)</option>
              </select>
            </div>
          </div>
        );
      case 'admin':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-6">
            {/* Set Role */}
            <div className="space-y-3">
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest" id={`${adminUidId}-group-label`}>{t('settings.admin.assign_role', 'Asignar Rol a Usuario')}</p>
              <label htmlFor={adminUidId} className="sr-only">{t('settings.admin.uid_label', 'UID del usuario (Firebase Auth)')}</label>
              <input
                id={adminUidId}
                type="text"
                placeholder={t('settings.admin.uid_label', 'UID del usuario (Firebase Auth)')}
                value={adminTargetUid}
                onChange={e => { setAdminTargetUid(e.target.value); setAdminActionStatus(null); }}
                className="w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none"
              />
              <label htmlFor={adminRoleId} className="sr-only">{t('settings.admin.role_label', 'Rol a asignar')}</label>
              <select
                id={adminRoleId}
                value={adminTargetRole}
                onChange={e => setAdminTargetRole(e.target.value)}
                className="w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none"
              >
                {['gerente', 'prevencionista', 'supervisor', 'director_obra', 'medico_ocupacional', 'operario'].map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button
                disabled={!adminTargetUid.trim()}
                onClick={async () => {
                  setAdminActionStatus(t('settings.admin.saving', 'Guardando...'));
                  try {
                    const token = await user?.getIdToken();
                    const res = await fetch('/api/admin/set-role', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ uid: adminTargetUid.trim(), role: adminTargetRole }),
                    });
                    const data = await res.json();
                    setAdminActionStatus(res.ok ? `✓ ${t('settings.admin.role_assigned', 'Rol asignado')}: ${adminTargetRole}` : `${t('common.error', 'Error')}: ${data.error}`);
                  } catch { setAdminActionStatus(t('settings.admin.network_error', 'Error de red')); }
                }}
                className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-black rounded-xl transition-colors"
              >
                {t('settings.admin.assign_role_btn', 'Asignar Rol')}
              </button>
            </div>

            {/* Revoke Access */}
            <div className="space-y-3 border-t border-zinc-200 dark:border-white/5 pt-4">
              <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">{t('settings.admin.revoke', 'Revocar Acceso')}</p>
              <p className="text-xs text-zinc-500">{t('settings.admin.revoke_desc', 'Invalida inmediatamente todos los tokens de sesión del usuario.')}</p>
              <button
                disabled={!adminTargetUid.trim()}
                onClick={async () => {
                  setAdminActionStatus(t('settings.admin.revoking', 'Revocando...'));
                  try {
                    const token = await user?.getIdToken();
                    const res = await fetch('/api/admin/revoke-access', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ targetUid: adminTargetUid.trim() }),
                    });
                    const data = await res.json();
                    setAdminActionStatus(res.ok ? `✓ ${t('settings.admin.revoked_ok', 'Acceso revocado')}` : `${t('common.error', 'Error')}: ${data.error}`);
                  } catch { setAdminActionStatus(t('settings.admin.network_error', 'Error de red')); }
                }}
                className="w-full py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-black rounded-xl transition-colors"
              >
                {t('settings.admin.revoke', 'Revocar Acceso')}
              </button>
            </div>

            {adminActionStatus && (
              <p
                role="status"
                aria-live="polite"
                className={`text-xs font-bold text-center ${adminActionStatus.startsWith('✓') ? 'text-emerald-500' : 'text-rose-400'}`}
              >
                {adminActionStatus}
              </p>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  const handleDeleteAccount = () => {
    addNotification({
      title: t('settings.delete_restricted_title', 'Acción Restringida'),
      message: t('settings.delete_restricted_msg', 'Para eliminar tu cuenta permanentemente, por favor contacta al administrador del sistema.'),
      type: 'warning'
    });
  };

  // Sprint 34 D4 — sidebar items con ID estable + labelKey i18n
  // (audit P0 §1.4). El render consume `t(labelKey)` y `t(descKey)`,
  // no hard-coded ES strings.
  const sections: Array<{
    id: SettingsSectionId;
    labelKey: string;
    descKey: string;
    fallbackLabel: string;
    fallbackDesc: string;
    icon: typeof User;
  }> = [
    { id: 'profile', labelKey: 'settings.sections.profile.label', descKey: 'settings.sections.profile.desc', fallbackLabel: 'Perfil y Cuenta', fallbackDesc: 'Gestiona tu información personal y preferencias de acceso.', icon: User },
    { id: 'security', labelKey: 'settings.sections.security.label', descKey: 'settings.sections.security.desc', fallbackLabel: 'Seguridad y Privacidad', fallbackDesc: 'Configura la autenticación de dos factores y permisos de datos.', icon: Lock },
    { id: 'notifications', labelKey: 'settings.sections.notifications.label', descKey: 'settings.sections.notifications.desc', fallbackLabel: 'Notificaciones', fallbackDesc: 'Personaliza qué alertas deseas recibir y por qué canales.', icon: Bell },
    { id: 'ai', labelKey: 'settings.sections.ai.label', descKey: 'settings.sections.ai.desc', fallbackLabel: 'Configuración de IA', fallbackDesc: 'Ajusta el comportamiento de Gemini y el análisis predictivo.', icon: Zap },
    { id: 'database', labelKey: 'settings.sections.database.label', descKey: 'settings.sections.database.desc', fallbackLabel: 'Base de Datos y Red Neuronal', fallbackDesc: 'Gestión de nodos, conexiones y exportación de datos.', icon: Database },
    { id: 'appearance', labelKey: 'settings.sections.appearance.label', descKey: 'settings.sections.appearance.desc', fallbackLabel: 'Interfaz y Tema', fallbackDesc: 'Personaliza el aspecto visual de Praeventio Guard.', icon: Palette },
    { id: 'regional', labelKey: 'settings.sections.regional.label', descKey: 'settings.sections.regional.desc', fallbackLabel: 'Idioma y Región', fallbackDesc: 'Ajusta el idioma de la plataforma y formatos regionales.', icon: Globe },
    ...(isAdmin ? [{ id: 'admin' as const, labelKey: 'settings.sections.admin.label', descKey: 'settings.sections.admin.desc', fallbackLabel: 'Administración de Usuarios', fallbackDesc: 'Asigna roles y revoca acceso a usuarios de la plataforma.', icon: Shield }] : []),
  ];

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-white tracking-tight">{t('settings.title', 'Configuración')}</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1 text-xs sm:text-sm">{t('settings.subtitle', 'Personaliza tu experiencia en Praeventio Guard')}</p>
      </div>

      <div className="space-y-4 mb-6 sm:mb-8">
        <div className="bg-white/50 dark:bg-zinc-900/50 border border-emerald-500/30 rounded-2xl p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-start sm:items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20">
                <Smartphone className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-white text-sm sm:text-base">{t('settings.fcm.title', 'Notificaciones Push (FCM)')}</h3>
                <p className="text-zinc-600 dark:text-zinc-400 text-[10px] sm:text-sm">{t('settings.fcm.desc', 'Recibe alertas críticas y de emergencia en tiempo real.')}</p>
              </div>
            </div>
            <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start w-full sm:w-auto mt-2 sm:mt-0">
              <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest px-2 py-1 rounded-full sm:mb-2 ${
                notificationPermissionStatus === 'granted' ? 'bg-emerald-500/20 text-emerald-400' :
                notificationPermissionStatus === 'denied' ? 'bg-rose-500/20 text-rose-400' :
                'bg-amber-500/20 text-amber-400'
              }`}>
                {notificationPermissionStatus === 'granted' ? t('settings.fcm.status_granted', 'Activas') :
                 notificationPermissionStatus === 'denied' ? t('settings.fcm.status_denied', 'Bloqueadas') :
                 t('settings.fcm.status_pending', 'Pendientes')}
              </span>
              {notificationPermissionStatus !== 'granted' && (
                <button 
                  onClick={requestPermission}
                  disabled={!isOnline}
                  className={`px-4 py-2 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-2 ${
                    !isOnline 
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  }`}
                >
                  {!isOnline ? (
                    <>
                      <WifiOff className="w-3 h-3" />
                      {t('settings.fcm.requires_connection', 'Requiere Conexión')}
                    </>
                  ) : (
                    t('settings.fcm.enable_btn', 'Activar Notificaciones')
                  )}
                </button>
              )}
            </div>
          </div>
          <p className="text-[10px] sm:text-xs text-zinc-700 dark:text-zinc-500 leading-relaxed">
            {t('settings.fcm.long_desc', 'Para recibir notificaciones push, debes permitir el acceso en tu navegador. Esto habilitará Firebase Cloud Messaging (FCM) para enviarte alertas críticas incluso cuando la aplicación esté en segundo plano.')}
          </p>
        </div>
      </div>

      <div className="space-y-3 sm:space-y-4">
        {sections.map((section, index) => {
          const isActive = activeSection === section.id;
          const label = t(section.labelKey, section.fallbackLabel);
          const description = t(section.descKey, section.fallbackDesc);
          return (
            <motion.div
              key={section.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`bg-white/50 dark:bg-zinc-900/50 border rounded-xl sm:rounded-2xl transition-all ${isActive ? 'border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'border-zinc-200 dark:border-white/10 hover:border-emerald-500/30'}`}
            >
              <button
                type="button"
                onClick={() => handleSectionClick(section.id)}
                aria-expanded={isActive}
                aria-controls={`settings-section-${section.id}`}
                className="w-full p-4 sm:p-5 flex items-center justify-between gap-4 cursor-pointer group text-left"
              >
                <div className="flex items-start sm:items-center gap-3 sm:gap-4 flex-1">
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-lg sm:rounded-xl flex items-center justify-center transition-colors ${isActive ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 'bg-white/40 dark:bg-zinc-800 text-emerald-600 dark:text-emerald-500 border border-zinc-200 dark:border-white/5 group-hover:bg-white/60 dark:group-hover:bg-zinc-800/80'}`}>
                    <section.icon className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h2 className={`font-bold text-sm sm:text-base transition-colors truncate ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400'}`}>{label}</h2>
                    <p className="text-zinc-600 dark:text-zinc-500 text-[10px] sm:text-sm line-clamp-2 sm:line-clamp-1">{description}</p>
                  </div>
                </div>
                <motion.div animate={{ rotate: isActive ? 180 : 0 }} transition={{ duration: 0.2 }} aria-hidden="true">
                  <ChevronDown className={`w-4 h-4 sm:w-5 sm:h-5 shrink-0 transition-colors ${isActive ? 'text-emerald-600 dark:text-emerald-500' : 'text-zinc-400 dark:text-zinc-600 group-hover:text-emerald-600 dark:group-hover:text-emerald-500'}`} />
                </motion.div>
              </button>

              <AnimatePresence>
                {isActive && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden"
                    id={`settings-section-${section.id}`}
                    role="region"
                    aria-label={label}
                  >
                    <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                      {renderSectionContent(section.id)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-8 sm:mt-12 p-4 sm:p-6 bg-rose-500/5 border border-rose-500/10 rounded-2xl sm:rounded-3xl">
        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
          <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-rose-500" />
          <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest">{t('settings.danger_zone', 'Zona de Peligro')}</h3>
        </div>
        <p className="text-[10px] sm:text-sm text-zinc-700 dark:text-zinc-500 mb-4 sm:mb-6 leading-relaxed">
          {t('settings.danger_desc', 'Estas acciones son permanentes y no se pueden deshacer. Por favor, procede con extrema precaución.')}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <button 
            onClick={handleLogout}
            className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[10px] sm:text-sm font-black uppercase tracking-widest rounded-xl transition-all border border-rose-500/20 active:scale-95"
          >
            {t('settings.logout_global', 'Cerrar Sesión Global')}
          </button>
          <button 
            onClick={handleDeleteAccount}
            className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-rose-500 hover:bg-rose-600 text-white text-[10px] sm:text-sm font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-rose-500/20 active:scale-95"
          >
            {t('settings.delete_account', 'Eliminar Cuenta')}
          </button>
        </div>
      </div>
    </div>
  );
}
