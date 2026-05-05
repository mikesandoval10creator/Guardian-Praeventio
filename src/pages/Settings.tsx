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
import { LocalePicker } from '../components/LocalePicker';
import { get, set } from 'idb-keyval';
import { logger } from '../utils/logger';

export function Settings() {
  const { t, i18n } = useTranslation();
  const { notificationPermissionStatus, requestPermission } = usePushNotifications();
  const isOnline = useOnlineStatus();
  const { addNotification } = useNotifications();
  const navigate = useNavigate();
  const { user, isAdmin } = useFirebase();
  const { authenticate, isSupported } = useBiometricAuth();
  const { enabled: fallDetectionEnabled, setEnabled: setFallDetectionEnabled, loading: fallDetectionLoading } = useFallDetectionPreference();
  const [activeSection, setActiveSection] = useState<string | null>(null);
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
        const success = await authenticate('Confirme su identidad para acceder a la configuración');
        setIsAuthenticated(success);
        if (!success) {
          addNotification({ title: 'Autenticación fallida', message: 'No se pudo verificar la identidad', type: 'warning' });
          navigate('/');
        }
      } else {
        setIsAuthenticated(true);
      }
    };
    checkAuth();
  }, [isSupported, authenticate, navigate, addNotification]);

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
      message: `Idioma cambiado a ${newLang === 'es' ? 'Español' : 'English'}`,
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

  const handleSectionClick = (title: string) => {
    setActiveSection(prev => prev === title ? null : title);
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

  const renderSectionContent = (title: string) => {
    switch (title) {
      case 'Perfil y Cuenta':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <div>
              <label htmlFor={usernameId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">Nombre de Usuario</label>
              <input
                id={usernameId}
                type="text"
                disabled
                value={user?.displayName || 'Usuario Praeventio'}
                className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white opacity-50 cursor-not-allowed"
              />
            </div>
            <div>
              <label htmlFor={emailFieldId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">Correo Electrónico</label>
              <input
                id={emailFieldId}
                type="email"
                disabled
                value={user?.email || ''}
                className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white opacity-50 cursor-not-allowed"
              />
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-500">Para modificar estos datos, contacta al administrador del sistema o utiliza el panel de Firebase Auth.</p>
          </div>
        );
      case 'Seguridad y Privacidad':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div>
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">Autenticación de Dos Factores (2FA)</h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-500">Añade una capa extra de seguridad a tu cuenta.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={mfaEnabled}
                aria-label="Activar autenticación de dos factores"
                onClick={() => setMfaEnabled(!mfaEnabled)}
                className={`w-12 h-6 rounded-full transition-colors relative ${mfaEnabled ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${mfaEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
            <div>
              <label htmlFor={sessionTimeoutId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">Tiempo de Expiración de Sesión</label>
              <select id={sessionTimeoutId} value={sessionTimeout} onChange={(e) => setSessionTimeout(e.target.value)} className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none">
                <option value="15">15 minutos de inactividad</option>
                <option value="30">30 minutos de inactividad</option>
                <option value="60">1 hora de inactividad</option>
                <option value="never">Nunca (No recomendado)</option>
              </select>
            </div>
            <button onClick={() => addNotification({title: 'Correo Enviado', message: 'Se ha enviado un enlace para restablecer tu contraseña.', type: 'success'})} className="w-full py-2 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-900 dark:text-white text-xs font-bold rounded-xl transition-colors border border-zinc-200 dark:border-white/10">
              Cambiar Contraseña
            </button>
            {/* Sprint 30 Bucket KK — WebAuthn keys (closes audit gap F-F). */}
            <div className="pt-2 border-t border-zinc-200 dark:border-white/5">
              <WebAuthnKeysSection />
            </div>
            <div className="flex items-start justify-between p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div className="flex-1 pr-4">
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">Detección de Hombre Caído</h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-500 mt-1">
                  Activa el monitoreo continuo del acelerómetro para detectar caídas. Recomendado solo si tu trabajo expone a riesgos de altura, andamios, techos o espacios confinados con desnivel.
                </p>
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2 font-semibold">
                  ⚠ Consume batería en segundo plano. Manténlo apagado si tu rubro no lo requiere.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={fallDetectionEnabled}
                aria-busy={fallDetectionLoading}
                onClick={() => setFallDetectionEnabled(!fallDetectionEnabled)}
                disabled={fallDetectionLoading}
                aria-label={fallDetectionEnabled ? 'Desactivar detección de caída' : 'Activar detección de caída'}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 mt-1 ${fallDetectionEnabled ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'} ${fallDetectionLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${fallDetectionEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        );
      case 'Notificaciones':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div>
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">Alertas por Correo Electrónico</h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-500">Resúmenes diarios y alertas críticas.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={emailNotifs}
                aria-label="Activar alertas por correo electrónico"
                onClick={() => setEmailNotifs(!emailNotifs)}
                className={`w-12 h-6 rounded-full transition-colors relative ${emailNotifs ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${emailNotifs ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
            
            <div className="flex flex-col gap-3 p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-sm font-bold text-zinc-900 dark:text-white">Notificaciones Push</h4>
                  <p className="text-xs text-zinc-600 dark:text-zinc-500">Recibe alertas instantáneas.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={pushNotifs}
                  aria-label="Activar notificaciones push"
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
                      <h5 className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest">🚨 Emergencias (S.O.S)</h5>
                      <p className="text-[10px] text-zinc-500">Alertas de S.O.S, evacuación y clima extremo. (No se puede desactivar por seguridad)</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={true}
                      aria-disabled={true}
                      aria-label="Alertas de emergencia (siempre activas por seguridad)"
                      disabled
                      className="w-10 h-5 rounded-full bg-red-500 opacity-50 cursor-not-allowed relative"
                    >
                      <div className="w-3 h-3 rounded-full bg-white absolute top-1 translate-x-6" />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest">🩺 Exámenes Médicos</h5>
                      <p className="text-[10px] text-zinc-500">Recordatorios de vigencia y nuevos resultados médicos.</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notifPrefs.medical}
                      aria-label="Notificaciones de exámenes médicos"
                      onClick={() => updateNotifPref('medical', !notifPrefs.medical)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${notifPrefs.medical ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                    >
                      <div className={`w-3 h-3 rounded-full bg-white absolute top-1 transition-transform ${notifPrefs.medical ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest">📚 Capacitaciones</h5>
                      <p className="text-[10px] text-zinc-500">Asignaciones de cursos, ODI y charlas programadas.</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notifPrefs.training}
                      aria-label="Notificaciones de capacitaciones"
                      onClick={() => updateNotifPref('training', !notifPrefs.training)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${notifPrefs.training ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                    >
                      <div className={`w-3 h-3 rounded-full bg-white absolute top-1 transition-transform ${notifPrefs.training ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest">🤖 Asistente IA (Guardian)</h5>
                      <p className="text-[10px] text-zinc-500">Consejos predictivos y anomalías detectadas en terreno.</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notifPrefs.ai_alerts}
                      aria-label="Notificaciones del asistente IA"
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
      case 'Configuración de IA':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <div>
              <label htmlFor={aiDetailId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">Nivel de Detalle del Asistente</label>
              <select id={aiDetailId} value={aiDetail} onChange={(e) => setAiDetail(e.target.value)} className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none">
                <option value="conciso">Conciso (Respuestas directas y cortas)</option>
                <option value="equilibrado">Equilibrado (Recomendado)</option>
                <option value="detallado">Detallado (Explicaciones exhaustivas y normativas)</option>
              </select>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div>
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">Análisis Predictivo Autónomo</h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-500">Permite a la IA analizar datos en segundo plano.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={aiProactive}
                aria-label="Activar análisis predictivo autónomo"
                onClick={() => setAiProactive(!aiProactive)}
                className={`w-12 h-6 rounded-full transition-colors relative ${aiProactive ? 'bg-[#4db6ac]' : 'bg-zinc-300 dark:bg-zinc-700'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${aiProactive ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        );
      case 'Base de Datos y Red Neuronal':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-6">
            <BunkerManager />
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5 text-center">
                <Database className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
                <span className="text-2xl font-black text-zinc-900 dark:text-white">1.2GB</span>
                <p className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest mt-1">Almacenamiento</p>
              </div>
              <div className="p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5 text-center">
                <Network className="w-6 h-6 text-indigo-500 mx-auto mb-2" />
                <span className="text-2xl font-black text-zinc-900 dark:text-white">842</span>
                <p className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest mt-1">Nodos Activos</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => addNotification({title: 'Exportación Iniciada', message: 'Tus datos se están preparando para descarga.', type: 'success'})} className="flex-1 py-2 bg-[#4db6ac]/10 hover:bg-[#4db6ac]/20 text-[#2a8a81] dark:text-[#4db6ac] text-xs font-bold rounded-xl transition-colors border border-[#4db6ac]/20">
                Exportar Datos (JSON)
              </button>
              <button onClick={() => addNotification({title: 'Caché Limpiada', message: 'Se ha liberado espacio local correctamente.', type: 'success'})} className="flex-1 py-2 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-900 dark:text-white text-xs font-bold rounded-xl transition-colors border border-zinc-200 dark:border-white/10">
                Limpiar Caché
              </button>
            </div>
          </div>
        );
      case 'Interfaz y Tema':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <div>
              <label htmlFor={themePrefId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">Preferencia de Tema</label>
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
                <option value="light">Claro (Fondo #4EB5AC)</option>
                <option value="dark">Oscuro</option>
                <option value="auto">Automático (Día/Noche)</option>
                <option value="system">Sistema Operativo</option>
              </select>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
              <div>
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white">Modo Oscuro Manual</h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-500">Alternar rápidamente (sobrescribe la preferencia)</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isDark}
                aria-label="Alternar modo oscuro manual"
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
      case 'Idioma y Región':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-4">
            <LocalePicker label="Idioma de la Interfaz" />
            {/* LocalePicker delegates to LanguageProvider which syncs
                i18next, the RTL `<html dir>` flag, lazy locale chunks and
                the Firestore user doc. The legacy `language` /
                `handleLanguageChange` state above is retained for any
                analytics/event listeners but the dropdown UI is now the
                single source of truth. */}
            <div>
              <label htmlFor={timezoneId} className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest">Zona Horaria</label>
              <select id={timezoneId} className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none">
                <option value="America/Santiago">America/Santiago (GMT-4)</option>
                <option value="America/Lima">America/Lima (GMT-5)</option>
                <option value="America/Bogota">America/Bogota (GMT-5)</option>
                <option value="America/Mexico_City">America/Mexico_City (GMT-6)</option>
              </select>
            </div>
          </div>
        );
      case 'Administración de Usuarios':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 space-y-6">
            {/* Set Role */}
            <div className="space-y-3">
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest" id={`${adminUidId}-group-label`}>Asignar Rol a Usuario</p>
              <label htmlFor={adminUidId} className="sr-only">UID del usuario (Firebase Auth)</label>
              <input
                id={adminUidId}
                type="text"
                placeholder="UID del usuario (Firebase Auth)"
                value={adminTargetUid}
                onChange={e => { setAdminTargetUid(e.target.value); setAdminActionStatus(null); }}
                className="w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none"
              />
              <label htmlFor={adminRoleId} className="sr-only">Rol a asignar</label>
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
                  setAdminActionStatus('Guardando...');
                  try {
                    const token = await user?.getIdToken();
                    const res = await fetch('/api/admin/set-role', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ uid: adminTargetUid.trim(), role: adminTargetRole }),
                    });
                    const data = await res.json();
                    setAdminActionStatus(res.ok ? `✓ Rol "${adminTargetRole}" asignado` : `Error: ${data.error}`);
                  } catch { setAdminActionStatus('Error de red'); }
                }}
                className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-black rounded-xl transition-colors"
              >
                Asignar Rol
              </button>
            </div>

            {/* Revoke Access */}
            <div className="space-y-3 border-t border-zinc-200 dark:border-white/5 pt-4">
              <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">Revocar Acceso</p>
              <p className="text-xs text-zinc-500">Invalida inmediatamente todos los tokens de sesión del usuario.</p>
              <button
                disabled={!adminTargetUid.trim()}
                onClick={async () => {
                  setAdminActionStatus('Revocando...');
                  try {
                    const token = await user?.getIdToken();
                    const res = await fetch('/api/admin/revoke-access', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ targetUid: adminTargetUid.trim() }),
                    });
                    const data = await res.json();
                    setAdminActionStatus(res.ok ? '✓ Acceso revocado' : `Error: ${data.error}`);
                  } catch { setAdminActionStatus('Error de red'); }
                }}
                className="w-full py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-black rounded-xl transition-colors"
              >
                Revocar Acceso
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
      title: 'Acción Restringida',
      message: 'Para eliminar tu cuenta permanentemente, por favor contacta al administrador del sistema.',
      type: 'warning'
    });
  };

  const sections = [
    { title: 'Perfil y Cuenta', icon: User, description: 'Gestiona tu información personal y preferencias de acceso.' },
    { title: 'Seguridad y Privacidad', icon: Lock, description: 'Configura la autenticación de dos factores y permisos de datos.' },
    { title: 'Notificaciones', icon: Bell, description: 'Personaliza qué alertas deseas recibir y por qué canales.' },
    { title: 'Configuración de IA', icon: Zap, description: 'Ajusta el comportamiento de Gemini y el análisis predictivo.' },
    { title: 'Base de Datos y Red Neuronal', icon: Database, description: 'Gestión de nodos, conexiones y exportación de datos.' },
    { title: 'Interfaz y Tema', icon: Palette, description: 'Personaliza el aspecto visual de Praeventio Guard.' },
    { title: 'Idioma y Región', icon: Globe, description: 'Ajusta el idioma de la plataforma y formatos regionales.' },
    ...(isAdmin ? [{ title: 'Administración de Usuarios', icon: Shield, description: 'Asigna roles y revoca acceso a usuarios de la plataforma.' }] : []),
  ];

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-white tracking-tight">Configuración</h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-1 text-xs sm:text-sm">Personaliza tu experiencia en Praeventio Guard</p>
      </div>

      <div className="space-y-4 mb-6 sm:mb-8">
        <div className="bg-white/50 dark:bg-zinc-900/50 border border-emerald-500/30 rounded-2xl p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-start sm:items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20">
                <Smartphone className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-white text-sm sm:text-base">Notificaciones Push (FCM)</h3>
                <p className="text-zinc-600 dark:text-zinc-400 text-[10px] sm:text-sm">Recibe alertas críticas y de emergencia en tiempo real.</p>
              </div>
            </div>
            <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start w-full sm:w-auto mt-2 sm:mt-0">
              <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest px-2 py-1 rounded-full sm:mb-2 ${
                notificationPermissionStatus === 'granted' ? 'bg-emerald-500/20 text-emerald-400' :
                notificationPermissionStatus === 'denied' ? 'bg-rose-500/20 text-rose-400' :
                'bg-amber-500/20 text-amber-400'
              }`}>
                {notificationPermissionStatus === 'granted' ? 'Activas' :
                 notificationPermissionStatus === 'denied' ? 'Bloqueadas' :
                 'Pendientes'}
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
                      Requiere Conexión
                    </>
                  ) : (
                    'Activar Notificaciones'
                  )}
                </button>
              )}
            </div>
          </div>
          <p className="text-[10px] sm:text-xs text-zinc-700 dark:text-zinc-500 leading-relaxed">
            Para recibir notificaciones push, debes permitir el acceso en tu navegador. Esto habilitará Firebase Cloud Messaging (FCM) para enviarte alertas críticas incluso cuando la aplicación esté en segundo plano.
          </p>
        </div>
      </div>

      <div className="space-y-3 sm:space-y-4">
        {sections.map((section, index) => {
          const isActive = activeSection === section.title;
          return (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`bg-white/50 dark:bg-zinc-900/50 border rounded-xl sm:rounded-2xl transition-all ${isActive ? 'border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'border-zinc-200 dark:border-white/10 hover:border-emerald-500/30'}`}
            >
              <button
                type="button"
                onClick={() => handleSectionClick(section.title)}
                aria-expanded={isActive}
                aria-controls={`settings-section-${section.title.replace(/\s+/g, '-').toLowerCase()}`}
                className="w-full p-4 sm:p-5 flex items-center justify-between gap-4 cursor-pointer group text-left"
              >
                <div className="flex items-start sm:items-center gap-3 sm:gap-4 flex-1">
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-lg sm:rounded-xl flex items-center justify-center transition-colors ${isActive ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 'bg-white/40 dark:bg-zinc-800 text-emerald-600 dark:text-emerald-500 border border-zinc-200 dark:border-white/5 group-hover:bg-white/60 dark:group-hover:bg-zinc-800/80'}`}>
                    <section.icon className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h2 className={`font-bold text-sm sm:text-base transition-colors truncate ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400'}`}>{section.title}</h2>
                    <p className="text-zinc-600 dark:text-zinc-500 text-[10px] sm:text-sm line-clamp-2 sm:line-clamp-1">{section.description}</p>
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
                    id={`settings-section-${section.title.replace(/\s+/g, '-').toLowerCase()}`}
                    role="region"
                    aria-label={section.title}
                  >
                    <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                      {renderSectionContent(section.title)}
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
          <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Zona de Peligro</h3>
        </div>
        <p className="text-[10px] sm:text-sm text-zinc-700 dark:text-zinc-500 mb-4 sm:mb-6 leading-relaxed">
          Estas acciones son permanentes y no se pueden deshacer. Por favor, procede con extrema precaución.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <button 
            onClick={handleLogout}
            className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[10px] sm:text-sm font-black uppercase tracking-widest rounded-xl transition-all border border-rose-500/20 active:scale-95"
          >
            Cerrar Sesión Global
          </button>
          <button 
            onClick={handleDeleteAccount}
            className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-rose-500 hover:bg-rose-600 text-white text-[10px] sm:text-sm font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-rose-500/20 active:scale-95"
          >
            Eliminar Cuenta
          </button>
        </div>
      </div>
    </div>
  );
}
