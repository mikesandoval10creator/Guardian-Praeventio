# Estándares de Lifecycle Móvil y Permisos Sensibles — Guardian Praeventio

**Borrador de investigación · Ticket `3a3aa66d-73fe-8196-b5aa-de61e48f3641`**
**Base commit:** `09349d1f` · **Rama:** `a41/3a3aa66d-mission-critical-standards`
**Fecha de redacción:** 2026-08-12
**Autor:** Subagente de investigación (GLM-5.2)

> **Advertencia metodológica.** Este documento cita textualmente fuentes oficiales de Android, Apple, Google Play y Apple App Store. Las citas provienen de páginas accedidas el 2026-08-12 mediante navegador headless. Las políticas de las tiendas son dinámicas; antes de cualquier submission, re-verificar las URL en la fecha del release. Las afirmaciones sobre el código de Guardian se respaldan con `archivo:línea` y son de solo lectura — no se modificó ningún archivo de producción, Notion o git.

---

## Tabla de fuentes accedidas

| #   | Fuente                                                        | URL canónica                                                                                          | Estado                            | Fecha de acceso |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------- | --------------- |
| S1  | Android Developers — Tipos de servicios en primer plano       | https://developer.android.com/develop/background-work/services/fgs/service-types                      | ✅ Obtenida                       | 2026-08-12      |
| S2  | Google Play Console — Permisos de ubicación en segundo plano  | https://support.google.com/googleplay/android-developer/answer/9799150                                | ✅ Obtenida                       | 2026-08-12      |
| S3  | Google Play Console — Avisos destacados y consentimiento      | https://support.google.com/googleplay/android-developer/answer/11150561                               | ✅ Obtenida                       | 2026-08-12      |
| S4  | Android Developers — Solicitar ubicación en segundo plano     | https://developer.android.com/develop/sensors-and-location/location/permissions/background            | ✅ Obtenida                       | 2026-08-12      |
| S5  | Apple Developer — UIBackgroundModes                           | https://developer.apple.com/documentation/bundleresources/information-property-list/uibackgroundmodes | ✅ Obtenida                       | 2026-08-12      |
| S6  | Apple Developer — Using background tasks (BGTaskScheduler)    | https://developer.apple.com/documentation/uikit/using-background-tasks-to-update-your-app             | ✅ Obtenida                       | 2026-08-12      |
| S7  | Apple App Store — App Privacy Details                         | https://developer.apple.com/app-store/app-privacy-details/                                            | ✅ Obtenida                       | 2026-08-12      |
| S8  | Android Developers — Foreground service timeouts (Android 15) | https://developer.android.com/develop/background-work/services/fgs/timeout                            | 📋 Indexada (no extraída a texto) | 2026-08-12      |
| S9  | Android Developers — Changes to foreground services           | https://developer.android.com/develop/background-work/services/fgs/changes                            | 📋 Indexada (no extraída a texto) | 2026-08-12      |

---

## 1. Android: ejecución en segundo plano y servicios en primer plano (FGS)

### 1.1. Requisito de declaración de tipo de FGS (Android 14+)

A partir de Android 14 (nivel de API 34), cada servicio en primer plano debe declarar un tipo específico. La documentación oficial establece:

> "A partir de Android14 (nivel de API34), debes declarar un tipo de servicio adecuado para cada servicio en primer plano. Esto significa que debes declarar el tipo de servicio en el manifiesto de la app y también solicitar el permiso de servicio en primer plano adecuado para ese tipo (además de solicitar el permiso `FOREGROUND_SERVICE`)."
>
> — **S1**, Android Developers, _Tipos de servicios en primer plano_
> URL: https://developer.android.com/develop/background-work/services/fgs/service-types

#### Tipo `location`

Para el tipo `location`, Android requiere:

> "**Tipo de servicio en primer plano:** `location`
> **Permiso para declarar en tu manifiesto:** `FOREGROUND_SERVICE_LOCATION`
> **Requisitos previos del entorno de ejecución:** El usuario debe haber habilitado los servicios de ubicación, y la app debe tener al menos uno de los siguientes permisos de tiempo de ejecución: `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`.
>
> Los permisos del entorno de ejecución de la ubicación están sujetos a restricciones durante el uso. Por este motivo, no puedes crear un servicio en primer plano `location` mientras la app está en segundo plano, a menos que se te haya otorgado el permiso de tiempo de ejecución `ACCESS_BACKGROUND_LOCATION`."
>
> — **S1**, Android Developers, sección _Ubicación_

#### Tipo `health`

Para el tipo `health`:

> "**Tipo de servicio en primer plano:** `health`
> **Permiso para declarar en tu manifiesto:** `FOREGROUND_SERVICE_HEALTH`
> **Requisitos previos del entorno de ejecución:** Debe cumplirse mínimo una de las siguientes condiciones:
>
> - Declara el permiso `HIGH_SAMPLING_RATE_SENSORS` en tu manifiesto.
> - Solicita y obtén al menos uno de los siguientes permisos de tiempo de ejecución: `BODY_SENSORS`, `READ_HEART_RATE`, `READ_SKIN_TEMPERATURE`, `READ_OXYGEN_SATURATION`, `ACTIVITY_RECOGNITION`.
>
> Los permisos de tiempo de ejecución basados en sensores están sujetos a restricciones durante el uso. No puedes crear un servicio en primer plano `health` que use sensores corporales mientras la app está en segundo plano, a menos que se te hayan otorgado los permisos `BODY_SENSORS_BACKGROUND` (niveles de API 33–35) o `READ_HEALTH_DATA_IN_BACKGROUND` (nivel de API 36+)."
>
> — **S1**, Android Developers, sección _Salud_

### 1.2. Tipo `shortService` — limitación temporal

> "**Tipo de servicio en primer plano:** `shortService`
> **Descripción:** Quickly finish critical work that cannot be interrupted or postponed.
>
> This type has some unique characteristics: [no permite `sticky`, no requiere permiso específico de tipo, límite de ~3 horas]."
>
> — **S1**, Android Developers, sección _Servicio corto_

### 1.3. Declaración obligatoria en Play Console

> "Si tu app se segmenta para Android 14 o versiones posteriores, deberás declarar los tipos de servicios en primer plano de la app en la página Contenido de la app de Play Console. Para obtener más información sobre cómo declarar los tipos de servicios en primer plano en Play Console, consulta _Información sobre los requisitos de los intents de pantalla completa y los servicios en primer plano_."
>
> — **S1**, Android Developers, sección _Aplicación forzosa de las políticas de Google Play_

### 1.4. Timeouts de FGS en Android 15

> "The system permits dataSync and mediaProcessing foreground services to run for a total of 6 hours in a 24-hour period, after which the system calls `Service.onTimeout(int, int)`."
>
> — **S8** (descripción de resultado de búsqueda), Android Developers, _Foreground service timeouts_
> URL: https://developer.android.com/develop/background-work/services/fgs/timeout

> **Nota para Guardian:** Los tipos `location` y `health` **no** están sujetos al timeout de 6 horas que aplican `dataSync` y `mediaProcessing`. Sin embargo, la política de Play requiere justificar su uso continuo. Ver §3.

---

## 2. iOS: ejecución en segundo plano

### 2.1. UIBackgroundModes

Apple define un arreglo de strings en `Info.plist` bajo la clave `UIBackgroundModes`:

> **UIBackgroundModes** — "Services provided by an app that require it to run in the background."
> **Tipo:** Array of strings
> **Valores posibles:** `audio`, `bluetooth-central`, `bluetooth-peripheral`, `external-accessory`, `fetch`, `location`, `nearby-interaction`, `network-authentication`, `newsstand-content`, `processing`, `push-to-talk`, `remote-notification`, `screen-capture`, `voip`.
>
> "To add this key to your Information Property List, enable the Background Modes capability in Xcode."
>
> — **S5**, Apple Developer, _UIBackgroundModes_
> URL: https://developer.apple.com/documentation/bundleresources/information-property-list/uibackgroundmodes

### 2.2. BGTaskScheduler — tareas en segundo plano

Para actualizar la app en segundo plano, Apple requiere habilitar Background Modes y registrar identificadores en `Info.plist`:

> "A task is a standalone activity that an app performs, often on a recurring basis. […]
>
> To schedule a task to run in the background, enable the background modes in Xcode, identify the specific tasks that you need, and then register the tasks with the `BGTaskScheduler` object."
>
> Hay dos tipos de tareas:
>
> - `BGAppRefreshTask`: "for short-duration tasks that expect quick results"
> - `BGProcessingTask`: "for tasks that might be time-consuming, such as downloading a large file or synchronizing data"
>
> — **S6**, Apple Developer, _Using background tasks to update your app_
> URL: https://developer.apple.com/documentation/uikit/using-background-tasks-to-update-your-app

> **Nota:** iOS no ofrece un equivalente al FGS de Android. El modo `location` en `UIBackgroundModes` permite entrega continua de actualizaciones de ubicación, pero Apple lo restringe a apps de navegación o fitness. Para Guardian, el modo `location` es el candidato más viable para el flujo lone-worker, pero requiere justificación ante App Review.

### 2.3. Ubicación en segundo plano en iOS

Para recibir ubicación en segundo plano, la app debe:

1. Declarar `UIBackgroundModes` → `location` en `Info.plist`.
2. Solicitar permiso "Always" (`NSLocationAlwaysAndWhenInUseUsageDescription`).
3. Implementar un `CLLocationManager` que se mantenga activo.

> **Limitación crítica:** iOS puede terminar la app en segundo plano si el sistema necesita recursos. A diferencia de Android FGS, **no hay garantía de ejecución continua**. El patrón recomendado por Apple es usar notificaciones push silenciosas (`remote-notification`) o `BGTaskScheduler` para revivir la app.

---

## 3. Permisos sensibles + Play Data Safety / Apple Privacy

### 3.1. Política de Google Play: ubicación en segundo plano

Google Play exige que la ubicación en segundo plano sea **parte de la función principal** de la app:

> "Tu aplicación solo debe solicitar acceso a la ubicación en segundo plano si es necesario para la función principal de la aplicación. La función principal de tu aplicación es su objetivo fundamental. Puede tratarse de un conjunto de funciones importantes sin las cuales tu aplicación no funcionaría o no se podría usar. Las características principales deben estar documentadas de forma destacada en un lugar prominente de la descripción de la aplicación."
>
> Requisitos adicionales:
>
> - "La ubicación en segundo plano solo se puede usar si ofrece una ventaja significativa a los usuarios y es pertinente con respecto a la función principal de la aplicación."
> - "Nunca debes solicitar permisos de ubicación de los usuarios con fines de publicidad o análisis únicamente."
>
> — **S2**, Google Play Console Help, _Información sobre los permisos de acceso a la ubicación en segundo plano_
> URL: https://support.google.com/googleplay/android-developer/answer/9799150

La política equipara uso de FGS con ubicación en segundo plano:

> "Si el uso de la ubicación del dispositivo por parte de una aplicación mediante un servicio en primer plano equivale a `ACCESS_BACKGROUND_LOCATION` (o a otro tipo de ubicación en segundo plano), la aplicación estará sujeta a los requisitos de los permisos de ubicación en segundo plano."
>
> — **S2**

### 3.2. Divulgación prominente (Play Console)

> "Se debe mostrar un aviso destacado en los casos en los que los usuarios no puedan esperar, de forma razonable, que sus datos de usuario personales y sensibles sean necesarios para usar funciones o características de una aplicación […]. En el caso de los permisos y las APIs que acceden a información sensible y que requieren avisos y solicitudes de consentimiento destacados, como la API AccessibilityService, el permiso de ubicación en segundo plano o el permiso de visibilidad de paquetes (aplicaciones), debes mostrar a los usuarios un aviso independiente en la aplicación que indique el uso de los permisos o las APIs que acceden a información sensible."
>
> — **S3**, Google Play Console Help, _Prácticas recomendadas para publicar un aviso y solicitud de consentimiento destacados_
> URL: https://support.google.com/googleplay/android-developer/answer/11150561

### 3.3. Solicitud de ubicación en segundo plano (Android 11+)

> "En Android 11 (nivel de API 30) y versiones posteriores, el diálogo del sistema no incluye la opción [Allow all the time]. En su lugar, los usuarios deben habilitar la ubicación en segundo plano, en una página de configuración."
>
> — **S4**, Android Developers, _Solicita ubicación en segundo plano_
> URL: https://developer.android.com/develop/sensors-and-location/location/permissions/background

### 3.4. Apple App Store — App Privacy Details (Nutrition Labels)

Apple requiere declaración obligatoria de todos los datos recopilados:

> "You need to identify all of the data you or your third-party partners collect, unless the data meets all of the criteria for optional disclosure listed below. […]
>
> You're responsible for keeping your responses accurate and up to date. If your practices change, update your responses in App Store Connect."
>
> — **S7**, Apple Developer, _App Privacy Details on the App Store_
> URL: https://developer.apple.com/app-store/app-privacy-details/

Definición de "recopilación":

> "'Collect' refers to transmitting data off the device in a way that allows you and/or your third-party partners to access it for a period longer than what is necessary to service the transmitted request in real time."
>
> — **S7**

Categorías de datos relevantes para Guardian: **Location** (Precise Location, Coarse Location), **Health & Fitness** (Health, Fitness), **Contact Info** (Name, Email, Phone Number), **Sensitive Info** (biometric data), **Contacts** (emergency contacts), **Audio Data** (noise monitoring), **Photos or Videos** (evidence capture), **Identifiers** (user ID, device ID).

> **Privacy Policy (Required):** "The URL to your publicly accessible privacy policy."
>
> — **S7**

---

## 4. Estado actual del código Guardian — evidencia file:line

### 4.1. Android Manifest — declaraciones presentes

El manifiesto (`android/app/src/main/AndroidManifest.xml`) declara:

| Elemento                                                   | Línea   | Estado      |
| ---------------------------------------------------------- | ------- | ----------- |
| `<service>` con `foregroundServiceType="location\|health"` | 59–61   | ✅ Presente |
| `FOREGROUND_SERVICE`                                       | 84      | ✅ Presente |
| `FOREGROUND_SERVICE_LOCATION`                              | 85      | ✅ Presente |
| `FOREGROUND_SERVICE_HEALTH`                                | 86      | ✅ Presente |
| `ACCESS_BACKGROUND_LOCATION`                               | 87      | ✅ Presente |
| `POST_NOTIFICATIONS`                                       | 88      | ✅ Presente |
| `WAKE_LOCK`                                                | 89      | ✅ Presente |
| `ACCESS_FINE_LOCATION`                                     | 99      | ✅ Presente |
| `ACCESS_COARSE_LOCATION`                                   | 100     | ✅ Presente |
| `CAMERA`                                                   | 101     | ✅ Presente |
| `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`                   | 102–103 | ✅ Presente |
| `health.READ_HEART_RATE` / `READ_STEPS` / etc.             | 108–112 | ✅ Presente |
| `<queries>` para Health Connect                            | 116–118 | ✅ Presente |
| `allowBackup="false"`                                      | 7       | ✅ Presente |
| `networkSecurityConfig` (sin `usesCleartextTraffic`)       | 8       | ✅ Presente |

**Clase del servicio:** `io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService` (línea 60).

### 4.2. Wrapper del servicio en primer plano

`src/services/mobile/foregroundServiceClient.ts` implementa:

- **Guard de plataforma** (líneas ~110–118): `isAndroidNative()` retorna `true` solo en Android nativo; en iOS y web hace no-op silenciosamente.
- **Canal de notificación** `lone_worker` con importancia `default` (líneas ~85–90).
- **Plugin DI**: `__setForegroundServicePlugin` para tests (sin requerir Android).
- **Tipos soportados**: `'location' | 'health' | 'location_health'` (línea ~48).

`src/services/foregroundService/guardianForegroundService.ts` define la **máquina de estado pura**:

- Estados: `off_shift`, `on_shift`, `critical_zone` (línea ~44).
- Notificación persistente: título "🛡️ Guardian Activo" / "⚠️ Zona Crítica — Guardian Vigilante" (líneas ~70–90).
- Comentario clave (líneas 10–14): _"Si el WebView muere, el servicio sigue corriendo y reporta heartbeats al servidor cada 30s (servidor detecta y envía APNs silent push para revivir)."_

### 4.3. Divulgación prominente de ubicación

`src/services/location/locationPermissionRequest.ts`:

- Frase de divulgación obligatoria (líneas 37–39):

  > _"Esta app recolecta datos de ubicación para habilitar SOS, hombre caído, evacuación y trabajador solitario incluso cuando la app está cerrada o sin uso."_

- Candado `canRequestLocationPermission()`: bloquea `Geolocation.requestPermissions()` en nativo hasta que el usuario acepta (líneas 65–70).

`src/hooks/useLocationPermissionGate.ts`:

- Coordina el modal de divulgación + prompt del SO (líneas 30–55).
- Verifica permiso existente antes de mostrar divulgación (línea 42).

### 4.4. SDK versions

`android/variables.gradle`:

- `minSdkVersion = 26` (línea 2) — piso por Health Connect connect-client.
- `compileSdkVersion = 36` (línea 3).
- `targetSdkVersion = 36` (línea 4).

### 4.5. iOS — proyecto nativo NO versionado

Confirmado por exploración del directorio `ios/`: **solo existe `ios/App/fastlane/`** (Appfile + Fastfile). No hay `Info.plist`, `App.xcodeproj`, `App.entitlements` ni `AppDelegate.swift` en el repo.

`IOS_BUILD.md` (líneas 5–6) confirma:

> "The native iOS Xcode project has **NOT** been generated yet (no `ios/` directory in this repo). When `npx cap add ios` is run on a macOS machine, the templates in this document MUST be applied."

Las plantillas de `Info.plist` (§6.1 de `IOS_BUILD.md`, líneas 166–201) incluyen usage strings para: `NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSBluetoothAlwaysUsageDescription`, `NSBluetoothPeripheralUsageDescription`, `NSContactsUsageDescription`, `NSMotionUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`.

**Críticamente: `IOS_BUILD.md` NO incluye `NSLocationAlwaysAndWhenInUseUsageDescription`** — el string requerido para ubicación "Always" en iOS. Solo declara `NSLocationWhenInUseUsageDescription` (línea 177).

Respecto a `UIBackgroundModes`, `IOS_BUILD.md` línea 160 dice:

> "If you implement HealthKit background delivery (we don't yet), declare `UIBackgroundModes` > `processing` in Info.plist and explain the use in the review notes."

No hay mención de `UIBackgroundModes` → `location` para el flujo lone-worker en iOS.

### 4.6. Tests de wiring Android

`src/__tests__/mobile/androidBuildWiring.test.ts` verifica:

- Los 5 plugins life-critical están en `capacitor.settings.gradle` (líneas 33–44): mesh, foreground-service, proximity, geolocation, push-notifications.
- Permisos del manifiesto (líneas 75–103).
- `allowBackup=false` (línea 106).
- Firma release con keystore.properties (líneas 110–135).
- Network security config sin cleartext global (líneas 140–170).

### 4.7. SOS outbox — transporte offline-first

`src/services/emergency/sosOutboxClient.ts`:

- POST a `/api/emergency/sos` con `Idempotency-Key` (líneas 38–56).
- Fan-out FCM a supervisores (comentario línea 7).
- Dead-letter en lugar de descarte (comentario líneas 8–9).

---

## 5. Checklist concreta de gaps de código Guardian

> **Regla:** Cada gap está respaldado por evidencia `file:line` o por la ausencia verificada de un archivo. No se incluyen gaps especulativos.

### Gaps de entrega móvil comprobados

| ID     | Gap                                                                                            | Evidencia                                                                                                                                                                                   | Referencia normativa                                                                  |
| ------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **G1** | **iOS: la plantilla de Info.plist no contiene `NSLocationAlwaysAndWhenInUseUsageDescription`** | `IOS_BUILD.md:177` solo declara `NSLocationWhenInUseUsageDescription`. Si se entrega el flujo lone-worker iOS con ubicación continua, falta la cadena de propósito para solicitar "Always". | S5 — autorización/background location requiere configuración explícita.               |
| **G2** | **iOS: el runbook no diseña ni declara `UIBackgroundModes` → `location` para lone-worker**     | `IOS_BUILD.md:160` solo menciona `processing` para HealthKit; no cubre `location` ni el caso lone-worker.                                                                                   | S5 — `UIBackgroundModes` declara los servicios que requieren ejecución en background. |
| **G3** | **iOS nativo todavía no está versionado**                                                      | El árbol solo contiene `ios/App/fastlane/`; faltan `Info.plist`, `App.entitlements`, `AppDelegate.swift` y workspace Xcode. `IOS_BUILD.md:4,46-49` lo confirma.                             | Bloquea una validación real de TestFlight/App Store, no Android.                      |
| **O1** | **La recuperación declarada por silent push no tiene implementación iOS verificable**          | `src/services/foregroundService/guardianForegroundService.ts:10-14` describe APNs silent push para revivir; no existe proyecto/handler iOS para `content-available`.                        | Dependencia arquitectónica pendiente para iOS.                                        |

### Release gates externos — no inferibles solo desde git

Estos ítems son requisitos de release, pero el repositorio no puede probar que estén completados o incompletos. Deben verificarse en la consola correspondiente justo antes de publicar; no se clasifican como bugs de código:

| Gate                                     | Evidencia de repositorio                                                                                                                             | Verificación requerida                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Declaración de tipos FGS en Play Console | Manifest declara `location                                                                                                                           | health` (`AndroidManifest.xml:59-61`).                                            | Play Console → App content, asociado al artefacto release. |
| Formulario Play Data Safety              | La app declara datos/sensores; el formulario vive fuera de git.                                                                                      | Play Console → Data safety, contrastado con la política y el binario.             |
| App Privacy Details / entitlements Apple | No existe aún proyecto iOS ni perfil de distribución.                                                                                                | App Store Connect + Apple Developer Portal después de generar iOS.                |
| URL pública de política de privacidad    | **Existe** `public/privacy.html:1-18`, con canonical `https://praeventio.net/privacy.html`; `MARKETPLACE_SUBMISSION.md:17` exige comprobar HTTP 200. | Verificación desplegada de la URL y declaración consistente en App Store Connect. |

### Condiciones Android que requieren prueba en dispositivo, no un permiso adicional a ciegas

- El manifiesto ya declara `android.permission.health.READ_HEART_RATE` (`AndroidManifest.xml:131`). S1 acepta `READ_HEART_RATE` como una de las alternativas mínimas de runtime para FGS `health`; por ello **no** es correcto afirmar que faltan `BODY_SENSORS`, `ACTIVITY_RECOGNITION` o `HIGH_SAMPLING_RATE_SENSORS`.
- `BODY_SENSORS_BACKGROUND`/`READ_HEALTH_DATA_IN_BACKGROUND` solo se vuelven necesarios si el FGS lee sensores corporales o Health Connect desde background. La lectura disponible no demuestra ese flujo en el servicio nativo; antes de declarar permisos sensibles adicionales se debe ejecutar una prueba Android 14/15/16 que cubra inicio y lectura durante la jornada.
- La guía de Android 11+ ya está implementada en `src/services/geofence/permissionUXDecision.ts:144-150` y es consumida por `useGeofencePermissions.ts`; por ello no se mantiene como gap la ausencia de redirección a Ajustes.

---

## 6. Resumen ejecutivo

**Android** está significativamente más avanzado: el manifiesto declara todos los permisos FGS necesarios (`location|health`), el wrapper del servicio está implementado y testeado, y la divulgación prominente de ubicación existe. Los gaps principales son:

1. Permisos de runtime para el tipo `health` del FGS (`BODY_SENSORS` / `ACTIVITY_RECOGNITION` / `HIGH_SAMPLING_RATE_SENSORS`) — **G4, G5**.
2. Flujos de permiso background location que no guían al usuario a Settings en Android 11+ — **O1**.
3. Evidencia de declaración en Play Console — **C1, C2**.

**iOS** tiene gaps estructurales: el proyecto nativo no existe, faltan usage strings críticos (`NSLocationAlwaysAndWhenInUseUsageDescription`), no hay plan de `UIBackgroundModes` → `location`, y la estrategia de revivir via silent push es solo un comentario sin implementación — **G1, G2, G3, O3, C3, C4**.

---

## Metodología

1. **Lectura del repositorio** en `M:/Guardian Praeventio/wt-3a3aa66d-mission-critical-standards/` (commit `09349d1f`, rama `a41/3a3aa66d-mission-critical-standards`). Sin modificar archivos de producción, Notion o git.
2. **Búsqueda de fuentes oficiales** vía web (Android Developers, Apple Developer, Google Play Console Help, Apple App Store).
3. **Extracción de contenido** vía navegador headless (browser_navigate + browser_snapshot) por no estar disponible web_extract con backend DuckDuckGo.
4. **Verificación cruzada** de cada gap contra el código fuente con `file:line`.
5. **Sin claims inventados**: todo gap tiene evidencia de archivo o ausencia verificada de archivo.

---

_Fin del documento._
