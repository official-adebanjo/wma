import { test, expect } from '../../fixtures/fixtures';
import { asRole, closeRoleContexts } from '../../fixtures/loan-personas';
import { PayrollReconciliationPage } from '../../pages/PayrollReconciliationPage';
import { LoanManagementPage } from '../../pages/LoanManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { D, formatNaira } from '../../../shared/calc/money';
import { uid } from '../../../shared/data/factories';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Loan Management › Payroll Reconciliation.
 * Expected batches per corridor and cycle with states Expected / Partially received / Fully received /
 * Late / Missing. Batch application is dual above the ₦1M seed threshold (Payroll ops lead propose,
 * Head of Public Sector approve). Reversal needs Compliance + prominent audit.
 *
 * Seeding assumptions (docs/TEST-HOOKS.md to be extended):
 *  - Public Sector loans seeded with extra.payrollBatchRef share one expected batch for their corridor;
 *    extra.expectedDeduction is the line amount; extra.batchDueDaysAgo back-dates the batch (Late/Missing).
 *  - hooks.simulateInboundTransfer({ reference: batchRef, customerId, amount }) is a payroll credit line;
 *    without customerId it lands as an unmatched credit.
 *  - Payroll config key `dualApprovalThreshold`; Late after due date, Missing after `missingAfterDays`.
 */
test.describe('Payroll Reconciliation', () => {
  const CORRIDOR = 'Lagos State';
  const DUAL_THRESHOLD = 1_000_000; // ₦1M seed threshold
  const MISSING_AFTER_DAYS = 14;

  type Line = { amount: number; received?: number };
  async function seedBatch(hooks: QaHooks, lines: Line[], opts: { dueDaysAgo?: number; unmatched?: number } = {}) {
    const batchRef = uid('PRB');
    const seeded: Array<{ customerId: string; loanId: string; reference: string; line: Line }> = [];
    for (const line of lines) {
      const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0, employer: CORRIDOR });
      const loan = await hooks.seedLoan({
        customerId, product: 'PUBLIC_SECTOR', state: 'LIVE_SERVICING', amount: line.amount * 12,
        extra: { corridor: CORRIDOR, payrollBatchRef: batchRef, expectedDeduction: line.amount, batchDueDaysAgo: opts.dueDaysAgo ?? -5 },
      });
      if (line.received) await hooks.simulateInboundTransfer({ reference: batchRef, customerId, amount: line.received });
      seeded.push({ customerId, ...loan, line });
    }
    if (opts.unmatched) await hooks.simulateInboundTransfer({ reference: batchRef, amount: opts.unmatched });
    return { batchRef, seeded };
  }

  test.beforeEach(async ({ hooks }) => {
    await hooks.setProductConfig({ product: 'PAYROLL_RECONCILIATION', patch: { dualApprovalThreshold: DUAL_THRESHOLD, missingAfterDays: MISSING_AFTER_DAYS } });
  });
  test.afterEach(closeRoleContexts);

  test(title('View expected batches by corridor with Expected / Partially received / Fully received / Late / Missing', Tag.high, Tag.smoke, Tag.spec('AdminPRD:PayrollRecon')), async ({ asPersona, hooks }) => {
    const expected = await seedBatch(hooks, [{ amount: 100_000 }]);
    const partial = await seedBatch(hooks, [{ amount: 100_000, received: 100_000 }, { amount: 100_000 }], { dueDaysAgo: 0 });
    const full = await seedBatch(hooks, [{ amount: 100_000, received: 100_000 }], { dueDaysAgo: 0 });
    const late = await seedBatch(hooks, [{ amount: 100_000 }], { dueDaysAgo: 3 });
    const missing = await seedBatch(hooks, [{ amount: 100_000 }], { dueDaysAgo: MISSING_AFTER_DAYS + 1 });
    const pr = new PayrollReconciliationPage(await asPersona('payrollOpsLead'));
    await pr.goto();
    await pr.filterCorridor(CORRIDOR);
    await pr.expectBatchState(expected.batchRef, 'Expected');
    await pr.expectBatchState(partial.batchRef, 'Partially received');
    await pr.expectBatchState(full.batchRef, 'Fully received');
    await pr.expectBatchState(late.batchRef, 'Late');
    await pr.expectBatchState(missing.batchRef, 'Missing');
    for (const corridor of await pr.batchRows().getByTestId('batch-corridor').allInnerTexts()) expect(corridor).toContain(CORRIDOR);
  });

  test(title('Open batch detail: summary, matched, unmatched credits, missing and partial repayments', Tag.high, Tag.smoke, Tag.spec('AdminPRD:PayrollRecon')), async ({ asPersona, hooks }) => {
    const lines: Line[] = [{ amount: 120_000, received: 120_000 }, { amount: 80_000, received: 50_000 }, { amount: 60_000 }];
    const unmatched = 33_000;
    const { batchRef } = await seedBatch(hooks, lines, { dueDaysAgo: 0, unmatched });
    const pr = new PayrollReconciliationPage(await asPersona('payrollOpsLead'));
    await pr.goto();
    await pr.openBatch(batchRef);
    const expectedTotal = lines.reduce((s, l) => s.plus(l.amount), D(0));
    const receivedTotal = lines.reduce((s, l) => s.plus(l.received ?? 0), D(unmatched));
    await expect(pr.summaryField('expected-total')).toContainText(formatNaira(expectedTotal));
    await expect(pr.summaryField('received-total')).toContainText(formatNaira(receivedTotal));
    await expect(pr.sectionRows('matched')).toHaveCount(1);
    await expect(pr.sectionRows('partial')).toHaveCount(1);
    await expect(pr.sectionRows('partial').first()).toContainText(formatNaira(30_000)); // shortfall 80k − 50k
    await expect(pr.sectionRows('missing')).toHaveCount(1);
    await expect(pr.sectionRows('unmatched')).toHaveCount(1);
    await expect(pr.sectionRows('unmatched').first()).toContainText(formatNaira(unmatched));
  });

  test(title('Approve batch below ₦1M: single admin applies matched repayments (source reconciliation) and notifies customers', Tag.crit, Tag.spec('AdminPRD:PayrollRecon')), async ({ asPersona, hooks }) => {
    const { batchRef, seeded } = await seedBatch(hooks, [{ amount: 150_000, received: 150_000 }, { amount: 150_000, received: 150_000 }], { dueDaysAgo: 0 });
    const page = await asPersona('payrollOpsLead');
    const pr = new PayrollReconciliationPage(page);
    await pr.gotoBatch(batchRef);
    const m = await pr.startAction(/approve batch/i);
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();

    const lm = new LoanManagementPage(page);
    await lm.openLoan(seeded[0].loanId);
    await lm.tab('Repayment history');
    const row = lm.repaymentRows().filter({ hasText: formatNaira(150_000) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/reconciliation/i);
    for (const s of seeded) {
      const notes = await hooks.latestNotifications(s.customerId);
      expect(notes.some((n) => n.channel === 'PUSH' && /repayment/i.test(`${n.title} ${n.body}`))).toBe(true);
    }
  });

  test(title('Approve batch above ₦1M: dual — proposer cannot self-approve; Head of Public Sector approves', Tag.crit, Tag.spec('AdminPRD:PayrollRecon'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const lines: Line[] = [{ amount: 400_000, received: 400_000 }, { amount: 400_000, received: 400_000 }, { amount: 400_000, received: 400_000 }];
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBeGreaterThan(DUAL_THRESHOLD);
    const { batchRef, seeded } = await seedBatch(hooks, lines, { dueDaysAgo: 0 });
    const proposer = await asPersona('payrollOpsLead');
    const pr = new PayrollReconciliationPage(proposer);
    await pr.gotoBatch(batchRef);
    const m = await pr.startAction(/approve batch/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const own = new ApprovalQueuePage(proposer);
    await own.goto();
    await own.open(new RegExp(batchRef));
    await own.expectSelfApprovalBlocked();

    const q = new ApprovalQueuePage(await asPersona('headOfPublicSector'));
    await q.goto();
    await q.open(new RegExp(batchRef));
    await q.expectEvidenceVisible();
    await q.expectInitiator(/payroll/i);
    await q.approve('Batch totals reconciled');
    const audit = await hooks.auditEntries({ targetId: seeded[0].loanId, limit: 1 });
    expect(audit[0].action).toMatch(/repayment|reconcil/i);
  });

  test(title('Roles outside payroll ops cannot approve or reverse batches', Tag.high, Tag.spec('AdminPRD:PayrollRecon')), async ({ asPersona, hooks }) => {
    const { batchRef } = await seedBatch(hooks, [{ amount: 150_000, received: 150_000 }], { dueDaysAgo: 0 });
    const pr = new PayrollReconciliationPage(await asPersona('collectionsOfficer'));
    await pr.gotoBatch(batchRef);
    await pr.detail.expectActionAbsent(/approve batch|reverse|suspend accrual/i);
  });

  test(title('Flag for corridor communication creates a communication log entry (internal only)', Tag.med, Tag.spec('AdminPRD:PayrollRecon')), async ({ asPersona, hooks }) => {
    const { batchRef, seeded } = await seedBatch(hooks, [{ amount: 100_000 }], { dueDaysAgo: 3 });
    const before = (await hooks.latestNotifications(seeded[0].customerId, 20)).length;
    const pr = new PayrollReconciliationPage(await asPersona('payrollOpsLead'));
    await pr.gotoBatch(batchRef);
    const m = await pr.startAction(/flag for corridor/i);
    await m.select(/category/i, 'Delay');
    await m.fill(/message/i, 'October batch not yet received from Lagos State payroll office');
    await m.submit();
    await m.expectApplied();
    await expect(pr.communicationLog().filter({ hasText: /delay/i })).toHaveCount(1);
    expect((await hooks.latestNotifications(seeded[0].customerId, 20)).length).toBe(before);
  });

  test(title('Reverse batch: Payroll ops lead proposes, Compliance approves; prominent audit; customers get reversal notice', Tag.crit, Tag.spec('AdminPRD:PayrollRecon')), async ({ asPersona, hooks }) => {
    const { batchRef, seeded } = await seedBatch(hooks, [{ amount: 150_000, received: 150_000 }, { amount: 150_000, received: 150_000 }], { dueDaysAgo: 0 });
    const proposer = await asPersona('payrollOpsLead');
    const pr = new PayrollReconciliationPage(proposer);
    await pr.gotoBatch(batchRef);
    let m = await pr.startAction(/approve batch/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();

    m = await pr.startAction(/^reverse/i);
    await m.fill(/reason/i, 'Corridor resent batch with corrected amounts');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const q = new ApprovalQueuePage(await asPersona('compliance'));
    await q.goto();
    await q.open(new RegExp(batchRef));
    await q.expectComplianceStepRequired();
    await q.approve('Reversal justified');

    const lm = new LoanManagementPage(proposer);
    await lm.openLoan(seeded[0].loanId);
    await lm.tab('Transactions');
    await expect(lm.transactionRows().filter({ hasText: /reversal/i }).filter({ hasText: formatNaira(150_000) })).toHaveCount(1);
    expect((await hooks.auditEntries({ targetId: seeded[0].loanId, limit: 1 }))[0].prominent).toBe(true);
    for (const s of seeded) {
      const notes = await hooks.latestNotifications(s.customerId);
      expect(notes.some((n) => n.channel === 'PUSH' && /repayment reversal notice/i.test(`${n.title} ${n.body}`))).toBe(true);
    }
  });

  test(title('Suspend accrual on a late batch requires an expected resolution date and flags each loan', Tag.crit, Tag.spec('AdminPRD:PayrollRecon'), Tag.spec('PublicSector§6')), async ({ asPersona, hooks }) => {
    const { batchRef, seeded } = await seedBatch(hooks, [{ amount: 100_000 }, { amount: 100_000 }], { dueDaysAgo: 3 });
    const page = await asPersona('headOfPublicSector');
    const pr = new PayrollReconciliationPage(page);
    await pr.gotoBatch(batchRef);
    await expect(pr.batchState()).toHaveText(/late/i);
    const m = await pr.startAction(/suspend accrual/i);
    await m.fill(/reason/i, 'Corridor payroll system outage');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectValidationError(/resolution date/i);
    const resolution = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await m.fill(/expected resolution date/i, resolution);
    await m.submit();
    await m.expectApplied();

    const lm = new LoanManagementPage(page);
    await lm.openLoan(seeded[0].loanId);
    await expect(lm.flagBanner()).toContainText(/accrual suspended/i);
    await expect(lm.detail.field('expected-resolution-date')).toContainText(/\d/);
    for (const s of seeded) {
      const notes = await hooks.latestNotifications(s.customerId);
      expect(notes.some((n) => n.channel === 'PUSH' && /interest accrual paused/i.test(`${n.title} ${n.body}`))).toBe(true);
    }
  });

  for (const handling of ['Waive suspended', 'Back-charge'] as const) {
    test(title(`Reactivate accrual → ${handling}`, Tag.crit, Tag.spec('AdminPRD:PayrollRecon')), async ({ asPersona, hooks }) => {
      const { batchRef, seeded } = await seedBatch(hooks, [{ amount: 100_000 }], { dueDaysAgo: 10 });
      const page = await asPersona('payrollOpsLead');
      const pr = new PayrollReconciliationPage(page);
      await pr.gotoBatch(batchRef);
      let m = await pr.startAction(/suspend accrual/i);
      await m.fill(/reason/i, 'Corridor outage');
      await m.fill(/expected resolution date/i, new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10));
      await m.evidence.fillDefault();
      await m.submit();
      await m.expectApplied();
      await hooks.advanceClock({ customerId: seeded[0].customerId, days: 5 });

      await pr.gotoBatch(batchRef);
      m = await pr.startAction(/reactivate accrual/i);
      await m.select(/handling/i, handling);
      await m.evidence.fillDefault();
      await m.submit();
      await m.expectApplied();

      const lm = new LoanManagementPage(page);
      await lm.openLoan(seeded[0].loanId);
      await expect(lm.flagBanner().filter({ hasText: /accrual suspended/i })).toHaveCount(0);
      await lm.tab('Transactions');
      const backCharges = lm.transactionRows().filter({ hasText: /back-charge/i });
      await expect(backCharges).toHaveCount(handling === 'Back-charge' ? 1 : 0);
      const notes = await hooks.latestNotifications(seeded[0].customerId);
      expect(notes.some((n) => n.channel === 'PUSH' && /accrual/i.test(`${n.title} ${n.body}`))).toBe(true);
    });
  }

  test(title('Investigate unmatched credit → assign customer requires customer ID; matched credit notifies customer', Tag.crit, Tag.spec('AdminPRD:PayrollRecon')), async ({ asPersona, hooks }) => {
    const unmatched = 45_000;
    const { batchRef } = await seedBatch(hooks, [{ amount: 100_000, received: 100_000 }], { dueDaysAgo: 0, unmatched });
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0, employer: CORRIDOR });
    const pr = new PayrollReconciliationPage(await asPersona('payrollOpsLead'));
    await pr.gotoBatch(batchRef);
    const m = await pr.openItem('unmatched', formatNaira(unmatched));
    await m.select(/resolution/i, 'Assign customer');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectValidationError(/customer id/i);
    await m.fill(/customer id/i, customerId);
    await m.submit();
    await m.expectApplied();
    await expect(pr.sectionRows('unmatched')).toHaveCount(0);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => n.channel === 'PUSH' && /payment received/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  test(title('Investigate unmatched credit → assign intent needs a pre-recorded intent; escalate keeps it open', Tag.high, Tag.spec('AdminPRD:PayrollRecon')), async ({ asPersona, hooks }) => {
    const unmatched = 21_000;
    const { batchRef } = await seedBatch(hooks, [{ amount: 100_000, received: 100_000 }], { dueDaysAgo: 0, unmatched });
    const pr = new PayrollReconciliationPage(await asPersona('payrollOpsLead'));
    await pr.gotoBatch(batchRef);
    const m = await pr.openItem('unmatched', formatNaira(unmatched));
    await m.select(/resolution/i, 'Assign intent');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectValidationError(/intent/i);
    await m.select(/resolution/i, 'Escalate');
    await m.submit();
    await m.expectApplied();
    await expect(pr.sectionRows('unmatched').filter({ hasText: /escalated/i })).toHaveCount(1);
  });

  test(title('Investigate missing repayment → genuine default routes the loan to Collections (Head of Collections)', Tag.crit, Tag.spec('AdminPRD:PayrollRecon')), async ({ browser, hooks }) => {
    const { batchRef, seeded } = await seedBatch(hooks, [{ amount: 100_000, received: 100_000 }, { amount: 90_000 }], { dueDaysAgo: 0 });
    const missingLoan = seeded[1];
    const page = await asRole(browser, 'headOfCollections');
    const pr = new PayrollReconciliationPage(page);
    await pr.gotoBatch(batchRef);
    const m = await pr.openItem('missing', missingLoan.reference);
    await m.select(/reason/i, 'Genuine default');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    const lm = new LoanManagementPage(page);
    await lm.openLoan(missingLoan.loanId);
    await lm.expectState(/collections/i);
  });

  test(title('Investigate missing repayment → remittance error records a note for corridor communication', Tag.high, Tag.spec('AdminPRD:PayrollRecon')), async ({ asPersona, hooks }) => {
    const { batchRef, seeded } = await seedBatch(hooks, [{ amount: 90_000 }], { dueDaysAgo: 0 });
    const page = await asPersona('payrollOpsLead');
    const pr = new PayrollReconciliationPage(page);
    await pr.gotoBatch(batchRef);
    const m = await pr.openItem('missing', seeded[0].reference);
    await m.select(/reason/i, 'Remittance error');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    const lm = new LoanManagementPage(page);
    await lm.openLoan(seeded[0].loanId);
    await expect(lm.detail.state()).not.toContainText(/collections/i);
    await lm.tab('Audit trail');
    await expect(lm.detail.auditRows().filter({ hasText: /remittance error/i }).first()).toBeVisible();
  });

  for (const handling of ['Apply partial', 'Request top-up', 'Mark shortfall'] as const) {
    test(title(`Handle partial repayment → ${handling}`, Tag.high, Tag.spec('AdminPRD:PayrollRecon')), async ({ asPersona, hooks }) => {
      const expectedAmt = 80_000;
      const received = 50_000;
      const { batchRef, seeded } = await seedBatch(hooks, [{ amount: expectedAmt, received }], { dueDaysAgo: 0 });
      const page = await asPersona('payrollOpsLead');
      const pr = new PayrollReconciliationPage(page);
      await pr.gotoBatch(batchRef);
      const m = await pr.openItem('partial', seeded[0].reference);
      await m.select(/handling/i, handling);
      await m.evidence.fillDefault();
      await m.submit();
      await m.expectApplied();
      const lm = new LoanManagementPage(page);
      await lm.openLoan(seeded[0].loanId);
      await lm.tab('Repayment history');
      await expect(lm.repaymentRows().filter({ hasText: formatNaira(received) })).toHaveCount(1);
      if (handling === 'Mark shortfall') await expect(lm.detail.field('shortfall')).toContainText(formatNaira(expectedAmt - received));
      const notes = await hooks.latestNotifications(seeded[0].customerId);
      expect(notes.some((n) => n.channel === 'PUSH' && /partial payment received/i.test(`${n.title} ${n.body}`))).toBe(true);
    });
  }
});
