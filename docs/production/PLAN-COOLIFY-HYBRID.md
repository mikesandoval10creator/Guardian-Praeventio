# Plan de producción híbrida — Guardian Praeventio

**Estado:** decisión inicial autorizada; implementación por slices verificables.
**Fecha:** 2026-10-26
**Commit base inspeccionado:** `c11b4308`

## Decisiones

1. `praeventio.net` será la landing pública.
2. `app.praeventio.net` será la aplicación autenticada y el destino de la PWA/deep links.
3. No se usará `api.praeventio.net` en la primera implementación salvo que una necesidad técnica lo obligue.
4. Coolify será una capa de despliegue dentro de una arquitectura híbrida sobre VPS/servidor propio; no será una migración total de Guardian a Coolify.
5. Los servicios externos y de Google no se eliminan ni se sustituyen por defecto: se mantienen detrás de adapters y pueden seguir operando en paralelo cuando aporten valor.
6. La producción inicial no dependerá de una cuenta de Google Cloud pagada, pero la arquitectura conservará una ruta compatible con Google para una futura expansión.
7. Vertex AI queda fuera de la ruta activa. La integración de IA se migrará a un gateway de proveedores y claves del usuario.
8. TypeScript y Vite+ seguirán siendo la base del producto y del tooling. Python, Rust y Go podrán incorporarse donde resuelvan deuda técnica medible, sin reescritura total.
9. REA, Graphify y Notion seguirán formando parte del flujo de trabajo: se reutilizarán los caminos ya probados para comprender el sistema, relacionar impacto, mantener trazabilidad y planificar mejoras.

## Arquitectura híbrida objetivo inicial

Coolify es una de las capas de ejecución, no el reemplazo de toda la plataforma. Cada servicio queda en Coolify, en un proveedor externo o en Google según coste, disponibilidad, riesgo y reversibilidad.

```text
praeventio.net
  └── Landing pública (Coolify)

app.praeventio.net
  └── Frontend + API Guardian (Coolify, mismo origen)

Servicios internos en Coolify
  ├── PostgreSQL o backend persistente elegido tras inventario de Firestore
  ├── Redis/cola si los jobs lo requieren
  ├── Worker Go para jobs, ingestión y sincronización
  ├── Servicios Rust para lógica determinista/sensible cuando exista contrato
  └── Gateway LLM para claves y proveedores configurados por cada usuario

Dependencias opcionales/futuras
  ├── Firestore/Firebase
  ├── Google KMS
  ├── Vertex AI (desactivado por defecto; no dependencia de producción)
  └── Google Cloud para una segunda plataforma de despliegue
```

## Restricción crítica: datos y autenticación

Coolify no convierte Firestore en una base de datos autohospedada. Antes de producción con cero dependencia de Google debemos clasificar cada uso actual de Firebase/Firestore:

- identidad y sesiones;
- autorización multi-tenant;
- reglas de seguridad;
- lecturas y escrituras de Zettelkasten;
- listeners en tiempo real;
- triggers/materializadores;
- índices y consultas;
- backups y restauración;
- almacenamiento de archivos;
- notificaciones.

No se migrará por intuición. Cada adapter tendrá contrato, pruebas de equivalencia, migración reversible y evidencia de restauración.

## URLs canónicas

- Landing: `https://praeventio.net`
- Aplicación web/PWA: `https://app.praeventio.net`
- API inicial: mismo origen bajo `https://app.praeventio.net/api/*`
- `api.praeventio.net`: no usar en la primera fase; conservar únicamente en documentación histórica o contratos externos que realmente lo exijan.

La landing ya existe en `src/pages/LandingPage.tsx` y el código documenta la separación anónima de la aplicación autenticada.

## Presencia web, descubrimiento y medición

Este bloque se incorpora al plan porque Guardian necesita ser encontrable por las
personas y organizaciones que buscan prevención de riesgos laborales, sin convertir
la medición en una fuga de datos ni confundir la analítica interna de la aplicación
con la medición pública del sitio.

### Alcance aprobado como plan, no como publicación inmediata

- **Analytics público:** seleccionar y configurar un proveedor (Google Analytics
  4 solo después de confirmar propiedad, consentimiento y entorno; mantener la
  opción de un adapter/proveedor alternativo). El tracking debe estar bloqueado
  hasta consentimiento, respetar opt-out, no enviar PII, credenciales, texto libre,
  RUT, ubicación precisa ni identificadores de seguridad, y separar `staging` de
  `production`.
- **Google Business Profile:** crear u optimizar el perfil únicamente si existe
  una entidad, ubicación o área de servicio verificable. No inventar dirección,
  reseñas, horarios ni cobertura; completar categoría, servicios, sitio oficial,
  contacto público y descripción coherente con la oferta real de Guardian.
- **Search Console e indexación:** verificar la propiedad de `praeventio.net`,
  revisar el entorno canónico de producción y solicitar indexación de la landing
  solo después de validar TLS, contenido, consentimiento, `robots.txt`, sitemap y
  ausencia de páginas de staging indexables. La solicitud no garantiza indexación.
- **SEO on-page:** definir títulos y descripciones por ruta pública, incluyendo
  nombre del negocio y servicio real ofrecido; añadir encabezado principal único,
  canonical, `lang`, Open Graph/Twitter y datos estructurados solo cuando los datos
  sean verdaderos y verificables. La aplicación autenticada no debe exponerse como
  contenido indexable por defecto.
- **`robots.txt` y sitemap:** revisar los archivos servidos desde `public/`,
  confirmar que permiten únicamente el rastreo público intencional, bloquean
  rutas privadas y referencian el sitemap canónico. Verificar el resultado desde
  el build servido, no solo desde el repositorio.
- **Investigación de palabras clave:** partir de búsquedas reales relacionadas con
  prevención de riesgos laborales, seguridad laboral, matrices de riesgo,
  capacitación y respuesta ante emergencias; mapear cada intención a contenido
  útil y verificable. No rellenar páginas con keywords ni prometer capacidades que
  el producto aún no tenga.
- **Conversiones:** definir eventos públicos mínimos (por ejemplo, visita a CTA,
  solicitud de contacto y comienzo de registro), con datos agregados y sin PII.
  No mezclar estos eventos con las métricas operacionales o de vida-safety de la
  aplicación.

### Orden verificable

1. Auditar `LandingPage.tsx`, rutas públicas, `index.html`, `public/robots.txt`,
   `public/sitemap.xml`, build y headers del servidor.
   - Hallazgo actual: `index.html` contiene canonical y metadata pública, pero las
     referencias a `https://guard.praeventio.net/og-image.svg` y
     `https://app.praeventio.net/icon-512.png` deben verificarse o corregirse antes
     de publicar; `public/icon-512.png` no existe en el checkout auditado.
   - Hallazgo actual: la landing tiene títulos y descripción dinámica, pero sus
     rutas de información/legal, enlaces externos y dominio efectivo deben
     comprobarse contra la arquitectura aprobada (`praeventio.net` landing y
     `app.praeventio.net` aplicación), evitando asumir que `www` o `guard` son
     dominios activos.
   - Hallazgo actual: existen `public/robots.txt` y `public/sitemap.xml`; falta
     verificar su contenido desde el build realmente servido y probar que el
     fallback SPA no convierta rutas privadas en páginas indexables.
2. Confirmar dominio canónico, propiedad de la marca, alcance geográfico,
   política de privacidad y mecanismo de consentimiento.
3. Implementar metadata, canonical, sitemap/robots y datos estructurados con tests
   o comprobaciones de build.
4. Elegir proveedor de Analytics y configurar staging/prod con consentimiento,
   redacción y opt-out comprobables; no introducir IDs reales antes de confirmar
   propiedad y entorno.
5. Preparar el Perfil de Negocio de Google con información verificable y solicitar
   verificación únicamente cuando corresponda.
6. Verificar Search Console en producción, enviar sitemap y solicitar rastreo de
   la landing; registrar la evidencia y los posibles estados de cobertura.
7. Medir impresiones, consultas, clics, conversiones y errores de rastreo antes de
   modificar contenido; revisar resultados con una ventana temporal suficiente.

Este bloque no autoriza todavía publicar una propiedad de Google, activar IDs de
medición reales ni solicitar indexación. Esas acciones requieren confirmación del
dominio, alcance, consentimiento, privacidad y entorno.

## Caminos de conocimiento, planificación y mejora

La evolución de Guardian no se realizará únicamente desde el editor ni mediante
decisiones aisladas. Cuando sea necesario comprender, mejorar o ampliar la
aplicación, se usarán los caminos que ya demostraron utilidad:

- **REA:** análisis y reverse engineering verificable de artefactos, bundles,
  aplicaciones, dependencias y comportamiento cuando la evidencia está en el
  runtime o en componentes que no se explican suficientemente desde el código.
  REA se usará como herramienta de investigación y evidencia, no como sustituto
  de los contratos, tests o revisión del repositorio.
- **Graphify:** navegación de relaciones, dependencias, impacto y features
  ocultas antes de modificar una superficie de Guardian. Los cambios deberán
  actualizar o reconciliar el índice cuando el código modificado altere el
  grafo relevante.
- **Notion:** fuente operativa para tickets, alcance, estado, decisiones y
  reconciliación posterior al trabajo. Un cambio no se considerará cerrado solo
  porque exista código: deberá conservar vínculo con el ticket y evidencia de
  tests, CI o despliegue según corresponda.

Estos caminos son complementarios: REA aporta evidencia de comportamiento,
Graphify aporta contexto relacional y Notion aporta planificación y trazabilidad.
No se crearán procesos paralelos que dupliquen sus fuentes de verdad. Antes de
introducir una mejora se comprobará si ya existe un camino probado para
explorarla, planificarla, implementarla y verificarla; se preferirá reutilizarlo
antes que inventar una ruta nueva.

## IA: salida de Vertex AI y gateway

La ruta activa no debe depender de Vertex AI ni de cuotas de Google. El gateway debe:

- aceptar claves del usuario sin exponerlas al frontend ni almacenarlas en texto plano;
- soportar proveedores OpenAI-compatible, Anthropic, OpenRouter, Ollama/vLLM y otros mediante adapters;
- aplicar límites por tenant/usuario;
- registrar coste, latencia, errores y proveedor sin registrar prompts sensibles innecesariamente;
- permitir fallback controlado y respuesta degradada;
- separar acciones de seguridad de acciones generativas;
- impedir que una respuesta de LLM bloquee una función crítica de vida-safety;
- mantener el contrato actual de `geminiService` mientras se migra por acción.

El repositorio ya contiene `@modelcontextprotocol/sdk`, un servidor MCP stdio de Zettelkasten y una capa self-hosted OpenAI-compatible. El trabajo pendiente es convertirlo en una superficie operativa segura y no asumir que el MCP stdio existente equivale a un gateway HTTP multiusuario.

## Orden de ejecución

### Slice 0 — base limpia y contrato de despliegue

- sincronizar `main` con `origin/main`;
- resolver el checkout real y documentar la evidencia de workspace;
- inventariar Dockerfiles, comandos de build/start y variables de entorno;
- eliminar ambigüedades de dominio;
- documentar el contrato Coolify sin tocar credenciales;
- consultar Notion para alcance y estado, Graphify para impacto y relaciones, y REA cuando se requiera evidencia de runtime o artefactos;
- definir staging y producción separados.

### Slice 1 — Coolify mínimo reproducible

- provisionar VPS separado de cualquier equipo de desarrollo;
- firewall, usuario administrativo sin root directo, actualizaciones y SSH endurecido;
- instalar Coolify;
- desplegar primero landing/app sin datos reales;
- configurar `praeventio.net` y `app.praeventio.net` en Squarebox;
- validar TLS, health checks, logs y rollback.

### Slice 1.5 — presencia web medible y rastreable

- auditar y corregir SEO técnico de la landing pública;
- verificar `robots.txt`, sitemap, canonical, títulos, descripciones y datos
  estructurados desde el build servido;
- implementar el gate de consentimiento y el adapter de Analytics sin PII;
- definir eventos de conversión públicos y separar sus propiedades de los datos
  operacionales de Guardian;
- preparar, sin publicar todavía, el checklist de Perfil de Negocio de Google;
- verificar Search Console e indexación solo cuando los gates de producción estén
  satisfechos;
- conservar evidencia de cada verificación y no tratar "solicitar indexación" como
  prueba de que Google ya indexó la página.

### Slice 2 — persistencia y auth sin Google pagado

- producir matriz Firestore → backend destino;
- elegir persistencia según consultas reales, no por preferencia tecnológica;
- implementar adapter y migración de prueba;
- validar aislamiento multi-tenant;
- probar backup, restauración y pérdida de nodo;
- ejecutar smoke tests con datos sintéticos.

### Slice 3 — gateway LLM + MCP

- extraer un `LlmProvider` estable;
- migrar una acción de IA a la vez fuera de Vertex/Gemini;
- crear gateway interno autenticado;
- conectar MCP con identidad y tenant explícitos;
- mantener MCP Zettelkasten read-only inicialmente;
- probar límites, revocación, auditoría y fuga de claves.

### Slice 4 — primer servicio Go/Rust

- elegir una deuda concreta respaldada por medición;
- definir contrato JSON/HTTP/gRPC/WASM;
- implementar equivalencia TypeScript;
- comparar resultados en fixtures reales anonimizados;
- añadir métricas, fallback y rollback;
- desplegar como servicio independiente en Coolify.

### Slice 5 — Zettelkasten, AR y producto

Después de estabilizar el camino de producción:

- mantener el ciclo Notion → implementación → tests/CI → evidencia → reconciliación;
- actualizar Graphify después de cambios que alteren relaciones del sistema;
- usar REA para validar comportamiento observable cuando el análisis estático no sea suficiente;
- fortalecer materialización, consultas y navegación Zettelkasten;
- separar procesamiento pesado de AR/photogrammetry;
- evaluar Rust para procesamiento determinista o WASM;
- evaluar Go para jobs y sincronización;
- priorizar features que aumenten valor para los primeros clientes.

## Gates de seguridad

No declarar producción lista hasta verificar literalmente:

- dominio y TLS correctos;
- autenticación y aislamiento multi-tenant;
- persistencia durable;
- backup y restauración ensayados;
- secretos fuera del repositorio;
- logs sin credenciales ni datos sensibles innecesarios;
- rollback probado;
- smoke test de rutas críticas;
- staging separado de producción;
- comportamiento seguro cuando un proveedor LLM falla;
- Android/deep links apuntando a `app.praeventio.net`.

## No hacer todavía

- no borrar Firestore ni sus adapters;
- no desplegar con credenciales reales en staging;
- no convertir Vertex AI en dependencia nueva;
- no exponer claves LLM del usuario al navegador;
- no reescribir todo en Rust o Go;
- no afirmar que Coolify es producción hasta probar restauración y rollback.
