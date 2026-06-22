import { useState, useEffect, useCallback } from 'react';
import { Compass, Navigation, WifiOff } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useNativeCompass } from '../../hooks/useNativeCompass';

interface NativeCompassProps {
  className?: string;
}

export function NativeCompass({ className }: NativeCompassProps) {
  const [isOpen, setIsOpen] = useState(false);
  const {
    compassData,
    isActive,
    error,
    startCompass,
    stopCompass,
    getDirectionName,
    getDirectionAbbr,
    isSupported,
  } = useNativeCompass();

  useEffect(() => {
    if (isOpen && !isActive) startCompass();
    if (!isOpen && isActive) stopCompass();
  }, [isOpen, isActive, startCompass, stopCompass]);

  const toggleOpen = useCallback(() => setIsOpen(o => !o), []);

  return (
    <div className={cn('flex flex-col items-center gap-2', className)} data-testid="native-compass">
      {/* Trigger button */}
      <button
        onClick={toggleOpen}
        aria-label={isOpen ? 'Cerrar brújula' : 'Abrir brújula nativa'}
        aria-expanded={isOpen}
        className="relative h-10 w-10 rounded-full flex items-center justify-center transition-colors"
        style={{
          background: 'rgba(var(--accent-primary-rgb, 77 182 172) / 0.12)',
          color: 'var(--accent-primary)',
          border: '1px solid var(--border-default)',
        }}
        title="Brújula nativa — Funciona sin internet"
      >
        <Compass className="h-5 w-5" />
        {/* Offline badge */}
        <span
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center"
          style={{ background: 'var(--accent-success, #16a34a)', border: '2px solid var(--bg-surface)' }}
          aria-hidden
        >
          <WifiOff className="h-1.5 w-1.5 text-white" />
        </span>
      </button>

      {/* Expanded compass panel */}
      {isOpen && (
        <div
          className="p-3 rounded-xl text-center space-y-2"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
          }}
          data-testid="compass-panel"
        >
          <div
            className="flex items-center justify-center gap-1 text-xs font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            <Navigation className="h-3 w-3" style={{ color: 'var(--accent-primary)' }} />
            <span>Brújula Offline</span>
            <WifiOff className="h-2.5 w-2.5" style={{ color: 'var(--accent-success, #16a34a)' }} />
          </div>

          {!isSupported && (
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Brújula no disponible en este dispositivo
            </p>
          )}

          {error && (
            <p className="text-[10px]" style={{ color: 'var(--accent-hazard)' }}>
              {error}
            </p>
          )}

          {isSupported && !compassData && !error && (
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Iniciando sensores…
            </p>
          )}

          {compassData && (
            <>
              {/* Mini compass rose (SVG) */}
              <div className="flex justify-center">
                <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden>
                  {/* Outer ring */}
                  <circle
                    cx="40"
                    cy="40"
                    r="36"
                    fill="none"
                    stroke="var(--border-default)"
                    strokeWidth="1.5"
                  />
                  {/* Degree marks */}
                  {Array.from({ length: 12 }, (_, i) => {
                    const angle = (i * 30) * Math.PI / 180;
                    const inner = i % 3 === 0 ? 28 : 31;
                    return (
                      <line
                        key={i}
                        x1={40 + Math.sin(angle) * inner}
                        y1={40 - Math.cos(angle) * inner}
                        x2={40 + Math.sin(angle) * 35}
                        y2={40 - Math.cos(angle) * 35}
                        stroke="var(--border-default)"
                        strokeWidth={i % 3 === 0 ? 1.5 : 0.8}
                      />
                    );
                  })}
                  {/* Cardinal N/S/E/W */}
                  {(['N', 'E', 'S', 'W'] as const).map((dir, i) => {
                    const angle = i * 90 * Math.PI / 180;
                    return (
                      <text
                        key={dir}
                        x={40 + Math.sin(angle) * 20}
                        y={40 - Math.cos(angle) * 20 + 4}
                        textAnchor="middle"
                        fontSize="8"
                        fontWeight="bold"
                        fill={dir === 'N' ? 'var(--accent-hazard)' : 'var(--text-muted)'}
                      >
                        {dir}
                      </text>
                    );
                  })}
                  {/* Needle — rotates with heading */}
                  <g transform={`rotate(${compassData.heading}, 40, 40)`}>
                    {/* North needle */}
                    <polygon
                      points="40,12 37,40 43,40"
                      fill="var(--accent-hazard)"
                      opacity="0.9"
                    />
                    {/* South needle */}
                    <polygon
                      points="40,68 37,40 43,40"
                      fill="var(--text-muted)"
                      opacity="0.6"
                    />
                    {/* Center dot */}
                    <circle
                      cx="40"
                      cy="40"
                      r="3"
                      fill="var(--bg-canvas)"
                      stroke="var(--text-muted)"
                      strokeWidth="1"
                    />
                  </g>
                </svg>
              </div>

              {/* Heading readout */}
              <div>
                <span
                  className="text-2xl font-black tabular-nums"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {compassData.heading}°
                </span>
                <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  {getDirectionName(compassData.heading)} ({getDirectionAbbr(compassData.heading)})
                </div>
                <div className="text-[9px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  ±{compassData.accuracy}°
                </div>
              </div>
            </>
          )}

          {/* Instructions */}
          <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
            Mantén el dispositivo horizontal. Calibra en figura-8.
          </p>
        </div>
      )}
    </div>
  );
}
