// Praeventio Guard — Sprint 31 Bucket PP.
//
// /reglamentos — landing page for DS 67 + DS 76 PDF generators. Tabbed
// switcher between the two reglamentos. Tenant + reporter come from the
// active session via FirebaseContext (mirrors SusesoReports).

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ds67Builder } from '../components/compliance/Ds67Builder';
import { Ds76Builder } from '../components/compliance/Ds76Builder';
import { useFirebase } from '../contexts/FirebaseContext';

type Tab = 'ds67' | 'ds76';

export const Reglamentos: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const [tab, setTab] = useState<Tab>('ds67');

  // Default tenant + reporter shape — falls back to safe placeholders if
  // the user record hasn't loaded yet. Real values come from the user
  // profile (tenantId) and Firebase Auth (uid).
  const tenantId = (user as { tenantId?: string } | null)?.tenantId ?? 'praeventio';
  const reportedBy = {
    uid: user?.uid ?? '',
    rut: ((user as { rut?: string } | null)?.rut ?? ''),
    fullName: user?.displayName ?? '',
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">{t('reglamentos.title', 'Reglamentos internos')}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t('reglamentos.subtitle', 'Genera PDFs firmables electrónicamente para DS 67/1999 (Higiene y Seguridad) y DS 76/2007 (Subcontratación Mining). Cada PDF lleva folio único, hash SHA-256 y firma simple Ley 19.799.')}
        </p>
      </header>

      <nav className="flex gap-2 border-b border-zinc-200 dark:border-zinc-700">
        <button
          onClick={() => setTab('ds67')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'ds67'
              ? 'border-b-2 border-teal-500 text-teal-600'
              : 'text-zinc-600'
          }`}
        >
          {t('reglamentos.tabDs67', 'DS 67 — Reglamento Interno')}
        </button>
        <button
          onClick={() => setTab('ds76')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'ds76'
              ? 'border-b-2 border-teal-500 text-teal-600'
              : 'text-zinc-600'
          }`}
        >
          {t('reglamentos.tabDs76', 'DS 76 — Subcontratación')}
        </button>
      </nav>

      <section>
        {tab === 'ds67' ? (
          <Ds67Builder tenantId={tenantId} reportedBy={reportedBy} />
        ) : (
          <Ds76Builder tenantId={tenantId} reportedBy={reportedBy} />
        )}
      </section>
    </div>
  );
};

export default Reglamentos;
