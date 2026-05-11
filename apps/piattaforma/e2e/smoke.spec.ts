import { test, expect } from '@playwright/test';

/**
 * Smoke test E2E base. Coprono i percorsi critici:
 *  - Home pubblica risponde 200 e mostra CTA registrazione
 *  - Pagine legali raggiungibili
 *  - Login form funziona con credenziali seed
 *
 * Run:  pnpm --filter piattaforma test:e2e
 * Pre:  dev server up su localhost:3000 + DB seed completo
 */

test('home pubblica con CTA registrazione', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Passaggio Veloce/);
  await expect(
    page.getByRole('link', { name: /Registra la tua azienda/i }).first(),
  ).toBeVisible();
});

test('pagine legali raggiungibili', async ({ page }) => {
  for (const path of ['/privacy', '/cookie', '/termini']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});

test('cookie banner appare e si chiude con Accetta tutti', async ({ page }) => {
  // Pulisce LocalStorage prima del test (banner mostrato solo se non c'è scelta)
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.getByRole('button', { name: /Accetta tutti/i })).toBeVisible();
  await page.getByRole('button', { name: /Accetta tutti/i }).click();
  await expect(
    page.getByRole('button', { name: /Accetta tutti/i }),
  ).toHaveCount(0);
});

test('login admin con credenziali seed', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@passaggioveloce.it');
  await page.getByLabel('Password').fill('DevPass123!');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  await expect(page.getByText('Admin Piattaforma')).toBeVisible();
});

test('team modale Aggiungi utente apre, switch tab, chiude con Esc', async ({
  page,
}) => {
  // Login dealer
  await page.goto('/login');
  await page.getByLabel('Email').fill('dealer1@passaggioveloce.it');
  await page.getByLabel('Password').fill('DevPass123!');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

  // Apri /team
  await page.goto('/team');
  await expect(
    page.getByRole('heading', { name: /^Team$/, level: 1 }),
  ).toBeVisible();

  // CTA in alto a destra
  const cta = page.getByRole('button', { name: /Aggiungi utente/i });
  await expect(cta).toBeVisible();

  // Apri modale
  await cta.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Aggiungi utente/i, level: 2 }),
  ).toBeVisible();

  // Tab Imposta password attivo di default → email input visibile
  await expect(
    page.getByPlaceholder(/dipendente@azienda\.it/i),
  ).toBeVisible();

  // Switch al tab Invita via email
  await page.getByRole('button', { name: /Invita via email/i }).click();
  await expect(
    page.getByPlaceholder(/utente@azienda\.it/i),
  ).toBeVisible();

  // Esc chiude
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
