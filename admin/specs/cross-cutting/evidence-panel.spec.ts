import * as fs from 'fs';
import * as path from 'path';
import { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/fixtures';
import { WalletManagementPage } from '../../pages/WalletManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { abs, ensureTestFiles } from '../../../shared/data/files';
import { testFiles, uid } from '../../../shared/data/factories';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Cross-cutting › Evidence panel — exercised on a representative money action
 * (Wallet Management › Manual ledger entry, which is dual ALWAYS so evidence also reaches the approver).
 * Types: PDF, PNG, JPG, JPEG; max 10MB per file; Written instruction needs "why not one of the above";
 * reason for acting on behalf required. Enforced at component level.
 */
const repoRoot = path.resolve(__dirname, '../../..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Writes extra fixtures (PNG, .jpeg) under the test output dir; returns repo-relative paths for EvidencePanel.upload. */
function extraFixtures(outDir: string) {
  fs.mkdirSync(outDir, { recursive: true });
  const png = path.join(outDir, 'evidence.png');
  const jpeg = path.join(outDir, 'evidence.jpeg');
  fs.writeFileSync(png, PNG);
  fs.copyFileSync(abs(testFiles.validJpg), jpeg);
  return { png: path.relative(repoRoot, png), jpeg: path.relative(repoRoot, jpeg) };
}

async function openManualEntry(page: Page, hooks: QaHooks, externalRef = uid('EVD')) {
  const { phone } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
  const wm = new WalletManagementPage(page);
  await wm.goto('Manual ledger');
  const m = await wm.createManualEntry();
  await wm.fillManualEntry({ customer: phone, product: 'Wallet', amount: 5_000, category: 'Credit', externalRef });
  return { m, externalRef };
}

test.describe('Cross-cutting › Evidence panel', () => {
  test.beforeAll(() => { ensureTestFiles(); });

  test(title('Submit without evidence is blocked', Tag.crit, Tag.smoke, Tag.spec('AdminPRD:EvidencePanel')), async ({ asPersona, hooks }) => {
    const page = await asPersona('treasuryOfficer');
    const { m } = await openManualEntry(page, hooks);
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.expectOpen();
  });

  const accepted: Array<[string, (out: string) => string]> = [
    ['PDF', () => testFiles.validPdf],
    ['JPG', () => testFiles.validJpg],
    ['PNG', (out) => extraFixtures(out).png],
    ['JPEG', (out) => extraFixtures(out).jpeg],
  ];
  for (const [kind, file] of accepted) {
    test(title(`Accepts ${kind} upload`, Tag.high, Tag.spec('AdminPRD:EvidencePanel')), async ({ asPersona, hooks }, testInfo) => {
      const page = await asPersona('treasuryOfficer');
      const { m } = await openManualEntry(page, hooks);
      await m.evidence.pick('Signed doc');
      await m.evidence.upload(file(testInfo.outputPath('fixtures')));
      await expect(await m.evidence.fileError()).toHaveCount(0);
      await m.evidence.reasonOnBehalf('Signed customer instruction');
      await m.submit();
      await m.expectRoutedToApproval();
    });
  }

  test(title('Rejects a file over 10MB', Tag.crit, Tag.spec('AdminPRD:EvidencePanel')), async ({ asPersona, hooks }) => {
    const page = await asPersona('treasuryOfficer');
    const { m } = await openManualEntry(page, hooks);
    await m.evidence.pick('Signed doc');
    await m.evidence.upload(testFiles.oversized);
    await expect(await m.evidence.fileError()).toContainText(/10\s?MB|too large|size/i);
    await m.evidence.reasonOnBehalf('Oversized file test');
    await m.submit();
    await m.expectOpen(); // still blocked
  });

  test(title('Rejects an unsupported file type', Tag.crit, Tag.spec('AdminPRD:EvidencePanel')), async ({ asPersona, hooks }) => {
    const page = await asPersona('treasuryOfficer');
    const { m } = await openManualEntry(page, hooks);
    await m.evidence.pick('Email upload');
    await m.evidence.upload(testFiles.unsupported);
    await expect(await m.evidence.fileError()).toContainText(/PDF|PNG|JPG|JPEG|file type|unsupported/i);
  });

  test(title('Written instruction requires "why not one of the above"', Tag.crit, Tag.spec('AdminPRD:EvidencePanel')), async ({ asPersona, hooks }) => {
    const page = await asPersona('treasuryOfficer');
    const { m } = await openManualEntry(page, hooks);
    await m.evidence.pick('Written instruction');
    await m.evidence.reasonOnBehalf('Branch walk-in instruction');
    await m.submit();
    await m.expectValidationError(/why not one of the above/i);
    await m.evidence.whyNotOther('Customer has no email or WhatsApp; wrote instruction at branch');
    await m.submit();
    await m.expectRoutedToApproval();
  });

  test(title('Reason for acting on behalf is required', Tag.crit, Tag.spec('AdminPRD:EvidencePanel')), async ({ asPersona, hooks }) => {
    const page = await asPersona('treasuryOfficer');
    const { m } = await openManualEntry(page, hooks);
    await m.evidence.pick('Ticket reference');
    await m.evidence.ticketRef(`TKT-${Date.now()}`);
    await m.submit();
    await m.expectValidationError(/reason for acting on behalf/i);
  });

  test(title('Evidence is visible to the approver and recorded in the audit entry', Tag.crit, Tag.spec('AdminPRD:EvidencePanel'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const proposer = await asPersona('treasuryOfficer');
    const { m, externalRef } = await openManualEntry(proposer, hooks);
    const ticket = `TKT-${Date.now()}`;
    await m.evidence.fillDefault(ticket);
    await m.evidence.upload(testFiles.validPdf);
    await m.submit();
    await m.expectRoutedToApproval();

    const own = new ApprovalQueuePage(proposer);
    await own.goto();
    await own.open(new RegExp(externalRef));
    await own.expectSelfApprovalBlocked();

    const approver = await asPersona('headOfTreasury');
    const q = new ApprovalQueuePage(approver);
    await q.goto();
    await q.open(new RegExp(externalRef));
    await q.expectEvidenceVisible();
    await expect(q.reviewModal().getByTestId('evidence-summary')).toContainText(ticket);
    await q.approve('Evidence verified');
    const audit = await hooks.auditEntries({ action: 'ledger.manual_entry', limit: 1 });
    expect(JSON.stringify(audit[0].evidence ?? '')).toContain(ticket);
  });

  test(title('Roles without money-action permission never reach the evidence panel', Tag.high, Tag.spec('AdminPRD:EvidencePanel')), async ({ asPersona }) => {
    const page = await asPersona('readOnly');
    await page.goto('/');
    await expect(page.getByRole('button', { name: /create entry/i })).toHaveCount(0);
    await expect(page.getByTestId('evidence-panel')).toHaveCount(0);
  });
});
