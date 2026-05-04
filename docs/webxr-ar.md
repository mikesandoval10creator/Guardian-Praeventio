# WebXR `immersive-ar` — Guardian Praeventio

Sprint 21 Ola 4 Bucket L.

## Compatibilidad

| Plataforma | Soporte | Notas |
| --- | --- | --- |
| Android Chrome 79+ | ✅ | ARCore requerido. Mejor experiencia. |
| Edge Mobile (Chromium) | ✅ | Mismo motor que Chrome. |
| Samsung Internet 12+ | ✅ | Sobre dispositivos con ARCore. |
| Quest Browser | ✅ | `immersive-vr` y `immersive-ar` (passthrough). |
| iOS Safari | ❌ | Apple no implementa WebXR. Usar AR Quick Look (Bucket M, `.usdz`). |
| Firefox Mobile | ⚠️ | Solo via `webxr-polyfill` opcional, no recomendado en prod. |
| Desktop Chrome | ⚠️ | Solo `inline`. Requiere headset Mixed Reality conectado para `immersive-*`. |

## Arquitectura

```
PlacedObjectsLayer
  └── botón "Ver en AR"
       └── ARObjectOverlay
            ├── useWebXRSupport() ──► detecta navigator.xr + isSessionSupported
            ├── soporta inmersivo? ──► XRSession (Three.js)
            │      ├── requestSession('immersive-ar', {...})
            │      ├── hit-test source on viewer reference space
            │      ├── reticle 3D que sigue el plano detectado
            │      ├── DOM overlay con checklist + botón cerrar
            │      └── tap → onSelectAnchor(pose) → onConfirm
            └── no soporta? ──► card "AR no disponible" (fallback)
```

## Permission flow

1. Primer click en "Iniciar AR inmersivo" dispara `navigator.xr.requestSession('immersive-ar', ...)`.
2. Chrome muestra permission prompt nativo:
   - "Permitir que [origin] inicie una sesión de realidad aumentada"
   - Combina permission de cámara + sensores en un solo prompt.
3. Si el usuario acepta, la sesión arranca y la pestaña entra en modo full-screen
   (sin chrome del browser).
4. En cleanup llamamos `session.end()` — el browser libera la cámara y vuelve al
   modo normal.

No persistimos permission grants — cada sesión vuelve a pedir si el usuario
revocó.

## API references

- WebXR Device API: https://www.w3.org/TR/webxr/
- Hit-test: https://www.w3.org/TR/webxr-hit-test-1/
- Anchors: https://immersive-web.github.io/anchors/
- DOM Overlay: https://immersive-web.github.io/dom-overlays/
- Light Estimation: https://immersive-web.github.io/lighting-estimation/

Three.js docs:
- WebXRManager: https://threejs.org/docs/#api/en/renderers/webxr/WebXRManager
- ARButton helper: https://threejs.org/docs/#manual/en/introduction/How-to-use-WebXR

## Troubleshooting

### El botón "Iniciar AR inmersivo" no aparece

- Confirmar Android Chrome 79+. Settings → Apps → Chrome → versión.
- Verificar que ARCore esté instalado y actualizado: Play Store → "Servicios
  de Google Play para AR".
- En `chrome://flags`, asegurar que `WebXR Incubations` esté habilitado en
  builds antiguas.

### `requestSession` falla con "NotSupportedError"

- El dispositivo no es compatible con ARCore. Listado oficial:
  https://developers.google.com/ar/devices
- El sitio no está servido por HTTPS (requisito de WebXR). En desarrollo,
  usar `vite --host --https` o tunnel ngrok con cert válido.

### El reticle no aparece (hit-test miss)

- Apuntar la cámara a una superficie con textura visible (suelo, mesa).
  ARCore necesita features para tracking — paredes blancas pueden fallar.
- Mover el dispositivo lentamente para que ARCore reconstruya el plano.
- Verificar que `hit-test` esté en `requiredFeatures` (XRSession.tsx ya lo
  hace).

### El modelo no carga

- Bucket M aterriza GLB reales en `/public/models/{kind}.glb`. Hasta entonces,
  ARObjectOverlay genera primitivos Three.js (cilindros, planos, cajas) por
  kind para que el flujo end-to-end funcione.
- Si agregas un GLB en el futuro, importarlo via `GLTFLoader` y reemplazar el
  retorno de `buildPreviewMesh()`.

### La sesión se queda colgada al cerrar

- El cleanup del `useEffect` en XRSession llama `session.end()` y `renderer.dispose()`.
  Si una excepción rompe ese path, la cámara puede quedar tomada — recargar
  la pestaña libera el recurso. Reportar como bug si reproducible.

### iOS Safari muestra "AR no disponible"

- Esperado. Apple no soporta WebXR. La rama AR Quick Look (`.usdz`) está
  cubierta por Bucket M (componente `ArQuickLook.tsx`, no incluido en este
  bucket).

## Próximos pasos (post-Ola 4)

- Cargar GLB reales generados por la pipeline de fotogrametría (Brecha C).
- Anclas persistentes via `XRAnchor` API — guardar la pose en Firestore para
  que el objeto reaparezca en la misma posición en sesiones futuras.
- Light estimation real → `THREE.LightProbe` para integrar el preview con la
  iluminación ambiente.
- Multi-user: WebRTC + shared coordinate frame entre prevencionistas en faena.
