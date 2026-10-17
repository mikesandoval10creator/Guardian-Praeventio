import { test, expect } from '@playwright/test';

test('public emergency calls require the current country without login', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('praeventio_cookie_consent', 'accepted');
  });
  await page.goto('/');
  const trigger = page.getByTestId('public-emergency-trigger');
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Ayuda de emergencia' });
  const calls = dialog.locator('a[href^="tel:"]');
  const country = dialog.getByRole('combobox', { name: 'País donde estás' });
  await expect(country).toHaveValue('');
  await expect(calls).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Primeros auxilios' })).toBeVisible();

  await country.selectOption('CL');
  await expect(calls).toHaveCount(3);
  await expect(calls.nth(0)).toHaveAttribute('href', 'tel:131');
  await country.selectOption('US');
  for (let i = 0; i < 3; i++) {
    await expect(calls.nth(i)).toHaveAttribute('href', 'tel:911');
  }
  await expect(dialog.getByText('Policía', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await trigger.click();
  await expect(country).toHaveValue('');
  await expect(calls).toHaveCount(0);
});
