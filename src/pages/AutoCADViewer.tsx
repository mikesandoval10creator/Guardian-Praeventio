import React, { useState, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Box, Upload, ShieldAlert, Layers, ZoomIn, ZoomOut, Maximize, AlertTriangle, FileCode2, X } from 'lucide-react';
import DxfParser from 'dxf-parser';
import { Card, Button } from '../components/shared/Card';

interface DxfEntity {
  type: string;
  layer?: string;
  vertices?: { x: number; y: number }[];
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
  center?: { x: number; y: number };
  radius?: number;
  position?: { x: number; y: number };
  text?: string;
}

interface ParsedDxf {
  entities: DxfEntity[];
  layers: { name: string; color?: number; visible: boolean }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const LAYER_COLORS: Record<number, string> = {
  1: '#ef4444', 2: '#fbbf24', 3: '#22c55e', 4: '#06b6d4',
  5: '#3b82f6', 6: '#a855f7', 7: '#e5e7eb', 8: '#94a3b8',
};

function colorFor(colorIdx?: number, fallback = '#4db6ac'): string {
  if (!colorIdx) return fallback;
  return LAYER_COLORS[colorIdx] ?? fallback;
}

function computeBounds(entities: DxfEntity[]): ParsedDxf['bounds'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const e of entities) {
    e.vertices?.forEach(v => consider(v.x, v.y));
    if (e.startPoint) consider(e.startPoint.x, e.startPoint.y);
    if (e.endPoint) consider(e.endPoint.x, e.endPoint.y);
    if (e.position) consider(e.position.x, e.position.y);
    if (e.center && e.radius) {
      consider(e.center.x - e.radius, e.center.y - e.radius);
      consider(e.center.x + e.radius, e.center.y + e.radius);
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  return { minX, minY, maxX, maxY };
}

export function AutoCADViewer() {
  const [parsed, setParsed] = useState<ParsedDxf | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [zoom, setZoom] = useState(1);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setParseError(null);
    setIsParsing(true);
    setFileName(file.name);

    try {
      if (file.size > 50 * 1024 * 1024) {
        throw new Error('Archivo excede 50MB');
      }
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'dwg') {
        throw new Error('DWG es formato binario propietario. Convierte a DXF primero (Autodesk: Save As → AutoCAD DXF).');
      }
      if (ext !== 'dxf') {
        throw new Error('Formato no soportado. Usa .DXF (texto).');
      }

      const text = await file.text();
      const parser = new DxfParser();
      const dxf = parser.parseSync(text);

      if (!dxf || !dxf.entities) {
        throw new Error('DXF inválido o vacío');
      }

      const entities = dxf.entities as DxfEntity[];
      const layerNames = Array.from(new Set(entities.map(e => e.layer ?? '0')));
      const layers = layerNames.map(name => ({
        name,
        color: dxf.tables?.layer?.layers?.[name]?.color,
        visible: true,
      }));

      setParsed({
        entities,
        layers,
        bounds: computeBounds(entities),
      });
    } catch (err: any) {
      setParseError(err?.message ?? 'Error al procesar archivo');
      setParsed(null);
    } finally {
      setIsParsing(false);
    }
  };

  const onUploadClick = () => fileInputRef.current?.click();
  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const toggleLayer = (name: string) => {
    setHiddenLayers(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const reset = () => {
    setParsed(null);
    setParseError(null);
    setFileName('');
    setZoom(1);
    setHiddenLayers(new Set());
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const svgViewBox = useMemo(() => {
    if (!parsed) return '0 0 800 600';
    const { minX, minY, maxX, maxY } = parsed.bounds;
    const w = (maxX - minX) || 100;
    const h = (maxY - minY) || 100;
    const padX = w * 0.05;
    const padY = h * 0.05;
    return `${minX - padX} ${minY - padY} ${w + padX * 2} ${h + padY * 2}`;
  }, [parsed]);

  const renderEntity = (e: DxfEntity, i: number) => {
    if (e.layer && hiddenLayers.has(e.layer)) return null;
    const layerColor = parsed?.layers.find(l => l.name === e.layer)?.color;
    const color = colorFor(layerColor);
    const sw = (parsed!.bounds.maxX - parsed!.bounds.minX) * 0.001 || 0.5;

    switch (e.type) {
      case 'LINE':
        if (!e.vertices || e.vertices.length < 2) return null;
        return <line key={i} x1={e.vertices[0].x} y1={-e.vertices[0].y} x2={e.vertices[1].x} y2={-e.vertices[1].y} stroke={color} strokeWidth={sw} />;
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const pts = (e.vertices ?? []).map(v => `${v.x},${-v.y}`).join(' ');
        return <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth={sw} />;
      }
      case 'CIRCLE':
        if (!e.center || e.radius == null) return null;
        return <circle key={i} cx={e.center.x} cy={-e.center.y} r={e.radius} fill="none" stroke={color} strokeWidth={sw} />;
      case 'ARC': {
        if (!e.center || e.radius == null) return null;
        return <circle key={i} cx={e.center.x} cy={-e.center.y} r={e.radius} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={`${sw * 4},${sw * 2}`} />;
      }
      case 'TEXT':
      case 'MTEXT':
        if (!e.position) return null;
        return <text key={i} x={e.position.x} y={-e.position.y} fontSize={(e as any).height ?? sw * 8} fill={color}>{e.text ?? ''}</text>;
      default:
        return null;
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Box className="w-8 h-8 text-[#4db6ac] dark:text-[#d4af37]" />
            Visor AutoCAD (DXF)
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Integración de Planos Estructurales · Parser real DXF
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-[#4db6ac] dark:text-[#d4af37] bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 border-[#4db6ac]/20 dark:border-[#d4af37]/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">Nivel: Enterprise</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Viewer Area */}
        <Card className="p-0 border-white/5 lg:col-span-2 overflow-hidden relative min-h-[600px] bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
          {!parsed && !isParsing && !parseError && (
            <div className="flex flex-col items-center justify-center text-center p-8">
              <FileCode2 className="w-16 h-16 text-zinc-300 dark:text-zinc-700 mb-4" />
              <h3 className="text-lg font-bold text-zinc-700 dark:text-white mb-2">Sube un archivo .DXF</h3>
              <p className="text-sm text-zinc-500 max-w-md">
                Parser real client-side: las entidades CAD (LINE, POLYLINE, CIRCLE, ARC, TEXT) se renderizan a SVG vectorial nativo. Sin uploads al servidor.
              </p>
            </div>
          )}

          {isParsing && (
            <div className="flex flex-col items-center justify-center text-center">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
                <Layers className="w-16 h-16 text-[#4db6ac] mb-4" />
              </motion.div>
              <p className="text-sm font-bold text-[#4db6ac] dark:text-[#d4af37] animate-pulse">Parseando vectores DXF...</p>
              <p className="text-xs text-zinc-500 mt-2">{fileName}</p>
            </div>
          )}

          {parseError && (
            <div className="flex flex-col items-center justify-center text-center p-8">
              <AlertTriangle className="w-16 h-16 text-rose-500 mb-4" />
              <h3 className="text-lg font-bold text-rose-500 mb-2">Error al procesar</h3>
              <p className="text-sm text-zinc-500 max-w-md">{parseError}</p>
              <button onClick={reset} className="mt-4 px-4 py-2 rounded-xl bg-zinc-800 text-white text-xs font-bold uppercase tracking-widest hover:bg-zinc-700">
                Reintentar
              </button>
            </div>
          )}

          {parsed && (
            <div className="absolute inset-0 w-full h-full bg-zinc-50 dark:bg-[#1e1e1e]" style={{ backgroundImage: 'radial-gradient(rgba(120,120,120,0.2) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
              <svg className="w-full h-full" viewBox={svgViewBox} preserveAspectRatio="xMidYMid meet" style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}>
                {parsed.entities.map(renderEntity)}
              </svg>
              <div className="absolute bottom-4 right-4 flex gap-2">
                <button onClick={() => setZoom(z => Math.min(z * 1.2, 5))} aria-label="Acercar" className="p-2 bg-zinc-800/90 rounded-lg hover:bg-zinc-700 text-white min-w-[44px] min-h-[44px] flex items-center justify-center">
                  <ZoomIn className="w-5 h-5" />
                </button>
                <button onClick={() => setZoom(z => Math.max(z / 1.2, 0.2))} aria-label="Alejar" className="p-2 bg-zinc-800/90 rounded-lg hover:bg-zinc-700 text-white min-w-[44px] min-h-[44px] flex items-center justify-center">
                  <ZoomOut className="w-5 h-5" />
                </button>
                <button onClick={() => setZoom(1)} aria-label="Ajustar" className="p-2 bg-zinc-800/90 rounded-lg hover:bg-zinc-700 text-white min-w-[44px] min-h-[44px] flex items-center justify-center">
                  <Maximize className="w-5 h-5" />
                </button>
              </div>
              <div className="absolute top-4 left-4 px-3 py-1.5 bg-zinc-900/90 rounded-lg text-[10px] font-bold uppercase tracking-widest text-white">
                {parsed.entities.length} entidades · {parsed.layers.length} capas
              </div>
            </div>
          )}
        </Card>

        {/* Controls Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <Upload className="w-5 h-5 text-[#4db6ac] dark:text-[#d4af37]" />
            Cargar Plano
          </h2>

          <input ref={fileInputRef} type="file" accept=".dxf" onChange={onInputChange} className="hidden" />

          <button
            onClick={onUploadClick}
            disabled={isParsing}
            className="w-full border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-[#4db6ac] dark:hover:border-[#d4af37] bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl p-8 text-center transition-colors cursor-pointer disabled:opacity-50"
          >
            <Upload className="w-10 h-10 text-zinc-400 dark:text-zinc-600 mx-auto mb-3" />
            <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Haz clic para subir archivo</p>
            <p className="text-xs text-zinc-500 mt-1">Solo .DXF (Max 50MB)</p>
          </button>

          {fileName && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#4db6ac]/5 dark:bg-[#d4af37]/5 border border-[#4db6ac]/20 dark:border-[#d4af37]/20">
              <span className="text-xs font-bold truncate text-zinc-700 dark:text-zinc-300">{fileName}</span>
              <button onClick={reset} aria-label="Quitar archivo" className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800">
                <X className="w-3.5 h-3.5 text-zinc-500" />
              </button>
            </div>
          )}

          {parsed && parsed.layers.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-zinc-200 dark:border-white/5">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Capas Detectadas ({parsed.layers.length})</h3>
              <div className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                {parsed.layers.map(layer => {
                  const visible = !hiddenLayers.has(layer.name);
                  const dotColor = colorFor(layer.color);
                  return (
                    <label key={layer.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => toggleLayer(layer.name)}
                        className="rounded border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[#4db6ac] focus:ring-[#4db6ac]"
                      />
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                      <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate flex-1">{layer.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {parsed && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <div className="flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Próxima fase: superposición automática de zonas IPER (riesgos) sobre las capas detectadas.
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
