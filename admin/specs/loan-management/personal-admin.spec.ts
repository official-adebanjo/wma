import { test, expect } from '../../fixtures/fixtures';
import { asRole, closeRoleContexts, roleBelowBand, roleForBand } from '../../fixtures/loan-personas';
import { LoanManagementPage } from '../../pages/LoanManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import * as loans from '../../../shared/calc/loans';
import { formatNaira } from '../../../shared/calc/money';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Loan Management › Personal-specific actions.
 * Variants PL1–PL5 are internal (never shown to customers). Approvals are amount-band routed
 * Team Lead → CRM → GM → Executive. Variant reassignment is break-glass (Head of Credit propose,
 * Compliance approve, prominent audit) and sends the loan back to Underwriting. Buy-over posts
 * two transactions and needs an external payoff reference. Top-up obeys the variant's rule.
 * Restructure keeps the old schedule in history.
 *
 * Seeding assumptions: Personal config keys `approvalBands` (3 ceilings), `dualThreshold`,
 * `interestModel` ('A' monthly equal | 'B' monthly reducing — LOAN PRODUCT SPECIFICATIONS §4.2),
 * `variants.<PLn>.{monthlyRatePct,dtiPct,topUp:{allowed,maxCount}}`; seedLoan extra keys `variant`,
 * `monthlyRatePct`, `interestModel`, `tenorMonths`, `topUpCount`.
 */
test.describe('Loan Management › Personal actions', () => {
  const BANDS: [number, number, number] = [500_000, 2_000_000, 5_000_000];
  const DUAL_THRESHOLD = 1_000_000;
  const DEFAULT_MODEL: loans.InterestModel = 'B';
  const MODELS = ['A', 'B'] as const;
  const modelTitle = (m: loans.InterestModel) => (m === 'A' ? 'Model A (monthly equal)' : 'Model B (monthly reducing)');
  const VARIANTS = {
    PL2: { monthlyRatePct: 2, dtiPct: 33, topUp: { allowed: true, maxCount: 2 } },
    PL4: { monthlyRatePct: 1.75, dtiPct: 40, topUp: { allowed: false, maxCount: 0 } },
  };

  test.beforeEach(async ({ hooks }) => {
    await hooks.setProductConfig({ product: 'PERSONAL', patch: { approvalBands: BANDS, dualThreshold: DUAL_THRESHOLD, variants: VARIANTS, interestModel: DEFAULT_MODEL } });
  });
  test.afterEach(closeRoleContexts);

  test(title('Book Personal on behalf: classifier assigns variant, lists required docs, routes to band; customer never sees variant', Tag.crit, Tag.spec('AdminPRD:Personal'), Tag.spec('Personal§7')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0, salaryDetected: true, monthlySalary: 800_000, employer: 'QA Employer Ltd' });
    const amount = 1_500_000;
    const page = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(page);
    const m = await lm.bookOnBehalf(customerId, 'Personal');
    await m.fill(/amount/i, amount);
    await m.select(/tenor/i, '12 months');
    await expect(m.root().getByTestId('variant')).toHaveText(/PL[1-5]/);
    await expect(lm.requiredDocs()).toContainText(/bank statement/i);
    await m.submit();
    await m.expectValidationError(/document|evidence/i);
    await lm.uploadRequiredDocs();
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();

    const audit = await hooks.auditEntries({ action: 'personal.book', limit: 1 });
    expect(audit[0].evidence).toBeTruthy();
    await lm.openLoan(audit[0].targetId);
    await lm.expectState(/underwriting/i);
    await lm.tab('Decisioning');
    await expect(lm.decisioning('variant')).toHaveText(/PL[1-5]/);
    await expect(lm.decisioning('approval-band')).toContainText(new RegExp(loans.approvalBand(amount, BANDS).replace('_', ' '), 'i'));
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => /submitted|in review/i.test(`${n.title} ${n.body}`))).toBe(true);
    for (const n of notes) expect(`${n.title} ${n.body}`).not.toMatch(/PL[1-5]|variant/i);
  });

  test(title('Book Personal on behalf as buy-over: external payoff reference is required', Tag.high, Tag.spec('AdminPRD:Personal')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0, salaryDetected: true, monthlySalary: 800_000 });
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    const m = await lm.bookOnBehalf(customerId, 'Personal');
    await m.fill(/amount/i, 900_000);
    await m.select(/tenor/i, '12 months');
    await m.root().getByRole('checkbox', { name: /buy-over/i }).check();
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectValidationError(/payoff reference/i);
  });

  for (const amount of [400_000, 1_500_000, 4_000_000, 7_000_000]) {
    const band = loans.approvalBand(amount, BANDS);
    test(title(`Approve Personal ${formatNaira(amount)} at band ${band}; under-authority approver blocked`, Tag.crit, Tag.spec('AdminPRD:Personal')), async ({ browser, asPersona, hooks }) => {
      const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
      const { loanId } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'UNDERWRITING', amount, extra: { variant: 'PL2' } });
      const below = roleBelowBand(band);
      if (below) {
        const under = new LoanManagementPage(await asRole(browser, below));
        await under.openLoan(loanId);
        await under.expectAuthorityBlocked(/^approve/i);
      } else {
        const officer = new LoanManagementPage(await asPersona('loanAccountOfficer'));
        await officer.openLoan(loanId);
        await officer.expectAuthorityBlocked(/^approve/i);
      }
      const lm = new LoanManagementPage(await asRole(browser, roleForBand(band)));
      await lm.openLoan(loanId);
      const m = await lm.startAction(/^approve/i);
      await m.fill(/reason/i, 'Affordability confirmed');
      await m.evidence.fillDefault();
      await m.submit();
      await m.expectApplied();
      await lm.expectState(/ready to disburse/i);
      const notes = await hooks.latestNotifications(customerId);
      expect(notes.some((n) => /personal loan approved/i.test(`${n.title} ${n.body}`))).toBe(true);
    });
  }

  test(title('Reassign variant (break-glass): Head of Credit proposes, self-approval blocked, Compliance signs off; re-enters Underwriting silently', Tag.crit, Tag.spec('AdminPRD:Personal'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'UNDERWRITING', amount: 1_200_000, extra: { variant: 'PL2' } });
    const before = (await hooks.latestNotifications(customerId, 20)).length;
    const proposer = await asPersona('headOfCredit');
    const lm = new LoanManagementPage(proposer);
    await lm.openLoan(loanId);
    const m = await lm.startAction(/reassign variant/i);
    await m.select(/new variant/i, 'PL4');
    await m.fill(/reason/i, 'Income basis misclassified');
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
    await q.approve('Reclassification verified');

    await lm.openLoan(loanId);
    await lm.expectState(/underwriting/i);
    await lm.tab('Decisioning');
    await expect(lm.decisioning('variant')).toHaveText(/PL4/);
    await expect(lm.detail.field('customer-status')).toHaveText(/in review/i);
    expect((await hooks.auditEntries({ targetId: loanId, limit: 1 }))[0].prominent).toBe(true);
    expect((await hooks.latestNotifications(customerId, 20)).length).toBe(before);
  });

  test(title('Execute buy-over: payoff + new loan disbursement posted as two transactions after CRM approval', Tag.crit, Tag.spec('AdminPRD:Personal')), async ({ browser, asPersona, hooks }) => {
    const amount = 1_800_000;
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'READY_TO_DISBURSE', amount, extra: { variant: 'PL2', buyOver: true } });
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/buy-over/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectValidationError(/payoff reference/i);
    await m.fill(/payoff reference/i, `EXT-PAYOFF-${Date.now()}`);
    await m.submit();
    await m.expectRoutedToApproval(); // above dual threshold

    const q = new ApprovalQueuePage(await asRole(browser, 'crm'));
    await q.goto();
    await q.open(new RegExp(reference));
    await q.expectEvidenceVisible();
    await q.approve('Payoff letter verified');

    await lm.openLoan(loanId);
    await lm.tab('Transactions');
    await expect(lm.transactionRows().filter({ hasText: /buy-over|payoff/i })).toHaveCount(1);
    await expect(lm.transactionRows().filter({ hasText: /disbursement/i })).toHaveCount(1);
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.some((n) => /buy-over complete/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  test(title('Top-up on behalf adds to principal when variant rule allows; blocked once max count reached or variant disallows', Tag.crit, Tag.spec('AdminPRD:Personal')), async ({ asPersona, hooks }) => {
    const principal = 600_000;
    const topUp = 200_000;
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: principal, extra: { variant: 'PL2', topUpCount: 0 } });
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/top-up/i);
    await m.fill(/amount/i, topUp);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied(); // principal + top-up stays under the dual threshold
    await expect(lm.detail.field('principal')).toContainText(formatNaira(principal + topUp));

    const { loanId: maxed } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: principal, extra: { variant: 'PL2', topUpCount: VARIANTS.PL2.topUp.maxCount } });
    await lm.openLoan(maxed);
    const m2 = await lm.startAction(/top-up/i);
    await m2.fill(/amount/i, topUp);
    await m2.evidence.fillDefault();
    await m2.submit();
    await m2.expectValidationError(/maximum|max.*top-up/i);
    await m2.cancel();

    const { loanId: disallowed } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: principal, extra: { variant: 'PL4' } });
    await lm.openLoan(disallowed);
    await lm.expectAuthorityBlocked(/top-up/i);
  });

  for (const model of MODELS) {
    test(title(`${modelTitle(model)}: Restructure Personal — schedule recalculated per oracle, old schedule preserved in history`, Tag.crit, Tag.spec('AdminPRD:Personal'), Tag.spec('Personal§6'), Tag.spec('LoanSpec§4.2')), async ({ asPersona, hooks }) => {
      const outstanding = 480_000;
      const rate = VARIANTS.PL2.monthlyRatePct;
      const newTenor = 18;
      await hooks.setProductConfig({ product: 'PERSONAL', patch: { interestModel: model } });
      const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
      const { loanId } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: outstanding, extra: { variant: 'PL2', monthlyRatePct: rate, interestModel: model, tenorMonths: 12 } });
      const lm = new LoanManagementPage(await asPersona('headOfCredit'));
      await lm.openLoan(loanId);
      const m = await lm.startAction(/^restructure/i);
      await m.select(/new tenor/i, `${newTenor} months`);
      await m.reasonCode('Salary reduction');
      await m.evidence.fillDefault();
      await m.submit();
      await m.expectApplied();
      const expected = loans.loanSchedule(outstanding, rate, newTenor, model);
      await lm.tab('Schedule');
      await expect(lm.scheduleRows()).toHaveCount(newTenor);
      await expect(lm.scheduleRows().first()).toContainText(formatNaira(expected[0].totalDue));
      await expect(lm.scheduleRows().last()).toContainText(formatNaira(expected[newTenor - 1].totalDue));
      await expect(lm.scheduleHistory()).toHaveCount(2);
      const notes = await hooks.latestNotifications(customerId);
      expect(notes.some((n) => /restructured/i.test(`${n.title} ${n.body}`))).toBe(true);
    });
  }

  test(title('Configured interest model drives the loan-detail schedule: Model A (monthly equal) vs Model B (monthly reducing)', Tag.crit, Tag.spec('AdminPRD:Personal'), Tag.spec('LoanSpec§4.2'), Tag.spec('LoanSpec§4.3')), async ({ asPersona, hooks }) => {
    const principal = 1_200_000;
    const rate = VARIANTS.PL2.monthlyRatePct;
    const tenor = 12;
    const lm = new LoanManagementPage(await asPersona('loanAccountOfficer'));
    const lastRowText: Record<string, string> = {};
    for (const model of MODELS) {
      await hooks.setProductConfig({ product: 'PERSONAL', patch: { interestModel: model } });
      const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
      const { loanId } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: principal, extra: { variant: 'PL2', monthlyRatePct: rate, interestModel: model, tenorMonths: tenor } });
      const expected = loans.loanSchedule(principal, rate, tenor, model);
      await lm.openLoan(loanId);
      await lm.tab('Schedule');
      await expect(lm.scheduleRows()).toHaveCount(tenor);
      for (const [i, row] of expected.entries()) {
        const ui = lm.scheduleRows().nth(i);
        await expect(ui, `${modelTitle(model)} row ${row.n} total due`).toContainText(formatNaira(row.totalDue));
        await expect(ui, `${modelTitle(model)} row ${row.n} interest`).toContainText(formatNaira(row.interest));
        await expect(ui, `${modelTitle(model)} row ${row.n} principal`).toContainText(formatNaira(row.principal));
        await expect(ui, `${modelTitle(model)} row ${row.n} balance`).toContainText(formatNaira(row.balanceAfter));
      }
      await expect(lm.detail.field('total-interest')).toContainText(formatNaira(loans.scheduleTotals(expected).interest));
      lastRowText[model] = (await lm.scheduleRows().last().innerText()).trim();
    }
    // Model A interest is flat every month; Model B's last-month interest is lower → the rendered schedules must differ.
    const a = loans.loanSchedule(principal, rate, tenor, 'A');
    const b = loans.loanSchedule(principal, rate, tenor, 'B');
    expect(a[tenor - 1].interest.gt(b[tenor - 1].interest)).toBe(true);
    expect(lastRowText.A).not.toBe(lastRowText.B);
  });

  test(title('Decline Personal with managed-vocab reason', Tag.high, Tag.spec('AdminPRD:Personal')), async ({ browser, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'UNDERWRITING', amount: 300_000, extra: { variant: 'PL2' } });
    const lm = new LoanManagementPage(await asRole(browser, roleForBand(loans.approvalBand(300_000, BANDS))));
    await lm.openLoan(loanId);
    const m = await lm.startAction(/^decline/i);
    await m.reasonCode('Affordability');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await lm.expectState(/declined/i);
    expect((await hooks.latestNotifications(customerId)).some((n) => n.channel === 'PUSH')).toBe(true);
  });

  test(title('Escalate Personal to the next-tier approver queue', Tag.med, Tag.spec('AdminPRD:Personal')), async ({ browser, hooks }) => {
    const amount = 450_000;
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'UNDERWRITING', amount, extra: { variant: 'PL2' } });
    const band = loans.approvalBand(amount, BANDS);
    expect(band).toBe('TEAM_LEAD');
    const lm = new LoanManagementPage(await asRole(browser, roleForBand(band)));
    await lm.openLoan(loanId);
    await lm.detail.action(/escalate/i);
    await lm.modal.fill(/note/i, 'Borrower has an unusual income pattern');
    await lm.modal.submit();
    await lm.modal.expectApplied();
    await lm.expectState(/escalated/i);

    const next = await asRole(browser, 'crm');
    const q = new LoanManagementPage(next);
    await q.goto();
    await q.portfolio.selectState('Underwriting');
    await q.portfolio.search(reference);
    await expect(q.portfolio.rows().filter({ hasText: reference })).toHaveCount(1);
  });

  test(title('Roles without Personal permissions see no Personal admin actions', Tag.high, Tag.smoke, Tag.spec('AdminPRD:Personal')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'UNDERWRITING', amount: 300_000, extra: { variant: 'PL2' } });
    const lm = new LoanManagementPage(await asPersona('supportAgent'));
    await lm.openLoan(loanId);
    await lm.detail.expectActionAbsent(/approve|reassign variant|top-up|restructure|decline/i);
  });
});
