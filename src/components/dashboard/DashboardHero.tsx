// Dashboard hero greeting — time-aware personalized header.
// Replaces the floating morning-wakeup button with a proper contextual header.
//
// Sprint B PR #519 (this): adds the Guardián Praeventio mascot to the
// left of the greeting. Mood is derived from time-of-day (celebrating
// in the morning, default in afternoon, thinking at night) and is
// auto-overridden to `emergency` when AppMode === 'emergency' via the
// MascotMood resolution inside `<GuardianMascot>` itself. The mascot
// hides in driving mode (also handled inside the component) so the hero
// degrades gracefully without conditional logic here.

import { Sun, Sunset, Moon, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../../contexts/ProjectContext';
import { GuardianMascot, type MascotMood } from '../shared/GuardianMascot';

interface DashboardHeroProps {
  onMorningCheckIn: () => void;
}

function getTimeOfDay(): {
  label: string;
  icon: typeof Sun;
  period: 'morning' | 'afternoon' | 'night';
  mascotMood: MascotMood;
} {
  const h = new Date().getHours();
  if (h >= 6 && h < 13)
    return { label: 'Buenos días', icon: Sun, period: 'morning', mascotMood: 'celebrating' };
  if (h >= 13 && h < 20)
    return { label: 'Buenas tardes', icon: Sunset, period: 'afternoon', mascotMood: 'default' };
  return { label: 'Buenas noches', icon: Moon, period: 'night', mascotMood: 'thinking' };
}

export function DashboardHero({ onMorningCheckIn }: DashboardHeroProps) {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { label: greeting, icon: Icon, mascotMood } = getTimeOfDay();

  const today = new Date().toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <section className="flex items-center justify-between gap-3 px-0.5">
      <div className="flex items-center gap-3 min-w-0">
        {/* Guardián mascot — Sprint B PR #519 wire. Renders the brand
            mascot at sm size (16×16) next to the time-icon, giving the
            dashboard hero a consistent identity touchpoint. The mood
            comes from time-of-day; AppModeContext auto-overrides to
            `emergency` when an emergency is active (logic inside
            <GuardianMascot>). Hidden in driving mode by the component. */}
        <GuardianMascot mood={mascotMood} size="sm" className="shrink-0" />
        <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-full accent-bg flex items-center justify-center shrink-0 shadow-mode">
          <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-xs sm:text-sm font-black text-primary-token leading-none capitalize">
            {t('dashboard.greeting', greeting)}
          </p>
          {selectedProject ? (
            <div className="flex items-center gap-1 mt-0.5">
              <Building2 className="w-2.5 h-2.5 text-muted-token shrink-0" />
              <span className="text-[9px] sm:text-[11px] text-muted-token truncate font-medium">
                {selectedProject.name}
              </span>
            </div>
          ) : (
            <span className="text-[9px] sm:text-[11px] text-muted-token capitalize">{today}</span>
          )}
        </div>
      </div>

      <button
        onClick={onMorningCheckIn}
        className="shrink-0 accent-bg hover:opacity-80 text-white px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-widest shadow-mode transition-all hover:scale-105 whitespace-nowrap flex items-center gap-1"
      >
        <Sun className="w-2.5 h-2.5" />
        {t('dashboard.morning_wakeup', 'Check-in')}
      </button>
    </section>
  );
}
