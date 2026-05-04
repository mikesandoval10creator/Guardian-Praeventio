import React, { useState, useCallback } from 'react';
import { ChevronDown, RotateCcw, FileText, X, Info } from 'lucide-react';
import { MedicalIcon } from '../medical/MedicalIcon';
// Sprint 20 17th-wave (Bucket D — title= → <Tooltip>): WCAG 1.4.13
// compliant tooltip on the icon-only "clear selection" reset button.
import { Tooltip } from '../shared/Tooltip';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BodyRegion {
  id: string;
  label: string;
  severity: 'leve' | 'moderado' | 'grave' | 'critico' | null;
  ds594Article?: string;
  notes?: string;
}

export interface HumanBodyViewerProps {
  value?: BodyRegion[];
  onChange?: (regions: BodyRegion[]) => void;
  readOnly?: boolean;
  compact?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  leve: {
    label: 'Leve',
    fill: 'fill-green-500/30',
    stroke: 'stroke-green-400',
    bg: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500/40',
    dot: 'bg-green-400',
  },
  moderado: {
    label: 'Moderado',
    fill: 'fill-amber-500/30',
    stroke: 'stroke-amber-400',
    bg: 'bg-amber-500/20',
    text: 'text-amber-400',
    border: 'border-amber-500/40',
    dot: 'bg-amber-400',
  },
  grave: {
    label: 'Grave',
    fill: 'fill-orange-500/30',
    stroke: 'stroke-orange-400',
    bg: 'bg-orange-500/20',
    text: 'text-orange-400',
    border: 'border-orange-500/40',
    dot: 'bg-orange-400',
  },
  critico: {
    label: 'Crítico',
    fill: 'fill-red-500/30',
    stroke: 'stroke-red-400',
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    border: 'border-red-500/40',
    dot: 'bg-red-400',
  },
} as const;

const DEFAULT_REGIONS: BodyRegion[] = [
  {
    id: 'cabeza-cuello',
    label: 'Cabeza / Cuello',
    severity: null,
    ds594Article: 'Art. 53-57 DS 594 — Ruido, Vibraciones, Casco Protector',
  },
  {
    id: 'torso-pecho',
    label: 'Torso / Pecho',
    severity: null,
    ds594Article: 'Art. 66-72 DS 594 — Agentes Físicos, Arnés, Chaleco Reflectante',
  },
  {
    id: 'abdomen-cintura',
    label: 'Abdomen / Cintura',
    severity: null,
    ds594Article: 'Art. 110-120 DS 594 — Ergonomía, Manejo Manual de Cargas',
  },
  {
    id: 'brazo-izquierdo',
    label: 'Brazo Izquierdo',
    severity: null,
    ds594Article: 'Art. 103-109 DS 594 — Vibraciones Mano-Brazo, Guantes',
  },
  {
    id: 'brazo-derecho',
    label: 'Brazo Derecho',
    severity: null,
    ds594Article: 'Art. 103-109 DS 594 — Vibraciones Mano-Brazo, Guantes',
  },
  {
    id: 'pierna-izquierda',
    label: 'Pierna Izquierda',
    severity: null,
    ds594Article: 'Art. 123-127 DS 594 — Ergonomía Postural, Calzado de Seguridad',
  },
  {
    id: 'pierna-derecha',
    label: 'Pierna Derecha',
    severity: null,
    ds594Article: 'Art. 123-127 DS 594 — Ergonomía Postural, Calzado de Seguridad',
  },
];

// ─── SVG Path Definitions ─────────────────────────────────────────────────────

// ViewBox: 0 0 120 280
// All coordinates are within this space. Front and back share the same outlines.

interface RegionPath {
  id: string;
  // SVG shape type for simplicity
  shape:
    | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
    | { type: 'rect'; x: number; y: number; width: number; height: number; rx?: number }
    | { type: 'path'; d: string };
  // WCAG 2.5.8 (Target Size) — hit-area centroid in viewBox coords. A
  // 24x24 transparent overlay is anchored here on top of the visual
  // shape so small viewports (320px) still expose a 24x24 CSS-px
  // touch/click target. Required because the stylized body paths
  // (e.g. neck stub, narrow forearm) drop below 24x24 once the SVG
  // renders inside `max-w-[180px]`.
  centroid: { cx: number; cy: number };
}

const FRONT_PATHS: RegionPath[] = [
  // Head: ellipse
  {
    id: 'cabeza-cuello',
    shape: { type: 'path', d: 'M60,4 C74,4 82,14 82,26 C82,38 74,46 60,48 C46,48 38,38 38,26 C38,14 46,4 60,4 Z M54,48 L54,60 L66,60 L66,48 Z' },
    centroid: { cx: 60, cy: 30 },
  },
  // Torso/Pecho
  {
    id: 'torso-pecho',
    shape: { type: 'path', d: 'M36,60 C30,62 24,66 22,78 L22,130 C22,134 26,136 30,136 L90,136 C94,136 98,134 98,130 L98,78 C96,66 90,62 84,60 Z' },
    centroid: { cx: 60, cy: 98 },
  },
  // Abdomen/Cintura
  {
    id: 'abdomen-cintura',
    shape: { type: 'rect', x: 26, y: 136, width: 68, height: 40, rx: 4 },
    centroid: { cx: 60, cy: 156 },
  },
  // Left arm (viewer's left = body's right visually on screen left)
  {
    id: 'brazo-izquierdo',
    shape: { type: 'path', d: 'M22,62 C16,64 10,70 8,78 L4,136 C4,140 8,142 12,140 L22,138 L26,76 Z' },
    centroid: { cx: 15, cy: 100 },
  },
  // Right arm
  {
    id: 'brazo-derecho',
    shape: { type: 'path', d: 'M98,62 C104,64 110,70 112,78 L116,136 C116,140 112,142 108,140 L98,138 L94,76 Z' },
    centroid: { cx: 105, cy: 100 },
  },
  // Left leg
  {
    id: 'pierna-izquierda',
    shape: { type: 'path', d: 'M28,176 L26,176 C22,176 20,178 20,182 L22,264 C22,268 26,270 30,270 L52,270 C56,270 58,268 58,264 L58,182 C58,178 56,176 52,176 Z' },
    centroid: { cx: 39, cy: 222 },
  },
  // Right leg
  {
    id: 'pierna-derecha',
    shape: { type: 'path', d: 'M92,176 L68,176 C64,176 62,178 62,182 L62,264 C62,268 64,270 68,270 L90,270 C94,270 98,268 98,264 L98,182 C98,178 96,176 92,176 Z' },
    centroid: { cx: 80, cy: 222 },
  },
];

// Back view paths — mirrored on neck/spine axis, same proportions.
// Centroids match the screen-side geometry: in BACK view the
// `brazo-izquierdo` LABEL is assigned to the screen-right path
// (mirrored body), so its centroid moves to the right of the SVG.
const BACK_PATHS: RegionPath[] = [
  {
    id: 'cabeza-cuello',
    shape: { type: 'path', d: 'M60,4 C74,4 82,14 82,26 C82,38 74,46 60,48 C46,48 38,38 38,26 C38,14 46,4 60,4 Z M54,48 L54,60 L66,60 L66,48 Z' },
    centroid: { cx: 60, cy: 30 },
  },
  {
    id: 'torso-pecho',
    shape: { type: 'path', d: 'M36,60 C30,62 24,66 22,78 L22,130 C22,134 26,136 30,136 L90,136 C94,136 98,134 98,130 L98,78 C96,66 90,62 84,60 Z' },
    centroid: { cx: 60, cy: 98 },
  },
  {
    id: 'abdomen-cintura',
    shape: { type: 'rect', x: 26, y: 136, width: 68, height: 40, rx: 4 },
    centroid: { cx: 60, cy: 156 },
  },
  // Back view: arms are mirrored labels (left arm is now on right of screen)
  {
    id: 'brazo-derecho',
    shape: { type: 'path', d: 'M22,62 C16,64 10,70 8,78 L4,136 C4,140 8,142 12,140 L22,138 L26,76 Z' },
    centroid: { cx: 15, cy: 100 },
  },
  {
    id: 'brazo-izquierdo',
    shape: { type: 'path', d: 'M98,62 C104,64 110,70 112,78 L116,136 C116,140 112,142 108,140 L98,138 L94,76 Z' },
    centroid: { cx: 105, cy: 100 },
  },
  {
    id: 'pierna-derecha',
    shape: { type: 'path', d: 'M28,176 L26,176 C22,176 20,178 20,182 L22,264 C22,268 26,270 30,270 L52,270 C56,270 58,268 58,264 L58,182 C58,178 56,176 52,176 Z' },
    centroid: { cx: 39, cy: 222 },
  },
  {
    id: 'pierna-izquierda',
    shape: { type: 'path', d: 'M92,176 L68,176 C64,176 62,178 62,182 L62,264 C62,268 64,270 68,270 L90,270 C94,270 98,268 98,264 L98,182 C98,178 96,176 92,176 Z' },
    centroid: { cx: 80, cy: 222 },
  },
];

// ─── Helper ───────────────────────────────────────────────────────────────────

export function bodyRegionsToString(regions: BodyRegion[]): string {
  const selected = regions.filter((r) => r.severity !== null);
  if (selected.length === 0) return 'Sin lesiones registradas.';

  const lines = selected.map((r) => {
    const sev = r.severity ? SEVERITY_CONFIG[r.severity].label : '';
    const notes = r.notes ? ` — Observaciones: ${r.notes}` : '';
    const art = r.ds594Article ? ` [${r.ds594Article}]` : '';
    return `• ${r.label}: ${sev}${notes}${art}`;
  });

  return `ZONAS CORPORALES AFECTADAS (DIAT Ley 16.744):\n${lines.join('\n')}`;
}

// ─── SVG Region Component ─────────────────────────────────────────────────────

interface SvgRegionProps {
  regionPath: RegionPath;
  region: BodyRegion;
  isHovered: boolean;
  readOnly: boolean;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}

function SvgRegion({ regionPath, region, isHovered, readOnly, onHover, onClick }: SvgRegionProps) {
  const isSelected = region.severity !== null;
  const sevConfig = isSelected ? SEVERITY_CONFIG[region.severity!] : null;

  // Compute SVG class strings manually (Tailwind won't work inside SVG attributes)
  const getColors = () => {
    if (isSelected && sevConfig) {
      const fillMap: Record<string, string> = {
        leve: 'rgba(34,197,94,0.3)',
        moderado: 'rgba(245,158,11,0.3)',
        grave: 'rgba(249,115,22,0.3)',
        critico: 'rgba(239,68,68,0.3)',
      };
      const strokeMap: Record<string, string> = {
        leve: '#4ade80',
        moderado: '#fbbf24',
        grave: '#fb923c',
        critico: '#f87171',
      };
      return { fill: fillMap[region.severity!], stroke: strokeMap[region.severity!], strokeWidth: 1.5 };
    }
    if (isHovered && !readOnly) {
      return { fill: 'rgba(8,145,178,0.2)', stroke: '#22d3ee', strokeWidth: 1.5 };
    }
    return { fill: '#0F1E35', stroke: '#1A3050', strokeWidth: 1 };
  };

  const { fill, stroke, strokeWidth } = getColors();

  // Visual props — no role/tabIndex/aria. The visual shape is purely
  // presentational; SR + keyboard entry happens via the overlay rect.
  // Click on the visible shape still fires (cursor pointer) so large
  // regions remain clickable across their whole extent.
  const visualProps = {
    fill,
    stroke,
    strokeWidth,
    style: { cursor: readOnly ? 'default' : 'pointer', transition: 'fill 0.15s, stroke 0.15s' },
    onMouseEnter: () => !readOnly && onHover(regionPath.id),
    onMouseLeave: () => !readOnly && onHover(null),
    onClick: () => !readOnly && onClick(regionPath.id),
    'aria-hidden': true as const,
  };

  // WCAG 2.5.8 (Target Size minimum 24x24 CSS px) — transparent overlay
  // anchored to the region centroid that ALWAYS guarantees a 24x24
  // hit-area regardless of how small the visual shape renders on
  // narrow viewports (320px). All a11y semantics live here so the
  // screen reader announces each region exactly once.
  const { centroid } = regionPath;
  const hitOverlay = (
    <rect
      x={centroid.cx - 12}
      y={centroid.cy - 12}
      width={24}
      height={24}
      fill="transparent"
      pointerEvents="all"
      style={{ cursor: readOnly ? 'default' : 'pointer' }}
      onMouseEnter={() => !readOnly && onHover(regionPath.id)}
      onMouseLeave={() => !readOnly && onHover(null)}
      onClick={() => !readOnly && onClick(regionPath.id)}
      role="button"
      aria-pressed={isSelected}
      aria-label={region.label}
      tabIndex={readOnly ? -1 : 0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick(regionPath.id);
        }
      }}
    />
  );

  const { shape } = regionPath;

  let visual: React.ReactElement;
  if (shape.type === 'ellipse') {
    visual = <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...visualProps} />;
  } else if (shape.type === 'rect') {
    visual = <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx ?? 0} {...visualProps} />;
  } else {
    visual = <path d={shape.d} {...visualProps} />;
  }

  return (
    <>
      {visual}
      {hitOverlay}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function HumanBodyViewer({ value, onChange, readOnly = false, compact = false }: HumanBodyViewerProps) {
  const [internalRegions, setInternalRegions] = useState<BodyRegion[]>(DEFAULT_REGIONS);
  const [view, setView] = useState<'front' | 'back'>('front');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedRegion, setExpandedRegion] = useState<string | null>(null);

  const regions = value ?? internalRegions;

  const setRegions = useCallback(
    (updater: (prev: BodyRegion[]) => BodyRegion[]) => {
      if (onChange) {
        onChange(updater(regions));
      } else {
        setInternalRegions(updater);
      }
    },
    [onChange, regions]
  );

  const handleRegionClick = (id: string) => {
    if (readOnly) return;
    setRegions((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (r.severity === null) {
          return { ...r, severity: 'leve' };
        }
        return { ...r, severity: null };
      })
    );
    setExpandedRegion((prev) => (prev === id ? null : id));
  };

  const handleSeverityChange = (id: string, severity: BodyRegion['severity']) => {
    setRegions((prev) => prev.map((r) => (r.id === id ? { ...r, severity } : r)));
  };

  const handleNotesChange = (id: string, notes: string) => {
    setRegions((prev) => prev.map((r) => (r.id === id ? { ...r, notes } : r)));
  };

  const handleReset = () => {
    setRegions(() => DEFAULT_REGIONS.map((r) => ({ ...r, severity: null, notes: undefined })));
    setExpandedRegion(null);
  };

  const selectedRegions = regions.filter((r) => r.severity !== null);
  const paths = view === 'front' ? FRONT_PATHS : BACK_PATHS;

  // For back view we need to map path id → region correctly
  const getRegionForPath = (pathId: string) => regions.find((r) => r.id === pathId)!;

  return (
    <div className={`bg-[#0A1628] border border-[#1A3050] rounded-2xl overflow-hidden ${compact ? 'flex flex-col' : 'flex flex-col xl:flex-row'}`}>
      {/* ── SVG Panel ───────────────────────────────────────────────── */}
      <div className={`relative flex flex-col items-center ${compact ? 'p-4' : 'p-6 xl:w-[340px] shrink-0'}`}>
        {/* Sprint 17c — Bioicons body silhouette + organ glyph strip. */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-cyan-300/70 z-10" aria-hidden="true">
          <MedicalIcon
            name={view === 'front' ? 'human-body-male-front' : 'human-body-female-front'}
            size={20}
            alt="Silueta corporal"
          />
          <MedicalIcon name="lung-pair" size={14} alt="Pulmones" />
          <MedicalIcon name="heart-anatomical" size={14} alt="Corazón" />
          <MedicalIcon name="brain" size={14} alt="Cerebro" />
          <MedicalIcon name="spine" size={14} alt="Columna" />
          <MedicalIcon name="eye" size={14} alt="Ojo" />
          <MedicalIcon name="ear" size={14} alt="Oído" />
        </div>
        {/* View toggle */}
        <div className="absolute top-4 right-4 flex gap-1 z-10">
          {(['front', 'back'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border ${
                view === v
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                  : 'bg-[#0F1E35] border-[#1A3050] text-[#4a6080] hover:text-cyan-400 hover:border-cyan-500/30'
              }`}
            >
              {v === 'front' ? 'Frente' : 'Espalda'}
            </button>
          ))}
        </div>

        {/* Reset button */}
        {!readOnly && selectedRegions.length > 0 && (
          <Tooltip content="Limpiar selección">
            <button
              onClick={handleReset}
              aria-label="Limpiar selección de regiones corporales"
              className="absolute top-4 left-4 p-1.5 rounded-lg bg-[#0F1E35] border border-[#1A3050] text-[#4a6080] hover:text-rose-400 hover:border-rose-500/30 transition-all z-10"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}

        {/* SVG Body */}
        <svg
          viewBox="0 0 120 280"
          role="img"
          aria-label={`Diagrama corporal vista ${view === 'front' ? 'frontal' : 'posterior'} — seleccione zonas afectadas`}
          className={`w-full max-w-[180px] ${compact ? 'max-h-[260px]' : 'max-h-[380px]'}`}
          style={{ filter: 'drop-shadow(0 0 12px rgba(14,165,233,0.08))' }}
        >
          {paths.map((regionPath) => {
            const region = getRegionForPath(regionPath.id);
            if (!region) return null;
            return (
              <SvgRegion
                key={regionPath.id}
                regionPath={regionPath}
                region={region}
                isHovered={hoveredId === regionPath.id}
                readOnly={readOnly}
                onHover={setHoveredId}
                onClick={handleRegionClick}
              />
            );
          })}
        </svg>

        {/* Legend */}
        {!compact && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {Object.entries(SEVERITY_CONFIG).map(([key, cfg]) => (
              <span key={key} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </span>
            ))}
          </div>
        )}

        {/* Hint */}
        {!readOnly && (
          <p className="mt-3 text-[9px] font-medium text-[#2a4060] uppercase tracking-widest text-center">
            {selectedRegions.length === 0 ? 'Haz clic en una zona para marcarla' : `${selectedRegions.length} zona${selectedRegions.length > 1 ? 's' : ''} seleccionada${selectedRegions.length > 1 ? 's' : ''}`}
          </p>
        )}
      </div>

      {/* ── Sidebar Panel ───────────────────────────────────────────── */}
      <div className={`flex-1 border-t xl:border-t-0 xl:border-l border-[#1A3050] flex flex-col ${compact ? '' : 'min-h-0'}`}>
        {/* Panel header */}
        <div className="px-4 py-3 border-b border-[#1A3050] flex items-center gap-2 shrink-0">
          <FileText className="w-4 h-4 text-cyan-500 shrink-0" />
          <span className="text-xs font-black text-white uppercase tracking-widest">
            Zonas Afectadas
          </span>
          <span className="ml-auto text-[10px] font-bold text-[#4a6080]">
            DIAT — Ley 16.744
          </span>
        </div>

        {/* Region list */}
        <div className={`flex-1 overflow-y-auto divide-y divide-[#1A3050] ${compact ? 'max-h-[320px]' : ''}`}>
          {regions.map((region) => {
            const isSelected = region.severity !== null;
            const sevConfig = isSelected ? SEVERITY_CONFIG[region.severity!] : null;
            const isExpanded = expandedRegion === region.id;

            return (
              <div key={region.id} className={`transition-colors ${isSelected ? 'bg-[#0F1E35]' : ''}`}>
                {/* Row header */}
                <div
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#0F1E35] transition-colors ${readOnly && !isSelected ? 'opacity-40' : ''}`}
                  onClick={() => {
                    if (!readOnly || isSelected) {
                      if (isSelected) setExpandedRegion(isExpanded ? null : region.id);
                      else handleRegionClick(region.id);
                    }
                  }}
                >
                  {/* Status dot */}
                  <div
                    className={`w-2.5 h-2.5 rounded-full border shrink-0 ${
                      isSelected
                        ? `${sevConfig!.dot} border-transparent`
                        : 'bg-transparent border-[#2a4060]'
                    }`}
                  />

                  <span className={`text-xs font-semibold flex-1 ${isSelected ? 'text-white' : 'text-[#4a6080]'}`}>
                    {region.label}
                  </span>

                  {isSelected && sevConfig && (
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${sevConfig.bg} ${sevConfig.text} border ${sevConfig.border}`}>
                      {sevConfig.label}
                    </span>
                  )}

                  {isSelected && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-[#4a6080] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  )}

                  {!readOnly && !isSelected && (
                    <span className="text-[9px] text-[#2a4060] font-medium">Clic para marcar</span>
                  )}
                </div>

                {/* Expanded panel */}
                {isSelected && isExpanded && (
                  <div className="px-4 pb-4 space-y-3">
                    {/* Severity selector */}
                    {!readOnly && (
                      <div>
                        <label className="block text-[10px] font-black text-[#4a6080] uppercase tracking-widest mb-2">
                          Severidad
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(Object.entries(SEVERITY_CONFIG) as [BodyRegion['severity'] & string, typeof SEVERITY_CONFIG[keyof typeof SEVERITY_CONFIG]][]).map(([key, cfg]) => (
                            <button
                              key={key}
                              onClick={() => handleSeverityChange(region.id, key as BodyRegion['severity'])}
                              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-bold transition-all ${
                                region.severity === key
                                  ? `${cfg.bg} ${cfg.text} ${cfg.border}`
                                  : 'bg-transparent border-[#1A3050] text-[#4a6080] hover:border-[#2a4060]'
                              }`}
                            >
                              <span className={`w-2 h-2 rounded-full ${cfg.dot} shrink-0`} />
                              {cfg.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* DS 594 reference */}
                    {region.ds594Article && (
                      <div className="flex gap-2 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20">
                        <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-blue-300 leading-relaxed font-medium">
                          {region.ds594Article}
                        </p>
                      </div>
                    )}

                    {/* Notes input */}
                    {!readOnly ? (
                      <div>
                        <label className="block text-[10px] font-black text-[#4a6080] uppercase tracking-widest mb-1.5">
                          Observaciones
                        </label>
                        <textarea
                          value={region.notes ?? ''}
                          onChange={(e) => handleNotesChange(region.id, e.target.value)}
                          placeholder="Descripción de la lesión..."
                          rows={2}
                          className="w-full bg-[#0A1628] border border-[#1A3050] rounded-lg text-xs text-white placeholder-[#2a4060] px-3 py-2 resize-none focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all"
                        />
                      </div>
                    ) : region.notes ? (
                      <div>
                        <p className="text-[10px] font-black text-[#4a6080] uppercase tracking-widest mb-1">Observaciones</p>
                        <p className="text-xs text-zinc-300">{region.notes}</p>
                      </div>
                    ) : null}

                    {/* Deselect button */}
                    {!readOnly && (
                      <button
                        onClick={() => {
                          handleRegionClick(region.id); // deselects
                        }}
                        className="flex items-center gap-1.5 text-[10px] font-bold text-rose-400/70 hover:text-rose-400 transition-colors"
                      >
                        <X className="w-3 h-3" />
                        Quitar zona
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* DIAT export preview */}
        {selectedRegions.length > 0 && (
          <div className="p-4 border-t border-[#1A3050] shrink-0">
            <p className="text-[9px] font-black text-[#4a6080] uppercase tracking-widest mb-2">
              Resumen DIAT
            </p>
            <pre className="text-[10px] text-cyan-300/70 font-mono leading-relaxed whitespace-pre-wrap bg-[#0F1E35] rounded-lg p-3 border border-[#1A3050]">
              {bodyRegionsToString(regions)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
