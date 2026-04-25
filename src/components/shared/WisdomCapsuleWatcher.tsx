import React, { useState } from 'react';
import { useWisdomCapsules } from '../../hooks/useWisdomCapsules';
import { WisdomCapsule } from './WisdomCapsule';

export function WisdomCapsuleWatcher() {
  const { nearbyCapsule } = useWisdomCapsules();
  const [dismissed, setDismissed] = useState<string | null>(null);

  const visible = nearbyCapsule && nearbyCapsule.id !== dismissed;

  if (!visible) return null;

  return (
    <WisdomCapsule
      capsule={nearbyCapsule}
      onDismiss={() => setDismissed(nearbyCapsule.id)}
    />
  );
}
