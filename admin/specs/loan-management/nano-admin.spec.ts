import { test, expect } from '../../fixtures/fixtures';
import { LoanManagementPage } from '../../pages/LoanManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import * as loans from '../../../shared/calc/loans';
import { formatNaira } from '../../../shared/calc/money';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Loan Management › Nano-specific actions.
 * Book on behalf runs full auto-decisioning (DTI + bureau + loyalty streak): approve → loan + wallet
 * disbursement; decline → decline record. Overrides of the engine are Head of Credit (propose) +
 * Compliance (approve) with prominent audit. Bureau timeout: retry / alt bureau / escalate / decline.
 *
 * Seeding assumptions: hooks.stubProvider BUREAU outcomes 'GOOD_SCORE' | 'POOR_SCORE' | 'TIMEOUT' | 'OK';
 * seedLoan NANO states AUTO_DECLINED, AUTO_APPROVED (pre-disbursement), BUREAU_TIMEOUT, DTI_EDGE;
 * Nano config keys `dtiLimitPct` / `dtiTolerancePct` / `termRatePct` via setProductConfig.
 */
test.describe('Loan Management › Nano actions', () => {
  const NANO_CFG = { dtiLimitPct: 40, dtiTolerancePct: 5, termRatePct: 5 };

  test.beforeEach(async ({ hooks }) => {
    await hooks.setProductConfig({ product: 'NANO', patch: NANO_CFG });
  });

  test(title('Book Nano on behalf: evidence mandatory; auto-approve creates loan and disburses to wallet', Tag.crit, Tag.spec('AdminPRD:Nano')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0, salaryDetected: true, monthlySalary: 300_000 });
    await hooks.stubProvider({ provider: 'BUREAU', outcome: 'GOOD_SCORE', customerId });
    const page = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(page);
    const m = await lm.bookOnBehalf(customerId, 'Nano');
    const amount = 20_000;
    await m.fill(/amount/i, amount);
    await m.select(/tenor/i, '30 days');
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();

    const audit = await hooks.auditEntries({ action: 'nano.book', limit: 1 });
    expect(audit[0].evidence).toBeTruthy();
    const loanId = audit[0].targetId;
    await lm.openLoan(loanId);
    await lm.expectState(/live servicing|disbursed/i);
    await expect(lm.detail.sourcePill().first()).toContainText(/admin_action|admin/i);
    const { totalRepayment } = loans.flatInterest(amount, NANO_CFG.termRatePct);
    await expect(lm.detail.field('total-repayment')).toContainText(formatNaira(totalRepayment));
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => /approved|disbursed|wallet/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  test(title('Book Nano on behalf: auto-decline creates a decline record and no disbursement', Tag.crit, Tag.spec('AdminPRD:Nano')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0, salaryDetected: true, monthlySalary: 300_000 });
    await hooks.stubProvider({ provider: 'BUREAU', outcome: 'POOR_SCORE', customerId });
    const page = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(page);
    const m = await lm.bookOnBehalf(customerId, 'Nano');
    await m.fill(/amount/i, 20_000);
    await m.select(/tenor/i, '30 days');
    await m.evidence.fillDefault();
    await m.submit();
    await expect(page.getByRole('status').or(page.getByTestId('toast')).first()).toContainText(/declined/i);

    const audit = await hooks.auditEntries({ action: 'nano.book', limit: 1 });
    await lm.openLoan(audit[0].targetId);
    await lm.expectState(/declined/i);
    await lm.tab('Transactions');
    await expect(lm.transactionRows().filter({ hasText: /disbursement/i })).toHaveCount(0);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => /couldn.t be approved|declined/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  test(title('Decisioning tab shows DTI, bureau score, loyalty streak and decision reason', Tag.high, Tag.smoke, Tag.spec('AdminPRD:Nano')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const obligations = 85_000;
    const income = 200_000;
    const { loanId } = await hooks.seedLoan({
      customerId, product: 'NANO', state: 'AUTO_DECLINED', amount: 30_000,
      extra: { monthlyObligations: obligations, monthlyIncome: income, bureauScore: 540, loyaltyStreak: 3, declineReason: 'DTI too high' },
    });
    const page = await asPersona('readOnly');
    const lm = new LoanManagementPage(page);
    await lm.openLoan(loanId);
    await lm.tab('Decisioning');
    const expectedDti = loans.dti(obligations, income); // 42.50
    await expect(lm.decisioning('dti')).toContainText(`${expectedDti.toFixed(2)}%`);
    await expect(lm.decisioning('bureau-score')).toContainText('540');
    await expect(lm.decisioning('loyalty-streak')).toContainText('3');
    await expect(lm.decisioning('decision-reason')).toContainText(/DTI too high/i);
  });

  test(title('Override auto-decline: Head of Credit proposes, self-approval blocked, Compliance approves; disburses with prominent audit', Tag.crit, Tag.spec('AdminPRD:Nano'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const amount = 25_000;
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'NANO', state: 'AUTO_DECLINED', amount });
    const proposer = await asPersona('headOfCredit');
    const lm = new LoanManagementPage(proposer);
    await lm.openLoan(loanId);
    const m = await lm.startAction(/override auto-decline/i);
    await m.fill(/reason/i, 'Bureau flag is stale — verified repayment history');
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const ownQueue = new ApprovalQueuePage(proposer);
    await ownQueue.goto();
    await ownQueue.open(new RegExp(reference));
    await ownQueue.expectSelfApprovalBlocked();

    const compliance = await asPersona('compliance');
    const q = new ApprovalQueuePage(compliance);
    await q.goto();
    await q.open(new RegExp(reference));
    await q.expectComplianceStepRequired();
    await q.expectEvidenceVisible();
    await q.expectInitiator(/credit/i);
    await q.approve('Override justified');

    const view = new LoanManagementPage(compliance);
    await view.openLoan(loanId);
    await view.expectState(/approved-via-override|live servicing/i);
    await view.tab('Transactions');
    await expect(view.transactionRows().filter({ hasText: /disbursement/i }).filter({ hasText: formatNaira(amount) })).toHaveCount(1);
    const audit = await hooks.auditEntries({ targetId: loanId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
    expect(audit[0].approvers?.length ?? 0).toBeGreaterThan(0);
  });

  test(title('Override auto-approve before disbursement: Compliance approval declines the loan with prominent audit and push', Tag.crit, Tag.spec('AdminPRD:Nano')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'NANO', state: 'AUTO_APPROVED', amount: 15_000 });
    const proposer = await asPersona('headOfCredit');
    const lm = new LoanManagementPage(proposer);
    await lm.openLoan(loanId);
    const m = await lm.startAction(/override auto-approve/i);
    await m.reasonCode('Bureau flag');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const q = new ApprovalQueuePage(await asPersona('compliance'));
    await q.goto();
    await q.open(new RegExp(reference));
    await q.expectComplianceStepRequired();
    await q.approve('Confirmed bureau flag');

    await lm.openLoan(loanId);
    await lm.expectState(/declined-via-override/i);
    const audit = await hooks.auditEntries({ targetId: loanId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => n.channel === 'PUSH' && /declined|bureau flag/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  for (const option of [
    { pick: 'Retry', stub: 'OK', state: /live servicing|declined|applied/i, notifies: false },
    { pick: 'Use alt bureau', stub: 'OK', state: /live servicing|declined|applied/i, notifies: false },
    { pick: 'Escalate', stub: undefined, state: /manual review|underwriting|escalated/i, notifies: false },
    { pick: 'Decline', stub: undefined, state: /declined/i, notifies: true },
  ] as const) {
    test(title(`Handle bureau timeout → ${option.pick}`, Tag.high, Tag.spec('AdminPRD:Nano'), Tag.spec('Nano§6c')), async ({ asPersona, hooks }) => {
      const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
      const { loanId } = await hooks.seedLoan({ customerId, product: 'NANO', state: 'BUREAU_TIMEOUT', amount: 20_000 });
      if (option.stub) await hooks.stubProvider({ provider: 'BUREAU', outcome: option.stub, customerId });
      const before = (await hooks.latestNotifications(customerId, 20)).length;
      const page = await asPersona('loanAccountOfficer');
      const lm = new LoanManagementPage(page);
      await lm.openLoan(loanId);
      const m = await lm.startAction(/handle bureau timeout/i);
      await m.select(/action/i, option.pick);
      if (option.pick === 'Decline') await m.reasonCode('Bureau flag');
      await m.evidence.fillDefault();
      await m.submit();
      await m.expectApplied();
      await lm.expectState(option.state);
      const after = await hooks.latestNotifications(customerId, 20);
      if (option.notifies) expect(after.some((n) => /declined|couldn.t be approved/i.test(`${n.title} ${n.body}`))).toBe(true);
      else if (option.pick !== 'Retry' && option.pick !== 'Use alt bureau') expect(after.length).toBe(before);
      const audit = await hooks.auditEntries({ targetId: loanId, limit: 1 });
      expect(audit[0].action).toMatch(/bureau/i);
    });
  }

  test(title('Handle DTI edge case: approval inside tolerance band is executed with prominent audit', Tag.crit, Tag.spec('AdminPRD:Nano')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    // DTI 42% → above the 40% limit but inside the 5-point tolerance band.
    const obligations = 84_000;
    const income = 200_000;
    const computed = loans.dti(obligations, income);
    expect(computed.gt(NANO_CFG.dtiLimitPct) && computed.lte(NANO_CFG.dtiLimitPct + NANO_CFG.dtiTolerancePct)).toBe(true);
    const { loanId } = await hooks.seedLoan({ customerId, product: 'NANO', state: 'DTI_EDGE', amount: 20_000, extra: { monthlyObligations: obligations, monthlyIncome: income } });
    const page = await asPersona('headOfCredit');
    const lm = new LoanManagementPage(page);
    await lm.openLoan(loanId);
    await lm.tab('Decisioning');
    await expect(lm.decisioning('dti')).toContainText(`${computed.toFixed(2)}%`);
    const m = await lm.startAction(/handle dti edge/i);
    await expect(m.root()).toContainText(/prominent audit/i);
    await m.select(/action/i, 'Approve');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await lm.expectState(/approved|live servicing/i);
    const audit = await hooks.auditEntries({ targetId: loanId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
  });

  test(title('Handle DTI edge case → Request info sends push and keeps loan pending', Tag.med, Tag.spec('AdminPRD:Nano')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'NANO', state: 'DTI_EDGE', amount: 20_000 });
    const page = await asPersona('compliance');
    const lm = new LoanManagementPage(page);
    await lm.openLoan(loanId);
    const m = await lm.startAction(/handle dti edge/i);
    await m.select(/action/i, 'Request info');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await lm.expectState(/awaiting|info requested|pending/i);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => n.channel === 'PUSH')).toBe(true);
    expect((await hooks.auditEntries({ targetId: loanId, limit: 1 }))[0].prominent).toBe(true);
  });

  test(title('Loan account officer cannot override engine decisions; read-only cannot handle bureau timeout', Tag.high, Tag.spec('AdminPRD:Nano')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId: declined } = await hooks.seedLoan({ customerId, product: 'NANO', state: 'AUTO_DECLINED', amount: 20_000 });
    const officer = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    await officer.openLoan(declined);
    await officer.detail.expectActionAbsent(/override auto-decline/i);

    const { customerId: c2 } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId: stuck } = await hooks.seedLoan({ customerId: c2, product: 'NANO', state: 'BUREAU_TIMEOUT', amount: 20_000 });
    const ro = new LoanManagementPage(await asPersona('readOnly'));
    await ro.openLoan(stuck);
    await ro.detail.expectActionAbsent(/handle bureau timeout|override/i);
  });
});
