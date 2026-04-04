import React, { createContext, useContext, useState, useEffect } from 'react';

interface EmergencyContextType {
  isEmergencyActive: boolean;
  emergencyType: string | null;
  triggerEmergency: (type: string) => void;
  resolveEmergency: () => void;
}

const EmergencyContext = createContext<EmergencyContextType | undefined>(undefined);

export function EmergencyProvider({ children }: { children: React.ReactNode }) {
  const [isEmergencyActive, setIsEmergencyActive] = useState(false);
  const [emergencyType, setEmergencyType] = useState<string | null>(null);

  const triggerEmergency = (type: string) => {
    setEmergencyType(type);
    setIsEmergencyActive(true);
  };

  const resolveEmergency = () => {
    setIsEmergencyActive(false);
    setEmergencyType(null);
  };

  return (
    <EmergencyContext.Provider value={{ isEmergencyActive, emergencyType, triggerEmergency, resolveEmergency }}>
      {children}
    </EmergencyContext.Provider>
  );
}

export function useEmergency() {
  const context = useContext(EmergencyContext);
  if (context === undefined) {
    throw new Error('useEmergency must be used within an EmergencyProvider');
  }
  return context;
}
