# Plan de producción híbrida — Guardian Praeventio

**Estado:** plan reconciliado con los acuerdos de Daniel; ejecución funcional pendiente de retomar.
**Creado:** 2026-10-26 · **Actualizado:** 2026-10-27
**Base histórica:** `c11b4308`; no representa el HEAD actual.
**Snapshot de esta actualización documental:** rama `fix/recover-technical-debt-20261027`, HEAD `5417fae4d6d61220dca75d6b3ad9d28d9f900ce3`.

## Continuidad y alcance vigente

Este es el plan canónico de evolución híbrida, no un backlog alternativo a Notion.
La actualización reconcilia las conversaciones de Larry del 22–26 de octubre y
los documentos existentes; no inicia implementación, instala herramientas, crea
infraestructura, fusiona PRs ni autoriza producción por sí sola. Las propuestas
siguen siendo propuestas hasta su implementación y verificación.

- **Workspace de desarrollo:** `M:/Guardian Praeventio/repo-live`. Preservar el
  checkout de C y el trabajo conjunto existente; no usar `reset --hard`, `clean`
  ni sincronizaciones destructivas para recuperar contexto.
- **Dirección:** arquitectura híbrida y reversible, Zettelkasten como tejido causal,
  gateway LLM/MCP, digital twin/AR operativo y adopción incremental de lenguajes.
  No reiniciar una planificación genérica ni relegar Rust a después de Coolify.
- **Orden inmediato:** reconciliar la base de integración pendiente y después
  retomar la implementación equivalente Rust del worker. Los pasos técnicos y
  criterios de salida se definen en «Orden de ejecución vigente».
- **Herramientas:** Vite+ debe usarse en los comandos reales; REA, Graphify, Notion
  y Obsidian conservan sus funciones complementarias. Sus instalaciones o notas
  no prueban disponibilidad ni cobertura end-to-end.

### Estado de partida, no certificado de producto completo

| Frente | Evidencia recuperada y comprobada el 2026-10-27 | Trabajo que sigue pendiente |
|---|---|---|
| Base compartida | #1874 publicado en borrador, `DIRTY`, sin checks reportados; cinco archivos sin resolver en el worktree de integración | Reconciliar con los cambios ya fusionados sin perder nuestras correcciones; gates y CI del SHA resultante |
| Zettelkasten y clima | #1866 y #1867 `MERGED` | Validar los productores/consumidores restantes y sus recorridos reales; no repetir arreglos antiguos ni declarar convergencia global |
| Vite+ | #1868 `MERGED`; adopción inicial integrada | Usarlo en cada slice y verificar runner, runtime y gates actuales; conservar comparación explícita con el runner anterior cuando corresponda |
| Resiliencia | #1872 y #1873 `MERGED` | Reconciliar su solapamiento con #1874; merge no equivale a cero leaks ni a cancelación de cualquier adapter |
| Rust y Go | Instalación autorizada por Daniel el 26 de octubre; `rustc/cargo 1.99.1`, `go1.27.3 windows/amd64` comprobados por ruta absoluta | Implementar equivalencia Rust del algoritmo, no reinstalar toolchains ni confundir un probe con el motor terminado |
| Comparación del grafo | Fixtures compartidos 100/1.000/10.000 y mediciones TypeScript conservados; prototipo Rust inspeccionado carga y valida los fixtures | Dinámica equivalente, tolerancia numérica, WASM real y medición end-to-end; pool productivo aún no acreditado |
| Gateway LLM/MCP | Adapters y resolver backend parciales documentados en `LOCAL-WORK-CONTINUITY.md` | Almacén seguro de claves, aislamiento completo, cuotas/fallback y MCP multiusuario autenticado; no declararlos terminados |
| Coolify, datos y auth | Contrato inicial documentado | Fuente de verdad de imágenes/pipeline, backend/proxy real, adapters, staging, restauración y rollback; despliegue no acreditado |
| Digital twin/AR/CAD | Línea de evolución acordada y referencia ArtCraft identificada | Revalidar capacidades existentes y cerrar un recorrido operacional, con licencias y criterios funcionales |
| SEO y medición | Incluidos en este plan | Verificación técnica y consentimiento antes de activar servicios o solicitar indexación |

Los estados GitHub son un corte temporal, no una orden automática de merge. En la
revisión también seguían abiertos #1869, #1870 y #1871, `CLEAN`, cada uno con 37
checks `SUCCESS`; deberán revisarse contra su SHA y base actuales antes de actuar.
Notion no se volvió a consultar durante esta reconciliación: no hay conteo nuevo
ni tickets cerrados por esta actualización.

### Trazabilidad de acuerdos y documentos

- Larry: sesión `20261025_223434_4b8e7776`; mensajes 750758/750927
  (híbrido y dominios), 751740 (REA/Graphify/Notion), 759152/759385
  (ArtCraft y técnicas gráficas), 759844 (presencia web), 760517
  (adelantar evaluación Rust/Go) y 761601 (instalación autorizada).
- El punto de continuación recuperado en la respuesta 762109 es implementar la
  dinámica equivalente Rust y comparar con TypeScript, no volver a empezar el
  benchmark. La propuesta de motor espacial anterior no sustituye ese slice.
- [`COOLIFY-DEPLOYMENT-CONTRACT.md`](COOLIFY-DEPLOYMENT-CONTRACT.md): contrato
  operacional y condiciones antes de desplegar; conserva inventario histórico.
- [`RUST-GO-FEASIBILITY-GATE.md`](RUST-GO-FEASIBILITY-GATE.md): contratos,
  equivalencia, benchmark, fallback y autorización posterior de toolchains.
- [`LOCAL-WORK-CONTINUITY.md`](LOCAL-WORK-CONTINUITY.md): trabajo compartido,
  evidencia local y límites; sus resultados históricos no certifican otro SHA.
- Intención de producto: `ZETTELKASTEN_V2_SPEC.md`,
  `docs/SPRINT_K_REFORMULATED.md`, `docs/specs/` y ADR aplicable, contrastados
  siempre con código actual, evidencia de Obsidian y ticket canónico de Notion.

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

## Orden de ejecución vigente

Este orden sustituye la secuencia inicial del 26 de octubre: la evaluación
Rust/WASM se adelanta al despliegue, y Zettelkasten no se pospone íntegramente
hasta después de producción. La numeración anterior se conserva solo como
referencia: Slice 0 → A/C; Slice 1 → F; Slice 1.5 → G; Slice 2 → D;
Slice 3 → E; Slice 4 → B/H; Slice 5 → D/H.

La actualización de este plan es el paso documental solicitado ahora. La
implementación comenzará después, siguiendo estos criterios y el alcance vigente.

### A — Reconciliar la base compartida, sin perder avances

- Releer el diff y estado remoto de #1874 y los cambios ya integrados por
  #1872/#1873; resolver semánticamente los cinco conflictos del worktree de
  integración, sin elegir indiscriminadamente una versión.
- Preservar nuestras correcciones de tenant-routing, HTTP, deadlines, tests,
  tooling y arquitectura; no tratarlas como cambios ajenos descartables.
- Revisar los PRs abiertos para evitar duplicación o solapamiento; no hacer
  merges en lote basados en un estado verde anterior.
- Validar primero regresiones focales y la vertical afectada; después typecheck,
  lint, suite aplicable, revisión adversarial y CI del SHA resultante.
- Reconciliar evidencia y tickets cuando corresponda. Exit 0 no demuestra cero
  leaks; no presentar una suite histórica como prueba de una nueva resolución.

**Salida:** base reconciliada y revisable, sin conflictos, con evidencia del SHA
actual y preservación comprobada de los contratos. No implica producción lista.

### B — Retomar Rust/WASM: dinámica equivalente del worker

- Reutilizar los fixtures compartidos y resultados conservados de 100, 1.000 y
  10.000 nodos. Repetir una línea base solo si cambió el código, el fixture o el
  entorno de medición; conservar versión/hash para una comparación reproducible.
- Implementar en Rust la dinámica equivalente de `forceGraphWorker.ts`, no una
  aproximación, un contador ni solo validación de JSON. Respetar el contrato 2D/3D,
  inicialización, iteraciones, errores y determinismo del algoritmo de referencia.
- Acordar y documentar tolerancia numérica y beneficio mínimo antes de decidir
  adopción; no inventar un umbral retrospectivo para hacer ganar al candidato.
- Comparar invariantes y resultados en fixtures compartidos, incluidos errores,
  ejecuciones repetidas e independencia entre trabajos.
- Compilar el algoritmo real a WASM y medir por separado cálculo, carga inicial,
  serialización/deserialización, transferencia, memoria, p50/p95/p99 y tamaño.
- Comparar el recorrido real Worker/WASM, no solo Rust nativo contra JS; conservar
  TypeScript como referencia y fallback, sin cambiar todavía la ruta productiva.

**Salida:** comparativa reproducible y veredicto adoptar/ajustar/no adoptar.
Compilar un probe WASM o cargar fixtures no satisface este criterio.

### C — Contrato operacional y ejecución acotada

- Cerrar el contrato Coolify existente: Dockerfile canónico, workflow, variables,
  clasificación de `firebase-applet-config.json`, comandos y puertos.
- Probar imágenes, API real `/api/health`, proxy `/api/*`, headers/CORS y deep links
  con datos sintéticos; un preview estático no prueba funcionamiento del backend.
- Donde el worker requiera ejecución concurrente, definir y probar pool acotado,
  cola, backpressure, cancelación/expiración y límites de entrada/salida/memoria.
  Medir tiempo en cola separado del cálculo y contención bajo carga; no convertir
  la concurrencia de un benchmark en promesa multiusuario del backend.
- Conservar fallback y rollback por feature flag/versionado si B justifica adoptar
  un motor nuevo; no añadir Rust como servicio remoto si basta Worker/WASM.

**Salida:** contratos y pruebas de operación reproducibles. Un pool o despliegue
no se considera implementado por estar descrito aquí.

### D — Datos, autenticación y convergencia Zettelkasten

- Clasificar cada dependencia real de Firebase/Firestore y su disponibilidad;
  elegir backend por consultas/contratos, sin borrar adapters ni asumir que Coolify
  sustituye identidad, reglas, persistencia, storage, colas o notificaciones.
- Construir adapters y migraciones de prueba reversibles con backup, restauración,
  pérdida de nodo y aislamiento multi-tenant comprobables.
- Seguir por vertical: productor → tipo runtime/allowlist → API autorizada →
  persistencia/materialización → consumidor → lectura observable.
- Validar aristas tipadas/inversas, backlinks, consultas, RAG/KnowledgeBase,
  obsolescencia, sincronización offline y cambio de proyecto/tenant. Un catálogo
  con rutas existentes no demuestra emisión ni consumo de sus tipos.
- Tratar Sprint K como funciones de sus dominios. Preservar proyecciones legacy
  justificadas y completar integración, no borrar capacidades para simplificar.

**Salida:** recorridos concretos con evidencia y tickets reconciliados, sin
atribuir cobertura global a un conjunto de tests focalizados.

### E — Gateway LLM y MCP operativo seguro

- Estabilizar `LlmProvider` y migrar una acción a la vez fuera de Vertex/Gemini,
  conservando compatibilidad y degradación segura.
- Implementar custodia de claves backend-only, cifrado en reposo, rotación y
  revocación; probar aislamiento de credenciales y circuitos por tenant/usuario.
- Añadir cuotas/coste, métricas redactadas, límites y fallback verificables.
- Conectar MCP con autenticación, autorización, tenant/proyecto explícitos,
  auditoría y rate limiting; Zettelkasten inicialmente read-only.
- Probar errores, abuso, fuga de claves y aislamiento. Escrituras MCP requieren
  autorización y reversión; no son parte del permiso read-only.

**Salida:** una vertical IA/MCP verificable sin dependencia de Vertex ni autoridad
LLM sobre vida-safety; un resolver por entorno no acredita el gateway completo.

### F — Coolify/staging y ruta híbrida desplegable

- Confirmar VPS separado y alcance autorizado antes de provisionar, incurrir en
  costes o modificar DNS; verificar proveedor real, no asumirlo por el nombre.
- Endurecer SSH/firewall/actualizaciones y separar secretos, datos y servicios de
  staging/producción. Mantener Google/servicios externos donde aporten valor.
- Desplegar landing/app/API con datos sintéticos, dominios canónicos y TLS; probar
  health/readiness, logs, métricas, deep links, recuperación y rollback.
- Si auth/datos/IA aún no están resueltos, etiquetar la capacidad del entorno con
  precisión: una landing o shell en staging no es la aplicación completa operativa.

**Salida:** staging con read-back y recuperación probados. La promoción a producción
requiere autorización y todos los gates; no la habilita el final de un slice.

### G — Presencia web y medición, sin adelantar publicación

- Ejecutar el bloque de SEO/consentimiento de este plan: metadata, canonical,
  sitemap/robots, rutas públicas/privadas y assets desde el build servido.
- Preparar Analytics sin PII, eventos mínimos de conversión y opt-out; activar
  propiedades reales solo con titularidad, consentimiento y entorno confirmados.
- Preparar Perfil de Negocio con información verificable; Search Console y
  solicitud de indexación solo cuando corresponda. Solicitar no equivale a indexar.

**Salida:** evidencia técnica y de privacidad, separada de métricas operacionales
y de vida-safety. Este frente no desplaza la integración ni el slice B pendiente.

### H — Digital twin/AR/CAD y servicios políglotas incrementales

- Construir sobre los componentes existentes, no crear otro motor paralelo.
  Revalidar cada hallazgo histórico antes de modificarlo.
- Separar documento/escena canónica → motor espacial determinista → render.
  Modelo versionado, coordenadas/unidades explícitas y comandos serializables
  permiten validación, auditoría, replay, undo/redo y sincronización offline.
- Cerrar una vertical: cargar faena → colocar/mover objeto de seguridad → validar
  contra geometría → mostrar findings → persistir → recargar/leer en el ámbito
  autorizado. Probar conflictos y pérdida de red, no solo la escena visible.
- Evaluar geometría, snapping, distancias, colisiones, rutas, carga por niveles de
  detalle y partición espacial; WebGPU/WASM/CPU/GPU se eligen por soporte, memoria
  y medición, con fallback WebGL/TypeScript cuando corresponda.
- Estudiar [ArtCraft](https://getartcraft.com/apps) como referencia de separación
  motor/interfaz y superficies UI/CLI/MCP; revisar licencia y dependencias antes
  de reutilizar código. No asumir que noticias o demos acreditan interoperabilidad.
- Mantener CAD/DWG y photogrammetry como adapters aislados con formatos, licencias,
  límites y tests explícitos; no declarar conversión real donde solo hay un stub.
- Rust puede ampliar el núcleo computacional si B y el caso espacial lo justifican.
  Go queda disponible para un worker/adapter con necesidad medida: contrato
  versionado, idempotencia, tenant, health, métricas, staging y rollback; no
  reemplaza `server.ts` por preferencia tecnológica.

**Salida:** capacidad operacional end-to-end medida. El motor espacial o LLM no
se convierte por sí solo en autoridad de seguridad ni de bloqueo del trabajador.

### Disciplina transversal de cada slice

1. Consultar ticket canónico de Notion y evidencia histórica de Obsidian/spec/ADR;
   usar Graphify para impacto y REA cuando aporte evidencia de artefacto/runtime.
2. Leer el flujo real y reproducir el defecto antes de cambiarlo.
3. Implementar un cambio acotado; ejecutar tests mediante Vite+ y gates actuales,
   incluida revisión adversarial y búsqueda de fallos hermanos.
4. Conservar comandos, SHA, resultados y límites. Actualizar Graphify si cambian
   relaciones; no inflar cobertura ni crear otro backlog documental.
5. PR y merge squash solo con CI vigente, alcance revisado y `CLEAN`, nunca
   `--admin`; tras merge, reconciliar Notion por evidencia y read-back.
6. Distinguir local, CI, staging, producción y Android físico/OEM. Ninguna capa
   sustituye a la siguiente. No prometer producción mientras Alpha 41 tenga
   pendientes fuera de los estados resueltos con evidencia.

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
