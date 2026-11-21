import { useEffect, useState } from "react";
import type { SplatCapture } from "../../services/digitalTwin/gaussianSplatRegistry";
import { subscribePreferredSplatCapture } from "../../services/digitalTwin/splatCaptureStore";
import { logger } from "../../utils/logger";
import { GaussianSplatViewer } from "./GaussianSplatViewer";

interface CaptureScope {
  tenantId: string;
  projectId: string;
}

export function ScopedGaussianSplatViewer({ tenantId, projectId }: CaptureScope) {
  if (!tenantId || !projectId) return <GaussianSplatViewer capture={null} />;
  return (
    <CaptureViewer
      key={JSON.stringify([tenantId, projectId])}
      tenantId={tenantId}
      projectId={projectId}
    />
  );
}

function CaptureViewer({ tenantId, projectId }: CaptureScope) {
  const [capture, setCapture] = useState<SplatCapture | null>(null);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribePreferredSplatCapture(
      tenantId,
      projectId,
      (next) => {
        if (active) setCapture(next);
      },
      () => {
        if (active) logger.warn("splat_capture_subscription_error");
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [tenantId, projectId]);

  return <GaussianSplatViewer capture={capture} />;
}
