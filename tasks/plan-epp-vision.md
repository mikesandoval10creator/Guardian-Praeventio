# Plan: Módulo de Inspección Visual de EPP con IA

## Objetivo
Implementar una funcionalidad que permita escanear a un trabajador usando la cámara o subiendo una foto para detectar automáticamente qué Elementos de Protección Personal (EPP) está utilizando, usando Gemini Vision.

## Pasos
1. **Servicio IA (`geminiService.ts`)**: Crear función `detectEPPWithVision(base64Image)` que instruya a Gemini a identificar EPP específicos (casco, gafas, chaleco, guantes, zapatos) y devuelva un JSON estructurado.
2. **Componente UI (`AIEPPScannerModal.tsx`)**: Crear un modal con interfaz futurista (estilo Praeventio) que permita:
   - Subir imagen/Tomar foto.
   - Mostrar estado de carga ("Analizando con Gemini Vision...").
   - Mostrar resultados (EPP detectado vs faltante).
   - Botón para "Aplicar" los EPP detectados a la lista de asignación.
3. **Integración (`EPPModal.tsx`)**: Añadir un botón prominente "Escanear con IA" que abra el nuevo modal. Recibir los EPP detectados y actualizar el estado `assignedEppIds`.
