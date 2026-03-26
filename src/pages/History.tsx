import { milestones } from '../data/milestones';
import { Card } from '../components/shared/Card';
import { History as HistoryIcon, Globe, MapPin } from 'lucide-react';

export function History() {
  return (
    <div className="space-y-6 sm:space-y-8 p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col items-center text-center mb-6 sm:mb-8">
        <div className="bg-zinc-100 dark:bg-zinc-800 p-3 sm:p-4 rounded-2xl sm:rounded-3xl mb-3 sm:mb-4">
          <HistoryIcon className="w-6 h-6 sm:w-8 sm:h-8 text-zinc-600 dark:text-zinc-400" />
        </div>
        <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tighter leading-tight">Historia de la Seguridad</h2>
        <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 max-w-xs mt-1">
          Evolución de la prevención de riesgos a nivel global y en Chile.
        </p>
      </div>

      <div className="relative space-y-6 sm:space-y-8 before:absolute before:inset-0 before:ml-4 sm:before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-emerald-500 before:via-zinc-200 before:to-zinc-200 dark:before:via-zinc-800 dark:before:to-zinc-800">
        {milestones.map((milestone, index) => (
          <div key={index} className="relative flex items-start gap-4 sm:gap-6 pl-10 sm:pl-12">
            <div className="absolute left-0 w-8 h-8 sm:w-10 sm:h-10 bg-white dark:bg-zinc-900 rounded-full border-2 border-emerald-500 flex items-center justify-center shadow-sm z-10">
              <span className="text-[8px] sm:text-[10px] font-black">{milestone.year}</span>
            </div>
            <Card className="flex-1 p-4 sm:p-6 hover:border-emerald-500/50 transition-colors">
              <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                {milestone.region === 'Global' ? (
                  <Globe className="w-3 h-3 text-blue-500" />
                ) : (
                  <MapPin className="w-3 h-3 text-red-500" />
                )}
                <span className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  {milestone.region}
                </span>
              </div>
              <h3 className="text-xs sm:text-sm font-black uppercase tracking-tight mb-1.5 sm:mb-2">{milestone.title}</h3>
              <p className="text-[10px] sm:text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {milestone.description}
              </p>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
