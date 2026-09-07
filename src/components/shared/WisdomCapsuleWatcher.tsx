import React, { useState } from 'react';
import { useWisdomCapsules } from '../../hooks/useWisdomCapsules';
import { useTenantId } from '../../hooks/useTenantId';
import { useProject } from '../../contexts/ProjectContext';
import { WisdomCapsule } from './WisdomCapsule';

export function WisdomCapsuleWatcher() {
  const { selectedProject } = useProject();
  const { tenantId } = useTenantId();
  const { nearbyCapsule } = useWisdomCapsules({
    projectId: selectedProject?.id ?? null,
    tenantId,
  });
  const [dismissed, setDismissed] = useState<string | null>(null);

  const scopedNearbyCapsule = selectedProject?.id && tenantId ? nearbyCapsule : null;
  const visible = scopedNearbyCapsule?.id !== dismissed ? scopedNearbyCapsule : null;

  if (!visible) return null;

  return (
    <WisdomCapsule
      capsule={visible}
      onDismiss={() => setDismissed(visible.id)}
    />
  );
}
