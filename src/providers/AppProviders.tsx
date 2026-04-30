import React, { ReactNode } from 'react';
import { UniversalKnowledgeProvider } from "../contexts/UniversalKnowledgeContext";
import { ProjectProvider } from "../contexts/ProjectContext";
import { SubscriptionProvider } from "../contexts/SubscriptionContext";
import { NotificationProvider } from "../contexts/NotificationContext";
import { EmergencyProvider } from "../contexts/EmergencyContext";
import { SensorProvider } from "../contexts/SensorContext";
import { ThemeProvider } from "../contexts/ThemeContext";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ThemeProvider>
      <UniversalKnowledgeProvider>
        <ProjectProvider>
          <SubscriptionProvider>
            <NotificationProvider>
              <EmergencyProvider>
                <SensorProvider>
                  {children}
                </SensorProvider>
              </EmergencyProvider>
            </NotificationProvider>
          </SubscriptionProvider>
        </ProjectProvider>
      </UniversalKnowledgeProvider>
    </ThemeProvider>
  );
}
