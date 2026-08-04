// Praeventio Guard — hook del portón de divulgación de ubicación.
//
// Coordina la divulgación prominente (requisito Play para
// ACCESS_BACKGROUND_LOCATION) con el resto de la app:
//   - En montaje, si estamos en plataforma nativa, el permiso NO está
//     concedido y el usuario aún no aceptó la divulgación → abre el modal.
//   - `accept()` persiste el consentimiento y recién ahí dispara el prompt
//     del sistema operativo (la divulgación SIEMPRE precede al prompt).
//   - `dismiss()` cierra el modal sin pedir permiso; el candado del servicio
//     (canRequestLocationPermission) sigue bloqueando los requests de otros
//     consumidores (useGeolocationTracking) hasta que la divulgación se
//     acepte.

import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { logger } from '../utils/logger';
import {
  isLocationDisclosureAcknowledged,
  acknowledgeLocationDisclosure,
} from '../services/location/locationPermissionRequest';

export interface LocationPermissionGateState {
  /** True cuando el modal de divulgación debe mostrarse. */
  open: boolean;
  /** Acepta la divulgación y dispara el prompt del SO. */
  accept: () => Promise<void>;
  /** Cierra el modal sin pedir el permiso. */
  dismiss: () => void;
}

export function useLocationPermissionGate(): LocationPermissionGateState {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    let disposed = false;
    (async () => {
      try {
        const perms = await Geolocation.checkPermissions();
        if (disposed) return;
        // Ya concedido: nada que divulgar ni pedir.
        if (perms.location === 'granted') return;
        if (!isLocationDisclosureAcknowledged()) {
          setOpen(true);
        }
      } catch (error) {
        // No consultable (plugin ausente): no interrumpir; el hook de
        // tracking mantiene su candado por seguridad.
        logger.warn('Location permission check failed:', error);
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  const accept = useCallback(async () => {
    // 1) Persistir la divulgación vista.
    acknowledgeLocationDisclosure();
    setOpen(false);
    // 2) Recién ahora se puede pedir el permiso al SO.
    try {
      await Geolocation.requestPermissions();
    } catch (error) {
      logger.warn('Location permission request failed:', error);
    }
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
  }, []);

  return { open, accept, dismiss };
}
