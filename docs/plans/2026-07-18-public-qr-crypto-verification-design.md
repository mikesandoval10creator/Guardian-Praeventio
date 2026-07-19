# Verificación criptográfica pública de firmas regulatorias

## Problema

El flujo de firma incorporado en #1272 vincula las firmas nuevas de SUSESO,
DS-67 y DS-76 al documento exacto. Sin embargo, el lector público de SUSESO
no consume esa evidencia: `verifyFolio()` declara `valid: true` cuando existe
`form.signature`, aunque el PDF, el contexto o la firma estén manipulados.

Graphify confirma la separación: `verifyFolio()` solo depende del parser de
folios y del store. No tiene aristas hacia el renderer determinista, el intent
WebAuthn, las credenciales registradas ni Cloud KMS.

## Decisión

Se implementará verificación archivística fail-closed. `valid: true` significará
exclusivamente que el servidor reconstruyó el documento y comprobó la firma
criptográfica. La respuesta distinguirá tres estados:

- `verified`: documento y firma comprobados;
- `invalid`: evidencia presente pero manipulada o criptográficamente falsa;
- `unverifiable`: evidencia antigua o dependencia histórica insuficiente.

Una passkey revocada o una clave KMS rotada no invalidará firmas emitidas antes
de la revocación. Las firmas nuevas persistirán la clave pública verificada en
una evidencia autocontenida v2. Las firmas v1 intentarán resolver su clave por
el registro histórico actual; si no existe, se declararán no verificables.

## Alternativas descartadas

1. **Confiar en `verificationVersion: 1`.** Es rápida, pero solo prueba que el
   servidor verificó algo al firmar; no detecta una mutación posterior del PDF
   ni una firma fabricada en Firestore.
2. **Resolver siempre la clave viva.** Permite verificar hoy, pero revocar una
   passkey o destruir una versión KMS rompe para siempre documentos históricos.
3. **Re-firmar evidencia antigua.** Cambiaría el hecho jurídico original y
   violaría la inmutabilidad. La evidencia antigua debe conservarse y describirse
   honestamente como no verificable.

## Evidencia v2

`ComplianceSignatureAuditFields` admitirá `verificationVersion: 1 | 2` y una
unión discriminada `verificationKey`:

```ts
type ComplianceVerificationKey =
  | {
      kind: 'webauthn-cose';
      credentialId: string;
      publicKeyB64: string;
      origin: string;
      rpId: string;
    }
  | {
      kind: 'kms-rsa-pem';
      keyVersion: string;
      publicKeyPem: string;
    };
```

WebAuthn capturará la clave COSE, origin y RP ID que ya fueron verificados por
SimpleWebAuthn. KMS persistirá el PEM devuelto para la versión exacta que produjo
la firma. Son claves públicas, nunca material secreto.

## Verificador compartido

Un servicio server-only recibirá documento, contexto autoritativo, firma y
resolvers de compatibilidad v1. Para WebAuthn:

1. valida evidencia y contexto completo;
2. deriva nuevamente el challenge canónico del intent;
3. valida `clientDataJSON` (`type`, challenge y origin);
4. valida RP hash y flags UP/UV de `authenticatorData`;
5. comprueba dueño de credencial para evidencia v1;
6. verifica la firma sobre `authenticatorData || SHA-256(clientDataJSON)` con
   la clave COSE.

No vuelve a aplicar el contador WebAuthn: el contador evita replay al emitir y
ya fue actualizado allí. Una verificación histórica no es una autenticación
nueva y nunca debe mutar ese contador.

Para KMS valida el contexto completo y ejecuta RSA-PSS SHA-256 sobre los bytes
exactos del PDF usando el PEM persistido o, para v1, el PEM de la versión
histórica resuelta.

## Integración SUSESO

`findFormByFolio` devolverá también el ID real del documento. `verifyFolio()`:

1. conserva los resultados actuales para folio malformado, desconocido o sin
   firma;
2. reconstruye el PDF sin firma mediante renderer v1;
3. compara renderer, hash almacenado, hash firmado y contexto;
4. delega la comprobación criptográfica;
5. expone solo tipo, fecha y RUT del firmante cuando el resultado sea verified.

No se expondrán datos del trabajador, contenido clínico, assertions, claves ni
PDF. Los fallos internos usarán razones estables y no mensajes de máquina.

## Endurecimiento de servicios y tests

Los `signForm()` de SUSESO, DS-67 y DS-76 rechazarán evidencia legacy o cuyo
contexto/hash no coincida con el formulario. Los tests dejarán de considerar
`signatureB64: 'AAAA'` una firma válida. La verificación compartida tendrá
fixtures criptográficos reales de WebAuthn P-256 y KMS RSA-PSS, además de
mutaciones de PDF, intent, identidad, firma y clave.

## Compatibilidad, despliegue y rollback

- No se elimina ningún algoritmo ni endpoint.
- Las respuestas conservan `valid: boolean`; se añaden `verificationStatus` y
  razones más precisas.
- Firmas sin evidencia vinculada pasan a `legacy_unverifiable`, nunca a válidas.
- No hay backfill ni reescritura automática de firmas existentes.
- Rollback de código no requiere migración destructiva: los campos v2 son
  aditivos y los lectores antiguos los ignoran.

## Criterios de aceptación

- una firma fabricada devuelve `valid: false`;
- alterar cualquier byte lógico del documento invalida el hash;
- WebAuthn y KMS reales devuelven `valid: true`;
- revocar la credencial después de una firma v2 no rompe su verificación;
- evidencia v1 sin clave y firmas legacy se describen como no verificables;
- el endpoint público no filtra PII del trabajador ni material criptográfico;
- pruebas focalizadas, typecheck, lint, build y CI aplicable quedan verdes.
