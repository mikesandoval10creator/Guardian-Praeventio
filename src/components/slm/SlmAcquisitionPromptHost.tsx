// Praeventio Guard — Host wrapper que cablea hook + prompt + banner.
//
// Vive lazy-loaded en `AppProviders.tsx`. Comparte UNA sola instancia
// del hook `useSlmAcquisition` entre:
//   - `<SlmAcquisitionPrompt />` — modal full-screen del primer launch.
//   - `<SlmDownloadFloatingBanner />` — pill persistente bottom-right
//     que sigue el progreso mientras el usuario navega.
//
// Razón de compartir el hook: si cada componente instanciara su propio
// `useSlmAcquisition()`, ambos correrían su propia state machine local
// con dos AbortControllers, dos suscripciones de progreso, etc. Pero el
// service layer es singleton (localStorage + IndexedDB), así que el
// resultado sería UI desincronizada. Compartiendo la instancia, el
// modal y el banner ven los mismos bytes, fase, errores.

import { useSlmAcquisition } from '../../hooks/useSlmAcquisition';
import { SlmAcquisitionPrompt } from './SlmAcquisitionPrompt';
import { SlmDownloadFloatingBanner } from './SlmDownloadFloatingBanner';

export function SlmAcquisitionPromptHost() {
  const acquisition = useSlmAcquisition();
  const {
    status,
    networkAdvisory,
    downloadProgress,
    downloadedBytes,
    accept,
    postpone,
    decline,
  } = acquisition;

  if (!status) return null;

  // El modal se muestra cuando el flujo recién arranca (needs_prompt)
  // o cuando explícitamente estamos descargando y el user llegó al
  // primer momento — pero NO durante toda la descarga, para no
  // bloquear el shell. Una vez que el flujo es "downloading" pasamos
  // al banner flotante.
  const showModal = status.state === 'needs_prompt';

  return (
    <>
      {showModal && (
        <SlmAcquisitionPrompt
          status={status}
          networkAdvisory={networkAdvisory}
          downloadProgress={downloadProgress}
          downloadedBytes={downloadedBytes}
          onAccept={() => {
            void accept();
          }}
          onPostpone={postpone}
          onDecline={decline}
          onDismiss={postpone}
        />
      )}
      <SlmDownloadFloatingBanner acquisition={acquisition} />
    </>
  );
}
