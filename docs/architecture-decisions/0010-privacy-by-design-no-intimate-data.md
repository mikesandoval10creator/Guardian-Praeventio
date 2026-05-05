# ADR 0010 — Privacy by Design: NO datos íntimos del trabajador

Status: **accepted** (principio arquitectónico inviolable)
Date: 2026-05-05
Aplica a: **TODO el código presente y futuro de Praeventio**

## Contexto

Guardian Praeventio puede operar con sensores, wearables, cámaras,
micrófonos, geolocalización, biometría y modelos de IA. La capacidad
técnica de capturar datos íntimos del trabajador existe. La pregunta
arquitectónica es: ¿qué nos da derecho a capturar?

Una empresa tiene legítimo interés y derecho legal de cuidar al
trabajador **dentro del perímetro físico y temporal de la faena**.
Lo que el trabajador hace fuera de ese perímetro es sagrado y queda
fuera de la app, sin importar cuán técnicamente posible sea capturarlo.

Esta decisión NO es una optimización de performance ni una restricción
de scope. Es la postura ética del producto: **prevención cálida, NO
vigilancia disfrazada de cuidado**.

## Decisión

### 🟢 Datos legítimos que la app puede leer y procesar

La app PUEDE razonar sobre estos datos porque caen dentro del perímetro
de faena durante el turno:

| Categoría | Justificación |
|---|---|
| Clima del lugar de faena | Riesgo objetivo del entorno |
| Geometría de faena (mesh, polígonos) | Activo de la empresa |
| EPP visible en cámara dentro de faena | Inspección contractual |
| Postura durante la tarea | Ergonomía de la operación |
| Posición GPS **solo durante el turno** | Asignación + emergencia |
| Telemetría de equipos y maquinaria | Activos de la empresa |
| Registros IPER y normativa aplicable | Documentación legal |
| Historial de incidentes del proyecto | Base de aprendizaje |
| Polvo, ruido, vibración, gases ambientales | Riesgo del entorno |

### ❌ Datos íntimos que JAMÁS tocamos

La app NO captura, NO infiere, NO almacena, NO presenta:

| Categoría | Razón filosófica |
|---|---|
| Sueño | Habla de vida personal, ansiedades, relaciones |
| Ritmo cardíaco fuera de turno | Estado de reposo es privado |
| Ubicación fuera de turno | El trabajador desaparece del radar al fichar salida |
| Mensajería personal | Sagrado |
| Redes sociales | Sagrado |
| Vida fuera de faena | Sagrado |
| Salud mental privada | Sagrado |
| Estado emocional inferido | Sagrado |
| Relaciones personales | Sagrado |

**El wearable, el celular, el GPS pueden capturar técnicamente todo
esto. La app deliberadamente NO los lee.** Esto se enforce con
guards de código, no con buena intención.

### 🟡 Datos médicos sensibles (zona delicada)

Solo procesables si:
1. El trabajador los carga **voluntariamente** vía PortableCurriculum
2. Con **consentimiento explícito** versionado (`consent_v1.0`)
3. Con **derecho a revocar en cualquier momento** (Ley 19.628 art. 12)
4. Con **encriptación envelope KMS real** (`KMS_ADAPTER=cloud-kms`,
   nunca `in-memory-dev` en producción — ver ADR 0007)
5. **Nunca** se usan para "asignar/no asignar" tareas
6. **Solo** para que el propio trabajador reciba recordatorios cálidos
   relevantes para él

## Aplicación práctica por módulo

### WearablesPanel + useHealthMetrics

Antes (Sprint 21 P): `getStepsToday()`, `getHeartRate(rangeStart, rangeEnd)`.
Ranges abiertas — el operador podía pedir HR de 03:00 AM (sueño).

Después (este ADR): `getHeartRateDuringShift(shiftStartMs, shiftEndMs)`.
La función rechaza ranges que no estén dentro de un turno activo.

```ts
// src/services/health/healthFacadeNative.ts
export interface ShiftWindow {
  startMs: number;        // fichado entrada
  endMs: number;          // fichado salida
  projectId: string;      // qué faena
}

export interface HealthFacadeNative {
  /** REJECTS reads outside active shift window. Throws if range escapes. */
  getHeartRateDuringShift(shift: ShiftWindow): Promise<HrSample[]>;
  
  /** Steps during shift only. */
  getStepsDuringShift(shift: ShiftWindow): Promise<number>;
  
  /** REMOVED: getSleepData. Sueño NUNCA se lee. */
}
```

UI implícita: el WearablesPanel SOLO muestra datos cuando hay
`activeShift` en `ProjectContext`. Fuera del turno → panel oculto +
mensaje "Tu información personal queda fuera de la app cuando no
estás en faena. Esto es por diseño."

### VitalityMonitor + alertas CIE-10

Antes: detectaba HR > 120 a cualquier hora.
Después: detecta HR > 120 **durante el turno** + correlaciona con
carga manual / temperatura / altitud — tres condiciones de faena.

Si el trabajador tiene HR elevada en su tiempo libre por hacer
ejercicio, eso NO le concierne a la app.

### EPP Vision (foto en faena)

Antes: bloqueaba al trabajador si Vision detectaba EPP faltante.
Después (este ADR + nudge philosophy):
- Vision detecta EPP faltante → mensaje cálido al trabajador:
  "Hey [nombre], detecté que te falta el casco dieléctrico para tu
  tarea de hoy. ¿Pasas a bodega? Te acompaño."
- Supervisor ve lo mismo, puede acompañar al trabajador.
- Si el trabajador decide proceder igual → registro queda como
  evidencia legal del informe entregado.
- **No bloqueamos. Informamos. La libertad del trabajador se respeta.**

### Predicción "Hombre Caído" + fatiga

Antes: alarma binaria que detiene la operación.
Después: susurro al oído del propio trabajador:
"[nombre], llevas 4 horas en altura sin pausa. Tu cuerpo te lo
agradecería."

Sin bloqueos. Agencia conservada. Cuidado expresado.

### IPER predictivo desde calendario

Antes: el sistema bloqueaba la asignación si IPER estaba pendiente.
Después: el sistema pre-completa la matriz IPER con base en
clima + tipo de trabajo + ubicación. El supervisor revisa, ajusta,
firma. Acelera la prevención sin sustituir el juicio humano.

### Climate→FCM orchestrator (Sprint 25 TT)

Ya cumple el principio: solo procesa `geo` del proyecto (no del
trabajador), `outdoor: true` (atributo del proyecto), `workTypes`
(tipo de tarea). Nunca toca datos del trabajador individual.
Multicast FCM va a `supervisorUids` del proyecto, ellos agregan
contexto a la cuadrilla. **Ya alineado con este ADR.**

### Mensajería + redes sociales + correo

**JAMÁS** la app pide permiso de lectura de SMS, llamadas,
WhatsApp, email, redes sociales. **JAMÁS.**

## Consecuencias

### Legal — pre-cumplimiento por diseño

- ✅ **Ley 19.628** Chile (datos personales, vigente). Cumplido por
  ADR 0010 + Sprint 23 Bucket FF (consent + RAT + 4 derechos).
- ✅ **Ley 21.719** Chile (nueva ley protección datos personales,
  vigor diciembre 2026). Pre-cumplido — la app no captura datos
  íntimos que la nueva ley restringirá.
- ✅ **GDPR** Europa (si expandimos). Principio de minimización
  cumplido: solo capturamos lo necesario para el legítimo interés
  declarado.
- ✅ **CCPA** California. Same.

### Técnica — guards de código, no de intención

Cada módulo que toca datos de salud, ubicación o cámara debe:
1. Verificar `useShiftWindow()` que el turno está activo
2. Documentar en JSDoc qué dato lee y qué legítimo interés justifica
3. Si lee datos sensibles, validar consent record fresh

Tests automatizados deben verificar que:
- `healthFacade.getHeartRate({ startMs: outsideShift, ... })` throws
- `getCurrentLocation()` returns null fuera de turno
- `analyzePostureWithAI(photo)` rechaza fotos sin contexto faena

### Producto — diferenciador competitivo

Mercado CL hoy: ACHS, Mutual de Seguridad, IST, otras Mutuales
operan modelo de "control" — recogen máximo dato, infieren riesgo
inferred sobre conductas privadas. **Praeventio se posiciona como el
único que respeta radicalmente la privacidad del trabajador**, lo
que nos hace:

1. Aceptable para sindicatos (que rechazan vigilancia laboral)
2. Aceptable para empresas que valoran cultura sin paranoia
3. Aceptable para trabajadores (adoption rate alta)
4. Pre-compliant con normativa futura

## Cómo vivir este ADR

### Code review checklist

Cuando un PR agrega lectura de datos personales, el reviewer pregunta:

- [ ] ¿Es dato dentro del perímetro físico de faena?
- [ ] ¿Es dato dentro de la ventana temporal del turno?
- [ ] ¿Hay consent record fresh si es médico?
- [ ] ¿La UI le dice al trabajador EXACTAMENTE qué se está midiendo?
- [ ] ¿Hay switch para que el trabajador apague la medición?
- [ ] ¿La inferencia se queda informativa o se vuelve bloqueante?

Si alguna respuesta es No, el PR no merge.

### Test pattern obligatorio

Para cada función que lea datos de salud / ubicación:

```ts
describe('shift-boundary enforcement', () => {
  it('throws when read range escapes active shift', async () => {
    const facade = HealthFacadeNative.fromEnv()!;
    const beforeShift = { startMs: 0, endMs: SHIFT_START - 1, projectId: 'p1' };
    await expect(facade.getHeartRateDuringShift(beforeShift)).rejects.toThrow(/outside shift/);
  });
  
  it('returns empty array when no active shift', async () => {
    const facade = HealthFacadeNative.fromEnv()!;
    expect(await facade.getStepsDuringShift({ startMs: 0, endMs: 0, projectId: '' })).toEqual(0);
  });
});
```

### Migration path

Sprint 26 (próximo) implementa:
1. `ShiftWindow` type + `useShiftWindow()` hook
2. `healthFacadeNative` refactor a `*DuringShift` métodos
3. `useHealthMetrics` solo expone datos cuando `activeShift !== null`
4. WearablesPanel hide-when-off-shift behavior
5. Consent banner v2 con texto explícito sobre este ADR

## Referencias

- Ley 19.628 (datos personales CL, vigente)
- Ley 21.719 (nueva LDP CL, vigor diciembre 2026)
- GDPR art. 5 (data minimization)
- ADR 0007 (φ Euler RSA en KMS envelope — encryption legal foundation)
- Sprint 23 Bucket FF (consent + RAT + 4 derechos)
- Memoria usuario `user_flow_infinito_filosofia.md` (filosofía privada del usuario)

## Decisión final

**Toda función que lea datos personales del trabajador queda obligada
a respetar este ADR. Sin excepciones. Sin "feature flags" para
desactivar la privacidad. La privacidad NO es opcional en
Praeventio — es el producto.**
