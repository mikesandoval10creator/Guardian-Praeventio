# Playwright E2E testing — guía de uso

> Sprint 18 cementa la **brecha D** identificada por Daho (2026-05-04):
> antes solo teníamos vitest (lógica matemática + endpoints), ahora
> también un robot que simula clicks reales en el navegador. Para una
> app safety-critical, esto cierra un riesgo grande.

## Por qué Playwright (no Cypress)

| Eje | Playwright | Cypress |
|---|---|---|
| Multi-browser | ✅ Chromium + Firefox + WebKit nativo | ❌ Chromium-flavored solo |
| Async API | ✅ Promesas modernas, sin `cy.then()` | ⚠️ Pseudo-síncrono propio |
| Mobile emulation | ✅ Pixel 7, iPhone 14 nativo | ⚠️ Solo viewport, no devices |
| Network interception | ✅ Hijack completo + offline mode | ✅ Pero más limitado |
| Trace viewer | ✅ Time-travel debugger excelente | ⚠️ Snapshot screenshots |
| Activamente mantenido | ✅ Microsoft, releases frecuentes | ⚠️ Disminución de inversión |

Para Praeventio (safety-critical, Capacitor móvil futuro, offline-first), Playwright es el match.

## Estructura

```
playwright.config.ts
tests/e2e/
  fixtures/
    auth.ts                  # mock auth (Sprint 19+)
  landing.spec.ts            # 9 tests, smoke público (corren YA)
  process-lifecycle.spec.ts  # skip Sprint 19 (necesita Firestore emulator)
  sos-button.spec.ts         # skip Sprint 19 (necesita auth fixture)
  fall-detection-toggle.spec.ts  # skip Sprint 19
  offline-resilience.spec.ts # skip Sprint 19 (con context.setOffline)
.github/workflows/e2e.yml    # CI workflow chromium + mobile-android
```

## Cómo correr

### Local — primer setup (una vez)

```bash
# Instalar dependencias (la dev-dep @playwright/test ya está en package.json)
npm install

# Instalar los binarios de los browsers
npx playwright install chromium
# O todos: npx playwright install
```

### Local — corriendo tests

```bash
# Headless, todos los projects (chromium + mobile-android + firefox + webkit)
npm run test:e2e

# Solo desktop chromium (más rápido para iterar)
npm run test:e2e -- --project=chromium

# Con navegador visible (debugging)
npm run test:e2e -- --headed --project=chromium

# Un solo file
npm run test:e2e -- tests/e2e/landing.spec.ts

# UI mode (Playwright's interactive runner)
npm run test:e2e:ui

# Trace viewer post-failure
npm run test:e2e:report
```

### CI

`.github/workflows/e2e.yml` corre en cada PR. Subo HTML report + traces solo en failure (artifact retention 14 días).

## Workflow de desarrollo

### Cuando agregás una feature UI nueva

1. Implementar en `src/`.
2. Agregar un spec en `tests/e2e/<feature>.spec.ts` que:
   - Cubra el happy path principal.
   - Cubra al menos un edge case que el usuario podría romper.
3. Correr local `npm run test:e2e -- --project=chromium tests/e2e/<feature>.spec.ts`.
4. Push → CI corre el suite completo.

### Cuando un test falla en CI pero pasa local

1. Bajar el artifact `playwright-traces` del PR.
2. Abrir con `npx playwright show-trace ./trace.zip`.
3. El trace muestra screenshot, DOM, network, console por cada step. Brutalmente útil.

## Tests pendientes (Sprint 19+)

Los specs marcados `test.skip` arriba esperan auth fixture + Firestore emulator setup. Plan Sprint 19:

1. **Firebase Emulator** — `firebase emulators:start --only firestore,auth` antes de `npx playwright test`.
2. **Auth fixture** — `tests/e2e/fixtures/auth.ts` `loginAsTestUser` debe producir un user que el server side acepta gracias a un guard `if (process.env.E2E_MODE === '1')`.
3. **Seed data** — `tests/e2e/fixtures/seed.ts` que crea Crew + Project + Process via REST endpoints en setup `beforeAll`.

## Anti-patrones a evitar

- ❌ `await page.waitForTimeout(N)` excepto en casos justificados (e.g. esperar long-press 3s).
- ❌ Tests que dependen de orden de ejecución entre archivos.
- ❌ Hard-codear URLs absolutas — siempre `baseURL` via config.
- ❌ Snapshots de UI (Playwright los soporta pero son frágiles para una app que itera rápido).
- ❌ Credenciales reales en specs — siempre fixtures mockeadas.
