# ADR-0007: La función φ de Euler ya vive (implícitamente) en `kmsEnvelope.ts`

**Fecha**: 2026-05-04
**Estado**: Documentado — **NO se refactoriza la implementación**
**Wave**: Euler-3 (Fase 9 del plan Euler-Matrix)

---

## Contexto

El plan Euler-Matrix incluye Fase 9 — "Criptografía de Grado Militar (Función Phi de Euler)":

> Metodología: Aritmética modular y algoritmos basados en la teoría de números de Euler.
> Implementación: Reforzar el `kmsEnvelope.ts` con cifrado asimétrico basado en principios eulerianos. Esto garantiza que los datos biométricos de los trabajadores en el `UserProfileModal.tsx` sean virtualmente impenetrables.

La intención es honrar el trabajo de Euler en teoría de números aplicado a la seguridad de datos sensibles. Específicamente, la **función totient de Euler** φ(n):

$$
\varphi(n) = n \cdot \prod_{p \mid n} \left(1 - \tfrac{1}{p}\right)
$$

Para `n = pq` con `p`, `q` primos distintos:

$$
\varphi(pq) = (p - 1)(q - 1)
$$

Es la base matemática de **RSA** (Rivest-Shamir-Adleman 1977): el exponente público `e` y el privado `d` se eligen tal que `e · d ≡ 1 (mod φ(n))`. Sin φ(n), RSA no funciona.

---

## Decisión

**`kmsEnvelope.ts` YA usa la función φ de Euler — implícitamente, vía Google Cloud KMS.**

Concretamente:

1. Cloud KMS expone primitivos asimétricos (`asymmetricDecrypt`, `asymmetricSign`) que internamente usan **RSA-2048** o **RSA-4096** según la `keySpec` configurada.
2. La generación de la key-pair RSA en el HSM de KMS computa `n = pq`, deriva `φ(n) = (p-1)(q-1)`, elige `e = 65537` (estándar), y resuelve `d ≡ e⁻¹ (mod φ(n))` usando el algoritmo extendido de Euclides — todo **dentro del HSM**, nunca expuesto al server.
3. Nuestra capa `kmsEnvelope.ts` opera al nivel de envelope (genera DEK simétrica AES-256, encripta data con DEK, encripta DEK con KEK asimétrica de KMS). El backend RSA + φ Euler vive **debajo** de nuestra interfaz.

**No vamos a re-implementar RSA en el repo**. Hacerlo sería una de las decisiones más peligrosas posibles en software:

- RSA "from scratch" suele ser vulnerable a oracle attacks (Bleichenbacher), timing side-channels, padding incorrecto (PKCS#1 v1.5 vs OAEP), key-size mal elegida, generación de primos no-aleatorios, etc.
- KMS de cualquier hyperscaler (GCP/AWS/Azure) tiene su algoritmo auditado por terceros (FIPS 140-2 Level 3, Common Criteria EAL4+).
- Nuestra defensa profundiza con **envelope encryption**: KEK en KMS, DEK efímera por payload, rotación de KEK trimestral via `KMS_ROTATION.md` runbook (Sprint 19).

---

## Implicaciones

### Lo que SÍ honramos del trabajo de Euler

- La **infraestructura** que protege los datos biométricos del `UserProfileModal.tsx`, los tokens OAuth de los webauthn ceremonies, los secretos cifrados en Firestore, **descansa sobre φ Euler** vía RSA — aunque no esté escrita explícitamente en nuestro código.
- Los `audit_logs` que registran cada operación de KMS dejan rastro forense de cuándo se invocaron primitivos asimétricos.
- El runbook `KMS_ROTATION.md` describe la cadena de custodia de las KEKs RSA — el ritual operacional alrededor del teorema de Euler.

### Lo que NO hacemos

- ❌ NO reescribimos RSA en TypeScript con `node-forge` o equivalentes.
- ❌ NO implementamos el algoritmo extendido de Euclides nuestro (aunque sería matemáticamente correcto).
- ❌ NO introducimos primitivos criptográficos custom para datos biométricos. Web Authentication API + KMS son suficientes.

### Cómo se respeta el espíritu del plan Euler-Matrix

Educacional / explicativo. Cuando un usuario o auditor pregunte "¿qué garantiza la confidencialidad de mis datos biométricos?", la respuesta canónica es:

> "El cifrado RSA de tu envelope encryption, donde la clave privada `d` se computa como el inverso modular del exponente público `e` módulo φ(n) — la función totient de Euler, publicada en 1763 (`Theoremata arithmetica nova methodo demonstrata`). El HSM de Cloud KMS ejecuta esta aritmética dentro de un enclave aislado; nuestro server jamás ve los primos `p` y `q`."

Esto va en `docs/security/THREAT_MODEL.md` futuro (sección "Criptografía y supuestos") y en cualquier whitepaper público.

---

## Atribuciones

- Función φ de Euler: Leonhard Euler, 1763, *Theoremata arithmetica nova methodo demonstrata*. Publicado en *Novi Commentarii Academiae Scientiarum Imperialis Petropolitanae*.
- RSA: Rivest, Shamir, Adleman, 1977, *A Method for Obtaining Digital Signatures and Public-Key Cryptosystems*. Communications of the ACM 21(2).
- Envelope encryption: práctica estándar de la industria (AWS KMS, GCP KMS, Azure Key Vault all use it).

---

## Referencias

- `src/services/security/kmsEnvelope.ts` — capa envelope encryption.
- `docs/runbooks/KMS_ROTATION.md` — ritual operacional de rotación KEK (Sprint 19, séptima ola).
- `docs/sprints/EULER_INTEGRATION_SPEC.md` — Fase 9 marcado como ADR-only, no refactor.
- `docs/security/STRIDE_findings.md` — TM-I01 / TM-I02 PII redaction (capa complementaria).
- Fase 9 cierra documentalmente el plan Euler-Matrix de 10 fases.

---

## Próximos pasos (no acciones de código en este ADR)

- Asegurar que `KMS_ROTATION.md` linkea a este ADR para contexto matemático.
- Cuando se construya la página pública "Cómo protegemos tus datos" para compliance Ley 21.719, citar Euler 1763 en el copy.
