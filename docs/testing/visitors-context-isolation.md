# Visitors: aislamiento de contexto y mutaciones

Ticket: `3ebaa66d-73fe-814c-80c5-f90cb6751afe`.

## Contrato

`Visitors` solo monta su contenido privado cuando `useFirebase()` expone un usuario y sesión lista. La instancia interna se identifica por `[uid, projectId]`: listas, hooks, formulario, errores y modal de inducción no sobreviven al cambio de actor/proyecto. No hay migración de datos ni borrado de visitas persistidas.

Cada mutación pertenece a su lifecycle real:

- checkout: instancia de la página;
- check-in: instancia del formulario (cerrarlo también invalida);
- acknowledge-induction: instancia del modal (cancelarlo también invalida).

El request captura el UID, tiene `AbortSignal` y verifica vigencia antes de enviar y después de credenciales, respuesta HTTP y lectura del cuerpo. El cleanup es síncrono antes del paint; una implementación de transporte que ignore abort tampoco puede aplicar una respuesta tardía. No se reetiqueta trabajo anterior con credenciales de otra cuenta.

La lista descarta documentos cuyo `projectId` no sea exactamente el activo. El resultado de check-in se valida antes de añadirlo o abrir la inducción. Esto es defensa cliente adicional; `verifyAuth` y `assertProjectMember` siguen siendo la autoridad, sin cambios en servidor ni reglas.

## Pruebas

### Frontend determinista

```
npm run test:ci -- src/pages/Visitors.test.tsx
```

Casos: A→B/403, A→sin proyecto→B/timeout→A, logout, nueva cuenta en el mismo proyecto, cierre de formularios/modales, snapshot y check-in foreign, credenciales tardías para las tres mutaciones, cuerpo tardío y abort por cambio de proyecto, preservación del estado válido actual.

Los contextos y el transporte se sustituyen en esta capa para controlar orden temporal; no es una certificación de JWT o Firestore.

### Integración real con emuladores

`src/rules-tests/visitors-context-roundtrip.test.ts` se ejecuta mediante el comando existente `npm run test:rules` (Auth/Firestore/Storage) o con Auth y Firestore locales y:

```
npm run test:ci -- --config vitest.rules.config.ts src/rules-tests/visitors-context-roundtrip.test.ts
```

No admite skip ni fallback remoto. Usa el formulario/página y `useActiveVisitors` reales, `apiAuthHeader`, SDK Auth con token emulado, `verifyAuth` real sin E2E_MODE, HTTP local, router real, pertenencia real y Firestore/auditoría emulados. Proyecciones de contexto React, roster e inducciones son fixtures explícitos; no se prueba su descubrimiento autónomo.

El recorrido registra A desde la UI, lee la fila persistida desde Admin SDK y desde GET autenticado, rechaza GET sin token/inválido (401), rechaza lectura/escritura del proyecto B ajeno (403), confirma ausencia de escrituras B y conserva A al volver. No hay respuesta HTTP de éxito fabricada.

## Límites

- Abort invalida el consumidor cliente; no revierte una escritura ya aceptada por el servidor. Un request enviado antes del cambio puede haber sido aplicado en su proyecto original; no prometer cancelación remota.
- No cambia idempotencia backend, autorización, firmas ni validez jurídica de la inducción.
- No certifica OAuth productivo, Firestore productivo, recepción física Android/OEM, ni todas las políticas de revocación/cache de la aplicación.
- Los cambios de proyecto preservan el documento persistido y fuerzan lectura nueva; no se reutiliza el array privado de la instancia anterior.
