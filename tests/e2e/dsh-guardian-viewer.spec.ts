/**
 * End-to-end verification of the Guardian Praeventio viewer plugin inside a
 * real DeepSeek Harness web client.
 *
 * The harness is a scratch DSH host whose profile re-enables the right
 * Sidebar Browser tab. The test drives the live client: it opens a session,
 * waits for the Guardian dock occupant to appear, opens the route catalogue,
 * searches for a route, and checks that the route opens in the Browser tab
 * with the absolute application URL.
 *
 * The dock is a session-scoped slot that the host renders only in the
 * `composer` variant of the input bar, so the test must open a session with
 * content: the empty "New Session" row keeps the hero variant mounted and the
 * dock never renders.
 *
 * Environment:
 *   DSH_TEST_URL   base URL of the scratch host, including the launch token
 *   DSH_APP_URL    base URL of the Guardian application under inspection
 */
import { expect, test } from '@playwright/test'

const DSH_URL = process.env.DSH_TEST_URL ?? 'http://127.0.0.1:59780'
const APP_URL = process.env.DSH_APP_URL ?? 'http://localhost:57335'

/** The Guardian dock pill, located by its accessible name (locale-aware). */
const pill = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /abrir guardian praeventio|open guardian praeventio/i })

/** The catalogue entry in the pill's menu (locale-aware). */
const catalogMenuItem = (page: import('@playwright/test').Page) =>
  page.getByRole('menuitem', { name: /buscar rutas|find routes/i })

/**
 * Open a session that has content, so the host mounts the composer variant.
 * @param page - the Playwright page.
 */
async function openSession(page: import('@playwright/test').Page): Promise<void> {
  // The first-run notice blocks every pointer event until it is dismissed.
  const notice = page.getByRole('dialog', { name: /preview notice|aviso de vista previa/i })
  if (await notice.isVisible().catch(() => false)) {
    await notice.getByRole('button', { name: /continue|continuar/i }).first().click()
    await notice.waitFor({ state: 'hidden', timeout: 15_000 })
  }

  const rows = page.locator('[role="treeitem"][data-row-key^="session:"]')
  // The sidebar populates asynchronously after the client boots.
  await rows.first().waitFor({ state: 'visible', timeout: 60_000 })
  const count = await rows.count()
  for (let index = 0; index < count; index += 1) {
    const text = (await rows.nth(index).textContent())?.trim() ?? ''
    // The empty placeholder keeps the hero variant mounted.
    if (/^New Session/i.test(text)) continue
    await rows.nth(index).click()
    return
  }
  throw new Error('no session with content is available in the sidebar')
}

test.describe('Guardian Praeventio viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DSH_URL, { waitUntil: 'domcontentloaded' })
    await openSession(page)
  })

  test('registers its dock occupant next to the host occupants', async ({ page }) => {
    const guardian = pill(page)
    await expect(guardian).toBeVisible({ timeout: 60_000 })

    // The occupant must live in the composer's dock slot.
    await expect(guardian.locator('xpath=ancestor::*[@data-slot="conversation.composer.dock"]')).toHaveCount(1)

    // The host's own occupants must survive: the plugin may not evict them.
    await expect(page.locator('[data-composer-stat]').first()).toBeVisible()
  })

  test('opens the route catalogue as a non-modal dialog', async ({ page }) => {
    await pill(page).click()

    const menuItem = catalogMenuItem(page)
    await expect(menuItem).toBeVisible({ timeout: 15_000 })
    await menuItem.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    // A non-modal dialog does not trap focus: the reviewer keeps reading the
    // conversation while the catalogue is open.
    await expect(dialog).toHaveAttribute('aria-modal', 'false')
    // The search field is an ARIA combobox over a listbox, not a searchbox.
    await expect(dialog.getByRole('combobox')).toBeVisible()
  })

  test('searches the route catalogue and opens a route in the Browser tab', async ({ page }) => {
    await pill(page).click()

    const menuItem = catalogMenuItem(page)
    await expect(menuItem).toBeVisible({ timeout: 15_000 })
    await menuItem.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })

    await dialog.getByRole('combobox').fill('emergencia')

    const options = dialog.getByRole('option')
    await expect(options.first()).toBeVisible({ timeout: 15_000 })
    expect(await options.count()).toBeGreaterThan(0)

    await options.first().click()

    // The route opens in the right Sidebar's Browser tab. The tab must carry
    // the absolute application URL: a bare host would be parsed as HTTPS.
    const frame = page.locator('iframe').first()
    await expect(frame).toBeAttached({ timeout: 30_000 })

    const frameUrl = await frame.getAttribute('src')
    expect(frameUrl).toBeTruthy()
    expect(frameUrl!.startsWith(APP_URL)).toBe(true)

    // The catalogue closes so the application is visible behind it.
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('logs no slot entry crash', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await expect(pill(page)).toBeVisible({ timeout: 60_000 })

    // The host renders an error anchor when a slot entry throws, which would
    // kill the whole overlay.
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)

    const pluginErrors = consoleErrors.filter(
      (line) =>
        !line.includes('Failed to load resource') &&
        !line.includes('favicon') &&
        !line.includes('Permissions policy violation'),
    )
    expect(pluginErrors).toEqual([])
  })
})
