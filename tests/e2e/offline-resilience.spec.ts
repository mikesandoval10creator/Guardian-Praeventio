import { test, expect } from "@playwright/test";
import { getFirestore } from "firebase-admin/firestore";
import { loginAsTestUser, signInBrowserViaCustomToken } from "./fixtures/auth";
import { seedProject } from "./fixtures/seed";

/**
 * Offline resilience (PWA + IndexedDB) (Sprint 19 unskip):
 *   Crear hallazgo con red caída → outbox durable (IndexedDB) → reconectar →
 *   sync a Firestore → hallazgo visible en el feed.
 *
 * Este es el test más crítico para safety en faena: si la app pierde datos
 * cuando el supervisor está bajo tierra sin señal, traicionamos el caso de
 * uso. Requiere el stack completo (Express E2E_MODE + Firestore Emulator).
 */
// Un-fixme'd (2026-07-05). Lo que este spec ahora ejercita de verdad, y los
// arreglos que lo destrabaron (todos código real, no hacks de test):
//   • Creación offline-first: AddFindingModal cierra el modal apenas addNode
//     encola el nodo en el outbox; el plan IA opcional corre solo online y en
//     background, así que la red caída ya no bloquea el guardado.
//   • addNode ahora AWAIT-ea el encolado durable (useRiskEngine): el op queda
//     persistido en IndexedDB antes de resolver, así sobrevive al reload del
//     reconnect (antes: fire-and-forget → cola vacía tras recargar).
//   • El proxy /api/gemini en E2E_MODE ya NO mockea syncNodeToNetwork /
//     syncBatchToNetwork (son escrituras Firestore, no generación IA): el
//     flush del outbox escribe de verdad en `nodes` contra el emulador.
//   • Barreras de proyecto activo (abajo): sin proyecto seleccionado
//     handleSubmit hacía early-return y el modal nunca cerraba.
test.describe("Offline-first sync", () => {
  // A retry must not turn lost offline data into an apparently green safety test.
  test.describe.configure({ retries: 0 });
  test("hallazgo creado offline se sincroniza al recuperar la red", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    test.skip(
      process.env.E2E_FULL_STACK !== "1",
      "Requires full E2E stack (preview + Express + Firestore Emulator). Run `npm run test:e2e:full`.",
    );

    await loginAsTestUser(page);
    const findingId = crypto.randomUUID();
    const findingTitle = `Cable suelto ${findingId}`;
    const findingDescription = `Cable suelto en piso 3 ${findingId}`;
    const projectName = `Offline E2E ${findingId}`;
    const seed = await seedProject({ projectName });
    const syncAttempts: Array<{
      status: number;
      success: boolean;
      failedOpsCount: number;
    }> = [];
    let matchingRemoteIds: string[] = [];

    const selectSeededProject = async () => {
      // Other specs/repeats can leave projects for this same test user. Do not
      // rely on Firestore document ordering to select this test's project.
      const selector = page.getByRole("button", { name: /^Proyecto Activo / });
      await expect(selector).toBeVisible({ timeout: 15_000 });
      await selector.click();
      await page
        .getByRole("button", { name: projectName, exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: `Proyecto Activo ${projectName}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem("gp.activeProjectId")),
        )
        .toBe(seed.projectId);
    };

    page.on("response", async (response) => {
      if (!response.url().includes("/api/gemini")) return;
      let requestBody: any;
      try {
        requestBody = response.request().postDataJSON();
      } catch {
        return;
      }
      if (requestBody?.action !== "syncBatchToNetwork") return;
      const operations = requestBody.args?.[0];
      if (
        !Array.isArray(operations) ||
        !JSON.stringify(operations).includes(findingTitle)
      )
        return;

      const payload = await response.json().catch(() => null);
      const result = payload?.result;
      const failedOps = result?.failedOps;
      const attempt = {
        status: response.status(),
        success: result?.success === true,
        failedOpsCount: Array.isArray(failedOps)
          ? failedOps.length
          : failedOps
            ? 1
            : 0,
      };
      syncAttempts.push(attempt);
      console.log("[offline-e2e-sync-ack]", JSON.stringify(attempt));
    });

    try {
      await page.goto("/findings");
      // §2.24 fix (2026-05-22) — wait barrier auth real antes de UI checks.
      await signInBrowserViaCustomToken(page);

      // Select the seeded project through the real UI before creating a finding.
      // A merely non-null project may belong to another test's fixture.
      await selectSeededProject();

      // Sprint E2E-99 — no hay ruta /findings/new; el formulario se abre con el
      // botón "Nuevo hallazgo" (data-testid estable agregado en este sprint).
      const newFindingBtn = page.getByTestId("new-finding-button");
      await newFindingBtn.waitFor({ state: "visible", timeout: 15_000 });
      await newFindingBtn.click();

      await context.setOffline(true);

      // Título, Ubicación y Descripción son required en el modal AddFinding —
      // sin los tres, la validación HTML5 bloquea el submit y el modal no cierra.
      await page.getByLabel(/T[ií]tulo/i).fill(findingTitle);
      await page.getByLabel(/Ubicaci[oó]n/i).fill("Piso 3, Sector B");
      await page.getByLabel(/Descripci[oó]n/i).fill(findingDescription);
      await page.getByRole("button", { name: /Registrar/i }).click();

      // El save offline tuvo éxito cuando el modal cierra (addNode encoló el nodo
      // en el outbox durable y no hubo error bloqueante). La prueba real es el
      // hallazgo apareciendo en el feed tras reconectar (abajo).
      await expect(
        page.getByRole("button", { name: /Registrar/i }),
      ).not.toBeVisible({ timeout: 8_000 });

      // Reconectar. El evento `online` dispara flush() del outbox en ESTA página
      // (autenticada, con el op en memoria). Esperamos a que el POST del flush
      // llegue al backend ANTES de recargar; sin esto, el page.goto de abajo
      // Observaciones previas encontraron cero requests cuando el flush se
      // disparaba tarde; ahora no basta observar un intento: las aserciones
      // posteriores exigen ACK exitoso para este hallazgo y read-back remoto.
      // Arm the listener before reconnecting: online can flush immediately.
      // Match THIS finding, not an unrelated batch from startup/background work.
      const syncResponsePromise = page.waitForResponse(
        (response) => {
          if (!response.url().includes("/api/gemini")) return false;
          try {
            const body = response.request().postDataJSON();
            return (
              body?.action === "syncBatchToNetwork" &&
              Array.isArray(body.args?.[0]) &&
              body.args[0].some(
                (operation: { data?: { title?: string } }) =>
                  operation.data?.title === findingTitle,
              )
            );
          } catch {
            return false;
          }
        },
        { timeout: 20_000 },
      );
      // Handle rejection while setOffline is pending, without swallowing failure.
      void syncResponsePromise.catch(() => undefined);
      await context.setOffline(false);
      const syncResponse = await syncResponsePromise;
      // waitForResponse observes headers, not a completed body. Navigation may
      // otherwise abort response.json() and manufacture a false negative ACK.
      const syncPayload = await syncResponse.json();
      expect(syncResponse.status()).toBe(200);
      expect(syncPayload?.result?.success).toBe(true);
      expect(syncPayload?.result?.failedOps ?? []).toEqual([]);

      // Recargar prueba durabilidad real: el estado optimista en memoria se
      // pierde, así que el hallazgo solo reaparece si se persistió en `nodes`.
      await page.goto("/findings");
      // Re-firmar el browser tras el reload: el feed lee `nodes` vía onSnapshot y
      // firestore.rules exige `request.auth != null`; el flush del outbox
      // (POST /api/gemini) también estampa `auth.currentUser.uid`. Sin re-sign-in
      // el query queda permission-denied y el flush corre como 'anonymous' →
      // assertProjectMember lo rechaza (403). Mismo patrón goto+signIn del inicio.
      await signInBrowserViaCustomToken(page);
      // ProjectContext selects its first project again on reload. Restore the
      // exact seeded project before inspecting the feed, without trusting order.
      await selectSeededProject();

      const db = getFirestore();
      await expect
        .poll(
          async () => {
            const snapshot = await db
              .collection("nodes")
              .where("projectId", "==", seed.projectId)
              .get();
            matchingRemoteIds = snapshot.docs
              .filter(
                (doc) =>
                  doc.data()?.title === findingTitle &&
                  doc.data()?.description === findingDescription,
              )
              .map((doc) => doc.id);
            const successfulSync = syncAttempts.some(
              (attempt) =>
                attempt.status === 200 &&
                attempt.success &&
                attempt.failedOpsCount === 0,
            );
            return successfulSync && matchingRemoteIds.length > 0;
          },
          { timeout: 20_000, intervals: [500, 1000, 2000] },
        )
        .toBe(true);

      await expect(page.getByText(findingDescription)).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      console.log(
        "[offline-e2e-final-evidence]",
        JSON.stringify({ syncAttempts, matchingRemoteIds }),
      );
      const db = getFirestore();
      const createdNodes = await db
        .collection("nodes")
        .where("title", "==", findingTitle)
        .get();
      const auditEntries = await db
        .collection("audit_logs")
        .where("details.title", "==", findingTitle)
        .get();
      await Promise.all([
        ...createdNodes.docs.map(async (doc) => {
          await Promise.all([
            doc.ref.delete(),
            db.collection("vector_store").doc(`node-${doc.id}`).delete(),
          ]);
        }),
        ...auditEntries.docs.map((doc) => doc.ref.delete()),
      ]);
      await seed.cleanup();
    }
  });
});
