/**
 * Accessibility — Sprint K §139-145.
 *
 * Single-page hub that exposes the four orthogonal accessibility-mode
 * toggles owned by `<AccessibilityProvider>` together with a live
 * preview of each effect. Every toggle is fully labelled and uses a
 * proper `role="switch"` so screen readers announce state without
 * ambiguity. Tap targets always honour the global `--min-tap-target`
 * token so this page itself is operable in `glovesMode` from the very
 * first interaction.
 *
 * The preview tiles render *with* the corresponding CSS class scoped
 * to a local container so the user can see the effect before committing
 * — distinct from the global toggle which mutates the root element.
 */
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Contrast,
  Hand,
  WifiOff,
  RotateCcw,
} from 'lucide-react';
import { useAccessibility } from '../contexts/AccessibilityContext';

interface ToggleCardProps {
  id: string;
  Icon: typeof BookOpen;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  previewClass: string;
  previewLabel: string;
  previewBody: string;
}

function ToggleCard({
  id,
  Icon,
  title,
  description,
  enabled,
  onToggle,
  previewClass,
  previewLabel,
  previewBody,
}: ToggleCardProps) {
  const switchId = `${id}-switch`;
  const previewId = `${id}-preview`;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="bg-surface border border-default-token rounded-3xl p-5 sm:p-6 shadow-mode flex flex-col gap-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center accent-text shrink-0">
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2
              id={`${id}-title`}
              className="text-base sm:text-lg font-black text-primary-token leading-tight"
            >
              {title}
            </h2>
            <p className="text-sm text-secondary-token mt-1 leading-relaxed">
              {description}
            </p>
          </div>
        </div>

        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby={`${id}-title`}
          aria-describedby={previewId}
          onClick={() => onToggle(!enabled)}
          className={`relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[#4db6ac] focus-visible:ring-offset-2 ${
            enabled ? 'bg-teal-400' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
          style={{
            width: 'max(56px, var(--min-tap-target, 44px))',
            height: 'max(32px, calc(var(--min-tap-target, 44px) * 0.6))',
          }}
        >
          <span
            aria-hidden="true"
            className={`inline-block bg-white shadow-mode rounded-full transition-transform duration-200 ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
            style={{
              width: 'calc(max(32px, var(--min-tap-target, 44px) * 0.6) - 8px)',
              height: 'calc(max(32px, var(--min-tap-target, 44px) * 0.6) - 8px)',
            }}
          />
        </button>
      </div>

      <div
        id={previewId}
        role="group"
        aria-label={previewLabel}
        className={`rounded-2xl border border-subtle-token p-4 bg-canvas ${previewClass}`}
      >
        <p className="text-xs uppercase tracking-widest font-black text-muted-token mb-2">
          {previewLabel}
        </p>
        <p className="text-sm text-primary-token leading-relaxed">
          {previewBody}
        </p>
      </div>
    </section>
  );
}

export function Accessibility() {
  const { t } = useTranslation();
  const {
    easyReading,
    highContrast,
    glovesMode,
    lowConnectivity,
    setEasyReading,
    setHighContrast,
    setGlovesMode,
    setLowConnectivity,
    reset,
  } = useAccessibility();

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto w-full">
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-primary-token">
          {t('accessibility.title', 'Modos accesibles')}
        </h1>
        <p className="mt-2 text-secondary-token max-w-2xl leading-relaxed">
          {t(
            'accessibility.subtitle',
            'Adapta Praeventio Guard a tus necesidades. Cada modo se activa de forma independiente y queda guardado en este dispositivo.',
          )}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ToggleCard
          id="easy-reading"
          Icon={BookOpen}
          title={t('accessibility.easyReading.title', 'Lectura fácil')}
          description={t(
            'accessibility.easyReading.description',
            'Aumenta el tamaño del texto y simplifica la tipografía para mejorar la lectura.',
          )}
          enabled={easyReading}
          onToggle={setEasyReading}
          previewClass="easy-reading"
          previewLabel={t('accessibility.preview', 'Vista previa')}
          previewBody={t(
            'accessibility.easyReading.previewBody',
            'Este texto se ve más grande y con más espacio entre líneas cuando el modo está activado.',
          )}
        />

        <ToggleCard
          id="high-contrast"
          Icon={Contrast}
          title={t('accessibility.highContrast.title', 'Alto contraste')}
          description={t(
            'accessibility.highContrast.description',
            'Invierte los colores principales para mejorar la legibilidad en condiciones de baja visibilidad.',
          )}
          enabled={highContrast}
          onToggle={setHighContrast}
          previewClass="high-contrast"
          previewLabel={t('accessibility.preview', 'Vista previa')}
          previewBody={t(
            'accessibility.highContrast.previewBody',
            'Los colores se invierten: fondo negro con texto blanco, ideal con luz solar fuerte.',
          )}
        />

        <ToggleCard
          id="gloves-mode"
          Icon={Hand}
          title={t('accessibility.glovesMode.title', 'Modo guantes')}
          description={t(
            'accessibility.glovesMode.description',
            'Aumenta los botones y áreas táctiles a 56px o más para usar la app con guantes de trabajo.',
          )}
          enabled={glovesMode}
          onToggle={setGlovesMode}
          previewClass="glove-friendly"
          previewLabel={t('accessibility.preview', 'Vista previa')}
          previewBody={t(
            'accessibility.glovesMode.previewBody',
            'Cada botón se vuelve fácilmente alcanzable con guantes industriales gruesos.',
          )}
        />

        <ToggleCard
          id="low-connectivity"
          Icon={WifiOff}
          title={t('accessibility.lowConnectivity.title', 'Baja conectividad')}
          description={t(
            'accessibility.lowConnectivity.description',
            'Muestra avisos amigables cuando la red es lenta o intermitente y favorece la carga offline.',
          )}
          enabled={lowConnectivity}
          onToggle={setLowConnectivity}
          previewClass="low-connectivity"
          previewLabel={t('accessibility.preview', 'Vista previa')}
          previewBody={t(
            'accessibility.lowConnectivity.previewBody',
            'En vez de spinners, verás placeholders esqueléticos y mensajes claros sobre el estado de la red.',
          )}
        />
      </div>

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-surface border border-default-token text-secondary-token hover:bg-elevated transition-colors shadow-mode"
          style={{ minHeight: 'var(--min-tap-target, 44px)' }}
        >
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm font-bold">
            {t('accessibility.reset', 'Restablecer todo')}
          </span>
        </button>
      </div>
    </div>
  );
}

export default Accessibility;
