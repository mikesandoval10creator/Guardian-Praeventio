import React from 'react';
import { useGeolocationTracking } from '../hooks/useGeolocationTracking';

export const GeolocationTracker: React.FC = () => {
  // This hook runs the tracking logic in the background based on project shifts
  useGeolocationTracking();
  
  // It renders nothing, just manages the side effects
  return null;
};
