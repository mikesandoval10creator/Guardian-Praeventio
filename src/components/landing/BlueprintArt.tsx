/**
 * Plano Vivo — blueprint artwork for the landing.
 *
 * Every piece is inline SVG (zero image weight) drawn with the palette
 * discipline: teal = system, gold = ONLY φ geometry, copihue = ONLY life.
 * Strokes self-draw via framer-motion `pathLength`; with
 * prefers-reduced-motion the plano arrives fully drawn.
 */
import { motion, useReducedMotion } from 'framer-motion';
import type { SVGProps } from 'react';
import { useTranslation } from 'react-i18next';

type DrawProps = { delay?: number; duration?: number };

function useDraw({ delay = 0, duration = 1.6 }: DrawProps = {}) {
  const reduced = useReducedMotion();
  if (reduced) {
    return { initial: { pathLength: 1 }, animate: undefined, whileInView: undefined, viewport: undefined, transition: undefined } as const;
  }
  return {
    initial: { pathLength: 0 },
    whileInView: { pathLength: 1 },
    viewport: { once: true, margin: '-60px' },
    transition: { duration, delay, ease: 'easeInOut' as const },
  };
}

/** Shield brand mark (nav + footer). */
export function ShieldMark({ size = 26, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" {...rest}>
      <path
        d="M16 2 4 7v9c0 7 5 11 12 14 7-3 12-7 12-14V7L16 2Z"
        style={{ stroke: 'var(--pv-teal)' }}
        strokeWidth="2"
      />
      <path d="M16 10v12M10 16h12" style={{ stroke: 'var(--pv-teal)' }} strokeWidth="2" />
    </svg>
  );
}

/**
 * Hero signature: scaffold blueprint drawing itself over the golden spiral.
 * The spiral (gold) is the ONLY gold in the viewport — φ discipline.
 */
export function HeroBlueprint({ caption }: { caption: string }) {
  const { t } = useTranslation();
  const spiral = useDraw({ delay: 1.0, duration: 2.4 });
  const posts = useDraw({ delay: 0.2, duration: 1.4 });
  const beams = useDraw({ delay: 0.6, duration: 1.2 });
  const braces = useDraw({ delay: 1.0, duration: 1.2 });
  const reduced = useReducedMotion();

  return (
    <div className="pv-hero-stage">
      <svg viewBox="0 0 460 540" className="pv-hero-svg" role="img" aria-label={caption}>
        <defs>
          <radialGradient id="pvGlow" cx="50%" cy="46%" r="60%">
            <stop offset="0%" stopColor="#17b6a3" stopOpacity="0.38" />
            <stop offset="55%" stopColor="#0f7c6e" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#0f7c6e" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="pvBlob" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#17b6a3" />
            <stop offset="60%" stopColor="#0f7c6e" />
            <stop offset="100%" stopColor="#063f39" />
          </linearGradient>
          {/* liquid deformation — teal mass breathes forever */}
          <filter id="pvLiquid" x="-40%" y="-40%" width="180%" height="180%">
            <feTurbulence type="fractalNoise" baseFrequency="0.011 0.015" numOctaves="2" seed="7" result="n">
              {!reduced && (
                <animate
                  attributeName="baseFrequency"
                  dur="24s"
                  values="0.011 0.015;0.017 0.010;0.011 0.015"
                  repeatCount="indefinite"
                />
              )}
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>

        {/* teal glow behind the core */}
        <ellipse cx="230" cy="250" rx="215" ry="235" fill="url(#pvGlow)" />

        {/* liquid teal mass */}
        <g filter="url(#pvLiquid)">
          <path
            d="M230 70 C330 78 388 150 384 250 C380 350 320 430 230 436 C140 430 80 350 76 250 C72 150 130 62 230 70 Z"
            fill="url(#pvBlob)"
            opacity="0.16"
          />
          <path
            d="M232 120 C300 126 344 180 342 250 C340 320 300 372 232 378 C165 372 122 320 120 250 C118 180 164 114 232 120 Z"
            fill="#17b6a3"
            opacity="0.14"
          />
        </g>

        {/* manga speed lines (ground) */}
        <g style={{ stroke: 'var(--pv-teal-deep)' }} strokeWidth="1" opacity="0.14">
          <line x1="20" y1="470" x2="150" y2="330" />
          <line x1="45" y1="500" x2="170" y2="360" />
          <line x1="80" y1="516" x2="196" y2="386" />
        </g>

        {/* scaffold — draws itself */}
        <g fill="none">
          <rect x="96" y="120" width="268" height="300" style={{ fill: 'var(--pv-teal)' }} opacity="0.05" />
          {[120, 230, 340].map((x, i) => (
            <motion.line
              key={`post-${x}`}
              {...posts}
              transition={{ ...(posts.transition ?? {}), delay: 0.2 + i * 0.15 }}
              x1={x}
              y1="96"
              x2={x}
              y2="440"
              style={{ stroke: 'var(--pv-teal-deep)' }}
              strokeWidth="1.4"
            />
          ))}
          {[150, 250, 350].map((y, i) => (
            <motion.line
              key={`beam-${y}`}
              {...beams}
              transition={{ ...(beams.transition ?? {}), delay: 0.6 + i * 0.12 }}
              x1="104"
              y1={y}
              x2="356"
              y2={y}
              style={{ stroke: 'var(--pv-teal-deep)' }}
              strokeWidth="1.2"
            />
          ))}
          {[
            [120, 150, 230, 250],
            [230, 150, 120, 250],
            [230, 250, 340, 350],
            [340, 250, 230, 350],
          ].map(([x1, y1, x2, y2], i) => (
            <motion.line
              key={`brace-${i}`}
              {...braces}
              transition={{ ...(braces.transition ?? {}), delay: 1.0 + i * 0.1 }}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              style={{ stroke: 'var(--pv-teal)' }}
              strokeWidth="1"
            />
          ))}
          {[
            [120, 150],
            [340, 150],
            [230, 250],
            [120, 350],
            [340, 350],
          ].map(([cx, cy]) => (
            <circle key={`joint-${cx}-${cy}`} cx={cx} cy={cy} r="3.2" style={{ fill: 'var(--pv-teal)' }} />
          ))}
        </g>

        {/* φ golden spiral — the ONLY gold in the viewport */}
        <motion.path
          {...spiral}
          d="M300 300 a70 70 0 0 1 -70 -70 a43.3 43.3 0 0 1 43.3 -43.3 a26.7 26.7 0 0 1 26.7 26.7 a16.5 16.5 0 0 1 -16.5 16.5 a10.2 10.2 0 0 1 -10.2 -10.2"
          style={{ stroke: 'var(--pv-gold)', fill: 'none' }}
          strokeWidth="1.3"
          opacity="0.85"
        />

        {/* HUD rings — rotate around the core (SVG-native for exact center) */}
        <circle cx="230" cy="250" r="182" fill="none" stroke="#0f7c6e" strokeWidth="1" strokeDasharray="3 10" opacity="0.5">
          {!reduced && (
            <animateTransform attributeName="transform" type="rotate" from="0 230 250" to="360 230 250" dur="46s" repeatCount="indefinite" />
          )}
        </circle>
        <circle cx="230" cy="250" r="150" fill="none" stroke="#17b6a3" strokeWidth="1" strokeDasharray="1 14" opacity="0.55">
          {!reduced && (
            <animateTransform attributeName="transform" type="rotate" from="360 230 250" to="0 230 250" dur="60s" repeatCount="indefinite" />
          )}
        </circle>
        <g opacity="0.6">
          {!reduced && (
            <animateTransform attributeName="transform" type="rotate" from="0 230 250" to="360 230 250" dur="46s" repeatCount="indefinite" />
          )}
          <circle cx="230" cy="68" r="3" fill="#17b6a3" />
          <circle cx="412" cy="250" r="2.4" fill="#0f7c6e" />
          <circle cx="230" cy="432" r="2.4" fill="#0f7c6e" />
        </g>
      </svg>

      {/* the guardian — living core of the plano */}
      <img className="pv-hero-mascot" src="/mascots/guardian-default-trans.png" alt="Guardian, mascota del sistema de prevención, sobre el plano del andamio" width={286} height={252} />

      {/* HUD labels — language-neutral technical chips (ponytail: inline, not i18n keys) */}
      <span className="pv-hud" style={{ top: '15%', left: '-4%' }}>
        DS 44 <small>{t('landing.dc.hud_ds44_sub')}</small>
      </span>
      <span className="pv-hud" style={{ top: '39%', right: '-8%' }}>
        mesh · BLE <small>{t('landing.dc.hud_mesh_sub')}</small>
      </span>
      <span className="pv-hud" style={{ bottom: '24%', left: '-6%' }}>
        SpO₂ <small>{t('landing.dc.hud_spo2_sub')}</small>
      </span>
      <span className="pv-hud pv-hud-vida" style={{ bottom: '9%', right: '-2%' }}>
        SOS <small>{t('landing.dc.hud_sos_sub')}</small>
      </span>
    </div>
  );
}

/* ── shared mini-pieces for the manga mesh panels (on ink) ────── */

function Phone({ x, y, alert = false, dim = false }: { x: number; y: number; alert?: boolean; dim?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity={dim ? 0.45 : 1}>
      <rect x="0" y="0" width="26" height="46" rx="4" style={{ stroke: 'var(--pv-mist)', fill: 'rgba(207,224,219,0.06)' }} strokeWidth="1.4" />
      <line x1="9" y1="40" x2="17" y2="40" style={{ stroke: 'var(--pv-mist)' }} strokeWidth="1.2" opacity="0.7" />
      {alert && <circle cx="13" cy="18" r="5" style={{ fill: 'var(--pv-vida-bright)' }} />}
    </g>
  );
}

function SpeedLines({ x, y }: { x: number; y: number }) {
  return (
    <g opacity="0.3" style={{ stroke: 'var(--pv-paper)' }} strokeWidth="1">
      <line x1={x} y1={y} x2={x + 18} y2={y - 6} />
      <line x1={x} y1={y + 8} x2={x + 22} y2={y + 4} />
      <line x1={x} y1={y + 16} x2={x + 16} y2={y + 16} />
    </g>
  );
}

/** Panel 1 — dead zone: the alert is born anyway. */
export function MeshPanelOne() {
  return (
    <svg viewBox="0 0 160 110" aria-hidden="true">
      <Phone x={30} y={32} alert />
      <SpeedLines x={62} y={44} />
      {/* crossed-out tower */}
      <g transform="translate(112 30)" style={{ stroke: 'var(--pv-mist)' }} strokeWidth="1.4" opacity="0.6">
        <line x1="0" y1="50" x2="12" y2="0" />
        <line x1="24" y1="50" x2="12" y2="0" />
        <line x1="4" y1="36" x2="20" y2="36" />
      </g>
      <g style={{ stroke: 'var(--pv-vida-bright)' }} strokeWidth="2">
        <line x1="104" y1="24" x2="144" y2="88" />
        <line x1="144" y1="24" x2="104" y2="88" />
      </g>
    </svg>
  );
}

/** Panel 2 — the alert hops pocket to pocket over BLE. */
export function MeshPanelTwo() {
  const reduced = useReducedMotion();
  const hop = (delay: number) =>
    reduced
      ? { initial: { pathLength: 1 } }
      : {
          initial: { pathLength: 0 },
          whileInView: { pathLength: 1 },
          viewport: { once: true },
          transition: { duration: 0.9, delay, ease: 'easeOut' as const },
        };
  return (
    <svg viewBox="0 0 160 110" aria-hidden="true">
      <Phone x={8} y={40} alert />
      <Phone x={66} y={40} />
      <Phone x={124} y={40} />
      <motion.path
        {...hop(0.2)}
        d="M36 44 Q 52 18 66 42"
        style={{ stroke: 'var(--pv-teal-bright)', fill: 'none' }}
        strokeWidth="1.6"
        strokeDasharray="4 4"
      />
      <motion.path
        {...hop(1.0)}
        d="M94 44 Q 110 18 124 42"
        style={{ stroke: 'var(--pv-teal-bright)', fill: 'none' }}
        strokeWidth="1.6"
        strokeDasharray="4 4"
      />
    </svg>
  );
}

/** Panel 3 — a phone finds signal: the alert reaches the world. */
export function MeshPanelThree() {
  const reduced = useReducedMotion();
  return (
    <svg viewBox="0 0 160 110" aria-hidden="true">
      <Phone x={24} y={40} />
      <g transform="translate(104 26)" style={{ stroke: 'var(--pv-mist)' }} strokeWidth="1.4">
        <line x1="0" y1="56" x2="12" y2="0" />
        <line x1="24" y1="56" x2="12" y2="0" />
        <line x1="4" y1="40" x2="20" y2="40" />
      </g>
      {/* signal waves */}
      {[10, 18, 26].map((r, i) => (
        <motion.path
          key={r}
          d={`M ${116 - r} 22 a ${r} ${r} 0 0 1 ${r * 2} 0`}
          style={{ stroke: 'var(--pv-teal-bright)', fill: 'none' }}
          strokeWidth="1.4"
          initial={reduced ? { opacity: 0.9 } : { opacity: 0 }}
          whileInView={reduced ? undefined : { opacity: [0, 1, 0.55] }}
          viewport={{ once: true }}
          transition={reduced ? undefined : { duration: 0.7, delay: 0.4 + i * 0.25 }}
        />
      ))}
      <motion.path
        d="M50 52 H 100"
        style={{ stroke: 'var(--pv-teal-bright)' }}
        strokeWidth="1.6"
        strokeDasharray="4 4"
        initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
        whileInView={reduced ? undefined : { pathLength: 1 }}
        viewport={{ once: true }}
        transition={reduced ? undefined : { duration: 0.8, delay: 0.1 }}
      />
      {/* delivered check */}
      <motion.path
        d="M132 78 l6 6 l12 -14"
        style={{ stroke: 'var(--pv-teal-bright)', fill: 'none' }}
        strokeWidth="2.2"
        strokeLinecap="round"
        initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
        whileInView={reduced ? undefined : { pathLength: 1 }}
        viewport={{ once: true }}
        transition={reduced ? undefined : { duration: 0.5, delay: 1.2 }}
      />
    </svg>
  );
}

/**
 * Evacuation floor plan with the A* route drawing itself to the exit,
 * avoiding the blocked sector (copihue hatch = hazard, the only red).
 */
export function EvacPlan({ startLabel, exitLabel }: { startLabel: string; exitLabel: string }) {
  const route = useDraw({ delay: 0.5, duration: 2.4 });
  return (
    <svg viewBox="0 0 320 210" aria-hidden="true" style={{ width: '100%', height: 'auto' }}>
      {/* outer walls */}
      <rect x="8" y="8" width="304" height="194" style={{ stroke: 'var(--pv-mist)', fill: 'none' }} strokeWidth="1.6" />
      {/* inner walls */}
      <g style={{ stroke: 'var(--pv-mist)' }} strokeWidth="1.2" opacity="0.75">
        <line x1="8" y1="70" x2="120" y2="70" />
        <line x1="170" y1="70" x2="312" y2="70" />
        <line x1="120" y1="70" x2="120" y2="150" />
        <line x1="200" y1="110" x2="200" y2="202" />
        <line x1="200" y1="110" x2="260" y2="110" />
      </g>
      {/* blocked sector — hazard hatch */}
      <g opacity="0.85">
        <rect x="128" y="78" width="64" height="64" style={{ stroke: 'var(--pv-vida-bright)', fill: 'none' }} strokeWidth="1.2" />
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1={128 + i * 16}
            y1="142"
            x2={144 + i * 16 > 192 ? 192 : 144 + i * 16}
            y2={144 + i * 16 > 192 ? 142 - (192 - (128 + i * 16)) : 78}
            style={{ stroke: 'var(--pv-vida-bright)' }}
            strokeWidth="1"
            opacity="0.6"
          />
        ))}
      </g>
      {/* A* route — drawn, dashed, alive */}
      <motion.path
        {...route}
        d="M40 178 V 96 H 100 V 40 H 232 V 88 H 268 V 40 L 296 40"
        style={{ stroke: 'var(--pv-teal-bright)', fill: 'none' }}
        strokeWidth="2.2"
        strokeDasharray="7 5"
        strokeLinecap="round"
      />
      {/* start node */}
      <circle cx="40" cy="178" r="5" style={{ fill: 'var(--pv-teal-bright)' }} />
      <text x="52" y="182" className="pv-cota">
        {startLabel}
      </text>
      {/* exit door */}
      <rect x="296" y="30" width="8" height="20" style={{ fill: 'var(--pv-teal-bright)' }} />
      <text x="252" y="24" className="pv-cota">
        {exitLabel}
      </text>
    </svg>
  );
}

/**
 * Copihue (Lapageria rosea) as technical line drawing — the national flower
 * closes the plano: geometry → structure → escape → life.
 */
export function CopihueLine({ delay = 0.2 }: { delay?: number }) {
  const vine = useDraw({ delay, duration: 1.6 });
  const bell = useDraw({ delay: delay + 0.9, duration: 1.6 });
  const inner = useDraw({ delay: delay + 1.9, duration: 1.2 });
  return (
    <svg viewBox="0 0 160 200" aria-hidden="true" style={{ width: 96, height: 'auto' }}>
      {/* vine + leaves */}
      <motion.path
        {...vine}
        d="M20 6 C 60 24 96 30 92 66"
        style={{ stroke: 'var(--pv-mist)', fill: 'none' }}
        strokeWidth="1.3"
      />
      <motion.path
        {...vine}
        d="M48 18 c 14 -2 22 6 20 16 c -12 2 -20 -6 -20 -16 Z"
        style={{ stroke: 'var(--pv-mist)', fill: 'none' }}
        strokeWidth="1.1"
      />
      {/* hanging bell — three tepals */}
      <motion.path
        {...bell}
        d="M92 66 C 70 92 68 132 84 166 C 88 174 96 174 100 166 C 116 132 114 92 92 66 Z"
        style={{ stroke: 'var(--pv-vida-bright)', fill: 'none' }}
        strokeWidth="1.5"
      />
      <motion.path
        {...bell}
        d="M92 70 C 78 98 78 132 88 160"
        style={{ stroke: 'var(--pv-vida-bright)', fill: 'none' }}
        strokeWidth="1.1"
        opacity="0.8"
      />
      <motion.path
        {...bell}
        d="M94 70 C 106 98 106 132 96 160"
        style={{ stroke: 'var(--pv-vida-bright)', fill: 'none' }}
        strokeWidth="1.1"
        opacity="0.8"
      />
      {/* stamens */}
      <motion.path
        {...inner}
        d="M88 168 l -3 12 M92 170 l 0 13 M96 168 l 3 12"
        style={{ stroke: 'var(--pv-gold)', fill: 'none' }}
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** SOS cascade — push → backup email → call, until a human confirms. */
export function SosCascade({ labels }: { labels: readonly [string, string, string] }) {
  const reduced = useReducedMotion();
  return (
    <svg viewBox="0 0 300 96" aria-hidden="true" style={{ width: '100%', height: 'auto' }}>
      {labels.map((label, i) => (
        <g key={label} transform={`translate(${18 + i * 100} 14)`}>
          <motion.circle
            cx="28"
            cy="24"
            r="17"
            style={{ stroke: i === 2 ? 'var(--pv-vida-bright)' : 'var(--pv-teal-bright)', fill: 'none' }}
            strokeWidth="1.6"
            initial={reduced ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0 }}
            whileInView={reduced ? undefined : { scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={reduced ? undefined : { duration: 0.5, delay: 0.2 + i * 0.45 }}
          />
          <text x="28" y="29" textAnchor="middle" className="pv-cota" style={{ fontSize: 11 }}>
            {i + 1}
          </text>
          <text x="28" y="70" textAnchor="middle" className="pv-cota">
            {label}
          </text>
          {i < 2 && (
            <motion.line
              x1="50"
              y1="24"
              x2="82"
              y2="24"
              style={{ stroke: 'var(--pv-mist)' }}
              strokeWidth="1.2"
              strokeDasharray="4 4"
              initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
              whileInView={reduced ? undefined : { pathLength: 1 }}
              viewport={{ once: true }}
              transition={reduced ? undefined : { duration: 0.4, delay: 0.5 + i * 0.45 }}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

/** IA anclada a la norma — question → RAG box → answer with a legal citation. */
export function RagPanel() {
  return (
    <svg viewBox="0 0 260 100" aria-hidden="true" style={{ width: '100%', height: 'auto' }}>
      <rect x="24" y="14" width="58" height="72" rx="3" style={{ stroke: 'var(--pv-mist)', fill: 'rgba(207,224,219,0.05)' }} strokeWidth="1.3" />
      <line x1="34" y1="30" x2="72" y2="30" style={{ stroke: 'var(--pv-mist)' }} strokeWidth="1" opacity="0.6" />
      <line x1="34" y1="42" x2="72" y2="42" style={{ stroke: 'var(--pv-mist)' }} strokeWidth="1" opacity="0.6" />
      <line x1="34" y1="54" x2="60" y2="54" style={{ stroke: 'var(--pv-teal-bright)' }} strokeWidth="1.4" />
      <line x1="34" y1="66" x2="72" y2="66" style={{ stroke: 'var(--pv-mist)' }} strokeWidth="1" opacity="0.6" />
      <text x="53" y="98" textAnchor="middle" className="pv-cota">DS 44 · art. 7</text>
      <line x1="90" y1="50" x2="136" y2="50" style={{ stroke: 'var(--pv-teal-bright)' }} strokeWidth="1.4" strokeDasharray="4 4" />
      <rect x="144" y="26" width="92" height="48" rx="10" style={{ fill: 'rgba(23,182,163,0.08)', stroke: 'var(--pv-teal-bright)' }} strokeWidth="1.3" />
      <line x1="158" y1="42" x2="222" y2="42" style={{ stroke: 'var(--pv-mist)' }} strokeWidth="1" opacity="0.7" />
      <line x1="158" y1="54" x2="206" y2="54" style={{ stroke: 'var(--pv-mist)' }} strokeWidth="1" opacity="0.7" />
      <text x="190" y="92" textAnchor="middle" className="pv-cota">respuesta con cita legal</text>
    </svg>
  );
}

/** Biometría on-device — vitals measured in the phone; nothing leaves it. */
export function BiometricPanel() {
  return (
    <svg viewBox="0 0 260 100" aria-hidden="true" style={{ width: '100%', height: 'auto' }}>
      <rect x="96" y="10" width="46" height="80" rx="6" style={{ stroke: 'var(--pv-mist)', fill: 'rgba(207,224,219,0.06)' }} strokeWidth="1.4" />
      <path d="M104 50 h8 l5 -12 l7 22 l5 -10 h10" style={{ stroke: 'var(--pv-teal-bright)', fill: 'none' }} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="150" y1="50" x2="196" y2="50" style={{ stroke: 'var(--pv-mist)' }} strokeWidth="1.2" strokeDasharray="4 4" opacity="0.5" />
      <line x1="186" y1="36" x2="206" y2="64" style={{ stroke: 'var(--pv-vida-bright)' }} strokeWidth="1.8" />
      <line x1="206" y1="36" x2="186" y2="64" style={{ stroke: 'var(--pv-vida-bright)' }} strokeWidth="1.8" />
      <text x="196" y="82" textAnchor="middle" className="pv-cota">nada sale</text>
      <text x="119" y="99" textAnchor="middle" className="pv-cota">se procesa aquí</text>
    </svg>
  );
}

/** Evidencia inmutable — hash-chained records, signed, append-only. */
export function AuditChainPanel() {
  return (
    <svg viewBox="0 0 260 100" aria-hidden="true" style={{ width: '100%', height: 'auto' }}>
      <rect x="24" y="34" width="52" height="34" rx="4" style={{ stroke: 'var(--pv-mist)', fill: 'rgba(207,224,219,0.05)' }} strokeWidth="1.3" />
      <text x="50" y="55" textAnchor="middle" className="pv-cota">#a1f4</text>
      <line x1="76" y1="51" x2="96" y2="51" style={{ stroke: 'var(--pv-teal-bright)' }} strokeWidth="1.4" />
      <rect x="96" y="34" width="52" height="34" rx="4" style={{ stroke: 'var(--pv-mist)', fill: 'rgba(207,224,219,0.05)' }} strokeWidth="1.3" />
      <text x="122" y="55" textAnchor="middle" className="pv-cota">#7c2e</text>
      <line x1="148" y1="51" x2="168" y2="51" style={{ stroke: 'var(--pv-teal-bright)' }} strokeWidth="1.4" />
      <rect x="168" y="34" width="52" height="34" rx="4" style={{ fill: 'rgba(23,182,163,0.08)', stroke: 'var(--pv-teal-bright)' }} strokeWidth="1.4" />
      <text x="194" y="55" textAnchor="middle" className="pv-cota" style={{ fill: 'var(--pv-teal-bright)' }}>firmado</text>
      <rect x="228" y="42" width="14" height="12" rx="2" style={{ stroke: 'var(--pv-mist)', fill: 'none' }} strokeWidth="1.3" />
      <path d="M231 42 v-4 a4 4 0 0 1 8 0 v4" style={{ stroke: 'var(--pv-mist)', fill: 'none' }} strokeWidth="1.3" />
      <text x="130" y="90" textAnchor="middle" className="pv-cota">append-only · nada se borra</text>
    </svg>
  );
}
