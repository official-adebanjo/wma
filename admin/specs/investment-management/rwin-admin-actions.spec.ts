import { test, expect } from '../../fixtures/fixtures';
import { InvestmentManagementPage } from '../../pages/InvestmentManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { Customer360Page } from '../../pages/Customer360Page';
import * as rwin from '../../../shared/calc/rwin';
import { formatNaira } from '../../../shared/calc/money';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Investment Management › RWIN 2.0-specific actions.
 * Rules carried over from RWIN_2_0_Customer_App_Spec: 30-day minimum is absolute (no admin unlock),
 * ₦50k minimum retained on partial withdrawal, ₦100M cap, top-up = new tranche at rate in force.
 */
test.describe('Investment Management › RWIN 2.0 actions', () => {
  const RATE = 14;

  test(title('Create RWIN 2.0 on behalf: validates min deposit and requires 30-day acknowledgement + evidence', Tag.crit, Tag.spec('AdminPRD:RWIN')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 2_000_000 });
    const page = await asPersona('treasuryOfficer');
    const c360 = new Customer360Page(page);
    await c360.goto(customerId);
    await c360.createInvestment('RWIN 2.0');
    const im = new InvestmentManagementPage(page);
    const m = im.modal;
    await m.fill(/plan name/i, 'Admin booked RWIN');
    await m.fill(/initial deposit/i, productConfig.rwin.minDeposit - 1);
    await m.expectValidationError(/minimum/i);
    await m.fill(/initial deposit/i, 500_000);
    await m.submit();
    await m.expectValidationError(/30-day|acknowledg/i);
    await m.root().getByRole('checkbox', { name: /30-day minimum/i }).check();
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    const audit = await hooks.auditEntries({ action: 'rwin.create', limit: 1 });
    expect(audit[0].evidence).toBeTruthy();
  });

  test(title('Create RWIN 2.0 on behalf above dual threshold routes to Approval Queue; self-approval blocked', Tag.crit, Tag.spec('AdminPRD:RWIN'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 60_000_000 });
    const proposer = await asPersona('treasuryOfficer');
    const c360 = new Customer360Page(proposer);
    await c360.goto(customerId);
    await c360.createInvestment('RWIN 2.0');
    const m = new InvestmentManagementPage(proposer).modal;
    await m.fill(/plan name/i, 'Large RWIN');
    await m.fill(/initial deposit/i, 50_000_000);
    await m.root().getByRole('checkbox', { name: /30-day minimum/i }).check();
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const queueAsProposer = new ApprovalQueuePage(proposer);
    await queueAsProposer.goto();
    await queueAsProposer.open(/Large RWIN|RWIN 2.0/);
    await queueAsProposer.expectSelfApprovalBlocked();

    const approver = await asPersona('headOfCrm');
    const queue = new ApprovalQueuePage(approver);
    await queue.goto();
    await queue.open(/Large RWIN|RWIN 2.0/);
    await queue.expectEvidenceVisible();
    await queue.approve('Verified customer instruction');
    await expect(queue.row(/Large RWIN/)).toHaveCount(0);
  });

  test(title('Withdraw on behalf before day 30 is structurally blocked — no admin unlock exists', Tag.crit, Tag.spec('AdminPRD:RWIN'), Tag.spec('RWIN§11')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'ACTIVE', principal: 500_000, ratePct: RATE, fundedDaysAgo: 12 });
    const page = await asPersona('headOfCrm');
    const im = new InvestmentManagementPage(page);
    await im.openPlan(investmentId);
    await im.detail.expectActionDisabled(/withdraw/i);
    await im.detail.expectActionAbsent(/unlock|break-glass|waive minimum/i);
  });

  test(title('Withdraw on behalf: partial must retain ₦50k; WHT deducted; net credited', Tag.crit, Tag.open('W2'), Tag.spec('AdminPRD:RWIN')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'ACTIVE', principal: 300_000, ratePct: RATE, fundedDaysAgo: 40 });
    const page = await asPersona('treasuryOfficer');
    const im = new InvestmentManagementPage(page);
    await im.openPlan(investmentId);
    const m = await im.startAction(/withdraw/i);
    await m.fill(/amount/i, 260_000);
    await m.expectValidationError(/₦50,000|minimum retained/i);
    await m.fill(/amount/i, 200_000);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await expect(im.detail.state()).toContainText(/active/i);
    await expect(im.detail.field('balance')).toContainText(formatNaira(100_000));
  });

  test(title('Top-up on behalf creates a new tranche at the rate in force and enforces cap', Tag.crit, Tag.open('W4'), Tag.spec('AdminPRD:RWIN')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 5_000_000 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'ACTIVE', principal: 99_900_000, ratePct: RATE, fundedDaysAgo: 40 });
    const page = await asPersona('treasuryOfficer');
    const im = new InvestmentManagementPage(page);
    await im.openPlan(investmentId);
    const m = await im.startAction(/top-up/i);
    await m.fill(/amount/i, 200_000);
    await m.expectValidationError(/cap/i);
    expect(rwin.validateDeposit(99_900_000, 200_000, 1)).toEqual({ ok: false, reason: 'EXCEEDS_CAP' });
    await m.fill(/amount/i, 50_000);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await im.detail.tab('Tranches');
    await expect(page.getByTestId('tranche-row')).toHaveCount(2);
    await expect(im.detail.sourcePill().first()).toContainText(/admin_action|admin/i);
  });

  test(title('Toggle auto-rollover: single admin, no dual approval, audited', Tag.med, Tag.spec('AdminPRD:RWIN')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'ACTIVE', principal: 500_000, ratePct: RATE, fundedDaysAgo: 10 });
    const page = await asPersona('treasuryOfficer');
    const im = new InvestmentManagementPage(page);
    await im.openPlan(investmentId);
    const before = await im.detail.field('auto-rollover').innerText();
    const m = await im.startAction(/toggle auto-rollover/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied(); // applied immediately, not "pending approval"
    await expect(im.detail.field('auto-rollover')).not.toHaveText(before);
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].approvers ?? []).toHaveLength(0);
  });

  test(title('Handle rollover cap exception: cap uplift requires Compliance sign-off + prominent audit', Tag.crit, Tag.spec('AdminPRD:RWIN')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'ACTIVE', principal: 99_800_000, ratePct: RATE, fundedDaysAgo: 88 });
    const crm = await asPersona('headOfCrm');
    const im = new InvestmentManagementPage(crm);
    await im.openPlan(investmentId);
    const m = await im.startAction(/handle cap exception/i);
    await m.select(/resolution/i, 'Cap uplift');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const compliance = await asPersona('compliance');
    const q = new ApprovalQueuePage(compliance);
    await q.goto();
    await q.open(/cap uplift/i);
    await q.expectComplianceStepRequired();
    await q.approve('Compliance approved uplift');
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
  });

  test(title('Roles without RWIN permissions do not see RWIN admin actions', Tag.high, Tag.spec('AdminPRD:RWIN')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'ACTIVE', principal: 500_000, ratePct: RATE, fundedDaysAgo: 40 });
    const page = await asPersona('marketing');
    const im = new InvestmentManagementPage(page);
    await im.openPlan(investmentId);
    await im.detail.expectActionAbsent(/withdraw|top-up|toggle auto-rollover/i);
  });
});
