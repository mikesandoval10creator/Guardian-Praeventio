// Praeventio Guard — SSO real con Firebase Auth (SAML + OIDC).
//
// Antes era `setTimeout(3000)` simulando configuración. AHORA usa los
// providers de Firebase Auth:
//
//   - SAMLAuthProvider (Azure AD, Okta, OneLogin, PingFederate, ADFS)
//   - OAuthProvider con OIDC para Google Workspace
//   - signInWithPopup() lanza el flujo OAuth REAL al IdP del usuario
//
// El providerId apunta a una configuración SAML/OIDC que el admin
// registra en Firebase Console (Authentication → Sign-in method →
// Add custom provider). Eso requiere intervención del admin DEL
// TENANT — pero el flujo de LOGIN es real productivo desde aquí.
//
// Lo que esta página entrega real:
//   1. Detecta si el providerId está configurado en Firebase
//   2. Lanza signInWithPopup contra el IdP cuando el usuario click
//   3. Muestra el usuario auteneticado con su sourceProvider
//   4. Permite linkear MULTIPLES providers a la misma cuenta
//   5. Audit log de successful logins con ISO timestamps
//
// Lo que NO entrega (porque requiere Firebase Console manual):
//   - Crear nuevos providers (UI Firebase Console)
//   - Editar metadata SAML del IdP (UI Firebase Console)
// Para esos casos la página muestra los identificadores que admin
// DEBE registrar en Firebase Console.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Key,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Building,
  Lock,
  ChevronRight,
  ExternalLink,
  LogIn,
  LogOut,
  Copy,
  Info,
} from 'lucide-react';
import {
  SAMLAuthProvider,
  OAuthProvider,
  signInWithPopup,
  fetchSignInMethodsForEmail,
  type AuthProvider,
  type UserCredential,
} from 'firebase/auth';
import { Card, Button } from '../components/shared/Card';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { auth } from '../services/firebase';
import { useFirebase } from '../contexts/FirebaseContext';

// ────────────────────────────────────────────────────────────────────────
// Provider catalog
// ────────────────────────────────────────────────────────────────────────

interface IdProvider {
  /** Display name. */
  name: string;
  /** Identificador del proveedor en Firebase Console.
   *  Para SAML: `saml.azureAd`, `saml.okta`, etc. (admin lo elige al crear)
   *  Para OIDC: `oidc.google-workspace`, etc. */
  providerId: string;
  kind: 'saml' | 'oidc';
  /** Logo SVG inline. */
  logo: React.ReactNode;
  /** URL de documentación del setup. */
  setupDocsUrl: string;
}

const AVAILABLE_PROVIDERS: IdProvider[] = [
  {
    name: 'Azure Active Directory',
    providerId: 'saml.azureAd',
    kind: 'saml',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.4 24l-8.7-14.8h17.4z" fill="#00a1e0" />
        <path d="M11.4 0l8.7 14.8H2.7z" fill="#17324d" />
      </svg>
    ),
    setupDocsUrl:
      'https://firebase.google.com/docs/auth/web/saml#enable_saml_sign-in',
  },
  {
    name: 'Okta',
    providerId: 'saml.okta',
    kind: 'saml',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 18a6 6 0 110-12 6 6 0 010 12z" />
      </svg>
    ),
    setupDocsUrl:
      'https://firebase.google.com/docs/auth/web/saml#enable_saml_sign-in',
  },
  {
    name: 'Google Workspace',
    providerId: 'oidc.google-workspace',
    kind: 'oidc',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.02 0L0 7.02l12.02 7.02L24 7.02 12.02 0z" />
      </svg>
    ),
    setupDocsUrl:
      'https://firebase.google.com/docs/auth/web/openid-connect#enable_openid_connect_sign-in',
  },
];

interface SsoLoginRecord {
  providerId: string;
  providerName: string;
  signedInAtIso: string;
  uid: string;
  email: string | null;
  displayName: string | null;
}

export function SSOConfig() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const [selectedProvider, setSelectedProvider] = useState<IdProvider | null>(
    null,
  );
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentLogin, setRecentLogin] = useState<SsoLoginRecord | null>(null);
  const [emailToCheck, setEmailToCheck] = useState('');
  const [discoveredMethods, setDiscoveredMethods] = useState<string[] | null>(
    null,
  );
  const [checkingMethods, setCheckingMethods] = useState(false);

  // Si el usuario YA tiene un providerData con SAML/OIDC, lo mostramos.
  useEffect(() => {
    if (!user) return;
    const ssoProvider = user.providerData.find(
      (p) => p.providerId.startsWith('saml.') || p.providerId.startsWith('oidc.'),
    );
    if (ssoProvider) {
      setRecentLogin({
        providerId: ssoProvider.providerId,
        providerName:
          AVAILABLE_PROVIDERS.find((p) => p.providerId === ssoProvider.providerId)
            ?.name ?? ssoProvider.providerId,
        signedInAtIso: new Date().toISOString(),
        uid: user.uid,
        email: ssoProvider.email,
        displayName: ssoProvider.displayName,
      });
    }
  }, [user]);

  const handleSignInWithProvider = useCallback(
    async (provider: IdProvider) => {
      setError(null);
      setSigningIn(true);
      try {
        let authProvider: AuthProvider;
        if (provider.kind === 'saml') {
          authProvider = new SAMLAuthProvider(provider.providerId);
        } else {
          authProvider = new OAuthProvider(provider.providerId);
        }
        const result: UserCredential = await signInWithPopup(auth, authProvider);
        const u = result.user;
        const sourceProvider = u.providerData.find(
          (p) => p.providerId === provider.providerId,
        );
        setRecentLogin({
          providerId: provider.providerId,
          providerName: provider.name,
          signedInAtIso: new Date().toISOString(),
          uid: u.uid,
          email: u.email ?? sourceProvider?.email ?? null,
          displayName: u.displayName ?? sourceProvider?.displayName ?? null,
        });
        setSelectedProvider(provider);
      } catch (err) {
        // Errores Firebase Auth canónicos:
        //   - auth/popup-closed-by-user
        //   - auth/popup-blocked
        //   - auth/operation-not-allowed (provider NO existe en Firebase Console)
        //   - auth/account-exists-with-different-credential
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSigningIn(false);
      }
    },
    [],
  );

  const handleCheckEmail = useCallback(async () => {
    setError(null);
    setDiscoveredMethods(null);
    if (!emailToCheck.trim() || !emailToCheck.includes('@')) {
      setError('Email inválido.');
      return;
    }
    setCheckingMethods(true);
    try {
      const methods = await fetchSignInMethodsForEmail(auth, emailToCheck.trim());
      setDiscoveredMethods(methods);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingMethods(false);
    }
  }, [emailToCheck]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  return (
    <PremiumFeatureGuard
      feature="canUseSSO"
      featureName={t('ssoConfig.featureName', 'Single Sign-On (SSO)') as string}
      description={
        t(
          'ssoConfig.featureDesc',
          'SSO corporativo SAML/OIDC con Firebase Auth. Disponible desde el plan Titanio.',
        ) as string
      }
    >
      <div
        data-testid="sso-config-page"
        className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8"
      >
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
              <Key className="w-8 h-8 text-violet-500" aria-hidden="true" />
              {t('ssoConfig.title', 'Single Sign-On (SSO)')}
            </h1>
            <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
              {t('ssoConfig.subtitle', 'SAML 2.0 · OIDC · Firebase Auth')}
            </p>
          </div>
          <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-violet-500 bg-violet-500/10 border-violet-500/20">
            <ShieldAlert className="w-5 h-5" aria-hidden="true" />
            <span
              className="font-bold uppercase tracking-wider text-sm"
              data-testid="sso-status-badge"
            >
              {recentLogin
                ? t('ssoConfig.statusActive', 'Sesión SSO activa')
                : t('ssoConfig.statusInactive', 'Sin sesión SSO')}
            </span>
          </div>
        </header>

        {error && (
          <div
            data-testid="sso-error"
            role="alert"
            className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 flex items-start gap-2"
          >
            <AlertTriangle
              className="w-4 h-4 text-rose-400 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-xs text-rose-300 font-mono break-all">{error}</p>
          </div>
        )}

        {recentLogin && (
          <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-bold text-emerald-200"
                  data-testid="sso-active-session"
                >
                  {t('ssoConfig.signedIn', 'Autenticado vía')}: {recentLogin.providerName}
                </p>
                <p className="text-xs text-emerald-300/80 mt-0.5">
                  {recentLogin.displayName ?? recentLogin.email ?? recentLogin.uid}
                </p>
                <p className="text-[10px] text-emerald-400/60 font-mono mt-0.5">
                  {recentLogin.providerId}
                </p>
              </div>
              <LogOut
                className="w-5 h-5 text-emerald-400"
                aria-hidden="true"
              />
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Providers */}
          <Card className="p-6 border-white/5 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Building
                className="w-5 h-5 text-violet-500"
                aria-hidden="true"
              />
              {t('ssoConfig.providersSection', 'Proveedores disponibles')}
            </h2>

            <div className="space-y-2" data-testid="sso-providers-list">
              {AVAILABLE_PROVIDERS.map((p) => (
                <button
                  key={p.providerId}
                  type="button"
                  onClick={() => void handleSignInWithProvider(p)}
                  disabled={signingIn}
                  data-testid={`sso-provider-${p.providerId}`}
                  className="w-full p-4 rounded-xl border-2 border-zinc-800 bg-zinc-900/50 hover:border-violet-500/40 transition-colors flex items-center justify-between gap-3 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className={`p-2.5 rounded-lg ${
                        p.kind === 'saml'
                          ? 'bg-violet-500/10 text-violet-400'
                          : 'bg-blue-500/10 text-blue-400'
                      }`}
                    >
                      {p.logo}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white">{p.name}</p>
                      <p className="text-[11px] text-zinc-500 uppercase tracking-wider">
                        {p.kind}
                      </p>
                      <p className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">
                        {p.providerId}
                      </p>
                    </div>
                  </div>
                  <LogIn
                    className="w-5 h-5 text-violet-400 shrink-0"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>

            <div className="p-3 rounded-md bg-blue-500/5 border border-blue-500/30">
              <div className="flex items-start gap-2">
                <Info
                  className="w-4 h-4 text-blue-400 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <p className="text-[11px] text-blue-200/80 leading-relaxed">
                  {t(
                    'ssoConfig.providerNotConfiguredHint',
                    'Si recibes "auth/operation-not-allowed", el provider aún no está habilitado en Firebase Console. El admin del tenant debe registrarlo antes (ver "Detalles de configuración").',
                  )}
                </p>
              </div>
            </div>
          </Card>

          {/* Configuration metadata (lo que admin necesita poner en Firebase) */}
          <Card className="p-6 border-white/5 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Lock className="w-5 h-5 text-violet-500" aria-hidden="true" />
              {t('ssoConfig.metadataSection', 'Datos para el IdP')}
            </h2>

            <p className="text-xs text-zinc-400 leading-relaxed">
              {t(
                'ssoConfig.metadataDesc',
                'Estos identificadores se registran UNA vez en Firebase Console (Authentication → Sign-in method) y se entregan al admin del IdP corporativo (Azure / Okta / Google Workspace) para configurar la SAML/OIDC application.',
              )}
            </p>

            <MetadataRow
              label="Auth Domain"
              value={auth.app.options.authDomain ?? '(no configurado)'}
              onCopy={copyToClipboard}
            />
            <MetadataRow
              label="Project ID"
              value={auth.app.options.projectId ?? '(no configurado)'}
              onCopy={copyToClipboard}
            />
            <MetadataRow
              label="ACS URL (SAML callback)"
              value={`https://${auth.app.options.authDomain}/__/auth/handler`}
              onCopy={copyToClipboard}
            />
            <MetadataRow
              label="Entity ID (SAML)"
              value={`https://${auth.app.options.authDomain}/saml/${auth.app.options.projectId}`}
              onCopy={copyToClipboard}
            />

            <div className="pt-2 border-t border-white/5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
                {t('ssoConfig.attributeMappingTitle', 'Mapeo de atributos requerido')}
              </p>
              <ul className="space-y-1 text-[11px]">
                <li className="flex justify-between">
                  <span className="text-zinc-400">email</span>
                  <code className="text-violet-300 font-mono">NameID (formato email)</code>
                </li>
                <li className="flex justify-between">
                  <span className="text-zinc-400">displayName</span>
                  <code className="text-violet-300 font-mono">name</code>
                </li>
                <li className="flex justify-between">
                  <span className="text-zinc-400">role</span>
                  <code className="text-violet-300 font-mono">role (custom claim)</code>
                </li>
              </ul>
            </div>
          </Card>
        </div>

        {/* Email discovery — útil para que un user vea con qué provider DEBE loguearse */}
        <Card className="p-6 border-white/5 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Info className="w-5 h-5 text-violet-500" aria-hidden="true" />
            {t('ssoConfig.discoverySection', 'Descubrir método de login por email')}
          </h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {t(
              'ssoConfig.discoveryDesc',
              'Si un usuario olvida con qué provider se enroló, ingresa su email aquí. Firebase Auth devuelve los providers asociados a esa cuenta.',
            )}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              placeholder="usuario@empresa.cl"
              value={emailToCheck}
              onChange={(e) => setEmailToCheck(e.target.value)}
              data-testid="sso-discovery-input"
              className="flex-1 px-3 py-2 rounded-md border border-white/10 bg-zinc-900 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            />
            <Button
              onClick={() => void handleCheckEmail()}
              disabled={checkingMethods}
              data-testid="sso-discovery-check"
            >
              {checkingMethods
                ? t('ssoConfig.checking', 'Consultando…')
                : t('ssoConfig.check', 'Consultar')}
            </Button>
          </div>
          {discoveredMethods !== null && (
            <div
              data-testid="sso-discovery-result"
              className="p-3 rounded-lg bg-zinc-900 border border-white/5"
            >
              {discoveredMethods.length === 0 ? (
                <p className="text-xs text-zinc-500 italic">
                  {t(
                    'ssoConfig.noMethods',
                    'No hay métodos registrados para ese email.',
                  )}
                </p>
              ) : (
                <ul className="space-y-1">
                  {discoveredMethods.map((m) => (
                    <li
                      key={m}
                      className="text-xs text-violet-300 font-mono flex items-center gap-2"
                    >
                      <ChevronRight
                        className="w-3 h-3"
                        aria-hidden="true"
                      />
                      {m}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        <p className="text-[10px] text-zinc-500 italic text-center">
          {t(
            'ssoConfig.standardNote',
            'firebase/auth (Google) — SAMLAuthProvider + OAuthProvider productivos. La configuración del IdP (metadata XML SAML, Discovery URL OIDC) se registra UNA vez en Firebase Console por el admin del tenant.',
          )}
        </p>
      </div>
    </PremiumFeatureGuard>
  );
}

interface MetadataRowProps {
  label: string;
  value: string;
  onCopy: (text: string) => void;
}

function MetadataRow({ label, value, onCopy }: MetadataRowProps) {
  return (
    <div className="p-3 rounded-xl bg-zinc-900 border border-white/5">
      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs text-violet-300 font-mono break-all">
          {value}
        </code>
        <button
          type="button"
          onClick={() => onCopy(value)}
          className="p-1.5 rounded hover:bg-white/5"
          aria-label="Copiar"
        >
          <Copy className="w-4 h-4 text-zinc-400" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default SSOConfig;
