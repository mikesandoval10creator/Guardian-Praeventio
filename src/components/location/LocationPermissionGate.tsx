// Praeventio Guard — gate de divulgación de ubicación (montaje global).
//
// Componente sin render visible: orquesta el modal de divulgación prominente
// y el prompt de permiso de ubicación del SO. Se monta junto a
// GeolocationTracker en AppRoutes, ANTES que cualquier request de ubicación
// pueda ocurrir.

import React from 'react';
import { useLocationPermissionGate } from '../../hooks/useLocationPermissionGate';
import { LocationDisclosureModal } from './LocationDisclosureModal';

export const LocationPermissionGate: React.FC = () => {
  const { open, accept, dismiss } = useLocationPermissionGate();

  return (
    <LocationDisclosureModal open={open} onAccept={accept} onDismiss={dismiss} />
  );
};
