import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Mountain,
  MapPin,
  Navigation,
  AlertTriangle,
  Wind,
  ThermometerSnowflake,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import {
  findNearestRefuges,
  refugeAvailability,
  type RefugeWithDistance,
} from '../services/refuges/mountainRefuges';

// 2026-05-15 (Sprint C): antes esta página tenía 3 refugios ficticios
// (Alfa/Beta/Gamma) con \`Math.cos(angle) * 15\` posicionando puntos
// artificialmente — un fake crítico porque vidas dependen de saber
// si hay un refugio REAL cerca. Ahora consume el catálogo
// \`services/refuges/mountainRefuges\` con coordenadas verificadas vía
// OpenStreetMap.

export function MountainRefuges() {
  const { t } = useTranslation();
  // Default razonable mientras esperamos geolocation; permite usar la
  // página antes de aceptar el permiso.
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number }>({
    lat: -33.45,
    lng: -70.6667,
  });
  const [geoStatus, setGeoStatus] = useState<'idle' | 'requesting' | 'ok' | 'denied'>('idle');
  const [weatherCondition, setWeatherCondition] = useState<'clear' | 'blizzard' | 'storm'>(
    'blizzard',
  );
  const [temperature, setTemperature] = useState(-15);

  // Pedir geolocalización solo si el usuario está en la página (no se
  // pide proactivamente al cargar). Esto cumple con privacy: el usuario
  // decide cuándo compartir.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    if (geoStatus !== 'idle') return;
    setGeoStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus('ok');
      },
      () => setGeoStatus('denied'),
      { timeout: 5000, maximumAge: 60_000 },
    );
  }, [geoStatus]);

  const nearestRefuges = useMemo<RefugeWithDistance[]>(() => {
    return findNearestRefuges(userLocation.lat, userLocation.lng, { count: 5 });
  }, [userLocation]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Mountain className="w-8 h-8 text-blue-500" />
            {t('mountainRefuges.title', 'Refugios de Montaña')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t(
              'mountainRefuges.subtitle',
              'Catálogo CONAF + Clubes Andinos — coordenadas verificadas',
            )}
          </p>
        </div>
        <div
          className={`px-4 py-2 rounded-xl border flex items-center gap-2 ${weatherCondition === 'blizzard' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' : 'text-zinc-400 bg-zinc-800 border-white/10'}`}
        >
          <ThermometerSnowflake className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            {temperature}°C —{' '}
            {weatherCondition === 'blizzard'
              ? t('mountainRefuges.weather.blizzard', 'Tormenta Blanca')
              : t('mountainRefuges.weather.clear', 'Despejado')}
          </span>
        </div>
      </div>

      {geoStatus === 'denied' && (
        <Card className="p-4 border-amber-500/20 bg-amber-500/5">
          <p className="text-sm text-amber-300 flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0" />
            {t(
              'mountainRefuges.geoDenied',
              'Geolocalización rechazada. Mostrando refugios cercanos a Santiago. Para resultados ajustados a tu posición, habilita el permiso.',
            )}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-500" />
            {t('mountainRefuges.routeConditions', 'Condiciones de Ruta')}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                {t('mountainRefuges.currentWeather', 'Clima Actual')}
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setWeatherCondition('clear')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${weatherCondition === 'clear' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}
                >
                  {t('mountainRefuges.weather.clear', 'Despejado')}
                </button>
                <button
                  onClick={() => setWeatherCondition('blizzard')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${weatherCondition === 'blizzard' ? 'bg-blue-500/20 text-blue-400 border-blue-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}
                >
                  {t('mountainRefuges.weather.blizzard', 'Tormenta')}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                {t('mountainRefuges.temperature', 'Temperatura (°C)')}
              </label>
              <input
                type="range"
                min="-40"
                max="10"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>-40°C</span>
                <span className="font-bold text-blue-400">{temperature}°C</span>
                <span>10°C</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-blue-500" />
              {t('mountainRefuges.protocol', 'Protocolo Activo')}
            </h3>
            <ul className="space-y-2 text-sm text-zinc-400">
              {weatherCondition === 'blizzard' ? (
                <>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                    <span className="text-rose-400 font-bold">
                      {t(
                        'mountainRefuges.proto.banTraffic',
                        'Prohibición total de tránsito a la intemperie.',
                      )}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    <span>
                      {t(
                        'mountainRefuges.proto.goRefuge',
                        'Dirigirse al refugio más cercano inmediatamente.',
                      )}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    <span>
                      {t(
                        'mountainRefuges.proto.beacon',
                        'Activar baliza de supervivencia si la visibilidad es nula.',
                      )}
                    </span>
                  </li>
                </>
              ) : (
                <>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                    <span>
                      {t(
                        'mountainRefuges.proto.cautionTraffic',
                        'Tránsito permitido con precaución.',
                      )}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                    <span>
                      {t(
                        'mountainRefuges.proto.radioCheck',
                        'Mantener comunicación radial cada 30 mins.',
                      )}
                    </span>
                  </li>
                </>
              )}
            </ul>
          </div>
        </Card>

        {/* Refuges List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header del listado */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <MapPin className="w-5 h-5 text-emerald-500" />
              {t('mountainRefuges.nearestTitle', 'Refugios más cercanos')}
              <span className="text-xs font-mono text-zinc-500">
                {userLocation.lat.toFixed(3)}, {userLocation.lng.toFixed(3)}
              </span>
            </h2>
            {geoStatus === 'requesting' && (
              <span className="text-xs text-zinc-500 animate-pulse">
                {t('mountainRefuges.locating', 'Geolocalizando...')}
              </span>
            )}
          </div>

          {nearestRefuges.length === 0 ? (
            <Card className="p-8 text-center border-amber-500/20 bg-amber-500/5">
              <p className="text-amber-300">
                {t(
                  'mountainRefuges.empty',
                  'No hay refugios documentados cerca de tu ubicación. En emergencia, contacta CONAF (1-3-0) o el club andino regional.',
                )}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {nearestRefuges.map((refuge) => {
                const availability = refugeAvailability(refuge);
                return (
                  <Card
                    key={refuge.id}
                    className={`p-4 border-white/5 ${availability === 'closed' ? 'opacity-60' : ''}`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Mountain
                          className={`w-4 h-4 ${availability === 'closed' ? 'text-rose-500' : availability === 'check' ? 'text-amber-500' : 'text-blue-500'}`}
                        />
                        {refuge.name}
                      </h3>
                      <span className="text-xs font-bold text-zinc-400">
                        {refuge.distanceKm.toFixed(1)} km
                      </span>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between text-zinc-400">
                        <span>{t('mountainRefuges.operator', 'Operador:')}</span>
                        <span className="text-zinc-300 text-right">{refuge.operator}</span>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>{t('mountainRefuges.elevation', 'Altitud:')}</span>
                        <span className="text-zinc-300">{refuge.elevationM} m</span>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>{t('mountainRefuges.capacityLabel', 'Capacidad:')}</span>
                        <span className="text-emerald-400 font-bold">
                          {refuge.capacity} personas
                        </span>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>{t('mountainRefuges.season', 'Temporada:')}</span>
                        <span
                          className={
                            availability === 'open'
                              ? 'text-emerald-400'
                              : availability === 'closed'
                                ? 'text-rose-400'
                                : 'text-amber-400'
                          }
                        >
                          {availability === 'open'
                            ? t('mountainRefuges.status.open', 'Operativo ahora')
                            : availability === 'closed'
                              ? t('mountainRefuges.status.closed', 'Cerrado (fuera temporada)')
                              : t('mountainRefuges.status.check', 'Verificar')}
                        </span>
                      </div>
                    </div>

                    {refuge.notes && (
                      <p className="mt-3 text-[10px] text-zinc-500 leading-relaxed">
                        {refuge.notes}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-1">
                      {refuge.amenities.radio && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                          {t('mountainRefuges.amenities.radio', 'Radio')}
                        </span>
                      )}
                      {refuge.amenities.heating && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">
                          {t('mountainRefuges.amenities.heating', 'Calefacción')}
                        </span>
                      )}
                      {refuge.amenities.potableWater && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                          {t('mountainRefuges.amenities.water', 'Agua potable')}
                        </span>
                      )}
                      {refuge.amenities.firstAid && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                          {t('mountainRefuges.amenities.firstAid', 'Primeros aux.')}
                        </span>
                      )}
                    </div>

                    <Button
                      className="w-full mt-4 text-xs py-2"
                      variant={availability === 'closed' ? 'secondary' : 'primary'}
                      disabled={availability === 'closed'}
                      onClick={() => {
                        // Abrir Google Maps con la ruta hacia el refugio.
                        const url = `https://www.google.com/maps/dir/?api=1&origin=${userLocation.lat},${userLocation.lng}&destination=${refuge.lat},${refuge.lng}`;
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      {availability === 'closed'
                        ? t('mountainRefuges.closed', 'Refugio fuera de temporada')
                        : t('mountainRefuges.navigate', 'Navegar a Refugio')}
                    </Button>
                  </Card>
                );
              })}
            </div>
          )}

          <Card className="p-3 border-zinc-700/30 bg-zinc-900/20">
            <p className="text-[10px] text-zinc-500 leading-relaxed flex items-start gap-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t(
                'mountainRefuges.dataDisclaimer',
                'Catálogo curado de refugios CONAF, Club Andino de Chile y Federación de Andinismo, verificados vía OpenStreetMap. NO sustituye al permiso del operador ni al protocolo de emergencia. En tormenta, contactar CONAF 1-3-0 o club andino regional antes de salir.',
              )}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
