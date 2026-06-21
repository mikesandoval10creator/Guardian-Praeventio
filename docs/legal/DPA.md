<!--
  Borrador — pendiente revisión legal.
  Este Acuerdo de Tratamiento de Datos (DPA) es un BORRADOR redactado para ser
  certificado por un abogado de protección de datos chileno antes de su uso
  contractual. No constituye asesoría legal ni una afirmación de cumplimiento
  certificado con la Ley 21.719 o el RGPD. Las citas legales no verificadas se
  marcan como TODO; no inventar artículos ni plazos.

  Fuentes de hechos legales (verificadas en docs/compliance/LEY-21719-ROADMAP.md):
  - Ley 21.719 (Chile) publicada 13-12-2024; plena vigencia 01-12-2026.
  - Reforma la Ley 19.628 y crea la Agencia de Protección de Datos Personales
    (NO confundir con la "ANPD", que es la autoridad de Brasil).
  - Plazo de respuesta de derechos del titular (ARCO + portabilidad): 30 días.
  - El texto de la ley NO fija un plazo horario único de notificación de brecha;
    Praeventio adopta 72h como estándar operacional interno (más estricto).
-->

# Acuerdo de Tratamiento de Datos (DPA)

**Borrador — pendiente revisión legal.**
Versión: 0.1 (borrador) · Última revisión interna: 2026-06-21 · Estado: pendiente certificación por abogado de datos chileno.

Este documento es el modelo de **Acuerdo de Tratamiento de Datos** entre la
empresa cliente (**Responsable del tratamiento**) y Guardian Praeventio
(**Encargado del tratamiento**), conforme al **RGPD art. 28** (Unión Europea) y a
la **Ley N° 19.628 modificada por la Ley N° 21.719** (Chile, plena vigencia
01-12-2026).

---

## 1. Partes y roles

| Rol | Parte |
|---|---|
| **Responsable del tratamiento** (decide finalidades y medios) | La empresa cliente que contrata Guardian Praeventio. |
| **Encargado del tratamiento** (trata datos por cuenta del responsable) | Guardian Praeventio, operado a través del dominio praeventio.net. |

Guardian Praeventio actúa **exclusivamente como encargado**: gestiona información
de prevención de riesgos para **facilitar la decisión del responsable** (la
empresa y sus expertos en prevención). Praeventio **no decide ni diagnostica**;
sus motores de cálculo e inteligencia artificial producen **recomendaciones**
revisadas por un humano (ver ADR 0012 y la cláusula 9 de este acuerdo).

> Nota de alcance: respecto de los datos de la **cuenta del propio usuario**
> (nombre, correo, foto de perfil de Google Sign-In) Praeventio puede actuar
> como responsable. Respecto de los **datos de los trabajadores de la empresa
> cliente**, Praeventio es siempre encargado. <!-- TODO(legal): confirmar
> calificación dual con counsel chileno bajo Ley 21.719. -->

---

## 2. Objeto, duración, naturaleza y finalidad

- **Objeto:** tratamiento de datos personales de trabajadores y colaboradores de
  la empresa cliente para la prestación del servicio de prevención de riesgos
  laborales.
- **Duración:** mientras esté vigente el contrato de servicio y por los plazos de
  conservación legal aplicables (cláusula 11).
- **Naturaleza y finalidad:** registro, almacenamiento, organización, análisis y
  puesta a disposición de información de seguridad y salud ocupacional, gestión
  de emergencias, cumplimiento normativo (Ley 16.744, DS 44/2024, DS 594,
  ISO 45001) y generación de documentos que la empresa firma y entrega a la
  autoridad. Praeventio **no transmite documentos a APIs de organismos públicos**
  (SUSESO/SII/MINSAL/etc.) — genera el documento; la empresa lo firma y entrega.

### 2.1 Categorías de datos e interesados

- **Interesados:** trabajadores, supervisores, expertos en prevención,
  contratistas y visitantes de la empresa cliente.
- **Categorías de datos personales:** identificación y contacto, datos de la
  relación laboral, registros de capacitación, incidentes y auditorías.
- **Categorías especiales / datos sensibles:** datos de salud ocupacional,
  resultados de exámenes ocupacionales, geolocalización de trabajadores (en
  emergencias y zonas configuradas) y datos biométricos de pose procesados
  **100% en el dispositivo** (no salen del equipo).

---

## 3. Instrucciones del responsable

El encargado tratará los datos personales **únicamente siguiendo instrucciones
documentadas** del responsable, incluidas las transferencias internacionales,
salvo obligación legal que le sea aplicable. Si el encargado considera que una
instrucción infringe la normativa de protección de datos, lo informará al
responsable sin dilación.

---

## 4. Confidencialidad

El encargado garantiza que las personas autorizadas para tratar los datos
personales se han comprometido a respetar la **confidencialidad** o están sujetas
a una obligación legal de confidencialidad.

---

## 5. Medidas de seguridad

El encargado aplica medidas técnicas y organizativas apropiadas (RGPD art. 32;
deber de seguridad de la Ley 21.719). Sin perjuicio de la auditoría completa,
incluyen:

- Reglas de Firestore con **denegación por defecto** y control de acceso por rol.
- **Bóveda médica** cifrada con envoltura de claves (KMS) y denegada por completo
  al cliente (solo acceso server-side).
- Registro de auditoría **inmutable y append-only**.
- Cifrado en tránsito (HTTPS/TLS) y en reposo; cifrado SQLite on-device.
- Biometría procesada **100% en el dispositivo** (ningún frame de cámara ni
  frecuencia cardíaca sale del equipo).
- Principio de mínimo privilegio en el acceso de auditores externos (tokens con
  alcance y expiración, no cuentas permanentes).

---

## 6. Sub-encargados (sub-procesadores)

- El responsable **autoriza de forma general** el uso de sub-encargados, sujeto a
  las condiciones de esta cláusula.
- El encargado mantiene una **lista pública y actualizada de sub-encargados** en
  `docs/legal/subprocessors.md` y en una URL estable
  (`/subprocessors.html`).
- El encargado **notificará** con antelación razonable cualquier **cambio**
  (alta o sustitución) de sub-encargados, dando al responsable la oportunidad de
  oponerse. <!-- TODO(legal): fijar el plazo de preaviso (p.ej. 30 días) y el
  mecanismo de oposición con counsel. -->
- El encargado impone a cada sub-encargado, mediante contrato, **las mismas
  obligaciones** de protección de datos que constan en este acuerdo (RGPD
  art. 28.4), y responde frente al responsable del incumplimiento del
  sub-encargado.

---

## 7. Asistencia al responsable: derechos de los titulares

El encargado asiste al responsable, mediante medidas técnicas y organizativas
apropiadas, para responder a las solicitudes de ejercicio de derechos de los
titulares (**acceso, rectificación, cancelación, oposición y portabilidad** —
ARCO + portabilidad). El **plazo de respuesta es de 30 días** conforme a la Ley
21.719. Praeventio ofrece flujos self-service de acceso, exportación, portabilidad
y solicitud de eliminación dentro de la aplicación, además de una URL pública de
solicitud de eliminación (`/data-deletion.html`).

---

## 8. Notificación de brechas de seguridad

- El encargado notificará al responsable **sin dilación indebida** tras tener
  conocimiento de una violación de la seguridad de los datos personales
  (RGPD art. 33.2), proporcionando la información necesaria para que el
  responsable cumpla sus propias obligaciones de notificación a la autoridad y a
  los afectados.
- **Estándar operacional interno de Praeventio: 72 horas** desde el conocimiento
  de la brecha. Este plazo de 72h es una **decisión operacional interna** (más
  estricta); el texto de la Ley 21.719 **no fija un plazo horario único** y la
  notificación debe hacerse "tan pronto como sea posible". <!-- TODO(legal):
  el counsel debe confirmar la citación legal exacta y el plazo aplicable a la
  notificación a la Agencia de Protección de Datos Personales; no afirmar un
  artículo sin verificación. -->
- En Chile, la autoridad de control es la **Agencia de Protección de Datos
  Personales** (creada por la Ley 21.719). No confundir con la "ANPD" (Brasil).

---

## 9. Decisiones automatizadas y rol de la IA

Las salidas de los motores de cálculo y de la inteligencia artificial (Gemini)
de Praeventio son **recomendaciones** sujetas a revisión humana. Praeventio
**nunca bloquea** maquinaria, acceso físico ni empleo de forma automatizada:
siempre existe una persona que decide. Esto materializa el derecho a no ser
objeto de decisiones basadas únicamente en tratamiento automatizado con efectos
jurídicos o significativos.

---

## 10. Auditoría

El encargado pone a disposición del responsable la información necesaria para
demostrar el cumplimiento de las obligaciones de esta cláusula y permite y
contribuye a la realización de **auditorías**, incluidas inspecciones, por el
responsable o un auditor mandatado por este (RGPD art. 28.3.h). <!-- TODO(legal):
acordar frecuencia, preaviso y costos razonables de auditoría. -->

---

## 11. Fin del tratamiento

A elección del responsable, al término de la prestación de los servicios el
encargado **suprimirá o devolverá** todos los datos personales y eliminará las
copias existentes, salvo que una obligación legal exija su conservación
(RGPD art. 28.3.g).

> **Conservación legal obligatoria:** ciertos registros de prevención y auditoría
> deben conservarse por mandato de la normativa laboral chilena (p. ej. Ley
> 16.744 / DS 594). En esos casos la supresión se realiza mediante
> **anonimización** que preserva el registro legal sin identificar al titular
> (ver ADR 0024 sobre retención de datos de prevención). <!-- TODO(legal):
> confirmar plazos de conservación obligatoria por tipo de registro. -->

---

## 12. Transferencias internacionales

El encargado puede tratar datos en infraestructura ubicada fuera de Chile (por
ejemplo, Google Cloud / Firebase). Toda transferencia internacional se realiza
conforme a las instrucciones del responsable y a un mecanismo de transferencia
válido bajo la Ley 21.719 y el RGPD. <!-- TODO(legal): documentar el mecanismo
de transferencia aplicable (cláusulas contractuales tipo / nivel adecuado de
protección) antes de 12-2026; ver gap G-15 del roadmap. -->
La ubicación de datos de cada sub-encargado se detalla en
`docs/legal/subprocessors.md`.

---

## 13. Ley aplicable y contacto

- **Ley aplicable:** Ley N° 19.628 modificada por la Ley N° 21.719 (Chile) y, en
  lo que corresponda, el RGPD (UE).
- **Contacto de protección de datos del encargado:** contacto@praeventio.net.
  <!-- TODO(legal): designar formalmente un encargado/DPO y publicar su contacto;
  ver gap G-7 del roadmap. -->

---

_Borrador — pendiente revisión legal. Praeventio no afirma estar certificada ni
en cumplimiento pleno con la Ley 21.719 o el RGPD; este documento describe
compromisos y mecanismos, no certificaciones._
