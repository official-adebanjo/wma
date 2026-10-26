import { test, expect } from '../../fixtures/fixtures';
import { asRole, closeRoleContexts } from '../../fixtures/loan-personas';
import { LoanManagementPage } from '../../pages/LoanManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import * as loans from '../../../shared/calc/loans';
import { formatNaira } from '../../../shared/calc/money';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Loan Management › Cross-product loan actions.
 * Release / hold disbursement, collections (call attempts, reminders), restructure, force-close,
 * write-off (Head of Credit + Compliance, prominent) and penalty waiver (Head of CRM + Compliance, prominent).
 *
 * Seeding assumptions: loan config key `dualThreshold` (shared LOANS config); seedLoan extra keys
 * `dpd`, `penalty`, `monthlyRatePct`, `interestModel` ('A' | 'B', LOAN PRODUCT SPECIFICATIONS §4.2), `tenorMonths`,
 * `disbursementTarget` ('WALLET' | 'SALARY_ACCOUNT').
 */
test.describe('Loan Management › Cross-product actions', () => {
  const DUAL_THRESHOLD = 1_000_000;

  test.beforeEach(async ({ hooks }) => {
    await hooks.setProductConfig({ product: 'LOANS', patch: { dualThreshold: DUAL_THRESHOLD } });
  });
  test.afterEach(closeRoleContexts);

  for (const p of [
    { product: 'NANO', amount: 20_000, target: /wallet/i },
    { product: 'PAYDAY', amount: 100_000, target: /wallet/i },
    { product: 'PERSONAL', amount: 500_000, target: /wallet/i },
    { product: 'PUBLIC_SECTOR', amount: 800_000, target: /salary account/i },
  ] as const) {
    test(title(`Release disbursement (${p.product}): Ready to disburse → Live servicing; credited to ${p.target.source}`, Tag.crit, Tag.spec('AdminPRD:LoanCrossProduct')), async ({ asPersona, hooks }) => {
      const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
      const { loanId } = await hooks.seedLoan({ customerId, product: p.product, state: 'READY_TO_DISBURSE', amount: p.amount });
      const lm = new LoanManagementPage(await asPersona('treasuryOfficer'));
      await lm.openLoan(loanId);
      const m = await lm.startAction(/release disbursement/i);
      if (p.product === 'NANO') {
        await m.submit();
        await m.expectValidationError(/evidence/i);
      }
      await m.evidence.fillDefault();
      await m.submit();
      await m.expectApplied();
      await lm.expectState(/live servicing/i);
      await lm.tab('Transactions');
      const tx = lm.transactionRows().filter({ hasText: /disbursement/i });
      await expect(tx).toHaveCount(1);
      await expect(tx).toContainText(formatNaira(p.amount));
      await expect(tx).toContainText(p.target);
      const notes = await hooks.latestNotifications(customerId);
      expect(notes.some((n) => /disburs/i.test(`${n.title} ${n.body}`))).toBe(true);
    });
  }

  test(title('Hold disbursement: loan becomes Held, customer told it is under review; loan account officer cannot hold', Tag.high, Tag.spec('AdminPRD:LoanCrossProduct')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'READY_TO_DISBURSE', amount: 500_000 });
    const officer = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    await officer.openLoan(loanId);
    await officer.detail.expectActionAbsent(/^hold/i);

    const lm = new LoanManagementPage(await asPersona('headOfCredit'));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/^hold/i);
    await m.fill(/reason/i, 'Possible identity mismatch');
    await m.submit();
    await m.expectApplied();
    await lm.expectState(/held/i);
    await lm.detail.expectActionDisabled(/release disbursement/i);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => n.channel === 'PUSH' && /disbursement is under review/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  test(title('Log call attempt: promise-to-pay creates a follow-up task; no-answer does not', Tag.med, Tag.spec('AdminPRD:LoanCrossProduct')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'COLLECTIONS', amount: 100_000, extra: { dpd: 12 } });
    const before = (await hooks.latestNotifications(customerId, 20)).length;
    const lm = new LoanManagementPage(await asPersona('collectionsOfficer'));
    await lm.openLoan(loanId);
    await lm.tab('Collections');

    let m = await lm.startAction(/log call attempt/i);
    await m.select(/outcome/i, 'No answer');
    await m.fill(/notes/i, 'Rang twice');
    await m.submit();
    await m.expectApplied();
    await expect(lm.contactAttempts()).toHaveCount(1);
    await expect(lm.followUps()).toHaveCount(0);

    m = await lm.startAction(/log call attempt/i);
    await m.select(/outcome/i, 'Promise to pay');
    await m.fill(/promise date|follow-up date/i, new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
    await m.fill(/notes/i, 'Will pay Friday');
    await m.submit();
    await m.expectApplied();
    await expect(lm.contactAttempts()).toHaveCount(2);
    await expect(lm.followUps()).toHaveCount(1);
    expect((await hooks.latestNotifications(customerId, 20)).length).toBe(before); // internal only
  });

  for (const channel of ['SMS', 'Email', 'Push'] as const) {
    test(title(`Send reminder via ${channel} with template is delivered and logged`, Tag.med, Tag.spec('AdminPRD:LoanCrossProduct')), async ({ asPersona, hooks }) => {
      const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
      const { loanId } = await hooks.seedLoan({ customerId, product: 'NANO', state: 'COLLECTIONS', amount: 20_000, extra: { dpd: 5 } });
      const lm = new LoanManagementPage(await asPersona('collectionsOfficer'));
      await lm.openLoan(loanId);
      const m = await lm.startAction(/send reminder/i);
      await m.select(/channel/i, channel);
      await m.select(/template/i, 'Overdue reminder');
      await m.submit();
      await m.expectApplied();
      await lm.tab('Collections');
      await expect(lm.reminders().filter({ hasText: new RegExp(channel, 'i') })).toHaveCount(1);
      const notes = await hooks.latestNotifications(customerId);
      expect(notes.some((n) => n.channel === channel.toUpperCase())).toBe(true);
    });
  }

  for (const model of ['A', 'B'] as const) test(title(`${model === 'A' ? 'Model A (monthly equal)' : 'Model B (monthly reducing)'}: Restructure (any product) above dual threshold — self-approval blocked; old schedule preserved`, Tag.crit, Tag.spec('AdminPRD:LoanCrossProduct'), Tag.spec('AdminPRD:ApprovalQueue'), Tag.spec('LoanSpec§4.2')), async ({ browser, asPersona, hooks }) => {
    const outstanding = 1_500_000;
    const rate = 2; // % per month
    const newTenor = 24;
    await hooks.setProductConfig({ product: 'PUBLIC_SECTOR', patch: { interestModel: model } });
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'PUBLIC_SECTOR', state: 'LIVE_SERVICING', amount: outstanding, extra: { monthlyRatePct: rate, interestModel: model, tenorMonths: 12 } });
    const proposer = await asPersona('headOfCredit');
    const lm = new LoanManagementPage(proposer);
    await lm.openLoan(loanId);
    const m = await lm.startAction(/^restructure/i);
    await m.select(/new tenor/i, `${newTenor} months`);
    await m.reasonCode('Financial hardship');
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const own = new ApprovalQueuePage(proposer);
    await own.goto();
    await own.open(new RegExp(reference));
    await own.expectSelfApprovalBlocked();

    const q = new ApprovalQueuePage(await asRole(browser, 'headOfCollections'));
    await q.goto();
    await q.open(new RegExp(reference));
    await q.approve('Hardship evidenced');

    await lm.openLoan(loanId);
    await lm.tab('Schedule');
    await expect(lm.scheduleRows()).toHaveCount(newTenor);
    const expected = loans.loanSchedule(outstanding, rate, newTenor, model);
    await expect(lm.scheduleRows().first()).toContainText(formatNaira(expected[0].totalDue));
    await expect(lm.scheduleRows().last()).toContainText(formatNaira(expected[newTenor - 1].totalDue));
    await expect(lm.scheduleHistory()).toHaveCount(2);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => /restructured/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  test(title('Force-close loan above dual threshold: Head of Credit proposes, Compliance approves; customer notified', Tag.crit, Tag.spec('AdminPRD:LoanCrossProduct')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: 2_000_000 });
    const lm = new LoanManagementPage(await asPersona('headOfCredit'));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/force-close/i);
    await m.fill(/reason/i, 'Deceased borrower — estate settlement');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();
    const q = new ApprovalQueuePage(await asPersona('compliance'));
    await q.goto();
    await q.open(new RegExp(reference));
    await q.expectEvidenceVisible();
    await q.approve('Estate documents verified');
    await lm.openLoan(loanId);
    await lm.expectState(/force-closed/i);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => n.channel === 'PUSH' && /loan has been closed/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  test(title('Write off: Head of Credit proposes, Compliance approves; prominent audit; moves to Written off silently', Tag.crit, Tag.spec('AdminPRD:LoanCrossProduct'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'COLLECTIONS', amount: 150_000, extra: { dpd: 120 } });
    const before = (await hooks.latestNotifications(customerId, 20)).length;
    const proposer = await asPersona('headOfCredit');
    const lm = new LoanManagementPage(proposer);
    await lm.openLoan(loanId);
    const m = await lm.startAction(/write off/i);
    await m.reasonCode('Uncollectable after 90+ DPD');
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const own = new ApprovalQueuePage(proposer);
    await own.goto();
    await own.open(new RegExp(reference));
    await own.expectSelfApprovalBlocked();

    const q = new ApprovalQueuePage(await asPersona('compliance'));
    await q.goto();
    await q.open(new RegExp(reference));
    await q.expectComplianceStepRequired();
    await q.approve('Loss recognised');

    await lm.openLoan(loanId);
    await lm.expectState(/written off/i);
    await expect(lm.detail.field('customer-status')).toHaveText(/closed/i);
    const audit = await hooks.auditEntries({ targetId: loanId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
    expect(audit[0].amount).toBe(150_000);
    expect((await hooks.latestNotifications(customerId, 20)).length).toBe(before);

    await lm.goto();
    await lm.portfolio.selectState('Written off');
    await lm.portfolio.search(reference);
    await expect(lm.portfolio.rows().filter({ hasText: reference })).toHaveCount(1);
  });

  test(title('Collections officer cannot write off or force-close', Tag.high, Tag.smoke, Tag.spec('AdminPRD:LoanCrossProduct')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'COLLECTIONS', amount: 150_000, extra: { dpd: 120 } });
    const lm = new LoanManagementPage(await asPersona('collectionsOfficer'));
    await lm.openLoan(loanId);
    await lm.detail.expectActionAbsent(/write off|force-close|waive penalty/i);
  });

  test(title('Waive loan penalty: amount bounded by penalty; Head of CRM + Compliance; prominent; wallet credited', Tag.crit, Tag.spec('AdminPRD:LoanCrossProduct')), async ({ asPersona, hooks }) => {
    const penalty = 7_500;
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: 400_000, extra: { penalty, penaltyApplied: true } });
    const proposer = await asPersona('headOfCrm');
    const lm = new LoanManagementPage(proposer);
    await lm.openLoan(loanId);
    const m = await lm.startAction(/waive penalty/i);
    await m.fill(/amount/i, penalty + 1);
    await m.expectValidationError(/exceeds|penalty/i);
    await m.fill(/amount/i, penalty);
    await m.fill(/reason/i, 'Late fee charged during system outage');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const own = new ApprovalQueuePage(proposer);
    await own.goto();
    await own.open(new RegExp(reference));
    await own.expectSelfApprovalBlocked();

    const q = new ApprovalQueuePage(await asPersona('compliance'));
    await q.goto();
    await q.open(new RegExp(reference));
    await q.expectComplianceStepRequired();
    await q.approve('Outage confirmed');

    await lm.openLoan(loanId);
    await lm.tab('Transactions');
    await expect(lm.transactionRows().filter({ hasText: /penalty refund|waiver/i }).filter({ hasText: formatNaira(penalty) })).toHaveCount(1);
    const audit = await hooks.auditEntries({ targetId: loanId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
    expect(audit[0].amount).toBe(penalty);
  });
});
