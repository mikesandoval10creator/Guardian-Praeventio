import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    { kind: "loading" | "unavailable" } | { kind: "resolved"; capture: SplatCapture | null }
  >({ kind: "loading" });
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribePreferredSplatCapture(
      tenantId,
      projectId,
      (next) => {
        if (active) setState({ kind: "resolved", capture: next });
      },
      () => {
        if (!active) return;
        // Firestore listener errors are terminal; ignore the store's subsequent null.
        active = false;
        setState({ kind: "unavailable" });
        logger.warn("splat_capture_subscription_error");
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [tenantId, projectId, attempt]);

  if (state.kind === "resolved") return <GaussianSplatViewer capture={state.capture} />;
  return (
    <section className="rounded-2xl border border-default-token bg-surface p-4 text-sm text-secondary-token">
      {state.kind === "loading" ? (
        <p role="status">{t("digitalTwin.captureLoading", "Consultando la captura 3D…")}</p>
      ) : (
        <>
          <p role="alert">{t("digitalTwin.captureUnavailable", "No se pudo consultar la captura 3D.")}</p>
          <button
            type="button"
            className="mt-2 rounded-md border border-default-token px-3 py-1.5 font-semibold"
            onClick={() => {
              setState({ kind: "loading" });
              setAttempt((current) => current + 1);
            }}
          >
            {t("digitalTwin.captureRetry", "Reintentar")}
          </button>
        </>
      )}
    </section>
  );
}
