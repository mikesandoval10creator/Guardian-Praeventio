// src/components/layout/CriticalActionsSheet.tsx
import { useState } from 'react';
import { AlertOctagon, Zap } from 'lucide-react';
import Sheet from '../shared/Sheet';
import Button from '../shared/Button';
import { useAppMode } from '../../contexts/AppModeContext';
import { FastCheckModal } from '../FastCheckModal';

/**
 * CriticalActionsSheet — acciones críticas en panel lateral SIN cambio de
 * ruta (no se pierde el contexto de la pantalla actual):
 *   • Emergencia  → setMode('emergency'); el EmergencyOverlay/SOSButton ya
 *                   montados en RootLayout reaccionan al modo (no navigate).
 *   • Fast Check  → abre el FastCheckModal inline.
 * Directiva fundador: nunca pánico — copy sereno, rojo solo en la acción
 * crítica de emergencia.
 */
export function CriticalActionsSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { setMode } = useAppMode();
  const [fastCheckOpen, setFastCheckOpen] = useState(false);

  const activateEmergency = (): void => {
    setMode('emergency');
    onClose();
  };

  return (
    <>
      <Sheet isOpen={isOpen} onClose={onClose} title="Acciones rápidas">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Acceso directo a lo crítico sin salir de esta pantalla.
          </p>

          <Button variant="danger" size="lg" onClick={activateEmergency} className="justify-start w-full">
            <AlertOctagon aria-hidden="true" />
            Activar Emergencia
          </Button>

          <Button variant="secondary" size="lg" onClick={() => setFastCheckOpen(true)} className="justify-start w-full">
            <Zap aria-hidden="true" />
            Fast Check
          </Button>

          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            La emergencia activa el modo de alta visibilidad. Puedes cancelarla cuando quieras.
          </p>
        </div>
      </Sheet>

      <FastCheckModal isOpen={fastCheckOpen} onClose={() => setFastCheckOpen(false)} />
    </>
  );
}
