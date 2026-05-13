// Praeventio Guard — Sprint 47 D.7: lazy wrapper para TwinSceneInstanced.
//
// El chunk pesa por dependencias r3f + rapier + drei. Eagerly cargarlo
// añade ~150KB gzipped al main bundle aunque el usuario no use el Twin.
// Este wrapper lazy difiere el chunk hasta que el componente se monta.

import { lazy, Suspense } from 'react';
import type { TwinSceneInstancedProps } from './TwinSceneInstanced.js';

const TwinSceneInstanced = lazy(() =>
  import('./TwinSceneInstanced.js').then((m) => ({ default: m.TwinSceneInstanced })),
);

export function TwinSceneInstancedLazy(props: TwinSceneInstancedProps) {
  return (
    <Suspense
      fallback={
        <div
          data-testid="twin-scene-lazy.loading"
          className="flex h-[480px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500"
        >
          Cargando escena 3D…
        </div>
      }
    >
      <TwinSceneInstanced {...props} />
    </Suspense>
  );
}
