# Registro de Lecciones y Patrones (Self-Improvement Cycle)

Este documento mantiene un registro de las lecciones aprendidas, correcciones de errores recurrentes y patrones arquitectónicos preferidos para el proyecto Praeventio Guard, siguiendo las directrices de "Orquestación del flujo de trabajo".

## Principios Base Activos
1. **Simplicidad primero:** Cambios mínimos y necesarios.
2. **Causa raíz:** No usar parches temporales.
3. **Verificación:** Probar antes de dar por completado.
4. **Elegancia:** Refactorizar si se siente improvisado, pero sin sobre-ingeniería.

## Lecciones Aprendidas
*(Se actualizará iterativamente tras cada corrección o feedback del usuario)*

### [2026-03-27] - Integración de Computer Vision (EPP)
- **Patrón:** Para el análisis de imágenes con IA (Gemini Vision), es crucial enviar el catálogo completo de elementos esperados (ej. lista de EPP) dentro del prompt. Esto permite que el modelo devuelva nombres exactos o muy similares, facilitando el mapeo posterior a IDs internos del sistema mediante "fuzzy matching".
- **Regla:** Mantener la UI de carga (loading state) sobre la imagen misma con un overlay translúcido mejora la percepción de velocidad y mantiene el contexto visual para el usuario mientras la IA procesa.

### [2026-03-27] - Search Grounding para Generación de Documentos (PTS)
- **Patrón:** Al generar documentos técnicos o normativos con IA (como Procedimientos de Trabajo Seguro), integrar herramientas de búsqueda (ej. `googleSearch` en Gemini) mejora drásticamente la precisión y relevancia de la información.
- **Regla:** Es vital instruir explícitamente al modelo en el prompt para que utilice la herramienta de búsqueda y extraiga datos específicos (ej. manuales de fabricantes, especificaciones técnicas) y que incluya las fuentes consultadas en la respuesta JSON para trazabilidad.
