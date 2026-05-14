import React, { lazy, Suspense, type ReactNode } from 'react';
import { UniversalKnowledgeProvider } from "../contexts/UniversalKnowledgeContext";
import { ProjectProvider } from "../contexts/ProjectContext";
import { SubscriptionProvider } from "../contexts/SubscriptionContext";
import { NotificationProvider } from "../contexts/NotificationContext";
import { EmergencyProvider } from "../contexts/EmergencyContext";
import { SensorProvider } from "../contexts/SensorContext";
import { ThemeProvider } from "../contexts/ThemeContext";
import { AppModeProvider } from "../contexts/AppModeContext";
import { NormativeProvider } from "../contexts/NormativeContext";
import { SLMProvider } from "../components/slm/SLMProvider";
import { MeshProvider } from "./MeshProvider";

// Sprint 54 perf — `<SLMShellOverlay>` only renders content when the
// device is offline (the banner). Eager-importing it pulled framer-motion
// + AppModeContext consumers + OfflineSLMBanner into the cold-start
// chunk for zero visual cost when online (which is most of the time).
// Lazy-load + Suspense with `null` fallback so when online the overlay
// is literally absent from the DOM and downloads only the first time
// the device goes offline.
const SLMShellOverlayLazy = lazy(() =>
  import('../components/slm/SLMShellOverlay').then((m) => ({
    default: m.SLMShellOverlay,
  })),
);

// Sprint 54 ext — primer-launch SLM acquisition prompt (#218). El
// componente se monta DENTRO de `<SLMProvider>` para compartir el
// estado de IA, y se descarga lazy porque solo aparece cuando el
// usuario no tiene el modelo ni pre-empaquetado ni en cache. Para
// el 99% de los launches (modelo ya descargado o pre-empaquetado)
// este chunk no se baja jamás.
const SlmAcquisitionPromptHostLazy = lazy(() =>
  import('../components/slm/SlmAcquisitionPromptHost').then((m) => ({
    default: m.SlmAcquisitionPromptHost,
  })),
);

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  // Provider order matters here.
  //
  // `UniversalKnowledgeProvider` was previously the outermost provider, but
  // Round 14 added a `where('projectId','==', selectedProject.id)` filter
  // to its `nodes` subscription so we no longer load every node the user
  // can read across every project (which scaled poorly and leaked
  // cross-project data into the global graph). The filter requires
  // `useProject()`, which means `ProjectProvider` must wrap
  // `UniversalKnowledgeProvider`. Reordering is safe because no other
  // provider in this chain consumes `useUniversalKnowledge()` upstream of
  // it — verified by `grep -r useUniversalKnowledge src/` against the
  // ancestor providers below.
  //
  // Sprint 20 — Bucket Nu: `SLMProvider` is mounted inside `AppModeProvider`
  // because `<SLMShellOverlay>` consumes both contexts to pick the
  // banner's visual mode. Position is innermost above `SensorProvider`
  // so consumers of every other context (theme, project, etc.) can
  // also reach the SLM state.
  return (
    <AppModeProvider>
      <ThemeProvider>
        <NormativeProvider>
          <ProjectProvider>
            <UniversalKnowledgeProvider>
              <SubscriptionProvider>
                <NotificationProvider>
                  <EmergencyProvider>
                    <SensorProvider>
                      <SLMProvider>
                        <Suspense fallback={null}>
                          <SLMShellOverlayLazy />
                        </Suspense>
                        <Suspense fallback={null}>
                          <SlmAcquisitionPromptHostLazy />
                        </Suspense>
                        {/* Sprint 35 — closes ADR-0013 last-mile (Sprint 33 D3).
                            Mounted inside ProjectProvider + FirebaseProvider so
                            useFirebase() + useProject() resolve. Early-returns
                            until uid + projectId are available. Flow Infinito
                            Fase 2 (Adaptive Response) requires this wire live. */}
                        <MeshProvider>
                          {children}
                        </MeshProvider>
                      </SLMProvider>
                    </SensorProvider>
                  </EmergencyProvider>
                </NotificationProvider>
              </SubscriptionProvider>
            </UniversalKnowledgeProvider>
          </ProjectProvider>
        </NormativeProvider>
      </ThemeProvider>
    </AppModeProvider>
  );
}
