// Praeventio Guard — "DEA más cercano a mí" (#4). In a cardiac arrest the single
// most useful thing is WHERE the closest defibrillator is, right now. This
// geolocates the user on demand and shows the nearest registered DEA (with
// coordinates) + the straight-line distance + its operational status. Pure geo
// math (`nearestDea`) so it works offline.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation, HeartPulse, Loader2 } from 'lucide-react';
import {
  nearestDea,
  computeDeaStatus,
  type Dea,
  type DeaStatus,
} from '../../services/dea/deaService';
import { humanErrorMessage } from '../../lib/humanError';


const STATUS_LABEL: Record<DeaStatus, { label: string; cls: string }> = {
  operational: { label: 'Operativo', cls: 'text-emerald-400' },
  warning: { label: 'Por vencer', cls: 'text-amber-400' },
  critical: { label: 'Requiere atención', cls: 'text-red-400' },
};

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function NearestDeaFinder({ deas }: { deas: Dea[] }) {
  const { t } = useTranslation();
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<{ dea: Dea; distanceM: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const find = () => {
    setError(null);
    setResult(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError(t('deaZones.nearest.noGeo', 'Geolocalización no disponible en este dispositivo.'));
      return;
    }
    setSearching(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const res = nearestDea(deas, { lat: p.coords.latitude, lng: p.coords.longitude });
        setResult(res);
        if (!res) {
          setError(t('deaZones.nearest.none', 'Ningún DEA tiene ubicación registrada todavía.'));
        }
        setSearching(false);
      },
      () => {
        setError(t('deaZones.nearest.denied', 'No pudimos obtener tu ubicación.'));
        setSearching(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const status = result ? STATUS_LABEL[computeDeaStatus(result.dea)] : null;

  return (
    <section
      aria-label={t('deaZones.nearest.title', 'DEA más cercano a mí')}
      className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5"
    >
      <header className="mb-2 flex items-center gap-2">
        <HeartPulse className="h-5 w-5 text-emerald-400" aria-hidden="true" />
        <h3 className="text-base font-black">{t('deaZones.nearest.title', 'DEA más cercano a mí')}</h3>
      </header>
      <p className="mb-3 text-xs text-zinc-400">
        {t(
          'deaZones.nearest.subtitle',
          'En un paro cardíaco cada segundo cuenta. Encuentra el desfibrilador más cercano a tu ubicación.',
        )}
      </p>
      <button
        type="button"
        onClick={find}
        disabled={searching}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {searching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Navigation className="h-5 w-5" />}
        {t('deaZones.nearest.findBtn', 'Buscar el DEA más cercano')}
      </button>

      {error && <p className="mt-3 text-sm text-amber-400">{humanErrorMessage(error)}</p>}

      {result && status && (
        <div className="mt-4 rounded-xl bg-white/5 p-4" data-testid="nearest-dea-result">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-bold text-white">
              <MapPin className="h-4 w-4 text-emerald-400" /> {result.dea.location}
            </span>
            <span className="font-mono text-lg text-emerald-400">{formatDistance(result.distanceM)}</span>
          </div>
          {result.dea.description && (
            <p className="mt-1 text-xs text-zinc-400">{result.dea.description}</p>
          )}
          <p className="mt-2 text-xs text-zinc-300">
            {t('deaZones.nearest.statusLabel', 'Estado')}:{' '}
            <span className={`font-bold ${status.cls}`}>{status.label}</span>
          </p>
        </div>
      )}
    </section>
  );
}
