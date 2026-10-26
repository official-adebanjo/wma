import { test, expect } from '../../fixtures/fixtures';
import { asRole, closeRoleContexts, rolesForReferralTier } from '../../fixtures/loan-personas';
import { LoanManagementPage } from '../../pages/LoanManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import * as loans from '../../../shared/calc/loans';
import { formatNaira } from '../../../shared/calc/money';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Loan Management › Payday-specific actions.
 * Referral matrix (config-driven): LOW auto-approves; MEDIUM → CRM; HIGH → Credit Manager + MD.
 * Amount capped at salaryCapPct of monthly salary; 30-day term. Mandate failure: retry / wallet
 * fallback / escalate to Collections. Declines use managed vocab per tier.
 *
 * Seeding assumptions: Payday config keys `referral.{mediumFrom,highFrom}`, `salaryCapPct`, `termRatePct`;
 * seedLoan PAYDAY states UNDERWRITING (extra.referralTier) and MANDATE_FAILED; stubProvider REMITA
 * outcomes 'DEBIT_OK' | 'DEBIT_FAILED'.
 */
test.describe('Loan Management › Payday actions', () => {
  const REFERRAL = { mediumFrom: 100_000, highFrom: 250_000 };
  const TERM_RATE_PCT = 10;
  const SALARY = 600_000;

  test.beforeEach(async ({ hooks }) => {
    await hooks.setProductConfig({ product: 'PAYDAY', patch: { referral: REFERRAL, salaryCapPct: productConfig.payday.salaryCapPct, termRatePct: TERM_RATE_PCT } });
  });
  test.afterEach(closeRoleContexts);

  test(title('Book Payday on behalf: amount above salary-proportion cap is rejected; evidence mandatory', Tag.crit, Tag.spec('AdminPRD:Payday'), Tag.spec('Payday§4')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0, salaryDetected: true, monthlySalary: SALARY, employer: 'QA Employer Ltd' });
    const cap = loans.paydayCap(SALARY, productConfig.payday.salaryCapPct);
    const page = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(page);
    const m = await lm.bookOnBehalf(customerId, 'Payday');
    await expect(m.root()).toContainText(formatNaira(cap));
    await expect(m.field(/term|tenor/i)).toHaveValue(/30/);
    await m.fill(/amount/i, cap.plus(1).toNumber());
    await m.expectValidationError(/cap|maximum/i);
    await m.fill(/amount/i, 50_000);
    await m.submit();
    await m.expectValidationError(/evidence/i);
  });

  for (const amount of [50_000, 150_000, 280_000]) {
    const tier = loans.referralTier(amount, REFERRAL);
    test(title(`Book Payday on behalf ${formatNaira(amount)} routes per referral matrix → ${tier}`, Tag.crit, Tag.spec('AdminPRD:Payday'), Tag.spec('Payday§6')), async ({ asPersona, hooks }) => {
      const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0, salaryDetected: true, monthlySalary: SALARY, employer: 'QA Employer Ltd' });
      const page = await asPersona('loanAccountOfficer');
      const lm = new LoanManagementPage(page);
      const m = await lm.bookOnBehalf(customerId, 'Payday');
      await m.fill(/amount/i, amount);
      await m.evidence.fillDefault();
      await m.submit();
      const audit = await hooks.auditEntries({ action: 'payday.book', limit: 1 });
      await lm.openLoan(audit[0].targetId);
      await lm.tab('Decisioning');
      await expect(lm.decisioning('referral-tier')).toHaveText(new RegExp(tier, 'i'));
      if (tier === 'LOW') {
        await lm.expectState(/live servicing|disbursed/i);
        const { totalRepayment } = loans.flatInterest(amount, TERM_RATE_PCT);
        await expect(lm.detail.field('total-repayment')).toContainText(formatNaira(totalRepayment));
      } else {
        await lm.expectState(/underwriting|in review/i);
        await expect(lm.detail.field('approver-queue')).toContainText(tier === 'MEDIUM' ? /CRM/ : /credit manager/i);
      }
    });
  }

  test(title('Decisioning tab shows referral tier for an application in review; read-only sees no decision actions', Tag.med, Tag.smoke, Tag.spec('AdminPRD:Payday')), async ({ asPersona, hooks }) => {
    const amount = 150_000;
    const tier = loans.referralTier(amount, REFERRAL);
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0, salaryDetected: true, monthlySalary: SALARY });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'UNDERWRITING', amount, extra: { referralTier: tier } });
    const lm = new LoanManagementPage(await asPersona('readOnly'));
    await lm.openLoan(loanId);
    await lm.tab('Decisioning');
    await expect(lm.decisioning('referral-tier')).toHaveText(new RegExp(tier, 'i'));
    await lm.detail.expectActionAbsent(/^approve|^decline/i);
  });

  test(title('Approve Payday at MEDIUM tier by CRM → Ready to disburse; push sent', Tag.crit, Tag.spec('AdminPRD:Payday')), async ({ browser, hooks }) => {
    const amount = 150_000;
    expect(loans.referralTier(amount, REFERRAL)).toBe('MEDIUM');
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0, salaryDetected: true, monthlySalary: SALARY });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'UNDERWRITING', amount, extra: { referralTier: 'MEDIUM' } });
    const [role] = rolesForReferralTier('MEDIUM');
    const lm = new LoanManagementPage(await asRole(browser, role));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/^approve/i);
    await m.fill(/reason/i, 'Salary verified');
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await lm.expectState(/ready to disburse/i);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => n.channel === 'PUSH' && /payday loan has been approved/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  test(title('Approve Payday at HIGH tier: Credit Manager then MD; self-approval of the second step blocked', Tag.crit, Tag.spec('AdminPRD:Payday'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ browser, hooks }) => {
    const amount = 280_000;
    expect(loans.referralTier(amount, REFERRAL)).toBe('HIGH');
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0, salaryDetected: true, monthlySalary: SALARY });
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'UNDERWRITING', amount, extra: { referralTier: 'HIGH' } });
    const [first, second] = rolesForReferralTier('HIGH');
    const cmPage = await asRole(browser, first);
    const lm = new LoanManagementPage(cmPage);
    await lm.openLoan(loanId);
    const m = await lm.startAction(/^approve/i);
    await m.fill(/reason/i, 'Within risk appetite');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();
    await lm.openLoan(loanId);
    await lm.expectState(/underwriting|awaiting md/i);

    const ownQueue = new ApprovalQueuePage(cmPage);
    await ownQueue.goto();
    await ownQueue.open(new RegExp(reference));
    await ownQueue.expectSelfApprovalBlocked();

    const q = new ApprovalQueuePage(await asRole(browser, second));
    await q.goto();
    await q.open(new RegExp(reference));
    await q.expectEvidenceVisible();
    await q.approve('MD sign-off');
    await lm.openLoan(loanId);
    await lm.expectState(/ready to disburse/i);
  });

  test(title('Wrong-tier approvers are blocked: loan account officer on MEDIUM, CRM on HIGH', Tag.crit, Tag.spec('AdminPRD:Payday')), async ({ browser, asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0, salaryDetected: true, monthlySalary: SALARY });
    const { loanId: medium } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'UNDERWRITING', amount: 150_000, extra: { referralTier: 'MEDIUM' } });
    const officer = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    await officer.openLoan(medium);
    await officer.expectAuthorityBlocked(/^approve/i);

    const { customerId: c2 } = await hooks.seedCustomer({ tier: 2, walletBalance: 0, salaryDetected: true, monthlySalary: SALARY });
    const { loanId: high } = await hooks.seedLoan({ customerId: c2, product: 'PAYDAY', state: 'UNDERWRITING', amount: 280_000, extra: { referralTier: 'HIGH' } });
    const crm = new LoanManagementPage(await asRole(browser, 'crm'));
    await crm.openLoan(high);
    await crm.expectAuthorityBlocked(/^approve/i);
    await crm.openLoan(high);
    await crm.expectState(/underwriting|in review/i);
  });

  test(title('Handle mandate failure → Retry re-triggers Remita debit and sends SMS', Tag.high, Tag.spec('AdminPRD:Payday'), Tag.spec('Payday§7')), async ({ asPersona, hooks }) => {
    const amount = 80_000;
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0, salaryDetected: true, monthlySalary: SALARY });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'MANDATE_FAILED', amount, extra: { termRatePct: TERM_RATE_PCT } });
    await hooks.stubProvider({ provider: 'REMITA', outcome: 'DEBIT_OK', customerId });
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/handle mandate failure/i);
    await m.select(/action/i, 'Retry');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await lm.tab('Transactions');
    await expect(lm.transactionRows().filter({ hasText: /remita/i }).first()).toBeVisible();
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => n.channel === 'SMS')).toBe(true);
  });

  test(title('Handle mandate failure → Wallet fallback debits full repayment from wallet', Tag.crit, Tag.spec('AdminPRD:Payday')), async ({ asPersona, hooks }) => {
    const amount = 80_000;
    const { totalRepayment } = loans.flatInterest(amount, TERM_RATE_PCT);
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: totalRepayment.toNumber(), salaryDetected: true, monthlySalary: SALARY });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'MANDATE_FAILED', amount, extra: { termRatePct: TERM_RATE_PCT } });
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/handle mandate failure/i);
    await m.select(/action/i, 'Wallet fallback');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await lm.tab('Transactions');
    await expect(lm.transactionRows().filter({ hasText: /wallet/i }).filter({ hasText: formatNaira(totalRepayment) })).toHaveCount(1);
    await expect(lm.detail.field('outstanding')).toContainText(formatNaira(0));
  });

  test(title('Handle mandate failure → Escalate moves the loan to Collections', Tag.high, Tag.spec('AdminPRD:Payday')), async ({ browser, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'MANDATE_FAILED', amount: 80_000 });
    const lm = new LoanManagementPage(await asRole(browser, 'headOfCollections'));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/handle mandate failure/i);
    await m.select(/action/i, 'Escalate');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await lm.expectState(/collections/i);
  });

  test(title('Decline Payday (LOW) with managed-vocab reason → Declined + push with reason', Tag.high, Tag.spec('AdminPRD:Payday'), Tag.spec('Payday§6b')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'UNDERWRITING', amount: 50_000, extra: { referralTier: 'LOW' } });
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/^decline/i);
    // Managed vocabulary: reason is a pick-list, not free text.
    await expect(m.root().getByRole('combobox', { name: /reason/i })).toBeVisible();
    await m.reasonCode('DSR too high');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await lm.expectState(/declined/i);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => n.channel === 'PUSH' && /declined/i.test(n.body) && /DSR too high/i.test(n.body))).toBe(true);
  });

  test(title('Decline at MEDIUM tier is reserved for CRM; loan account officer is blocked', Tag.high, Tag.spec('AdminPRD:Payday')), async ({ browser, asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'UNDERWRITING', amount: 150_000, extra: { referralTier: 'MEDIUM' } });
    const officer = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    await officer.openLoan(loanId);
    await officer.expectAuthorityBlocked(/^decline/i);

    const crm = new LoanManagementPage(await asRole(browser, 'crm'));
    await crm.openLoan(loanId);
    const m = await crm.startAction(/^decline/i);
    await m.reasonCode('Salary verification failed');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await crm.expectState(/declined/i);
  });

  test(title('Request additional documents sets Awaiting-docs and pushes an upload prompt', Tag.med, Tag.spec('AdminPRD:Payday')), async ({ browser, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'UNDERWRITING', amount: 150_000, extra: { referralTier: 'MEDIUM' } });
    const lm = new LoanManagementPage(await asRole(browser, 'underwriter'));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/request (additional )?doc/i);
    await m.select(/document type/i, 'Payslip');
    await m.fill(/note/i, 'Please upload your latest payslip');
    await m.submit();
    await m.expectApplied();
    await lm.expectState(/awaiting[- ]docs|awaiting customer/i);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => n.channel === 'PUSH' && /upload|payslip/i.test(`${n.title} ${n.body}`))).toBe(true);
  });
});
