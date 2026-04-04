# Plan: Generador de PTS con Búsqueda de Manuales de Fabricante (Google Search Grounding)

## Objetivo
Mejorar la generación de Procedimientos de Trabajo Seguro (PTS) integrando información real y actualizada de los manuales de los fabricantes de las herramientas o maquinarias utilizadas, utilizando la capacidad de "Google Search Grounding" de Gemini.

## Pasos
1. **Servicio IA (`geminiService.ts`)**: Crear función `generatePTSWithManufacturerData(taskName, machineryList, context)` que utilice la herramienta `googleSearch: {}`. El prompt instruirá a Gemini a buscar específicamente manuales, fichas técnicas y recomendaciones de seguridad del fabricante para la maquinaria listada.
2. **Componente UI (`PTSGenerator.tsx`)**: 
   - Añadir un campo de entrada para "Herramientas y Maquinaria a utilizar" (ej. "Taladro percutor Bosch GSB 18V", "Retroexcavadora Caterpillar 320").
   - Mostrar las fuentes (URLs) utilizadas por Gemini para generar el PTS, dando trazabilidad a la información del fabricante.
3. **Lecciones Aprendidas (`lessons.md`)**: Registrar el uso de Search Grounding para enriquecer documentos legales/técnicos con datos de fabricantes en tiempo real.
