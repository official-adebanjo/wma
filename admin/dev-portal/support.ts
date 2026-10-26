import { Page, expect, test } from '@playwright/test';
import * as path from 'path';
import '../../shared/config/env';

/**
 * Support for specs recorded against the real Rosabon Admin Portal (dev) with Playwright codegen.
 * Credentials come from .env (DEV_ADMIN_*), never from the spec files.
 */
export const DEV = {
  url: process.env.DEV_ADMIN_URL ?? 'https://rosabon-app-admin-dev.rosabon-finance.com',
  email: process.env.DEV_ADMIN_EMAIL ?? '',
  password: process.env.DEV_ADMIN_PASSWORD ?? '',
  destructive: process.env.DEV_ALLOW_DESTRUCTIVE === '1',
  storageState: path.resolve(__dirname, '../../.auth/dev-super-admin.json'),
};

/** Unique, human-readable suffix so re-runs never collide with data from earlier runs. */
export const uniq = (prefix: string) => `${prefix} ${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '')}`;

/**
 * Recorded steps that act on whichever existing record sits at a given position (nth row/button).
 * Replaying them hits a *different* record each run, so they only run when DEV_ALLOW_DESTRUCTIVE=1.
 */
export function destructive(): void {
  test.skip(!DEV.destructive, 'Acts on existing records by position — set DEV_ALLOW_DESTRUCTIVE=1 to run');
}

export async function home(page: Page): Promise<void> {
  await page.goto('/#/');
  await expect(page).not.toHaveURL(/#\/login/);
}

/** Sidebar navigation; expands a collapsible group first when given. */
export async function nav(page: Page, link: string, opts: { group?: string; exact?: boolean } = {}): Promise<void> {
  if (opts.group) {
    const expand = page.getByLabel(`Expand ${opts.group}`);
    if (await expand.isVisible().catch(() => false)) await expand.click();
  }
  await page.getByRole('link', { name: link, exact: opts.exact ?? true }).first().click();
}

/** Clicks an "Export CSV" button and asserts a .csv download is produced. */
export async function exportCsv(page: Page): Promise<void> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
}

/** First data row's action button in the main table. */
export function firstRowButton(page: Page) {
  return page.getByRole('main').getByRole('row').filter({ has: page.getByRole('cell') }).first().getByRole('button').first();
}

/** Adds an evidence item in the shared EvidencePanel. */
export async function addEvidence(page: Page, type: string, reference: string): Promise<void> {
  await page.getByLabel('TypeSigned').selectOption(type);
  await page.getByPlaceholder('Reference — ticket number,').fill(reference);
  await page.getByRole('button', { name: 'Add' }).click();
}

export async function clickStates(page: Page, states: string[]): Promise<void> {
  for (const s of states) {
    const btn = page.getByRole('button', { name: s, exact: true });
    await btn.click();
    await expect(page.getByRole('main')).toBeVisible();
  }
}
