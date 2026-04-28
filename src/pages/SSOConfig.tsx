import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Key, ShieldAlert, CheckCircle2, AlertTriangle, Building, Users, Lock, ChevronRight } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';

export function SSOConfig() {
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);

  const handleConfigure = () => {
    setIsConfiguring(true);
    // Simulate SSO Configuration
    setTimeout(() => {
      setIsConfiguring(false);
      setIsConfigured(true);
    }, 3000);
  };

  // Gate: SSO (SAML/OIDC corporate auth) is a Workspace Native add-on shipped
  // only with Titanio+. The old `isPremium` boolean would have let any paid
  // tier (e.g. Comité Paritario at CLP $11.990/mes) reach this surface, which
  // is not what we sell. `canUseSSO` enforces the actual product boundary.
  return (
    <PremiumFeatureGuard
      feature="canUseSSO"
      featureName="Single Sign-On (SSO)"
      description="SSO corporativo (SAML/OIDC, Azure AD, Okta) está disponible desde el plan Titanio. Actualiza tu plan para configurar autenticación corporativa."
    >
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Key className="w-8 h-8 text-violet-500" />
            Single Sign-On (SSO)
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Autenticación Corporativa SAML / OIDC
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-violet-500 bg-violet-500/10 border-violet-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Nivel: Enterprise
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Identity Providers */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Building className="w-5 h-5 text-violet-500" />
            Proveedores de Identidad (IdP)
          </h2>

          <div className="space-y-3">
            <div className={`p-4 rounded-xl border-2 transition-colors cursor-pointer ${isConfigured ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/50 hover:border-violet-500/50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-lg ${isConfigured ? 'bg-emerald-500/20 text-emerald-500' : 'bg-zinc-800 text-zinc-500'}`}>
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.4 24l-8.7-14.8h17.4z" fill="#00a1e0"/>
                      <path d="M11.4 0l8.7 14.8H2.7z" fill="#17324d"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Azure Active Directory</h3>
                    <p className="text-xs text-zinc-400">SAML 2.0 / OIDC</p>
                  </div>
                </div>
                {isConfigured ? (
                  <span className="text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">Activo</span>
                ) : (
                  <ChevronRight className="w-5 h-5 text-zinc-500" />
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl border-2 border-zinc-800 bg-zinc-900/50 flex items-center justify-between opacity-50">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-zinc-800 text-zinc-500">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 1.97c-.383.383-1.006.383-1.389 0l-1.97-1.97c-.383-.383-.383-1.006 0-1.389l1.97-1.97c.383-.383 1.006-.383 1.389 0l1.97 1.97c.383.383.383 1.006 0 1.389zM12 19.684c-4.243 0-7.684-3.441-7.684-7.684S7.757 4.316 12 4.316c4.243 0 7.684 3.441 7.684 7.684s-3.441 7.684-7.684 7.684z"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Okta</h3>
                  <p className="text-xs text-zinc-400">SAML 2.0</p>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border-2 border-zinc-800 bg-zinc-900/50 flex items-center justify-between opacity-50">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-zinc-800 text-zinc-500">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.02 0L0 7.02l12.02 7.02L24 7.02 12.02 0zm0 15.65L3.43 10.6l-3.43 2.01L12.02 24l12.02-11.39-3.43-2.01-8.59 5.05z"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Google Workspace</h3>
                  <p className="text-xs text-zinc-400">OIDC</p>
                </div>
              </div>
            </div>
          </div>

          {!isConfigured && (
            <Button 
              className="w-full py-4 text-lg" 
              onClick={handleConfigure} 
              disabled={isConfiguring}
            >
              {isConfiguring ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin mr-2" />
                  Configurando Metadatos...
                </>
              ) : (
                <>
                  <Key className="w-5 h-5 mr-2" />
                  Configurar Azure AD
                </>
              )}
            </Button>
          )}
        </Card>

        {/* Configuration Details */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-violet-500" />
            Detalles de Configuración
          </h2>

          {!isConfigured ? (
            <div className="flex flex-col items-center justify-center h-64 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
              <Users className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500 max-w-xs">Configura un proveedor de identidad para habilitar el inicio de sesión único para tus empleados.</p>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Entity ID (Audience URI)</p>
                <code className="text-xs text-violet-400 break-all">https://praeventio.net/saml/metadata</code>
              </div>

              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Assertion Consumer Service (ACS) URL</p>
                <code className="text-xs text-white break-all">https://praeventio.net/api/auth/saml/callback</code>
              </div>

              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Mapeo de Atributos</p>
                <div className="space-y-2 mt-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Email</span>
                    <span className="text-white font-mono">http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Nombre</span>
                    <span className="text-white font-mono">http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Rol</span>
                    <span className="text-white font-mono">http://schemas.microsoft.com/ws/2008/06/identity/claims/role</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-emerald-400">SSO Habilitado</h3>
                  <p className="text-xs text-emerald-500/70">Los usuarios ahora pueden iniciar sesión usando sus credenciales corporativas.</p>
                </div>
              </div>
            </motion.div>
          )}
        </Card>
      </div>
    </div>
    </PremiumFeatureGuard>
  );
}
