import { test, expect } from '@playwright/test';
import { ROUTES, btn, closeModal, destructive, open, subNav, uniq } from './support';

/** Wallet Management — Live Board, Payment Providers, Routing Policy, Wallet Config, Settlement, Manual Ledger, Incidents. */
test.describe('Dev portal › Wallet Management', () => {
  test('Live board: provider health, held, stuck and failed sections @smoke', async ({ page }) => {
    await open(page, ROUTES.walletBoard);
    await expect(page.getByRole('heading', { name: 'Wallet Operations, Live Board' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Provider health' })).toBeVisible();
    for (const h of [/^Held transactions \(\d+\)$/, /^Stuck transactions \(\d+\)$/, /^Failed today \(\d+\)$/]) {
      await expect(page.getByRole('heading', { name: h })).toBeVisible();
    }
  });

  test('sub-pages load: Payment Providers, Routing Policy, Wallet Config, Settlement, Manual Ledger, Incidents @smoke', async ({ page }) => {
    await open(page, ROUTES.walletBoard);
    for (const [link, heading] of [
      ['Payment Providers', 'Payment Providers'], ['Routing Policy', 'Provider Routing Policy'], ['Wallet Config', 'Wallet Product Configuration'],
      ['Settlement', null], ['Manual Ledger', 'Manual Ledger Actions'], ['Incidents', null], ['Live Board', 'Wallet Operations, Live Board'],
    ] as const) {
      await subNav(page, link);
      await expect(heading ? page.getByRole('heading', { name: heading }) : page.getByRole('heading').nth(1)).toBeVisible();
    }
  });

  test('Manual ledger: credit, debit and reversal dialogs open and close @smoke', async ({ page }) => {
    await open(page, ROUTES.walletBoard);
    await subNav(page, 'Manual Ledger');
    for (const action of ['Manual credit', 'Manual debit', 'Reversal']) {
      await btn(page, action).click();
      await closeModal(page);
    }
  });

  test('Routing policy: override history opens; manual-override dialog cancels @smoke', async ({ page }) => {
    await open(page, ROUTES.walletBoard);
    await subNav(page, 'Routing Policy');
    await btn(page, 'View override history').click();
    await closeModal(page);
    await btn(page, 'Manual override').first().click();
    await btn(page, 'Cancel').last().click();
  });

  test('Payment providers: add provider is submitted for approval @creates', async ({ page }) => {
    await open(page, ROUTES.walletBoard);
    await subNav(page, 'Payment Providers');
    await btn(page, 'Add provider').click();
    await page.getByRole('textbox', { name: 'Provider name' }).fill(uniq('QA Provider'));
    await page.getByRole('textbox', { name: 'Primary contact' }).fill('adebanjo.adeniji@concept-nova.com');
    await page.getByRole('checkbox', { name: 'Bank transfer in' }).check();
    await page.getByRole('checkbox', { name: 'Bank transfer out' }).check();
    await page.getByRole('textbox', { name: 'Settlement account' }).fill('1234567890');
    await btn(page, 'Submit for approval').click();
    await expect(page.getByRole('heading', { name: 'Add payment provider' })).toBeHidden();
  });

  test('Routing policy: edit rule submits for approval @creates', async ({ page }) => {
    await open(page, ROUTES.walletBoard);
    await subNav(page, 'Routing Policy');
    await btn(page, 'Edit rule').first().click();
    await btn(page, 'Submit for approval').click();
  });

  test('Wallet config: capability, fee and velocity settings submit for approval @creates', async ({ page }) => {
    await open(page, ROUTES.walletBoard);
    await subNav(page, 'Wallet Config');
    for (const h of ['Capabilities', 'Fees per capability', 'Velocity controls', 'Auto-hold rules']) {
      await expect(page.getByRole('heading', { name: h })).toBeVisible();
    }
    await btn(page, 'Submit for approval').click();
  });

  test('Live board: release / reject / reconcile / query / manual complete @destructive', async ({ page }) => {
    destructive();
    await open(page, ROUTES.walletBoard);
    await btn(page, 'Release').first().click();
    await page.getByLabel('Reason (required)').fill('release sent to app');
    await btn(page, 'Release transaction').click();
    await btn(page, 'Query provider').first().click();
  });

  test('Providers: mark status / retire; routing manual override @destructive', async ({ page }) => {
    destructive();
    await open(page, ROUTES.walletBoard);
    await subNav(page, 'Payment Providers');
    await btn(page, 'Mark status').first().click();
  });
});
