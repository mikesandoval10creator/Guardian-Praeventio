# Configurar Google Maps API key — guía paso a paso

> Necesario para que `Site25DPanel.tsx` (Digital Twin Fase A) y cualquier
> componente que use `@react-google-maps/api` funcione en dev y prod.

## ¿Por qué la necesito?

Sin esta key Google Maps muestra "For development purposes only" como marca de agua
y bloquea las features avanzadas (geocoding, places, tile loading robusto).

## Pasos (10 minutos, una sola vez)

### 1. Acceso a Google Cloud Console

Andá a https://console.cloud.google.com/ con la cuenta de Google que administra
el proyecto Guardian Praeventio (la misma que ya usás para Firebase).

Si todavía no creaste proyecto en Cloud Console, hacelo: arriba izquierda →
"Crear proyecto" → nombre `praeventio-prod` (o el que ya tengas vinculado a Firebase).

### 2. Habilitar APIs

Ir a **APIs & Services → Library** y habilitar las 3 que necesitamos:

1. **Maps JavaScript API** ← **obligatoria** (renderiza el mapa)
2. **Places API** ← opcional (search de direcciones, autocompletado)
3. **Geocoding API** ← opcional (lat/lng ↔ dirección textual para reportes SUSESO)

Click en cada una → "Habilitar".

### 3. Crear la API key

**APIs & Services → Credentials → + CREATE CREDENTIALS → API key**.

Copiar la key inmediatamente (formato `AIzaSy...` 39 caracteres).

### 4. Restringir la key (CRÍTICO — sin esto, alguien la roba y te factura)

Click en la key recién creada → editar:

**Application restrictions** → "HTTP referrers (web sites)" → agregar:
- `https://praeventio.net/*`
- `https://www.praeventio.net/*`
- `https://*.run.app/*` (si usás Cloud Run)
- `http://localhost:*/*` (para dev)

**API restrictions** → "Restrict key" → seleccionar SOLO las 3 APIs habilitadas
en paso 2. Esto previene que la key tenga superpoderes en otras APIs de Google
si se filtra.

**Save** abajo.

### 5. Agregar a tu `.env` local

```bash
# en D:/Guardian Praeventio/repo/.env  (NO .env.example — ese se commitea)
VITE_GOOGLE_MAPS_API_KEY=AIzaSy_TU_KEY_REAL_DE_39_CHARS
```

Verificar con `npm run dev` — el mapa de Site25DPanel debería renderizar
sin marca de agua.

### 6. Agregar a Cloud Run / Vercel prod

**Cloud Run** (si es tu hosting):
```bash
gcloud run services update praeventio-guard \
  --update-env-vars VITE_GOOGLE_MAPS_API_KEY=AIzaSy...
```

O via consola: Cloud Run → tu servicio → Edit & deploy new revision → Variables
& Secrets → "Add variable" → name `VITE_GOOGLE_MAPS_API_KEY` value [tu key].

**Vercel** (alternativa):
Settings → Environment Variables → `VITE_GOOGLE_MAPS_API_KEY` = [tu key] (apply
to Production + Preview + Development).

### 7. Verificar

Abrir la página `Digital Twin Faena` post-deploy. El mapa con tilt=45° debe
cargar limpio. Si ves "RefererNotAllowed" en la consola del browser, revisar
que la URL de prod esté en la HTTP referrer restriction (paso 4).

## Quotas + costos

Google Maps tier gratis incluye `$200/mes` de crédito (≈ 28000 cargas de mapa,
40000 geocoding requests). Para Praeventio en MVP esto es más que suficiente.
Cuando crezca:

- Setear **Quota cap** en `APIs & Services → Quotas` para evitar facturas
  sorpresa: máximo 1000 map loads/día durante MVP.
- Activar **Billing alerts** en `$10`, `$50`, `$100`.

## Si después de esto el mapa sigue sin cargar

1. Abrí DevTools del browser → Console → buscar errores Google Maps.
2. Errores típicos:
   - `RefererNotAllowedMapError` — agregar URL exacta a la restricción referer.
   - `ApiNotActivatedMapError` — habilitar la API en paso 2.
   - `BillingNotEnabledMapError` — habilitar billing en el proyecto Cloud
     (no se cobra hasta superar tier gratis, pero tiene que estar configurado).

## Componentes Praeventio que consumen esta key

- [Site25DPanel](../../src/components/digital-twin/Site25DPanel.tsx) (Digital
  Twin Fase A — sitio en mapa con tilt 45°)
- Driving page futuro (Sprint 12 finish — speed map)
- DynamicEvacuationMap, VectorialEvacuationMap (rutas de escape)
- CoastalEmergencyMap, VolcanicEruptionMap (mapas de emergencia)

Todos usan `@react-google-maps/api` que ya está en deps; comparten la misma
env var.

## Decisión D3 contexto

Aunque el repo es **Gemini-first** para AI (decisión D3, ver memoria del
proyecto), el stack de mapas sigue siendo Google. El usuario explícitamente
priorizó compatibilidad Google Workspace; Maps es parte coherente de eso.
La alternativa OpenStreetMap (tile-only, sin tilt 3D) queda como fallback
para mercados donde Google Maps no tenga cobertura.
