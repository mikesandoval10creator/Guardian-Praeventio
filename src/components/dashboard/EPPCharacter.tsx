import { Shield, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card } from '../shared/Card';
import { eppCatalog } from '../../data/epp';

export function EPPCharacter() {
  const requiredEPP = eppCatalog.filter(e => e.required);

  return (
    <Card className="p-8 bg-zinc-50 dark:bg-zinc-900/50 border-dashed border-2">
      <div className="flex flex-col items-center text-center mb-8">
        <div className="relative mb-6">
          <div className="w-48 h-48 bg-emerald-100 dark:bg-emerald-900/20 rounded-full flex items-center justify-center border-4 border-emerald-500/20">
            <Shield className="w-24 h-24 text-emerald-600 dark:text-emerald-400 drop-shadow-sm" />
          </div>
          <div className="absolute -top-2 -right-2 bg-emerald-500 text-white p-2 rounded-full shadow-lg">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
        <h3 className="text-xl font-bold tracking-tight mb-2 uppercase">Guardián Praeventio</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">
          Tu equipo de protección personal está completo y verificado para las condiciones actuales.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {requiredEPP.map((item) => (
          <div key={item.id} className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center shadow-sm">
              <img 
                src={item.imageUrl || undefined} 
                alt={item.name} 
                className="w-8 h-8 object-contain opacity-80"
                referrerPolicy="no-referrer"
              />
            </div>
            <span className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-tighter text-center leading-none">
              {item.name}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
