import { test as base, Browser, Page, expect } from '@playwright/test';
import * as fs from 'fs';
import { Persona, storageStatePath } from './personas';
import { QaHooks } from '../../shared/api/qa-hooks';

/**
 * Admin test fixtures.
 *
 *  asPersona(p)  → a Page logged in as that persona (separate browser context).
 *                  Needed for dual-approval flows: proposer and approver must differ.
 *  hooks         → QA seeding/inspection client; test is skipped if hooks aren't configured.
 *
 * Usage:
 *   test('...', async ({ asPersona, hooks }) => {
 *     const treasury = await asPersona('treasuryOfficer');
 *     const crm = await asPersona('headOfCrm');
 *   });
 */
type Fixtures = {
  asPersona: (p: Persona) => Promise<Page>;
  hooks: QaHooks;
};

export const test = base.extend<Fixtures>({
  asPersona: async ({ browser }, use, testInfo) => {
    const opened: Array<{ close(): Promise<void> }> = [];
    await use(async (p: Persona) => {
      const state = storageStatePath(p);
      if (!fs.existsSync(state)) testInfo.skip(true, `Persona ${p} has no stored session (configure ADMIN_* creds)`);
      const ctx = await (browser as Browser).newContext({ storageState: state });
      opened.push(ctx);
      const page = await ctx.newPage();
      await page.goto('/'); // land inside the portal so sidebar navigation works
      return page;
    });
    for (const c of opened) await c.close();
  },
  hooks: async ({}, use, testInfo) => {
    if (!QaHooks.isConfigured()) testInfo.skip(true, 'QA hooks not configured (QA_HOOKS_BASE_URL / QA_HOOKS_TOKEN)');
    const h = await QaHooks.create();
    await use(h);
    await h.dispose();
  },
});

export { expect };
