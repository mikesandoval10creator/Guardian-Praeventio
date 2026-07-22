# Health Vault: acceso soberano para profesionales externos verificados

**Fecha:** 2026-07-21  
**Estado:** implementado y verificado para revisión
**Tarea Notion:** `[P0] Acceso soberano al Health Vault para médico externo verificado`  
**Principio rector:** la información médica pertenece al usuario y lo acompaña entre empresas, proyectos y prestadores. La empresa no hereda acceso clínico y un médico externo no necesita pertenecer al tenant.

## 1. Problema real

El flujo actual crea un QR temporal, pero el endpoint público `GET /api/health-vault/view/:tokenId/:secret` consume el enlace como `Anónimo (vía QR)` y entrega los registros sin demostrar quién mira ni si es profesional de salud. El secreto portador es, por sí solo, la autorización.

Además:

- `isDoctor()` representa un rol laboral global, no una identidad profesional verificable;
- un usuario nuevo siempre nace como `operario` y es enviado al onboarding empresarial;
- el visor público evita login, por lo que no puede vincular una consulta con una persona;
- el alcance `full` permite que registros futuros entren implícitamente en un consentimiento anterior;
- el secreto actual viaja en el path y puede terminar en historiales o logs de infraestructura;
- WebAuthn ya existe, pero demuestra control de una credencial enrolada, no que la persona sea el médico inscrito en un registro público.

## 2. Objetivos

1. Permitir que el usuario comparta registros elegidos con el médico que prefiera, aunque sea externo a su organización.
2. Hacer reutilizable la identidad profesional: un médico ya enrolado y validado sólo inicia sesión, confirma presencia con WebAuthn y abre el QR.
3. Separar identidad profesional de roles de empresa y de membresías de proyecto.
4. Mantener consentimiento explícito, granular, temporal, revocable y demostrable.
5. Proveer un adaptador listo para la API de Prestadores de SuperSalud sin fingir una verificación oficial mientras sólo exista un stub.
6. Crear un embudo profesional ético y medible sin incluir PHI, RUT ni finalidad clínica en analítica.
7. Cerrar la lectura anónima y los permisos clínicos globales directamente relacionados con el Health Vault.

## 3. No objetivos de este PR

- Integrar realmente la API de SuperSalud: requiere una API key y autorización que aún no están disponibles.
- Resolver la portabilidad completa después de una desvinculación laboral. Queda en una tarea Notion separada.
- Corregir en el mismo PR el consentimiento de `portableHistory`; también queda separado.
- Construir publicidad, venta de leads, recomendaciones farmacéuticas o ranking patrocinado de profesionales.
- Permitir que el médico diagnostique, prescriba o modifique registros del paciente desde este visor.
- Convertir al profesional externo en miembro de un tenant o proyecto.

## 4. Decisiones de confianza

### 4.1 Identidad profesional separada

Se crea una entidad server-only `health_professional_identities/{uid}`. No se cambia el rol laboral global del usuario para validar a un médico.

Estados:

- `pending`: inscripción incompleta o esperando revisión;
- `provisional`: identidad revisada por un operador auditado, registro consultado manualmente y WebAuthn enrolado;
- `verified`: identidad y habilitación confirmadas por un proveedor oficial configurado;
- `suspended`: acceso pausado mientras se revisa una inconsistencia;
- `revoked`: identidad profesional invalidada.

El adaptador stub sólo puede responder `unavailable` o `not_configured`. Nunca puede producir `verified`.

### 4.2 Qué demuestra la huella

La huella se usa mediante WebAuthn. Confirma presencia y control de una credencial ya ligada a la cuenta. No es evidencia suficiente de título profesional ni de identidad civil. Por eso:

- `provisional` requiere una revisión humana auditada previa;
- cada acceso clínico exige una aserción WebAuthn reciente con propósito `health_professional_access`;
- el paciente ve claramente si el profesional está `provisional` o `verified`;
- cuando exista SuperSalud, el adaptador oficial podrá elevar `provisional` a `verified` tras contrastar el registro.

### 4.3 Verificación provisional utilizable

Para que el producto sea usable antes de disponer de la API oficial:

1. el profesional completa nombre, RUT, número de registro y profesión;
2. el servidor cifra el RUT y calcula un índice HMAC para unicidad/búsqueda; nunca persiste el RUT en claro;
3. un revisor autorizado consulta manualmente una fuente oficial y realiza la comprobación de identidad definida por el proceso operativo;
4. el sistema registra revisor, fecha, método, referencia de evidencia no sensible y hash de la decisión; no almacena fotografías de cédula;
5. el profesional enrola WebAuthn;
6. el estado pasa a `provisional`, nunca a `verified`.

La aprobación provisional no concede acceso global. Sólo habilita al profesional para aceptar una autorización individual de un paciente.

## 5. Modelo de datos

### 5.1 `HealthProfessionalIdentity`

Campos principales:

- `uid`
- `profession: 'physician'`
- `country: 'CL'`
- `displayName`
- `registryAuthority: 'superintendencia_salud_cl'`
- `registryNumber`
- `rutCiphertext` y metadatos de envelope encryption
- `rutLookupHmac`
- `status`
- `identityAssurance`: método, fecha, revisor y nivel
- `registryAssurance`: proveedor, estado, fecha de consulta y próxima revalidación
- `webauthnRequired: true`
- `createdAt`, `updatedAt`, `suspendedAt`, `revokedAt`

La colección no es legible ni escribible por Firestore Client SDK. Los clientes consumen DTO mínimos desde endpoints server-side.

### 5.2 Perfil público mínimo

La búsqueda que usa el paciente devuelve únicamente:

- UID profesional opaco;
- nombre validado;
- profesión;
- número de registro;
- estado `provisional` o `verified`;
- especialidades sólo cuando su procedencia esté declarada.

No devuelve RUT, email, empresa, pacientes, cantidad de consultas ni datos de salud.

### 5.3 `HealthAccessGrant`

La evolución versionada de `VaultShareToken` conserva compatibilidad estructural, pero agrega:

- `version: 2`
- `ownerUid`
- `recipientProfessionalUid` o estado `awaiting_recipient_confirmation`
- `purpose` enumerado y mostrado sólo dentro del consentimiento, no en analítica
- `resourceIds`: snapshot explícito de IDs autorizados
- `consentTextVersion` y `consentTextHash`
- `consentedAt`
- `status: pending | active | revoked | expired`
- `tokenHash`; el secreto crudo nunca se persiste
- `expiresAt`, `maxSessions`, `sessionCount`
- historial mínimo de accesos con UID profesional, estado de credencial y timestamps

Los helpers de UI `full`, `recent` y `topic` permanecen, pero el servidor los resuelve a `resourceIds` al crear el grant. Un registro agregado después no se comparte automáticamente.

### 5.4 Sesión de acceso efímera

Después de validar QR, identidad, WebAuthn y consentimiento, el servidor emite una sesión opaca de vida corta:

- ligada al grant y al UID profesional;
- almacenada sólo como hash;
- mantenida en memoria por el visor, no en `localStorage`;
- revalidada para cada descarga;
- invalidada inmediatamente por revocación del grant o de la identidad profesional.

## 6. Flujos de usuario

### 6.1 Médico ya validado y preseleccionado

1. El paciente busca y selecciona al profesional.
2. Selecciona registros y duración; la aplicación muestra el consentimiento exacto.
3. El servidor crea un grant ligado al UID profesional.
4. El QR usa `/vault/share/:tokenId#secret`; el fragmento no viaja al servidor durante la carga inicial.
5. El médico escanea. Si no tiene sesión, inicia sesión y vuelve al mismo flujo.
6. WebAuthn confirma presencia.
7. El servidor contrasta destinatario, estado profesional, consentimiento, expiración y secreto.
8. Se crea una sesión efímera y el visor muestra sólo los recursos congelados en el grant.

No hay registro profesional repetido.

### 6.2 Profesional nuevo

1. El paciente genera una invitación sin liberar información.
2. El profesional escanea, inicia sesión y completa onboarding profesional, no empresarial.
3. Mientras esté `pending`, el visor muestra un estado humano y no entrega metadatos clínicos.
4. Tras revisión provisional y enrolamiento WebAuthn, el paciente ve la identidad oficial/provisional presentada.
5. El paciente confirma al destinatario; el grant queda ligado de forma atómica.
6. El profesional realiza WebAuthn y accede.

### 6.3 QR robado o médico incorrecto

- Una persona no autenticada no recibe datos.
- Un usuario no profesional no recibe datos.
- Otro médico válido no puede consumir un grant preligado.
- En una invitación abierta, el primer profesional sólo crea una solicitud; no recibe datos hasta la confirmación del paciente.
- Reintentos, carreras y doble confirmación se resuelven transaccionalmente.

### 6.4 Revocación

El paciente puede revocar en cualquier momento. La siguiente petición del visor o archivo falla con un mensaje humano. Ninguna URL de archivo sigue funcionando después de la revocación.

## 7. API y componentes

### 7.1 Proveedor de registro

Interfaz `ProfessionalRegistryProvider`:

- `verifyPhysician(input)`
- respuestas cerradas: `verified`, `not_found`, `mismatch`, `unavailable`, `not_configured`
- timeout, circuit breaker y logging sin RUT

Implementaciones:

- `StubProfessionalRegistryProvider`: default inicial; nunca devuelve `verified`;
- futuro `SuperSaludProfessionalRegistryProvider`: usa API key server-side y transforma la respuesta oficial al contrato interno.

### 7.2 Endpoints profesionales

- `POST /api/health-professionals/enroll`
- `GET /api/health-professionals/me`
- `GET /api/health-professionals/search`
- `POST /api/health-professionals/review/:uid` — sólo revisor autorizado y auditado
- `POST /api/health-professionals/revalidate/:uid`

### 7.3 Endpoints de grant

- `POST /api/health-vault/share` — sólo titular; crea v2
- `POST /api/health-vault/share/:id/confirm-recipient` — sólo titular
- `POST /api/health-vault/view/:id/claim` — autenticado; secreto en body tras extraerlo del fragmento
- `POST /api/health-vault/view/:id/session` — exige WebAuthn reciente
- `GET /api/health-vault/view/:id/records` — sesión efímera + Firebase auth
- `GET /api/health-vault/view/:id/file/:recordId` — mismo control y revalidación
- `POST /api/health-vault/share/:id/revoke` — sólo titular

El endpoint público antiguo deja de devolver datos. Para shares v1 muestra una explicación y solicita al titular generar un enlace seguro nuevo.

### 7.4 UI

- `HealthVaultShare`: selector de profesional, estado de verificación, selección explícita de registros, finalidad, duración y resumen de consentimiento.
- `HealthVaultViewer`: estados `login_required`, `professional_enrollment`, `verification_pending`, `recipient_confirmation_pending`, `webauthn_required`, `authorized` y errores humanos.
- onboarding profesional liviano accesible desde el QR.
- cola mínima de revisión para operador autorizado.
- historial del paciente con profesional, estado de verificación, fecha, recursos contados y revocación; nunca contenido clínico en el resumen.

## 8. Enrutado y onboarding

El QR conserva el destino durante login. `/vault/share/...` queda excluido del redirect automático al onboarding empresarial. Esta excepción no marca `onboarded=true` ni crea tenant/proyecto.

La identidad profesional vive en su propio flujo. Un médico puede ser también trabajador o miembro de proyectos, pero ambas capacidades permanecen independientes.

## 9. Firestore y autorización

- `health_professional_identities`: deny client read/write.
- `health_vault_shares`: sólo titular puede leer resúmenes; escritura server-only.
- `health_vault`: titular mantiene sus operaciones permitidas; el profesional nunca obtiene lectura directa.
- el rol global `isDoctor()` deja de conceder lectura de Health Vault, shares y colecciones médicas personales cubiertas por este flujo.
- el servidor usa el grant para mediar accesos profesionales.
- datos tenant-scoped como SUSESO, ubicación y telemetría no se incluyen en este PR y siguen sus tareas separadas de aislamiento.

## 10. Cifrado, privacidad y minimización

- RUT cifrado con el adaptador KMS existente y lookup por HMAC con clave separada.
- secretos QR almacenados como hash con comparación constant-time.
- ningún secreto en query string; los nuevos QR usan fragmento.
- `Cache-Control: no-store`, CSP y `Referrer-Policy: no-referrer` en el visor.
- archivos obtenidos mediante `fetch` autenticado y convertidos a object URL temporal; no se exponen rutas de Storage.
- Sentry, logger, audit y analytics usan IDs opacos y códigos cerrados; nunca RUT, nombres de documentos, tags, diagnósticos, medicamentos ni finalidad clínica.
- la lista de profesionales no se ordena por patrocinio ni por información de salud del paciente.

## 11. Embudo profesional ético

Eventos sugeridos, sin PHI:

- `health.professional.onboarding_started`
- `health.professional.onboarding_completed`
- `health.professional.verification_pending`
- `health.professional.provisional_approved`
- `health.professional.officially_verified`
- `health.share.recipient_confirmed`
- `health.share.session_started`

Propiedades permitidas: país, tipo de estado, canal `qr|directory`, duración en bucket y códigos de error cerrados. Quedan prohibidos UID crudo, RUT, especialidad consultada, propósito clínico, record IDs y datos del paciente.

## 12. Errores y disponibilidad

- Provider stub o SuperSalud no disponible: no se concede estado `verified`.
- KMS/HMAC no disponible: el enrolamiento falla cerrado y explica que la verificación no pudo completarse.
- WebAuthn no soportado: no se libera información clínica; se ofrece continuar desde un dispositivo compatible.
- identidad suspendida/revocada: toda sesión se invalida.
- share expirado/revocado: mensaje humano, no `403` crudo.
- auditoría secundaria caída: el acceso clínico falla cerrado si no puede registrarse la decisión crítica.

## 13. Migración y compatibilidad

- agregar `version: 2` sin borrar tipos o helpers existentes;
- shares v1 permanecen visibles y revocables para el titular;
- un share v1 no puede revelar datos anónimamente después del despliegue;
- la UI explica cómo emitir un share v2;
- no se migran automáticamente destinatarios ni consentimientos porque eso inventaría voluntad del usuario.

## 14. Estrategia de pruebas

### Unitarias

- máquina de estados de identidad profesional;
- proveedor stub incapaz de producir `verified`;
- cifrado/HMAC y redacción;
- grant v2 y snapshot de recursos;
- revocación, expiración, receptor y WebAuthn.

### Rutas

- titular crea y confirma;
- admin/empresa no consienten;
- médico externo provisional/verified accede sin tenant;
- no profesional, médico distinto, QR robado y credencial suspendida fallan;
- carreras de claim/confirmación son atómicas;
- cada archivo revalida;
- logs y auditoría no contienen PHI.

### Firestore Rules

- dos empresas hostiles y dos profesionales;
- ningún profesional lee directamente los documentos de otro usuario;
- sólo titular ve sus resúmenes;
- colecciones server-only niegan todo Client SDK.

### UI

- retorno post-login al QR;
- médico existente no repite onboarding;
- profesional nuevo ve flujo pendiente;
- paciente distingue provisional de oficial;
- todos los errores son explicativos.

### E2E mínimo

1. paciente selecciona médico provisional;
2. crea QR con dos registros;
3. médico externo inicia sesión y completa WebAuthn;
4. ve exactamente esos dos registros;
5. paciente revoca;
6. siguiente lectura y archivo quedan bloqueados;
7. médico nunca entra al proyecto del paciente.

## 15. Criterios de aceptación

- Ninguna ruta anónima entrega datos o metadatos médicos.
- Un médico externo validado accede sin pertenecer a la empresa.
- Un médico existente no vuelve a registrarse.
- El stub oficial nunca afirma verificación oficial.
- La huella es obligatoria para cada sesión clínica y se describe correctamente como prueba de presencia/posesión.
- Sólo el titular crea, liga, amplía o revoca el consentimiento.
- Los recursos compartidos quedan congelados al consentir.
- Revocación efectiva en registros y archivos.
- Cero PHI/RUT en analytics, logs y auditoría.
- Tests unitarios, rutas, reglas, UI, typecheck y ratchets verdes antes del PR.

## 16. Tareas posteriores registradas

- `[P0][privacidad] Consentimiento de historial portable exclusivo del titular`.
- `[P1] Pasaporte personal de seguridad laboral portable tras desvinculación`.

Estas tareas preservarán las capacidades, capacitaciones, certificaciones y experiencia del usuario, pero retirarán inmediatamente su acceso a proyectos y datos operacionales de la empresa anterior.

## 17. Evidencia de implementación

- 312 pruebas focalizadas verdes en 25 archivos: dominio, cifrado, WebAuthn, rutas legacy/v2, UI, analítica, rotación HMAC y carreras transaccionales.
- 102 pruebas verdes con emuladores de Firestore/Storage en las suites de privacidad afectadas. Dos corridas globales no reportaron fallos de aserción, pero un worker local de Vitest terminó por recursos tras 749/757 y 751/757; GitHub CI queda como autoridad para la corrida global única.
- `typecheck:ci`, `lint:connectivity`, `lint:rules`, `lint:router-tests`, `lint:user-facing-errors`, `lint:api-index` y `npm run build` terminaron con código 0.
- Catálogo y manifiesto de analítica alineados en 53 eventos; la allowlist del embudo elimina identificadores y contexto clínico en runtime.
- Rotación HMAC operable: bootstrap no imprimible, preflight de forma/fuerza, reindexación por lotes reanudable y escritura atómica de identidad+índices+auditoría.
- Graphify reconstruido: 29.167 nodos, 59.067 aristas y 1.245 comunidades.
- Revisión independiente final: APPROVED, sin hallazgos Critical, Important ni Minor pendientes.
