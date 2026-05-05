# ADR 0012 — Health Data Sovereignty: HealthVault del Trabajador (NO Diagnóstico)

Status: **accepted** (principio arquitectónico inviolable)
Date: 2026-05-05
Aplica a: módulo médico completo, ergonomía continua, MedicalAnalyzer →
HealthVault rename, integración con PortableCurriculum

## Contexto

El módulo médico del Sprint 21 R (catálogos CIE-10/ATC/anatomía) y los
componentes `MedicalAnalyzer`, `DifferentialDiagnosis`, `DrugInteractions`
sugieren capacidades diagnósticas. **Esta sugerencia es incorrecta.**

Diagnosticar es competencia exclusiva del médico tratante (Ley 20.584
art. 2 + 8). Una app que diagnostica:

1. Es **ilegal en Chile** sin habilitación médica del responsable técnico.
2. Es **éticamente irresponsable** porque diagnóstico requiere examen
   clínico, anamnesis, contexto que la app no puede ejecutar.
3. **Traiciona la filosofía** del producto (ADR 0010): la app respeta
   al trabajador como adulto que decide con buena información, NO le
   impone interpretaciones de su propia salud.
4. Genera **responsabilidad civil** sobre el operador de la app por
   diagnósticos incorrectos.

Lo que la app SÍ puede hacer es algo más valioso y legalmente intachable:
ser la **bóveda médica portable y soberana del trabajador**.

## Decisión

### El trabajador es DUEÑO ABSOLUTO de su información médica

La app aloja la información, la organiza, la presenta visualmente, la
comparte cuando el trabajador lo decide. **Nunca interpreta. Nunca
diagnostica. Nunca infiere patología.** El médico tratante hace ese
trabajo.

### Principio rector — el "bibliotecario, no oráculo"

| ✅ La app HACE | ❌ La app NO hace |
|---|---|
| Almacena exámenes que el trabajador carga | Diagnostica condiciones a partir de exámenes |
| Muestra evolución temporal de valores | Concluye que valores son patológicos |
| Cruza historial laboral con dolencias actuales | Califica enfermedad como profesional o común |
| Genera QR temporal para compartir con médico | Decide si trabajador es apto o no apto |
| Educa con información general normativa | Reemplaza consulta médica |
| Recuerda alergias y medicamentos crónicos | Sugiere medicamentos o ajustes de dosis |
| Cita normas (DS 109, Ley 16.744) | Califica formalmente Ley 16.744 (eso es competencia COMPIN) |

### Disclaimers OBLIGATORIOS en UI

Cualquier vista del módulo médico DEBE mostrar disclaimer permanente:

> **Praeventio nunca diagnostica.** Esta es tu cartera médica portable.
> La información se organiza para que la compartas con tu médico tratante,
> él hará el diagnóstico, tratamiento y calificación legal correspondiente.

Tipografía mínima 12pt. Color contrast AAA. Visible sin scroll.

### Términos legales

`docs/legal/HEALTH_VAULT_TERMS.md` (CREAR Sprint 26):
- Cláusula explícita: "Praeventio es un sistema de información médica
  personal. NO es un dispositivo médico (no requiere registro ISP).
  NO emite diagnósticos. NO sustituye consulta médica."
- Cumplimiento Ley 20.584 art. 2-8 (derechos del paciente, información
  médica)
- Cumplimiento Ley 21.719 (datos sensibles, vigor diciembre 2026)
- Cumplimiento Ley 16.744 (la app aporta CONTEXTO laboral, no califica)
- Disclaimer médico permanente

## Implementación técnica

### 1. Rename + refactor: MedicalAnalyzer → HealthVault

**Sprint 26** Bucket UU:
- Rename `src/components/medicine/MedicalAnalyzer.tsx` → `HealthVault.tsx`
- Reemplazar prompt Gemini "diagnose this" por "organize this for the user"
- Output cambia: ya no entrega "posible diagnóstico" sino tarjetas con
  "Tu valor de hemoglobina (13.2) — historia de cambio en los últimos 2
  años — pregúntale a tu médico qué significa para ti"

### 2. Health Vault Storage

`src/services/health/vault.ts`:
```ts
export interface HealthRecord {
  id: string;
  workerUid: string;          // dueño absoluto
  type: 'lab_result' | 'imaging' | 'diagnosis_note' | 'medication' |
        'allergy' | 'family_history' | 'audiometry' | 'spirometry' |
        'ecg' | 'ergonomic_log';
  uploadedAt: number;
  uploadedBy: 'self' | 'doctor' | 'mutual';   // who uploaded
  fileUri?: string;            // GCS signed URL, encrypted
  fileEncryptionKeyId?: string; // KMS envelope reference
  meta: {
    title: string;
    issueDate?: string;
    issuer?: string;           // hospital, lab, médico
    isProfessionalSignature?: boolean;
  };
  values?: Record<string, number | string>; // structured data extraction
  /** Tags para filtrar — NUNCA contienen diagnóstico inferido. */
  tags: string[];
  /** Worker-controlled visibility. */
  shareScope: 'private' | 'employer-via-curriculum' | 'shared-via-qr';
}
```

Storage: Firestore `users/{uid}/health_vault/{recordId}`.
Encryption: KMS envelope con `cloud-kms` adapter (no `in-memory-dev` en
prod — ADR 0007).

### 3. QR Temporal Sharing (la pieza brillante)

`src/services/health/vaultShare.ts`:
```ts
export interface VaultShareToken {
  id: string;
  workerUid: string;
  scope: 'full' | 'recent' | 'topic';
  topic?: string;             // si scope='topic' (ej. "lumbalgia")
  recordIds?: string[];       // si scope='topic' o subset
  createdAt: number;
  expiresAt: number;          // default +24h
  usedAt: number | null;
  usedBy: { name: string; uid?: string } | null;
  revokedAt: number | null;
}

export async function createShareToken(opts: {
  workerUid: string;
  scope: VaultShareToken['scope'];
  topic?: string;
  recordIds?: string[];
  ttlHours?: number;          // default 24
}): Promise<{ token: string; qrPayload: string; expiresAt: number }>;

export async function consumeShareToken(token: string, viewer: {
  name: string;
  uid?: string;
}): Promise<{ records: HealthRecord[]; workerName: string; viewExpiresAt: number }>;

export async function revokeShareToken(tokenId: string, byUid: string): Promise<void>;
```

**El trabajador genera el QR. El médico escanea y ve la información en
su navegador (web view sin login requerido — viewer-by-token). Después
de 24h o usado N veces, expira automáticamente.**

Audit log obligatorio:
- `health_vault.share.created`
- `health_vault.share.consumed`
- `health_vault.share.expired`
- `health_vault.share.revoked`

### 4. Ergonomía continua + cruce con PortableCurriculum

`src/services/health/ergonomicCorrelation.ts`:
```ts
/**
 * Función pura. NO genera diagnóstico. Solo organiza datos para que
 * el médico tratante los vea consolidados cuando el trabajador comparte
 * el QR.
 *
 * Input: ergonomic logs (REBA/RULA scores acumulados desde MediaPipe Pose
 *        Sprint 21 F + microposturas durante turno) + curriculum laboral
 *        (Sprint anterior, PortableCurriculum 🟢 testeado).
 *
 * Output: bundle informativo con timeline laboral + scores ergonómicos +
 *         dolores reportados por el trabajador. Sin etiquetar nada como
 *         "enfermedad profesional". Eso lo decide el médico.
 */
export interface OccupationalContextBundle {
  workerUid: string;
  generatedAt: number;
  laborHistory: Array<{
    yearFrom: number; yearTo: number;
    employer: string;
    role: string;
    physicalDemands: string[];   // 'manual_lifting', 'overhead_work', etc.
    riskAgents: string[];         // 'silica', 'noise', 'vibration', etc.
  }>;
  ergonomicMetrics: Array<{
    date: string;
    rebaScore: number;
    rulaScore: number;
    affectedZones: string[];      // 'lumbar', 'cervical', 'shoulder', etc.
    minutesObserved: number;
  }>;
  selfReportedSymptoms: Array<{
    date: string;
    bodyPart: string;
    severity: 1 | 2 | 3 | 4 | 5;
    description: string;
    triggeredByWork: boolean | null;  // null = unknown / not asserted
  }>;
  /** Disclaimer obligatorio en cada export. */
  readonly disclaimer:
    'Esta información fue organizada por Praeventio para ser revisada por el médico tratante. Praeventio no diagnostica. El médico decide.';
}

export function buildOccupationalContextBundle(
  workerUid: string,
  laborHistory: LaborHistoryEntry[],
  ergonomicLogs: ErgonomicLogEntry[],
  symptoms: SelfReportedSymptomEntry[],
): OccupationalContextBundle;
```

Esto le entrega al médico, en 30 segundos, el contexto que le tomaría
una hora reconstruir.

### 5. Disclaimer enforcement automático

`src/components/health/MedicalDisclaimer.tsx`:
Componente obligatorio que se renderiza en TODA vista del módulo médico:

```tsx
<MedicalDisclaimer />
// renders persistent banner: "Praeventio nunca diagnostica..."
```

PRs que rendericen `HealthVault.tsx`, `OccupationalContext.tsx`,
`SymptomLog.tsx` etc. SIN `<MedicalDisclaimer/>` son rechazados en
code review.

Test pattern:
```ts
it('renders MedicalDisclaimer prominently', () => {
  render(<HealthVault />);
  expect(screen.getByText(/Praeventio nunca diagnostica/i)).toBeInTheDocument();
});
```

### 6. NO inferencia diagnóstica en el código

Code review checklist obligatorio:
- ❌ Bloqueado: `inferDiagnosis()`, `assessClinicalRisk()`,
  `suggestTreatment()`, `predictPathology()`
- ❌ Bloqueado: prompt Gemini "diagnose", "what condition", "is this normal"
- ✅ Permitido: `organize()`, `visualize()`, `explainNormativeContext()`,
  `cite()`, `summarizeForDoctor()`
- ✅ Permitido: prompt Gemini "organize this medical document for the
  patient", "explain this normative reference"

### 7. Educación informada (no diagnóstico)

Cuando el trabajador carga audiometría que muestra valores en zona de
alerta, la app responde:

✅ **Correcto:**
> "José, tu audiometría muestra sensibilidad reducida en frecuencias
> altas. Tu trabajo te expone a ruido. Aquí va información general
> sobre cuidado auditivo: protectores clase 4, pausas acústicas,
> cuándo conviene ver al especialista. **Conversa con tu médico
> tratante** — él te dará el seguimiento correcto."

❌ **Prohibido:**
> "Tienes hipoacusia inducida por ruido grado 1. Probable enfermedad
> profesional. Te corresponde calificación Ley 16.744."

La diferencia es que el primer mensaje educa + redirige al médico real;
el segundo diagnostica. Solo el primero está permitido.

## Consecuencias

### Legal — pre-cumplimiento por diseño

- ✅ **Ley 20.584 art. 2-8** Chile (derechos del paciente, información
  médica). El trabajador es dueño absoluto.
- ✅ **Ley 21.719** Chile (datos sensibles vigor diciembre 2026).
  Encryption envelope KMS + worker consent + revocable.
- ✅ **Ley 16.744** Chile (calificación enfermedades profesionales).
  La app NO califica — entrega contexto al médico que SÍ califica.
- ✅ **Ley 19.937** sobre dispositivos médicos. Praeventio NO es
  dispositivo médico (no diagnóstico) → no requiere registro ISP.

### Operacionales

- Trabajadores que cambian de mutual / consultorio mantienen su historial.
- Médicos de consultorio reciben en 30 segundos información que les
  tomaría una hora.
- Sub-diagnóstico de enfermedades profesionales en Chile baja porque
  el médico tiene contexto laboral disponible.
- Trabajador recibe calificación Ley 16.744 cuando corresponde
  → mutual + indemnización + tratamiento adecuado.

### Técnicas

- Refactor `MedicalAnalyzer` → `HealthVault` (Sprint 26 Bucket UU)
- Rename arquitectónico de prompts/funciones que sugieran diagnóstico
- `<MedicalDisclaimer/>` obligatorio en cada vista médica
- Code review checklist nuevo bloquea PRs con palabras prohibidas

### Producto — diferenciador competitivo enorme

Mercado CL:
- **Mutual de Seguridad / ACHS / IST**: tienen historia clínica de
  trabajadores, pero la información NO es del trabajador, es de la
  mutual.
- **FONASA / ISAPRE**: tienen cartola, pero solo de su sistema.
- **Cuaderno físico del trabajador**: única forma actual de portabilidad,
  pero se pierde, se moja, se rompe.

Praeventio entrega: **portabilidad médica soberana del trabajador**, con
encryption real, compartir vía QR, cumplimiento legal pleno.

**No existe competencia directa. Es categoría nueva.**

## Cómo vivir este ADR

### Code review checklist

- [ ] El componente NO genera texto que diagnostique condiciones
- [ ] Los prompts Gemini NO incluyen "diagnose / what condition / is normal"
- [ ] `<MedicalDisclaimer/>` está presente en la vista
- [ ] El copy invita al usuario a consultar a su médico tratante
- [ ] El audit log registra acceso (worker o doctor vía QR)
- [ ] Encryption KMS envelope para records con valores numéricos
- [ ] Consent record fresh si se exporta data fuera del device del trabajador

Si alguna respuesta es No, el PR no merge.

### Tests obligatorios

```ts
describe('MedicalDisclaimer enforcement', () => {
  it('renders in HealthVault view', () => { ... });
  it('renders in SymptomLog view', () => { ... });
  it('renders in OccupationalContext export', () => { ... });
});

describe('No-diagnosis enforcement', () => {
  it('does NOT include "diagnose" or "diagnóstico" in Gemini prompts', () => { ... });
  it('output text does NOT match medical diagnosis patterns', () => { ... });
});

describe('VaultShareToken', () => {
  it('expires after 24h default', () => { ... });
  it('audit log on create + consume + revoke', () => { ... });
  it('revoke makes future consumes fail', () => { ... });
});
```

### Migration path Sprint 26

Bucket UU implementa:
1. Rename `MedicalAnalyzer.tsx` → `HealthVault.tsx`
2. Refactor prompts Gemini
3. Crear `vaultShare.ts` con QR token system
4. Crear `ergonomicCorrelation.ts` para bundle informativo al médico
5. `<MedicalDisclaimer/>` component
6. Code review automation: pre-commit hook que rechaza palabras
   prohibidas en archivos del módulo médico

## Coherencia con ADRs anteriores

- **ADR 0010** (privacy-by-design del trabajador): perfecta coherencia.
  El trabajador es dueño de sus datos íntimos. Aquí incluimos los
  datos médicos como categoría máxima de privacidad.
- **ADR 0011** (twin triple-gate): si el ADR 0011 protege la privacidad
  industrial de la empresa, el ADR 0012 protege la privacidad médica
  del trabajador. Tres ADRs simétricos:
  * 0010: trabajador (datos íntimos generales)
  * 0011: empresa (datos industriales del twin)
  * 0012: trabajador (datos médicos sensibles)

## Referencias

- Ley 20.584 (derechos del paciente CL)
- Ley 21.719 (datos personales vigor 2026 CL)
- Ley 16.744 (accidentes y enfermedades profesionales)
- Ley 19.937 (autoridad sanitaria — dispositivos médicos)
- ADR 0007 (KMS envelope encryption)
- ADR 0010 (privacy by design)
- ADR 0011 (twin triple-gate)
- HIPAA Privacy Rule §164.524 (referencia internacional, US)
- GDPR art. 9 (datos especiales — referencia internacional)

## Decisión final

**Praeventio NUNCA diagnostica. Punto. Sin excepciones. Sin "feature
flag" para activar diagnóstico en algún tier premium. La app es
bibliotecario médico del trabajador, NO oráculo de salud.**

**El médico tratante es el único que diagnostica. Praeventio le entrega
información organizada para que su trabajo sea mejor.**

**Esta es la postura ética del producto. No es opcional.**
