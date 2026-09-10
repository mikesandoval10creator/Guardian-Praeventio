import { test, expect } from "@playwright/test";
import admin from "firebase-admin";
import { createHash } from "node:crypto";
import {
  loginAsTestUser,
  signInBrowserViaCustomToken,
  buildE2EAuthHeader,
} from "./fixtures/auth";

test.describe("onboarding completion full-stack", () => {
  test.skip(
    process.env.E2E_FULL_STACK !== "1",
    "Requires Express + Auth/Firestore emulators",
  );

  test("retries a failed submission, persists the real project and replays without duplicates", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(90_000);
    const uid = `onboarding-${testInfo.workerIndex}-${Date.now()}`;
    await loginAsTestUser(page, {
      uid,
      email: `${uid}@praeventio.test`,
      roles: ["operario"],
      tenantId: uid,
      projectIds: [],
    });
    const db = admin.firestore();
    // This fixture deliberately starts BEFORE onboarding, unlike returning-user specs.
    await db
      .collection("users")
      .doc(uid)
      .set({ onboarded: false }, { merge: true });
    await page.goto("/onboarding");
    await signInBrowserViaCustomToken(page);
    await expect(page.getByTestId("industry-construction")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId("industry-construction").click();
    await page.getByTestId("next-button").click();
    await page.getByTestId("country-CL").click();
    await page.getByTestId("next-button").click();
    await page.getByTestId("tier-gratis").click();
    await page.getByTestId("next-button").click();
    await page.getByTestId("emails-textarea").fill("e2e@praeventio.test");
    await page.getByTestId("next-button").click();
    await page
      .getByTestId("project-name-input")
      .fill("Proyecto onboarding real");

    let firstKey: string | undefined;
    await page.route(
      "**/api/onboarding/complete",
      async (route) => {
        firstKey = route.request().headers()["idempotency-key"];
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "test_retry" }),
        });
      },
      { times: 1 },
    );
    await page.getByTestId("finish-button").click();
    await expect(page.getByTestId("onboarding-error")).toContainText(
      "test_retry",
    );
    expect((await db.collection("users").doc(uid).get()).get("onboarded")).toBe(
      false,
    );
    expect(
      (await db.collection("tenants").doc(uid).collection("projects").get())
        .size,
    ).toBe(0);

    const completed = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/onboarding/complete") &&
        r.request().method() === "POST",
    );
    await page.getByTestId("finish-button").click();
    const response = await completed;
    expect(response.status()).toBe(200);
    const headers = response.request().headers();
    expect(headers["idempotency-key"]).toBe(firstKey);
    expect(headers["idempotency-key"]).toMatch(/^onboarding-[a-f0-9]{64}$/);
    expect(headers.authorization).toBeTruthy();
    // The wizard performs a hard navigation after consuming JSON. Chromium
    // can discard that response's CDP body; verify the authoritative receipt
    // instead and compare it with a real replay below (no mocked success).
    const receiptId = `onboarding-${createHash("sha256").update(uid).digest("hex")}`;
    const receipt = await db
      .collection("system_idempotency_cache")
      .doc(receiptId)
      .get();
    expect(receipt.get("state")).toBe("completed");
    const result = receipt.get("result");
    const invitations = await db
      .collection("invitations")
      .where("projectId", "==", result.projectId)
      .get();
    expect(invitations.size).toBe(1);
    const invitation = invitations.docs[0].data();
    const preview = await request.get(
      `/api/invitations/info/${invitation.token}`,
    );
    expect(preview.status()).toBe(200);
    expect((await preview.json()).invitedEmail).toBe("e2e@praeventio.test");
    const inviteeUid = `${uid}-invitee`;
    const accepted = await request.post(
      `/api/invitations/${invitation.token}/accept`,
      {
        headers: {
          Authorization: buildE2EAuthHeader(
            process.env.E2E_TEST_SECRET!,
            inviteeUid,
          ),
        },
        data: { projectId: result.projectId },
      },
    );
    expect(accepted.status()).toBe(200);
    expect(
      (await db.collection("projects").doc(result.projectId).get()).get(
        "members",
      ),
    ).toContain(inviteeUid);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    expect((await db.collection("users").doc(uid).get()).get("onboarded")).toBe(
      true,
    );
    expect(
      (await db.collection("projects").doc(result.projectId).get()).get(
        "createdBy",
      ),
    ).toBe(uid);

    // Replay uses the real Express endpoint after the browser navigated away.
    const replay = await request.post("/api/onboarding/complete", {
      headers: {
        Authorization: headers.authorization,
        "Idempotency-Key": headers["idempotency-key"],
      },
      data: response.request().postDataJSON(),
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(result);
    expect(
      (await db.collection("tenants").doc(uid).collection("projects").get())
        .size,
    ).toBe(1);
    expect(
      (await db.collection("projects").where("createdBy", "==", uid).get())
        .size,
    ).toBe(1);
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId("onboarding-wizard")).toHaveCount(0);
  });
});
