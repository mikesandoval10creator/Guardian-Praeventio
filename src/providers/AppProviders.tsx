import React, { ReactNode } from 'react';
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
import { SLMShellOverlay } from "../components/slm/SLMShellOverlay";

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
      <UniversalKnowledgeProvider>
        <ProjectProvider>
          <SubscriptionProvider>
            <NotificationProvider>
              <EmergencyProvider>
                <SensorProvider>
                  <SLMProvider>
                    <SLMShellOverlay />
                    {children}
                  </SLMProvider>
                </SensorProvider>
              </EmergencyProvider>
            </NotificationProvider>
          </SubscriptionProvider>
        </ProjectProvider>
      </UniversalKnowledgeProvider>
      </NormativeProvider>
    </ThemeProvider>
    </AppModeProvider>
  );
}
