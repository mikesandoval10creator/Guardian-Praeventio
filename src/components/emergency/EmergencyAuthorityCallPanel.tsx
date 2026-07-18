// Praeventio Guard — one-tap authority call panel (human-decides).
//
// [P0][VIDA] Surfaces the country-aware emergency numbers (medical/fire/police)
// as tel: links on the emergency screen a critical push deep-links to. Purely
// presentational: it NEVER auto-dials and never fires a side effect — a human
// on-scene taps the number. Auto-dispatch to real authorities is deliberately
// out of scope (false-alarm liability). Numbers come from emergencyNumbers.ts:
// project region code → GPS coords → Chile fallback.
import { useTranslation } from 'react-i18next';
import { Phone, MapPin } from 'lucide-react';
import {
  getEmergencyNumbersByRegion,
  getEmergencyNumbersByCoords,
  toTelUri,
  type EmergencyNumbers,
} from '../../services/emergency/emergencyNumbers';

export interface EmergencyAuthorityCallPanelProps {
  /** Project ISO 3166-1 alpha-2 country code (e.g. 'CL'). Preferred source. */
  regionCode?: string;
  /** GPS coords to reverse-lookup the country when no regionCode. */
  coords?: { lat: number; lng: number };
  /** Worker location to show for the responder, if known. */
  workerCoords?: { lat: number; lng: number } | null;
}

function resolveNumbers(props: EmergencyAuthorityCallPanelProps): EmergencyNumbers {
  if (props.regionCode) return getEmergencyNumbersByRegion(props.regionCode);
  if (props.coords) return getEmergencyNumbersByCoords(props.coords);
  return getEmergencyNumbersByRegion('CL');
}

export function EmergencyAuthorityCallPanel(props: EmergencyAuthorityCallPanelProps) {
  const { t } = useTranslation();
  const n = resolveNumbers(props);
  const lines: Array<{ key: string; label: string; number: string }> = [
    { key: 'medical', label: t('emergencyAuthority.medical', 'Ambulancia'), number: n.medical },
    { key: 'fire', label: t('emergencyAuthority.fire', 'Bomberos'), number: n.fire },
    { key: 'police', label: t('emergencyAuthority.police', 'Policía'), number: n.police },
  ];

  return (
    <div
      data-testid="emergency-authority-panel"
      className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4"
    >
      <h3 className="text-xs font-black uppercase tracking-tight text-rose-500 mb-3">
        {t('emergencyAuthority.title', 'Llamar a emergencias')} · {n.countryName}
      </h3>
      <div className="grid gap-2">
        {lines.map((l) => (
          <a
            key={l.key}
            href={toTelUri(l.number)}
            className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2.5 border border-default-token"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-primary-token">
              <Phone className="w-4 h-4 text-rose-500" aria-hidden="true" />
              {l.label}
            </span>
            <span className="text-base font-black text-rose-500">{l.number}</span>
          </a>
        ))}
        {n.universal && (
          <a
            href={toTelUri(n.universal)}
            className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2.5 border border-default-token"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-primary-token">
              <Phone className="w-4 h-4 text-rose-500" aria-hidden="true" />
              {t('emergencyAuthority.universal', 'Número universal')}
            </span>
            <span className="text-base font-black text-rose-500">{n.universal}</span>
          </a>
        )}
      </div>
      {props.workerCoords && (
        <a
          href={`https://google.com/maps?q=${props.workerCoords.lat},${props.workerCoords.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center gap-2 text-xs text-secondary-token"
        >
          <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
          {t('emergencyAuthority.location', 'Ubicación del trabajador')}:{' '}
          {props.workerCoords.lat.toFixed(4)}, {props.workerCoords.lng.toFixed(4)}
        </a>
      )}
    </div>
  );
}
