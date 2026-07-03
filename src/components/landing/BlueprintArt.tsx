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
  const spiral = useDraw({ delay: 1.2, duration: 2.2 });
  const posts = useDraw({ delay: 0.1, duration: 1.4 });
  const beams = useDraw({ delay: 0.7, duration: 1.2 });
  const braces = useDraw({ delay: 1.1, duration: 1.2 });
  const reduced = useReducedMotion();

  return (
    <div className={reduced ? '' : 'pv-floaty'} style={{ maxWidth: 420, width: '100%' }}>
      <svg viewBox="0 0 260 420" style={{ width: '100%', height: 'auto', overflow: 'visible' }} role="img" aria-label={caption}>
        {/* plano fill */}
        <rect x="46" y="70" width="168" height="300" style={{ fill: 'var(--pv-teal)' }} opacity="0.06" />
        {/* golden spiral — φ */}
        <motion.path
          {...spiral}
          d="M162 258 a96 96 0 0 1 -96 -96 a59.3 59.3 0 0 1 59.3 -59.3 a36.7 36.7 0 0 1 36.7 36.7 a22.7 22.7 0 0 1 -22.7 22.7 a14 14 0 0 1 -14 -14"
          style={{ stroke: 'var(--pv-gold)', fill: 'none' }}
          strokeWidth="1.2"
          opacity="0.8"
        />
        {/* scaffold posts */}
        {[70, 130, 190].map((x, i) => (
          <motion.line
            key={x}
            {...posts}
            transition={{ ...(posts.transition ?? {}), delay: 0.1 + i * 0.18 }}
            x1={x}
            y1="60"
            x2={x}
            y2="380"
            style={{ stroke: 'var(--pv-teal-deep)' }}
            strokeWidth="1.4"
          />
        ))}
        {/* ledgers */}
        {[110, 190, 270, 350].map((y, i) => (
          <motion.line
            key={y}
            {...beams}
            transition={{ ...(beams.transition ?? {}), delay: 0.7 + i * 0.12 }}
            x1="60"
            y1={y}
            x2="200"
            y2={y}
            style={{ stroke: 'var(--pv-teal-deep)' }}
            strokeWidth="1.4"
          />
        ))}
        {/* diagonal bracing */}
        {[
          [70, 110, 130, 190],
          [130, 110, 70, 190],
          [130, 270, 190, 350],
          [190, 270, 130, 350],
        ].map(([x1, y1, x2, y2], i) => (
          <motion.line
            key={i}
            {...braces}
            transition={{ ...(braces.transition ?? {}), delay: 1.1 + i * 0.1 }}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            style={{ stroke: 'var(--pv-teal-deep)' }}
            strokeWidth="1.4"
          />
        ))}
        {/* joints */}
        {[
          [70, 110],
          [130, 190],
          [190, 270],
          [130, 350],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.2" style={{ fill: 'var(--pv-teal)' }} />
        ))}
        {/* cota — dimension line with φ */}
        <line x1="222" y1="70" x2="222" y2="370" style={{ stroke: 'var(--pv-ink)' }} strokeWidth="1" opacity="0.4" />
        <line x1="218" y1="70" x2="226" y2="70" style={{ stroke: 'var(--pv-ink)' }} strokeWidth="1" opacity="0.4" />
        <line x1="218" y1="370" x2="226" y2="370" style={{ stroke: 'var(--pv-ink)' }} strokeWidth="1" opacity="0.4" />
        <text x="230" y="224" className="pv-cota" transform="rotate(90 230 224)">
          φ · 1.618
        </text>
      </svg>
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
