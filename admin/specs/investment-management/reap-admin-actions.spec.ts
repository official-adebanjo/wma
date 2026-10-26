import { test, expect } from '../../fixtures/fixtures';
import { InvestmentActionsPage } from '../../pages/InvestmentActionsPage';
import { Customer360Page } from '../../pages/Customer360Page';
import { openApprovalQueue } from '../../pages/approvals';
import * as reap from '../../../shared/calc/reap';
import { addDays, formatNaira } from '../../../shared/calc/money';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Investment Management › REAP-specific actions.
 * Rules from REAP_Customer_App_Spec: min target is config-driven; On-demand frequency hides autosave;
 * break / pre-maturity exit = principal returned, 100% of accrued interest forfeited (E6 default).
 * Admin unlock and forfeiture waiver are dual + Compliance + prominent audit.
 */
test.describe('Investment Management › REAP actions', () => {
  const RATE = 12;

  /** Seeds the single-contribution history assumed by the oracle: one contribution of `principal` on the funding day. */
  const contributionsFor = (principal: number, fundedDaysAgo: number): reap.Contribution[] => [
    { amount: principal, on: addDays(new Date(), -fundedDaysAgo) },
  ];

  test(title('Create REAP on behalf: min target, autosave eligibility per frequency, evidence mandatory, initial contribution', Tag.crit, Tag.spec('AdminPRD:REAP'), Tag.spec('REAP§Step4')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 500_000 }); // Admin PRD: REAP is Tier 1+
    const page = await asPersona('treasuryOfficer');
    const c360 = new Customer360Page(page);
    await c360.goto(customerId);
    await c360.createInvestment('REAP');
    const im = new InvestmentActionsPage(page);
    const m = im.modal;
    await m.fill(/plan name/i, 'Admin booked REAP');
    await m.fill(/target/i, productConfig.reap.minTarget - 1);
    await m.expectValidationError(/minimum/i);
    await m.fill(/target/i, 300_000);
    await m.select(/tenor/i, '6 months');

    // On-demand: autosave does not apply and is hidden, with an explanation.
    await m.root().getByRole('radio', { name: /on-demand/i }).check();
    await expect(m.root().getByRole('switch', { name: /autosave/i }).or(m.root().getByRole('checkbox', { name: /autosave/i }))).toHaveCount(0);
    await expect(m.root()).toContainText(/on-demand.*(doesn't|does not) support autosave/i);

    // Scheduled frequency: autosave visible, ON by default, contribution amount required.
    await m.root().getByRole('radio', { name: /^monthly$/i }).check();
    const autosave = m.root().getByRole('switch', { name: /autosave/i }).or(m.root().getByRole('checkbox', { name: /autosave/i })).first();
    await expect(autosave).toBeChecked();
    await m.fill(/contribution amount/i, 50_000);
    await m.root().getByRole('radio', { name: /wallet/i }).check();
    await m.fill(/initial contribution/i, 50_000);

    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();

    const audit = await hooks.auditEntries({ action: 'reap.create', limit: 1 });
    expect(audit[0].evidence).toBeTruthy();
    expect(audit[0].targetId).toBeTruthy();
    await im.openPlan(audit[0].targetId);
    await expect(im.detail.state()).toContainText(/active/i);
    await expect(im.detail.sourcePill().first()).toContainText(/admin_action|admin/i);
    await expect(im.transactionHistory()).toContainText(formatNaira(50_000));
    const sms = await hooks.latestNotifications(customerId);
    expect(sms.some((n) => n.channel === 'SMS' && /REAP plan has been created/i.test(n.body))).toBe(true);
  });

  test(title('Create REAP on behalf above threshold routes to Approval Queue; self-approval blocked', Tag.crit, Tag.spec('AdminPRD:REAP'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3, walletBalance: 80_000_000 });
    const proposer = await asPersona('treasuryOfficer');
    const c360 = new Customer360Page(proposer);
    await c360.goto(customerId);
    await c360.createInvestment('REAP');
    const m = new InvestmentActionsPage(proposer).modal;
    await m.fill(/plan name/i, 'Large REAP');
    await m.fill(/target/i, 100_000_000);
    await m.select(/tenor/i, '12 months');
    await m.root().getByRole('radio', { name: /^monthly$/i }).check();
    await m.fill(/contribution amount/i, 8_500_000);
    await m.root().getByRole('radio', { name: /wallet/i }).check();
    await m.fill(/initial contribution/i, 50_000_000);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const own = await openApprovalQueue(proposer);
    await own.open(/Large REAP|REAP/);
    await own.expectSelfApprovalBlocked();

    const q = await openApprovalQueue(await asPersona('headOfCrm'));
    await q.open(/Large REAP|REAP/);
    await q.expectEvidenceVisible();
    await q.approve('Verified customer instruction');
    await expect(q.row(/Large REAP/)).toHaveCount(0);
  });

  test(title('Withdraw REAP on behalf before maturity: 100% interest forfeited, principal to wallet, plan Closed', Tag.crit, Tag.open('E6'), Tag.spec('AdminPRD:REAP')), async ({ asPersona, hooks }) => {
    const PRINCIPAL = 120_000;
    const DAYS = 60;
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'REAP', state: 'ACTIVE', principal: PRINCIPAL, ratePct: RATE, fundedDaysAgo: DAYS, extra: { tenorMonths: 6, target: 300_000 } });
    const expected = reap.breakOutcome(contributionsFor(PRINCIPAL, DAYS), RATE, new Date());

    const page = await asPersona('treasuryOfficer');
    const im = new InvestmentActionsPage(page);
    await im.openPlan(investmentId);
    const m = await im.startAction(/withdraw on behalf/i);
    await expect(im.summaryLine('principal')).toContainText(formatNaira(expected.principalReturned));
    await expect(im.summaryLine('interest-forfeited')).toContainText(formatNaira(expected.interestForfeited));
    await expect(im.summaryLine('net-to-wallet')).toContainText(formatNaira(expected.principalReturned));
    await m.reasonCode('Change of plans');
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();

    await expect(im.detail.state()).toContainText(/closed/i);
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].amount).toBe(expected.principalReturned.toNumber());
    expect(JSON.stringify(audit[0])).toMatch(/forfeit/i);
    const push = await hooks.latestNotifications(customerId);
    expect(push.some((n) => /interest forfeited per plan terms/i.test(n.body))).toBe(true);
  });

  test(title('Admin unlock (break-glass): Head of CRM proposes, Compliance signs off, prominent audit, state Unlocked-Break-Glass', Tag.crit, Tag.spec('AdminPRD:REAP')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId, reference } = await hooks.seedInvestment({ customerId, product: 'REAP', state: 'LOCKED', principal: 200_000, ratePct: RATE, fundedDaysAgo: 40, extra: { tenorMonths: 12, target: 500_000 } });
    const crm = await asPersona('headOfCrm');
    const im = new InvestmentActionsPage(crm);
    await im.openPlan(investmentId);
    const m = await im.startAction(/admin unlock/i);
    await m.fill(/reason/i, 'Medical emergency — customer instruction on file');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();
    await expect(im.detail.state()).not.toContainText(/unlocked/i);

    const q = await openApprovalQueue(await asPersona('compliance'));
    await q.open(reference);
    await q.expectComplianceStepRequired();
    await q.approve('Compliance approved break-glass unlock');

    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
    await im.openPlan(investmentId);
    await expect(im.detail.state()).toContainText(/unlocked.?break.?glass/i);
  });

  test(title('Treasury officer cannot admin-unlock or waive REAP forfeiture', Tag.crit, Tag.spec('AdminPRD:REAP')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'REAP', state: 'LOCKED', principal: 200_000, ratePct: RATE, fundedDaysAgo: 40 });
    const im = new InvestmentActionsPage(await asPersona('treasuryOfficer'));
    await im.openPlan(investmentId);
    await im.detail.expectActionAbsent(/admin unlock|waive forfeiture/i);
  });

  test(title('Waive REAP forfeiture: managed-vocab reason, amount capped at forfeited interest, Compliance approval, prominent audit, wallet refund', Tag.crit, Tag.open('E6'), Tag.spec('AdminPRD:REAP')), async ({ asPersona, hooks }) => {
    const PRINCIPAL = 150_000;
    const DAYS = 90;
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const forfeited = reap.breakOutcome(contributionsFor(PRINCIPAL, DAYS), RATE, new Date()).interestForfeited;
    const { investmentId, reference } = await hooks.seedInvestment({
      customerId, product: 'REAP', state: 'CLOSED', principal: PRINCIPAL, ratePct: RATE, fundedDaysAgo: DAYS,
      extra: { forfeitedInterest: forfeited.toNumber() },
    });
    const crm = await asPersona('headOfCrm');
    const im = new InvestmentActionsPage(crm);
    await im.openPlan(investmentId);
    const m = await im.startAction(/waive forfeiture/i);
    await m.fill(/amount/i, forfeited.plus(1).toFixed(2));
    await m.expectValidationError(/exceeds|forfeited/i);
    await m.fill(/amount/i, forfeited.toFixed(2));
    await m.reasonCode('Service failure');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const compliance = await asPersona('compliance');
    const q = await openApprovalQueue(compliance);
    await q.open(reference);
    await q.expectComplianceStepRequired();
    await expect(q.reviewModal()).toContainText(formatNaira(forfeited));
    await q.approve('Compliance approved waiver');

    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
    expect(audit[0].amount).toBe(forfeited.toNumber());
    const push = await hooks.latestNotifications(customerId);
    expect(push.some((n) => /interest waiver refund/i.test(n.title + n.body))).toBe(true);
  });

  test(title('Correct REAP plan details is cosmetic-only and applies immediately without approval', Tag.med, Tag.spec('AdminPRD:REAP')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'REAP', state: 'ACTIVE', principal: 50_000, ratePct: RATE, fundedDaysAgo: 10 });
    const im = new InvestmentActionsPage(await asPersona('headOfCrm'));
    await im.openPlan(investmentId);
    const m = await im.startAction(/edit details/i);
    // Only cosmetic fields are editable — no financial terms in the form.
    await expect(m.field(/target|tenor|rate|contribution amount/i)).toHaveCount(0);
    await m.fill(/plan name/i, 'Corrected REAP name');
    await m.submit();
    await m.expectApplied();
    await expect(im.detail.field('plan-name')).toContainText('Corrected REAP name');
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].approvers ?? []).toHaveLength(0);
  });

  test(title('Roles without REAP permissions do not see REAP admin actions', Tag.high, Tag.spec('AdminPRD:REAP')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'REAP', state: 'ACTIVE', principal: 50_000, ratePct: RATE, fundedDaysAgo: 10 });
    const im = new InvestmentActionsPage(await asPersona('marketing'));
    await im.openPlan(investmentId);
    await im.detail.expectActionAbsent(/withdraw on behalf|admin unlock|waive forfeiture|edit details/i);
  });
});
