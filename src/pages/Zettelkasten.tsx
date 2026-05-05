// Sprint 29 Bucket AA F-B — Zettelkasten landing page.
//
// Por ahora aloja únicamente el panel de búsqueda NL sobre incidentes
// históricos del proyecto. Futuras secciones (grafo, generadores ad-hoc,
// graph topology de Euler) se anclan desde aquí.

import React from 'react';
import { Database } from 'lucide-react';
import { NlQueryPanel } from '../components/zettelkasten/NlQueryPanel';

export const Zettelkasten: React.FC = () => {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-[#4db6ac]/10 flex items-center justify-center border border-[#4db6ac]/20">
          <Database className="w-6 h-6 text-[#4db6ac]" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">Zettelkasten</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Red de conocimiento vinculada al proyecto activo.
          </p>
        </div>
      </header>

      <NlQueryPanel />
    </div>
  );
};

export default Zettelkasten;
