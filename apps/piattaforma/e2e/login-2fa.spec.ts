import { test, expect } from '@playwright/test';
import { generateSync } from 'otplib';

/**
 * E2E del login a due fattori (2FA TOTP).
 *
 * Usa l'utente seed `dealer2fa@passaggioveloce.it` (vedi packages/db/prisma/seed.ts):
 * ADMIN_AZIENDA ACTIVE con twoFactorEnabled e secret TOTP noto, così da poter
 * generare un codice valido a runtime e verificare l'intero flusso fino a /dashboard.
 *
 * Run:  pnpm --filter piattaforma test:e2e
 * Pre:  dev server up su localhost:3000 + DB seed completo
 *
 * NB rate limiting: c'è un limite IP+email di 5 tentativi / 15 min. Questo spec
 * tiene i tentativi falliti al minimo (Test A = 0 falliti, Test B = 1 fallito).
 */

// Stesso secret base32 dell'utente seed dealer2fa (test-only).
const SECRET = 'KZXW6YTBOI7EQ5LFMRUGS3THNZUWK43F';

test('login 2FA: TOTP valido porta alla dashboard', async ({ page }) => {
  // Step 1 — credenziali corrette → server chiede il secondo fattore
  await page.goto('/login');
  await page.getByLabel('Email').fill('dealer2fa@passaggioveloce.it');
  await page.getByLabel('Password').fill('DevPass123!');
  await page.getByRole('button', { name: 'Accedi' }).click();

  // Step 2 — appare il campo 2FA (prova del needTotp) e il bottone cambia label
  await expect(page.getByLabel(/Codice 2FA/i)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Verifica codice' }),
  ).toBeVisible();

  // Genera un TOTP valido dal secret e completa il login
  const code = generateSync({ secret: SECRET });
  await page.getByLabel(/Codice 2FA/i).fill(code);
  await page.getByRole('button', { name: 'Verifica codice' }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
});

test('login 2FA: codice errato resta sullo step 2FA con errore', async ({
  page,
}) => {
  // Step 1 — raggiunge il needTotp
  await page.goto('/login');
  await page.getByLabel('Email').fill('dealer2fa@passaggioveloce.it');
  await page.getByLabel('Password').fill('DevPass123!');
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByLabel(/Codice 2FA/i)).toBeVisible();

  // Step 2 — codice non valido: 1 solo tentativo (per non triggerare il rate limit)
  await page.getByLabel(/Codice 2FA/i).fill('000000');
  await page.getByRole('button', { name: 'Verifica codice' }).click();

  // Resta sullo step 2FA: alert d'errore + campo ancora visibile + URL /login
  await expect(page.getByText(/Codice 2FA non valido/i)).toBeVisible();
  await expect(page.getByLabel(/Codice 2FA/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
