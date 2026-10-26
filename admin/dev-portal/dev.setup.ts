import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { DEV } from './support';

setup('sign in to the dev Admin Portal', async ({ page }) => {
  setup.skip(!DEV.email || !DEV.password, 'DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD not set in .env');
  await page.goto('/#/login');
  await page.getByPlaceholder('you@rosabon.com').fill(DEV.email);
  await page.getByPlaceholder('Enter your password').fill(DEV.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/#\/login/, { timeout: 30_000 });
  fs.mkdirSync(path.dirname(DEV.storageState), { recursive: true });
  await page.context().storageState({ path: DEV.storageState });
});

setup('wrong password is rejected', async ({ page, browser }) => {
  const ctx = await browser.newContext({ storageState: undefined });
  const p = await ctx.newPage();
  await p.goto(`${DEV.url}/#/login`);
  await p.getByPlaceholder('you@rosabon.com').fill(DEV.email);
  await p.getByPlaceholder('Enter your password').fill('Definitely-Wrong-1');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await expect(p).toHaveURL(/#\/login/);
  await ctx.close();
  void page;
});
