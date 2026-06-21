<!--
  Borrador — pendiente revisión legal.
  Lista de sub-encargados (sub-procesadores) de Guardian Praeventio. Mantener
  sincronizada con public/subprocessors.html y con la Política de Privacidad
  (src/pages/PrivacyPolicy.tsx, sección "Compartición de Datos") — esta lista NO
  debe contradecir esa sección. Verificar la ubicación de datos real de cada
  proveedor antes de certificar.
-->

# Sub-encargados (sub-procesadores)

**Borrador — pendiente revisión legal.**
Última actualización: 2026-06-21 · Versión: 0.1 (borrador).

Guardian Praeventio (**encargado del tratamiento**) utiliza los siguientes
**sub-encargados** para prestar el servicio. Cada uno trata datos personales
únicamente para la finalidad indicada y bajo obligaciones contractuales de
protección de datos equivalentes a las del DPA (`docs/legal/DPA.md`, cláusula 6).

| Sub-encargado | Servicio prestado | Categorías de datos | Ubicación de datos | Política de privacidad |
|---|---|---|---|---|
| **Google / Firebase** (Google LLC) | Hosting, autenticación (Google Sign-In), base de datos (Firestore), notificaciones push (FCM) | Datos de cuenta, datos de proyecto y de trabajadores, tokens de dispositivo | Estados Unidos (región Google Cloud `us-central1`) <!-- TODO(legal): confirmar región exacta y mecanismo de transferencia --> | firebase.google.com/support/privacy |
| **Google Gemini** (Google LLC) | Procesamiento de inteligencia artificial (recomendaciones, no decisiones) | Texto de las consultas enviadas a la IA (sin datos personales identificables sin consentimiento) | Estados Unidos <!-- TODO(legal): confirmar región de inferencia y retención del proveedor --> | ai.google.dev/terms |
| **Resend** (Resend, Inc.) | Envío de correos electrónicos transaccionales (invitaciones a proyectos, avisos) | Correo electrónico y contenido del mensaje | Estados Unidos <!-- TODO(legal): confirmar --> | resend.com/legal/privacy-policy |
| **Google Play Billing** (Google LLC) | Verificación y gestión de suscripciones en Android | Token de compra y plan activo (NO datos de tarjeta) | Estados Unidos <!-- TODO(legal): confirmar --> | play.google.com/about/play-terms |

## Notas

- **No vendemos ni comercializamos** datos personales.
- Datos de pago: Praeventio **no almacena datos de tarjetas de crédito**. El
  cobro y la verificación de la compra los realiza la plataforma de pago
  correspondiente.
- Biometría y frames de cámara: se procesan **100% en el dispositivo** y **no se
  envían** a ningún sub-encargado.
- **Cambios:** ante el alta o sustitución de un sub-encargado, el encargado lo
  notificará al responsable con antelación razonable, según la cláusula 6 del DPA.
  <!-- TODO(legal): fijar plazo de preaviso y mecanismo de oposición. -->

<!--
  Procesadores adicionales mencionados en otros documentos del repo (Sentry para
  observabilidad de errores; Transbank/Khipu/Mercado Pago para pagos según país)
  deben evaluarse e incluirse aquí si tratan datos personales de trabajadores.
  TODO(legal): confirmar cuáles aplican como sub-encargados y su ubicación de datos.
-->

---

_Borrador — pendiente revisión legal._
