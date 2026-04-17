import { useState, useCallback } from 'react';

/**
 * Hook para prevenir el doble envío de formularios o acciones críticas.
 * Deshabilita el botón/acción mientras la promesa se está resolviendo.
 */
export function useSubmit<T>(submitFunction: (...args: any[]) => Promise<T>) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (...args: any[]) => {
      if (isSubmitting) return; // Prevenir doble ejecución

      setIsSubmitting(true);
      try {
        await submitFunction(...args);
      } finally {
        setIsSubmitting(false);
      }
    },
    [submitFunction, isSubmitting]
  );

  return { isSubmitting, handleSubmit };
}
