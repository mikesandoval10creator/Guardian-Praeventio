// Praeventio Guard — feature-flag router que conmuta entre el
// `<AsesorChat>` legacy y `<ResilientAsesorPanel />` nuevo.
//
// Renderiza el panel correcto basado en `useResilientAsesorFlag`. Si
// el flag está OFF (default), el legacy chat es servido como antes —
// CERO cambio de comportamiento. Si está ON, el nuevo panel
// resiliente toma su lugar.
//
// Diseñado para que la migración pueda hacerse:
//   1. Beta opt-in: usuarios power-user activan el flag manualmente
//      desde Settings (botón "Probar nuevo asistente").
//   2. Canary deploy: `VITE_FORCE_RESILIENT_ASESOR=1` fuerza ON en un
//      build específico desplegado a un % de tenants.
//   3. Default flip: una vez validado, cambiamos el default del hook
//      a `true` (un PR pequeño) y el legacy queda como fallback opt-in.
//   4. Cleanup: una vez confirmado en prod, eliminamos AsesorChat y
//      el router.

import { lazy, Suspense, type ComponentProps } from 'react';
import { useResilientAsesorFlag } from '../../hooks/useResilientAsesorFlag';

// Ambos paths son lazy para que el código pesado del que NO se usa
// no entre al cold-start chunk del shell.
const LegacyAsesorChat = lazy(() =>
  import('./AsesorChat').then((m) => ({ default: m.AsesorChat })),
);

const ResilientAsesorPanelLazy = lazy(() =>
  import('./ResilientAsesorPanel').then((m) => ({
    default: m.ResilientAsesorPanel,
  })),
);

type ResilientAsesorPanelProps = ComponentProps<typeof ResilientAsesorPanelLazy>;

interface AsesorChatRouterProps {
  /**
   * Props que el panel resiliente necesita (ZK nodes + tenantId +
   * adapters etc.). Si el flag está OFF, estos props son ignorados.
   */
  resilientProps?: ResilientAsesorPanelProps;
}

export function AsesorChatRouter({ resilientProps }: AsesorChatRouterProps) {
  const { enabled } = useResilientAsesorFlag();

  if (enabled) {
    return (
      <Suspense fallback={null}>
        <ResilientAsesorPanelLazy {...(resilientProps ?? {})} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <LegacyAsesorChat />
    </Suspense>
  );
}
