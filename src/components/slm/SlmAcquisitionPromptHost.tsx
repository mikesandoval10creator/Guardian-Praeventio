// Praeventio Guard — Host wrapper que cablea hook + prompt.
//
// Vive lazy-loaded en `AppProviders.tsx`. Renderiza el modal solo
// cuando el `useSlmAcquisition` hook reporta `needs_prompt` o
// `downloading`. En cualquier otro estado (ready, declined,
// postponed), no produce DOM — el chunk se baja una vez al primer
// render del shell y queda inerte si el usuario ya tiene el modelo
// o ya decidió no descargarlo.

import { useSlmAcquisition } from '../../hooks/useSlmAcquisition';
import { SlmAcquisitionPrompt } from './SlmAcquisitionPrompt';

export function SlmAcquisitionPromptHost() {
  const {
    status,
    networkAdvisory,
    downloadProgress,
    downloadedBytes,
    accept,
    postpone,
    decline,
  } = useSlmAcquisition();

  if (!status) return null;
  // Únicos estados que renderizan el modal. El componente interno
  // también devuelve null en estados "silenciosos" (ready, declined,
  // postponed), pero hacemos el short-circuit aquí para evitar el
  // overhead del wrapper modal en el árbol de render.
  if (status.state !== 'needs_prompt' && status.state !== 'downloading') {
    return null;
  }

  return (
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
  );
}
