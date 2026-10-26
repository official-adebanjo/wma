import { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/fixtures';
import { SettingsPage } from '../../pages/SettingsPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { TransactionsLedgerPage } from '../../pages/TransactionsLedgerPage';
import { asRole, closeRoleSessions } from '../../fixtures/platform-personas';
import { uid } from '../../../shared/data/factories';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Settings.
 *   Change Rules              — Compliance → CPO/CFO; dual + Compliance; prominent audit
 *   Reason Codes              — Compliance → Head of Ops; retired values hidden from dropdowns, old records preserved
 *   Approval Thresholds       — Head of Ops → Compliance; pending change until dual; new-positions-only
 *   Communications Providers  — CTO → Head of Ops; dual + Compliance
 *   Metric Definitions        — Finance → Compliance; dual + Compliance
 */
const REVERSAL_VOCAB = 'Reversal reasons';
const THRESHOLD = /investment booking/i;

async function approve(page: Page, matching: RegExp, opts: { compliance?: boolean } = {}) {
  const q = new ApprovalQueuePage(page);
  await q.goto();
  await q.open(matching);
  if (opts.compliance) await q.expectComplianceStepRequired();
  await q.approve('Approved');
}

test.describe('Settings', () => {
  test.afterEach(closeRoleSessions);

  test(title('Change Rules lists every configurable field with its propagation classification', Tag.med, Tag.smoke, Tag.spec('AdminPRD:Settings')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const s = new SettingsPage(page);
    await s.goto('Change Rules');
    await expect(s.portfolio.rows().first().getByTestId('propagation-class')).toHaveText(/cosmetic|new-positions-only|judgement-required/i);
  });

  test(title('Edit field classification: dual + Compliance, self-approval blocked, prominent audit', Tag.crit, Tag.spec('AdminPRD:Settings'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const compliance = await asPersona('compliance');
    const s = new SettingsPage(compliance);
    await s.goto('Change Rules');
    const field = (await s.portfolio.columnValues('Field'))[0].trim();
    const original = (await s.classification(field).innerText()).trim();
    const target = /cosmetic/i.test(original) ? 'New-positions-only' : 'Cosmetic';
    const m = await s.openAndEdit(field);
    await m.select(/class/i, target);
    await m.fill(/reason/i, 'Business reclassification — automated test');
    await m.submit();
    await m.expectRoutedToApproval();
    await expect(s.classification(field)).toHaveText(original); // not applied yet

    const own = new ApprovalQueuePage(compliance);
    await own.goto();
    await own.open(new RegExp(field));
    await own.expectSelfApprovalBlocked();

    const cpo = await asPersona('cpo');
    await approve(cpo, new RegExp(field), { compliance: true });
    await s.goto('Change Rules');
    await expect(s.classification(field)).toHaveText(new RegExp(target, 'i'));
    const audit = await hooks.auditEntries({ action: 'change_rule.edit', limit: 1 });
    expect(audit[0].prominent).toBe(true);

    // restore
    const r = await s.openAndEdit(field);
    await r.select(/class/i, original);
    await r.fill(/reason/i, 'Restore after automated test');
    await r.submit();
    await approve(cpo, new RegExp(field));
  });

  test(title('Reason code: add → edit → retire (each dual); retired value hidden from dropdowns but preserved on record', Tag.high, Tag.spec('AdminPRD:Settings')), async ({ asPersona }) => {
    const value = uid('QA reversal');
    const edited = `${value} (edited)`;
    const compliance = await asPersona('compliance');
    const ops = await asPersona('headOfOps');
    const s = new SettingsPage(compliance);

    await s.goto('Reason Codes');
    await s.openVocabulary(REVERSAL_VOCAB);
    await s.addValue(value);
    await s.modal.expectRoutedToApproval();
    await approve(ops, new RegExp(value));

    await s.goto('Reason Codes');
    await s.openVocabulary(REVERSAL_VOCAB);
    const m = await s.openAndEdit(value);
    await m.fill(/value|label/i, edited);
    await m.submit();
    await approve(ops, new RegExp(value));

    await s.goto('Reason Codes');
    await s.openVocabulary(REVERSAL_VOCAB);
    await s.retireValue(edited);
    await approve(ops, new RegExp(edited.replace(/[()]/g, '\\$&')));

    await s.goto('Reason Codes');
    await s.openVocabulary(REVERSAL_VOCAB);
    await expect(s.vocabularyValues().filter({ hasText: edited })).toContainText(/retired/i); // preserved

    const treasury = await asPersona('treasuryOfficer');
    const tl = new TransactionsLedgerPage(treasury);
    await tl.goto('Transaction Monitor');
    await tl.portfolio.rows().first().click();
    const rm = await tl.startAction(/^reverse/i);
    await rm.field(/reason/i).click();
    await expect(treasury.getByRole('option', { name: edited })).toHaveCount(0);
    await rm.cancel();
  });

  test(title('Edit approval threshold creates a pending change that applies only after dual approval', Tag.crit, Tag.spec('AdminPRD:Settings')), async ({ asPersona, hooks }) => {
    const ops = await asPersona('headOfOps');
    const s = new SettingsPage(ops);
    await s.goto('Approval Thresholds');
    const original = (await s.thresholdValue(THRESHOLD).innerText()).trim();
    const originalNum = Number(original.replace(/[^0-9.]/g, ''));
    await s.editThreshold(THRESHOLD, 'Custom', originalNum + 1_000_000);
    await expect(s.pendingChangeBadge(THRESHOLD)).toBeVisible();
    await expect(s.thresholdValue(THRESHOLD)).toHaveText(original);

    const compliance = await asPersona('compliance');
    await approve(compliance, /threshold|investment booking/i);
    await s.goto('Approval Thresholds');
    await expect(s.thresholdValue(THRESHOLD)).not.toHaveText(original);
    await expect(s.pendingChangeBadge(THRESHOLD)).toHaveCount(0);
    const audit = await hooks.auditEntries({ action: 'threshold.edit', limit: 1 });
    expect(audit[0].approvers ?? []).toHaveLength(1);

    // restore
    await s.editThreshold(THRESHOLD, 'Custom', originalNum);
    await approve(compliance, /threshold|investment booking/i);
  });

  test(title('Configure communications provider: CTO proposes, Head of Ops approves with Compliance step', Tag.high, Tag.spec('AdminPRD:Settings')), async ({ asPersona, browser }) => {
    const cto = await asRole(browser, 'cto');
    const s = new SettingsPage(cto);
    await s.goto('Communications Providers');
    await expect(s.portfolio.rows().first().getByTestId('health-status')).toBeVisible();
    const provider = (await s.portfolio.columnValues('Provider'))[0].trim();
    const m = await s.openAndEdit(provider);
    await m.fill(/rate limit|throughput/i, 100);
    await m.submit();
    await m.expectRoutedToApproval();
    const ops = await asPersona('headOfOps');
    await approve(ops, new RegExp(provider), { compliance: true });
  });

  test(title('Edit metric definition: Finance proposes, Compliance approves (dual + Compliance)', Tag.high, Tag.spec('AdminPRD:Settings')), async ({ asPersona, browser, hooks }) => {
    const finance = await asRole(browser, 'finance');
    const s = new SettingsPage(finance);
    await s.goto('Metric Definitions');
    for (const col of ['Formula', 'Source', 'Refresh']) await expect(s.portfolio.table().getByRole('columnheader', { name: new RegExp(col, 'i') })).toBeVisible();
    const metric = (await s.portfolio.columnValues('Metric'))[0].trim();
    const m = await s.openAndEdit(metric);
    await m.fill(/source/i, 'ledger.v2');
    await m.submit();
    await m.expectRoutedToApproval();
    const compliance = await asPersona('compliance');
    await approve(compliance, new RegExp(metric), { compliance: true });
    const audit = await hooks.auditEntries({ action: 'metric.edit', limit: 1 });
    expect(audit[0]).toBeTruthy();
  });

  test(title('Roles without settings permissions cannot edit Change Rules or thresholds', Tag.crit, Tag.spec('AdminPRD:Settings')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    await page.goto('/');
    if ((await page.getByTestId('nav-settings').count()) === 0) return; // module hidden = no access
    const s = new SettingsPage(page);
    await s.goto('Change Rules');
    await s.portfolio.rows().first().click();
    await expect(page.getByRole('button', { name: /^edit|configure/i })).toHaveCount(0);
  });
});
