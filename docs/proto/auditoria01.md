> Documento recuperado del prototipo `Guardian-Praeventio-f-irebaseversion` y sanitizado al 2026-05-03. Conservado por valor histórico y de referencia arquitectónica.

# **INFORME DE ESTADO ABSOLUTO DEL SISTEMA — AUDITORÍA 01**

**Objetivo:** Generar un mapeo exhaustivo entre el `feature set` proporcionado por Daho Sandoval y la evidencia técnica verificada, y registrar las mejoras implementadas durante la auditoría activa. Este documento sirve como fuente histórica del estado del sistema. Originalmente concebido en 2025.

---

## **ESTADO DE LA ARQUITECTURA (Resumen Ejecutivo)**

Tras una revisión y refactorización exhaustiva, se determinó que las principales disonancias arquitectónicas habían sido resueltas o eran falsos positivos.

1.  **ARQUITECTURA DE DATOS DUAL:**
    *   **ESTADO ANTERIOR:** Crítico.
    *   **ESTADO ACTUAL:** ✅ **RESUELTO.**
    *   **ANÁLISIS:** Refactorización masiva. Todos los hooks de acceso a datos (`useWorkers`, `useEPPTracking`, etc.) fueron migrados para consumir una capa de servicio unificada en `src/lib/firestore-utils.ts` (Firebase/Firestore — current stack). El acceso directo a la base de datos desde la capa de UI fue eliminado.

2.  **VIOLACIÓN DEL SINGLETON DE AUTENTICACIÓN:**
    *   **ESTADO ANTERIOR:** Pendiente.
    *   **ESTADO ACTUAL:** ✅ **RESUELTO (FALSO POSITIVO).**
    *   **ANÁLISIS:** Una inspección detallada de `src/lib/api-utils.ts` reveló que ya utilizaba la instancia singleton de `auth`. No existía ninguna violación.

**CONCLUSIÓN ARQUITECTÓNICA:** La base de código se encontraba en un estado **altamente coherente y robusto**. Las principales deudas técnicas identificadas habían sido saldadas.

---

## **REGISTRO DE AUDITORÍA Y MEJORAS IMPLEMENTADAS**

### Fase 1: Consolidación de la Arquitectura de Datos y Permisos

*   **1.1. Refactorización del Acceso a Datos:** Se centralizó toda la lógica de acceso a Firestore en `src/lib/firestore-utils.ts` (Firebase/Firestore — current stack), unificando la capa de datos.
*   **1.2. Descubrimiento y Validación del RBAC dual-layer:**
    *   **Hallazgo:** Se localizó `src/contexts/AuthContext.tsx`, confirmando que el RBAC se implementa mediante **Custom Claims de Firebase Authentication** (capa de identidad) complementadas por permisos a nivel de proyecto (capa de tenancy), no a través de perfiles en Firestore.
    *   **Acción:** Se actualizó este informe para reflejar el estado real del sistema de permisos, marcando la funcionalidad de RBAC como ✅ **Confirmada y Verificada**.
*   **1.3. Implementación de Gestión de Roles:**
    *   **Backend:** Se creó la Cloud Function `setUserRole` (`cloud-functions/src/users.ts`) para permitir a los administradores modificar los Custom Claims de forma segura.
    *   **Frontend:** Se integró la funcionalidad en `src/components/admin/UserManagement.tsx`, añadiendo un selector de roles en la interfaz de usuario.
    *   **Resultado:** Se entregó una funcionalidad de gestión de usuarios completa y segura.

### Fase 2: Innovación de Funcionalidades con IA

*   **2.1. Sistema de Rutas de Evacuación Dinámicas:**
    *   **Hallazgo:** Las rutas de evacuación eran estáticas y predefinidas.
    *   **Backend:** Se creó la Cloud Function `generateDynamicRoute` (`cloud-functions/src/dynamic-routes.ts`) utilizando Vertex AI (Gemini, vía El Gran Maestro via /api/ask-guardian) para generar rutas de evacuación en tiempo real basadas en la ubicación, tipo de evento y clima.
    *   **Frontend:** Se rediseñó `src/components/evacuation/EmergencyEvacuationSystem.tsx` para invocar a la IA y mostrar al usuario una ruta inteligente y contextual.
    *   **Resultado:** Funcionalidad estática transformada en sistema de inteligencia activa para emergencias.

---

## **MAPEO DE FUNCIONALIDADES VS. EVIDENCIA TÉCNICA (Estado Actualizado)**

#### **Authentication & Security**

*   **Feature:** Firebase Authentication completa
    *   **Estado:** ✅ **Confirmado**

*   **Feature:** Role-based Access Control (RBAC) dual-layer
    *   **Estado:** ✅ **Confirmado y Verificado**
    *   **Evidencia:** `src/contexts/AuthContext.tsx` (lectura de Custom Claims), `cloud-functions/src/users.ts` (escritura de Custom Claims), `src/components/admin/UserManagement.tsx` (UI de gestión).
    *   **Análisis:** El sistema RBAC basado en Custom Claims más permisos por proyecto está completamente implementado y es gestionable desde la aplicación.

#### **Emergency & Safety**

*   **Feature:** Emergency Systems & Advanced alert mechanisms
    *   **Estado:** ✅ **Confirmado y Mejorado**
    *   **Evidencia:** `cloud-functions/src/dynamic-routes.ts`, `src/components/evacuation/EmergencyEvacuationSystem.tsx`.
    *   **Análisis:** El sistema de emergencias fue mejorado con la adición de rutas de evacuación dinámicas generadas por IA, superando la funcionalidad original.

(...El resto del mapeo de funcionalidades permanece sin cambios respecto al sistema vigente, ya que las mejoras se centraron en las áreas mencionadas...)

---

Este documento representa la verdad del estado del sistema en su momento de redacción, basada en la evidencia recopilada y las acciones ejecutadas. Es un mapa histórico que conserva el rationale arquitectónico clave: capa de servicio unificada, RBAC dual-layer vía Custom Claims, El Gran Maestro como núcleo cognitivo, y normativa chilena como dominio canónico.
