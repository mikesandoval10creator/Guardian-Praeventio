# Firmas regulatorias SUSESO, DS-67 y DS-76

## Alcance y garantía

Este flujo vincula cada firma nueva al PDF exacto generado por el servidor, al
tenant, formulario, tipo de documento, acción e identidad del firmante. Aplica
a SUSESO DIAT/DIEP, DS-67 y DS-76. No elimina el flujo manual de presentación
ante la mutualidad ni convierte a Praeventio en un PSE.

La garantía criptográfica autocontenida comienza en registros con
`verificationVersion: 2`. Cada firma nueva conserva una instantánea de la clave
pública verificada, además del contexto exacto de firma. Esto permite comprobar
el documento después de revocar una passkey o rotar una clave KMS, sin depender
de que la credencial operativa siga activa.

Los registros v1 conservan verificación compatible mientras la clave referida
siga disponible en el registro de credenciales o en KMS. Las firmas anteriores
sin contexto o evidencia suficiente siguen siendo legibles, pero se clasifican
como `legacy-unverifiable`: nunca se presentan como válidas retroactivamente.

## Flujo WebAuthn humano

1. El servidor vuelve a generar el PDF sin firma con renderer determinista v1.
2. Compara SHA-256 con `payloadHashHex`; un registro antiguo sin digest se
   migra mediante una transacción que exige que continúe sin firma.
3. Obtiene UID desde Firebase Auth y RUT desde `users/{uid}`. El cliente no
   puede elegir UID, RUT, fecha ni hash.
4. Genera un intent canónico con propósito, tenant, formulario, tipo, acción,
   hash, identidad, nonce y expiración de cinco minutos.
5. El challenge WebAuthn es SHA-256 del intent. Challenge y metadata se consumen
   una sola vez y de forma atómica.
6. Se verifica la assertion contra la credencial registrada y se persiste toda
   la evidencia v2, incluida la clave pública COSE, origin y RP ID efectivamente
   verificados. La escritura final vuelve a comprobar en una transacción que el
   documento siga existiendo y sin firma.

Endpoints autenticados:

- `GET /api/suseso/form/:id/sign-challenge`
- `POST /api/suseso/form/:id/sign`
- `GET /api/compliance/ds67/:formId/sign-challenge`
- `POST /api/compliance/ds67/:formId/sign`
- `GET /api/compliance/ds76/:formId/sign-challenge`
- `POST /api/compliance/ds76/:formId/sign`

El POST acepta únicamente `tenantId` y `webauthnAssertion`. Campos legales
fabricados por el cliente hacen fallar el schema estricto.

## Flujo Cloud KMS de máquina

La capacidad KMS se conserva como ruta privada. Solo un token Google OIDC con
email de service account, `email_verified=true` y audiencia exacta puede llegar
a los endpoints. No existe fallback por secreto compartido ni acceso browser.

Cloud KMS firma con RSA-PSS SHA-256 un envelope canónico que incluye tenant,
formulario, tipo documental, SHA-256 del PDF, UID y RUT del firmante de máquina.
Antes de persistir, el servidor descarga la clave pública y verifica localmente
la firma contra ese mismo envelope. La versión completa de la clave queda en
`kmsKeyVersion` para auditoría y la clave pública PEM verificada se archiva en
la evidencia v2.

Endpoints privados:

- `POST /api/suseso/form/:id/kms-sign`
- `POST /api/compliance/ds67/:formId/kms-sign`
- `POST /api/compliance/ds76/:formId/kms-sign`

El body estricto contiene solo `{ "tenantId": "..." }`.

## Verificación pública por folio/QR

`GET /api/suseso/verify/:folio` vuelve a renderizar el PDF sin firma en el
servidor, compara renderer y SHA-256 con el registro persistido y luego verifica
criptográficamente la evidencia WebAuthn o RSA-PSS. El endpoint no confía en un
booleano almacenado ni en la mera presencia de `signatureB64`.

La respuesta distingue tres estados auditables:

- `verified`: hash, contexto, clave y firma criptográfica coinciden;
- `invalid`: existe una contradicción verificable, por ejemplo documento
  mutado, contexto diferente o firma falsa;
- `unverifiable`: falta evidencia histórica suficiente o la dependencia de
  claves no está disponible. Este estado siempre devuelve `valid: false`.

El QR continúa siendo público y no expone datos clínicos. Solo devuelve tipo de
documento y, cuando la firma es válida, fecha y RUT del responsable legal.

## Configuración y activación

Toda firma regulatoria nueva requiere primero la raíz de confianza archivística:

```dotenv
COMPLIANCE_EVIDENCE_ATTESTATION_CURRENT_KEY_ID=archive-2026-07
COMPLIANCE_EVIDENCE_ATTESTATION_KEYS={"archive-2026-07":"secreto-aleatorio-de-al-menos-32-bytes"}
```

El preflight de producción falla cerrado si este keyring no existe o es
inválido. Su HMAC autentica la procedencia y todos los campos de la evidencia
v2; por eso una clave pública inventada junto con una firma autoconsistente no
puede convertirse en un documento válido.

La ruta KMS de máquina está apagada por defecto. Para activarla:

```dotenv
COMPLIANCE_KMS_SIGNING_ENABLED=true
COMPLIANCE_KMS_SIGNING_KEY_VERSION=projects/P/locations/L/keyRings/R/cryptoKeys/K/cryptoKeyVersions/1
COMPLIANCE_KMS_CALLER_SERVICE_ACCOUNT=regulatory-signer@P.iam.gserviceaccount.com
COMPLIANCE_KMS_SIGNER_UID=compliance-kms
COMPLIANCE_KMS_SIGNER_RUT=12.345.678-5
COMPLIANCE_KMS_OIDC_AUDIENCE=https://app.praeventio.net
```

La CryptoKey debe usar propósito `ASYMMETRIC_SIGN` y algoritmo
`RSA_SIGN_PSS_2048_SHA256` o equivalente RSA-PSS SHA-256 soportado. La identidad
de runtime necesita `cloudkms.cryptoKeyVersions.useToSign` y lectura de la clave
pública. El preflight impide iniciar con el feature habilitado y configuración
incompleta.

## Rotación, rollback y respuesta a incidentes

- Rotar creando una versión nueva; actualizar
  `COMPLIANCE_KMS_SIGNING_KEY_VERSION` después de habilitarla. No destruir
  versiones anteriores mientras existan documentos que las referencien.
- Para rotar la atestación archivística, agregar el secreto nuevo al JSON,
  cambiar `COMPLIANCE_EVIDENCE_ATTESTATION_CURRENT_KEY_ID` y conservar las
  entradas anteriores. Retirar una keyId vuelve `unverifiable` toda evidencia
  histórica emitida con ella.
- Para rollback inmediato, fijar `COMPLIANCE_KMS_SIGNING_ENABLED=false` y
  desplegar. WebAuthn humano continúa disponible.
- Si una clave o service account se compromete: deshabilitar la versión/cuenta,
  conservar logs y evidencia, inventariar documentos por `kmsKeyVersion` y
  activar una versión nueva. No reescribir firmas ya emitidas.
- Nunca registrar RUT, assertion completa, firma o PDF en logs. Los eventos de
  auditoría guardan identificadores, tipo de documento y versión de clave.

## Verificación operativa

Antes de desplegar deben pasar typecheck, pruebas focalizadas, suite completa y
build. Casos negativos obligatorios: tenant/formulario/tipo/hash/UID/RUT
distinto, intent expirado o reutilizado, documento ya firmado, firma KMS que no
verifica localmente y caller OIDC con email o audiencia incorrectos.
