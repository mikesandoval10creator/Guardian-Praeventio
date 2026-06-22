// SPDX-License-Identifier: MIT
//
// DigitalTwinAR — entrada principal al "Modo AR" del Digital Twin.
//
// Sprint F (2026-05-16) AR Real Vision. Cumple el plan del usuario:
//   "en el menú de digital twin encontremos la posibilidad de habilitar
//    el modo AR, de esa forma podremos usar una herramienta donde
//    podremos interactuar con la realidad de una forma sorprendente"
//
// Esta página ofrece 3 modos AR — el usuario elige cuál abrir:
//
//   1. Machinery Nodes (ARMachineryScene)
//      Ver/crear nodos de información sobre maquinaria real.
//      Casos: marcar grúa horquilla con su última inspección y
//      próximo mantenimiento, leerlos desde el smartphone apuntando
//      la cámara.
//
//   2. Warehouse Planning (ARWarehouseScene, en construcción)
//      Placear virtualmente extintores, hidrantes, señaléticas, AED
//      antes de comprarlos/instalarlos. Verifica con la matriz
//      hazmatSegregation si una combinación es peligrosa.
//
//   3. Poster Scan (ARPosterScanner, en construcción)
//      Apuntar cámara a poster impreso → MediaPipe detecta → animación
//      educativa overlay.
//
// Capability gate: si el browser NO soporta WebXR `immersive-ar` ni
// iOS Quick Look ni Android Scene Viewer, mostramos un mensaje
// explicando QUÉ hace falta (browser moderno + dispositivo AR-capable)
// con link a tutorial. Sin engaño: no fingimos que funciona en desktop.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Glasses, Cpu, Warehouse, Image as ImageIcon, ArrowLeft, AlertTriangle } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useWebXRSupport } from '../hooks/useWebXRSupport';
import { isIosUserAgent, isAndroidUserAgent } from '../components/ar/ArViewLink';
import { ARMachineryScene } from '../components/ar/ARMachineryScene';
import { ARWarehouseScene } from '../components/ar/ARWarehouseScene';
import { ARPosterScanner } from '../components/ar/ARPosterScanner';
import { useProject } from '../contexts/ProjectContext';
import { useNavigate } from 'react-router-dom';

type ArMode = 'menu' | 'machinery' | 'warehouse' | 'poster';

export function DigitalTwinAR() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const navigate = useNavigate();
  const xrSupport = useWebXRSupport();
  const [mode, setMode] = useState<ArMode>('menu');

  // Detectamos plataforma para mostrar pista accurate al usuario
  const isIos = typeof navigator !== 'undefined' && isIosUserAgent();
  const isAndroid = typeof navigator !== 'undefined' && isAndroidUserAgent();
  // Codex fix: la escena ARMachinery/Warehouse usan WebXR immersive-ar
  // directamente (no Quick Look ni Scene Viewer). El gate antes incluía
  // iOS/Android UA aunque NO tuvieran WebXR — la "Iniciar" prometía algo
  // que después fallaba con error WebXR. Ahora gate solo por capability
  // REAL. iOS Quick Look y Android Scene Viewer son links a modelos `.glb`/
  // `.usdz` (otro flow) — los usaremos en el modo poster scan más adelante.
  const hasNativeAr = xrSupport.immersiveAr;
  // Mantenemos el detector de plataforma para mensajes más útiles.
  const platformHint = isIos
    ? 'iPhone/iPad detectado: WebXR immersive-ar no está soportado en iOS Safari. El modo AR completo requiere Chrome Android con ARCore. iOS Quick Look estará disponible en el modo poster scan (próxima iteración).'
    : isAndroid
      ? 'Android detectado: si no aparece "Iniciar" aquí, abre el sitio en Chrome y verifica que tu dispositivo soporte ARCore (instalable desde Play Store si tu Android es compatible).'
      : 'Desktop detectado: el AR está pensado para tu smartphone en faena. El Digital Twin 3D normal sigue funcionando aquí.';

  // Cuando entramos a una escena AR, ocultamos el menú con state
  if (mode === 'machinery') {
    return <ARMachineryScene onExit={() => setMode('menu')} />;
  }
  if (mode === 'warehouse') {
    return <ARWarehouseScene onExit={() => setMode('menu')} />;
  }

  if (mode === 'poster') {
    return <ARPosterScanner onExit={() => setMode('menu')} />;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Button variant="secondary" onClick={() => navigate('/digital-twin')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('digitalTwinAr.backTwin', 'Volver al Twin 3D')}
          </Button>
          <h1 className="mt-4 text-3xl md:text-4xl font-black text-primary uppercase tracking-tighter flex items-center gap-3">
            <Glasses className="w-8 h-8 text-cyan-400" />
            {t('digitalTwinAr.title', 'Modo Realidad Aumentada')}
          </h1>
          <p className="mt-2 text-[10px] font-bold text-muted-token uppercase tracking-[0.2em]">
            {selectedProject?.name
              ? `${t('digitalTwinAr.project', 'Proyecto')}: ${selectedProject.name}`
              : t('digitalTwinAr.noProject', 'Selecciona un proyecto activo')}
          </p>
        </div>
      </div>

      {/* Capability gate */}
      {!hasNativeAr && (
        <Card className="p-6 border-rose-500/30 bg-rose-500/5">
          <h2 className="text-lg font-bold text-rose-300 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            {t('digitalTwinAr.noSupport', 'Tu dispositivo no soporta el AR completo')}
          </h2>
          <p className="text-sm text-rose-100/80 mb-3">{platformHint}</p>
          <p className="text-[10px] text-rose-200/60 font-mono">
            WebXR immersive-ar: {String(xrSupport.immersiveAr)} · iOS:{' '}
            {String(isIos)} · Android: {String(isAndroid)}
          </p>
        </Card>
      )}

      {/* Aviso si no hay proyecto seleccionado */}
      {hasNativeAr && !selectedProject && (
        <Card className="p-4 border-amber-500/30 bg-amber-500/5">
          <p className="text-sm text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {t(
              'digitalTwinAr.noProjectWarn',
              'Selecciona un proyecto activo antes de entrar al modo AR — las anclas son privadas por proyecto y necesitamos saber dónde guardarlas.',
            )}
          </p>
        </Card>
      )}

      {/* 3 cards de modos.
          Codex fix: el gate de la Card (cursor-pointer + onClick) ahora
          chequea TAMBIÉN selectedProject — sin esto, hacer click en la
          card sin proyecto activo te metía a la cámara y después no podías
          guardar nada. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          className={`p-6 border-cyan-500/30 bg-cyan-500/5 transition-all ${
            hasNativeAr && selectedProject
              ? 'hover:scale-[1.02] cursor-pointer'
              : 'opacity-50 cursor-not-allowed'
          }`}
          onClick={() => hasNativeAr && selectedProject && setMode('machinery')}
        >
          <Cpu className="w-10 h-10 text-cyan-400 mb-3" />
          <h3 className="text-lg font-bold text-primary mb-2">
            {t('digitalTwinAr.modeMachinery', 'Nodos en Maquinaria')}
          </h3>
          <p className="text-sm text-secondary mb-4">
            {t(
              'digitalTwinAr.modeMachineryDesc',
              'Ve información de seguridad apuntando la cámara a una máquina del faena. Crea nuevos nodos para que tu equipo vea inspecciones, mantenimientos y alertas activas.',
            )}
          </p>
          <Button
            className="w-full bg-cyan-600 hover:bg-cyan-500"
            disabled={!hasNativeAr || !selectedProject}
            onClick={(e) => {
              e.stopPropagation();
              if (hasNativeAr && selectedProject) setMode('machinery');
            }}
          >
            {t('digitalTwinAr.startMachinery', 'Iniciar')}
          </Button>
        </Card>

        <Card
          className={`p-6 border-emerald-500/30 bg-emerald-500/5 transition-all ${
            hasNativeAr && selectedProject
              ? 'hover:scale-[1.02] cursor-pointer'
              : 'opacity-50 cursor-not-allowed'
          }`}
          onClick={() => hasNativeAr && selectedProject && setMode('warehouse')}
        >
          <Warehouse className="w-10 h-10 text-emerald-400 mb-3" />
          <h3 className="text-lg font-bold text-primary mb-2">
            {t('digitalTwinAr.modeWarehouse', 'Planificar Bodega')}
          </h3>
          <p className="text-sm text-secondary mb-4">
            {t(
              'digitalTwinAr.modeWarehouseDesc',
              'Placea virtualmente extintores, hidrantes, AEDs y 17 tipos de señalética para visualizar el orden antes de instalar. Detecta automáticamente pares demasiado cerca (<1.5m) para evitar interferencias.',
            )}
          </p>
          <Button
            className="w-full bg-emerald-600 hover:bg-emerald-500"
            disabled={!hasNativeAr || !selectedProject}
            onClick={(e) => {
              e.stopPropagation();
              if (hasNativeAr) setMode('warehouse');
            }}
          >
            {t('digitalTwinAr.startWarehouse', 'Iniciar')}
          </Button>
        </Card>

        {/* Poster scan: NO requiere WebXR — solo cámara + MediaPipe. Por
            eso el gate solo chequea selectedProject. */}
        <Card
          className={`p-6 border-violet-500/30 bg-violet-500/5 transition-all ${
            selectedProject
              ? 'hover:scale-[1.02] cursor-pointer'
              : 'opacity-50 cursor-not-allowed'
          }`}
          onClick={() => selectedProject && setMode('poster')}
        >
          <ImageIcon className="w-10 h-10 text-violet-400 mb-3" />
          <h3 className="text-lg font-bold text-primary mb-2">
            {t('digitalTwinAr.modePoster', 'Escaneo de Poster')}
          </h3>
          <p className="text-sm text-secondary mb-4">
            {t(
              'digitalTwinAr.modePosterDesc',
              'Apunta la cámara a un poster de seguridad impreso. MediaPipe detecta la imagen y muestra una animación educativa: cómo usar el arnés, protocolo del extintor, evacuación, etc.',
            )}
          </p>
          <p className="text-[10px] text-violet-300/70 mb-3">
            {t(
              'digitalTwinAr.modePosterReq',
              'Funciona en cualquier smartphone con cámara — no requiere ARCore.',
            )}
          </p>
          <Button
            className="w-full bg-violet-600 hover:bg-violet-500"
            disabled={!selectedProject}
            onClick={(e) => {
              e.stopPropagation();
              if (selectedProject) setMode('poster');
            }}
          >
            {t('digitalTwinAr.startPoster', 'Iniciar')}
          </Button>
        </Card>
      </div>

      <Card className="p-4 border-default-token bg-surface/20">
        <p className="text-[10px] text-muted-token leading-relaxed">
          {t(
            'digitalTwinAr.privacyNote',
            'La información de tus máquinas y faena es PRIVADA por proyecto. Solo miembros del proyecto activo pueden ver los nodos AR que se creen aquí (validado a nivel de Firestore rules + tenant claims).',
          )}
        </p>
      </Card>
    </div>
  );
}
