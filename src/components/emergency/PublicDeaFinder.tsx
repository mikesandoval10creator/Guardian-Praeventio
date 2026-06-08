// Praeventio Guard — public "nearest defibrillator" finder (#4 Step 3). The
// founder's vision: a bystander in a cardiac arrest, WITHOUT logging in, finds
// the closest AED right now. Reads the sanitized public `dea_locations`
// collection (anonymous read allowed by firestore.rules — life-safety public
// good, ADR 0021) and runs pure geo math (`nearestByCoordinates`). The public
// doc carries its operational `status` directly (no inspection dates leak — see
// `isValidDeaLocation` in firestore.rules), so no member-only `computeDeaStatus`
// is needed here. Mounted inside `PublicEmergencyButton` (the no-login portada).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation, HeartPulse, Loader2 } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import {
  nearestByCoordinates,
  type DeaStatus,
  type GeoCoord,
} from '../../services/dea/deaService';

interface PublicDea {
  id: string;
  location: string;
  coordinates: GeoCoord;
  status: DeaStatus;
}

const STATUS_LABEL: Record<DeaStatus, { label: string; cls: string }> = {
  operational: { label: 'Operativo', cls: 'text-emerald-400' },
  warning: { label: 'Por vencer', cls: 'text-amber-400' },
  critical: { label: 'Requiere atención', cls: 'text-red-400' },
};

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * Reads the public AED registry and surfaces the nearest one to the bystander.
 * Self-contained: no props, no auth, no app context — it fetches its own data
 * via the Firebase client singleton so it works from the anonymous portada.
 */
export function PublicDeaFinder() {
  const { t } = useTranslation();
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<{ item: PublicDea; distanceM: number } | null>(null);
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
      async (p) => {
        try {
          const snap = await getDocs(collection(db, 'dea_locations'));
          const items: PublicDea[] = snap.docs
            .map((d) => {
              const data = d.data() as Partial<PublicDea>;
              return {
                id: d.id,
                location: data.location ?? '',
                coordinates: data.coordinates,
                status: data.status ?? 'operational',
              };
            })
            .filter((x): x is PublicDea => !!x.coordinates);
          const res = nearestByCoordinates(items, {
            lat: p.coords.latitude,
            lng: p.coords.longitude,
          });
          setResult(res);
          if (!res) {
            setError(
              t('deaZones.nearest.none', 'Ningún DEA tiene ubicación registrada todavía.'),
            );
          }
        } catch {
          setError(
            t('deaZones.public.loadError', 'No pudimos cargar el mapa de DEA. Intenta de nuevo.'),
          );
        } finally {
          setSearching(false);
        }
      },
      () => {
        setError(t('deaZones.nearest.denied', 'No pudimos obtener tu ubicación.'));
        setSearching(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const status = result ? STATUS_LABEL[result.item.status] : null;

  return (
    <section
      aria-label={t('deaZones.public.title', 'Desfibrilador (DEA) más cercano')}
      className="mx-auto w-full max-w-xl rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5"
    >
      <header className="mb-2 flex items-center gap-2">
        <HeartPulse className="h-5 w-5 text-emerald-400" aria-hidden="true" />
        <h3 className="text-base font-black text-white">
          {t('deaZones.public.title', 'Desfibrilador (DEA) más cercano')}
        </h3>
      </header>
      <p className="mb-3 text-xs text-white/60">
        {t(
          'deaZones.public.subtitle',
          'En un paro cardíaco cada segundo cuenta. Encuentra el desfibrilador más cercano a ti. No necesitas iniciar sesión.',
        )}
      </p>
      <button
        type="button"
        onClick={find}
        disabled={searching}
        data-testid="public-dea-find"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {searching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Navigation className="h-5 w-5" />}
        {t('deaZones.nearest.findBtn', 'Buscar el DEA más cercano')}
      </button>

      {error && <p className="mt-3 text-sm text-amber-400">{error}</p>}

      {result && status && (
        <div className="mt-4 rounded-xl bg-white/5 p-4" data-testid="public-nearest-dea-result">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-bold text-white">
              <MapPin className="h-4 w-4 text-emerald-400" /> {result.item.location}
            </span>
            <span className="font-mono text-lg text-emerald-400">
              {formatDistance(result.distanceM)}
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-300">
            {t('deaZones.nearest.statusLabel', 'Estado')}:{' '}
            <span className={`font-bold ${status.cls}`}>{status.label}</span>
          </p>
        </div>
      )}
    </section>
  );
}
