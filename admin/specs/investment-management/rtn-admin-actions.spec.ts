import { test, expect } from '../../fixtures/fixtures';
import { InvestmentActionsPage, rtnTestConfig } from '../../pages/InvestmentActionsPage';
import { Customer360Page } from '../../pages/Customer360Page';
import { openApprovalQueue } from '../../pages/approvals';
import * as rtn from '../../../shared/calc/rtn';
import { addDays, formatNaira } from '../../../shared/calc/money';
import { productConfig } from '../../../shared/config/env';
import { testFiles } from '../../../shared/data/factories';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Investment Management › RTN-specific actions.
 * Rules from RTN_Customer_App_Spec: individual Tier 1+, corporate Tier 2+; whole-amount rate from the
 * amount × tenor matrix; bank transfer → Underfunded with a hold window; early exit = penalty per ladder,
 * net = amount + accrued − penalty − WHT; top-up only if enabled in config (T11).
 * The matrix and ladder are seeded via setProductConfig so the oracle has known inputs.
 */
test.describe('Investment Management › RTN actions', () => {
  const { matrix, ladder } = rtnTestConfig;

  test.beforeEach(async ({ hooks }) => {
    await hooks.setProductConfig({ product: 'RTN', patch: { rateMatrix: matrix, penaltyLadder: ladder } });
  });

  test(title('Create RTN placement on behalf (individual, wallet): rate from matrix, evidence mandatory, state Active', Tag.crit, Tag.open('T1'), Tag.spec('AdminPRD:RTN')), async ({ asPersona, hooks }) => {
    const AMOUNT = 2_000_000;
    const TENOR = 90;
    const rate = rtn.lookupRate(matrix, AMOUNT, TENOR);
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 3_000_000 });
    const page = await asPersona('treasuryOfficer');
    const c360 = new Customer360Page(page);
    await c360.goto(customerId);
    await c360.createInvestment('RTN');
    const im = new InvestmentActionsPage(page);
    const m = im.modal;
    await m.root().getByRole('radio', { name: /^individual/i }).check();
    await m.fill(/amount/i, productConfig.rtn.minIndividual - 1);
    await m.expectValidationError(/minimum/i);
    await m.fill(/amount/i, AMOUNT);
    await m.select(/tenor/i, `${TENOR} days`);
    await m.root().getByRole('radio', { name: /at maturity/i }).check();
    await expect(im.summaryLine('rate')).toContainText(`${rate}%`);
    await m.root().getByRole('radio', { name: /wallet/i }).check();
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();

    const audit = await hooks.auditEntries({ action: 'rtn.create', limit: 1 });
    await im.openPlan(audit[0].targetId);
    await expect(im.detail.state()).toContainText(/active/i);
    await expect(im.detail.field('rate')).toContainText(`${rate}%`);
    await expect(im.detail.sourcePill().first()).toContainText(/admin_action|admin/i);
  });

  test(title('Create RTN on behalf: corporate requires Tier 2+; bank transfer source creates Underfunded placement', Tag.crit, Tag.spec('AdminPRD:RTN'), Tag.spec('RTN§Step1')), async ({ asPersona, hooks }) => {
    const tier1 = await hooks.seedCustomer({ tier: 1, accountType: 'CORPORATE', walletBalance: 0 });
    const page = await asPersona('treasuryOfficer');
    const c360 = new Customer360Page(page);
    await c360.goto(tier1.customerId);
    await c360.createInvestment('RTN');
    const im = new InvestmentActionsPage(page);
    await im.modal.root().getByRole('radio', { name: /^corporate/i }).check();
    await im.modal.expectValidationError(/tier 2/i);
    await im.modal.cancel();

    const AMOUNT = 15_000_000;
    const corp = await hooks.seedCustomer({ tier: 2, accountType: 'CORPORATE', walletBalance: 0 });
    await c360.goto(corp.customerId);
    await c360.createInvestment('RTN');
    const m = im.modal;
    await m.root().getByRole('radio', { name: /^corporate/i }).check();
    await m.fill(/amount/i, AMOUNT);
    await m.select(/tenor/i, '180 days');
    await m.root().getByRole('radio', { name: /at maturity/i }).check();
    await expect(im.summaryLine('rate')).toContainText(`${rtn.lookupRate(matrix, AMOUNT, 180)}%`);
    await m.root().getByRole('radio', { name: /bank transfer/i }).check();
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    const audit = await hooks.auditEntries({ action: 'rtn.create', limit: 1 });
    await im.openPlan(audit[0].targetId);
    await expect(im.detail.state()).toContainText(/underfunded/i);
  });

  test(title('Withdraw RTN on behalf at maturity: WHT deducted, net credited, placement Closed', Tag.crit, Tag.open('X1'), Tag.spec('AdminPRD:RTN')), async ({ asPersona, hooks }) => {
    const AMOUNT = 2_000_000;
    const TENOR = 90;
    const rate = rtn.lookupRate(matrix, AMOUNT, TENOR);
    const expected = rtn.bookingProjection(AMOUNT, rate, TENOR, 'AT_MATURITY', addDays(new Date(), -TENOR));
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'MATURED', principal: AMOUNT, ratePct: rate, fundedDaysAgo: TENOR, extra: { tenorDays: TENOR, interestTiming: 'AT_MATURITY' } });
    const im = new InvestmentActionsPage(await asPersona('treasuryOfficer'));
    await im.openPlan(investmentId);
    const m = await im.startAction(/^withdraw/i);
    await expect(im.summaryLine('wht')).toContainText(formatNaira(expected.wht));
    await expect(im.summaryLine('net-to-wallet')).toContainText(formatNaira(expected.paidAtMaturity));
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await expect(im.detail.state()).toContainText(/closed/i);
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].amount).toBe(expected.paidAtMaturity.toNumber());
  });

  for (const timing of ['AT_MATURITY', 'UPFRONT'] as const) {
    test(title(`Force-liquidate before maturity (${timing}): penalty per ladder, net = oracle forceLiquidation`, Tag.crit, Tag.open('T4'), Tag.open('T5'), Tag.open('T6'), Tag.spec('AdminPRD:RTN'), Tag.spec('RTN§7')), async ({ asPersona, hooks }) => {
      const AMOUNT = 5_000_000;
      const TENOR = 180;
      const ELAPSED = 60;
      const rate = rtn.lookupRate(matrix, AMOUNT, TENOR);
      const expected = rtn.forceLiquidation({ amount: AMOUNT, ratePct: rate, tenorDays: TENOR, activatedOn: addDays(new Date(), -ELAPSED), asOf: new Date(), timing, ladder });
      const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
      const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'ACTIVE', principal: AMOUNT, ratePct: rate, fundedDaysAgo: ELAPSED, extra: { tenorDays: TENOR, interestTiming: timing } });
      const im = new InvestmentActionsPage(await asPersona('headOfCrm'));
      await im.openPlan(investmentId);
      const m = await im.startAction(/force-liquidate/i);
      await expect(m.root()).toContainText(/penalty/i);
      await expect(im.summaryLine('penalty')).toContainText(formatNaira(expected.penalty));
      if (timing === 'AT_MATURITY') {
        await expect(im.summaryLine('accrued-interest')).toContainText(formatNaira(expected.accruedInterest));
        await expect(im.summaryLine('wht')).toContainText(formatNaira(expected.wht));
      }
      await expect(im.summaryLine('net-to-wallet')).toContainText(formatNaira(expected.netToWallet));
      if (timing === 'AT_MATURITY') {
        await m.submit();
        await m.expectValidationError(/evidence/i);
      }
      await m.evidence.fillDefault();
      await m.submit();
      await m.expectApplied();
      await expect(im.detail.state()).toContainText(/closed|liquidated/i);
      const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
      expect(audit[0].amount).toBe(expected.netToWallet.toNumber());
      expect(JSON.stringify(audit[0])).toMatch(/penalty/i);
    });
  }

  test(title('Force-liquidate above dual threshold routes to approval; self-approval blocked; Treasury officer has no Force-liquidate', Tag.crit, Tag.spec('AdminPRD:RTN'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const AMOUNT = 60_000_000;
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId, reference } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'ACTIVE', principal: AMOUNT, ratePct: rtn.lookupRate(matrix, AMOUNT, 365), fundedDaysAgo: 100, extra: { tenorDays: 365, interestTiming: 'AT_MATURITY' } });

    const treasury = new InvestmentActionsPage(await asPersona('treasuryOfficer'));
    await treasury.openPlan(investmentId);
    await treasury.detail.expectActionAbsent(/force-liquidate/i);

    const proposer = await asPersona('headOfCrm');
    const im = new InvestmentActionsPage(proposer);
    await im.openPlan(investmentId);
    const m = await im.startAction(/force-liquidate/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();
    const own = await openApprovalQueue(proposer);
    await own.open(reference);
    await own.expectSelfApprovalBlocked();

    const q = await openApprovalQueue(await asPersona('superAdmin'));
    await q.open(reference);
    await q.expectEvidenceVisible();
    await q.approve('Approved early liquidation');
    await im.openPlan(investmentId);
    await expect(im.detail.state()).toContainText(/closed|liquidated/i);
  });

  test(title('Rollover RTN on behalf: new placement at current matrix rate for principal + net interest; old Closed', Tag.crit, Tag.open('T10'), Tag.spec('AdminPRD:RTN')), async ({ asPersona, hooks }) => {
    const AMOUNT = 9_500_000;
    const TENOR = 90;
    const bookedRate = 13.5; // historical rate — rollover must use the current matrix, not this
    const newAmount = rtn.rolloverAmount(AMOUNT, bookedRate, TENOR, 'AT_MATURITY');
    const currentRate = rtn.lookupRate(matrix, newAmount, TENOR);
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'MATURED', principal: AMOUNT, ratePct: bookedRate, fundedDaysAgo: TENOR, extra: { tenorDays: TENOR, interestTiming: 'AT_MATURITY' } });
    const im = new InvestmentActionsPage(await asPersona('treasuryOfficer'));
    await im.openPlan(investmentId);
    const m = await im.startAction(/rollover/i);
    await expect(im.summaryLine('rollover-amount')).toContainText(formatNaira(newAmount));
    await expect(im.summaryLine('rate')).toContainText(`${currentRate}%`);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await expect(im.detail.state()).toContainText(/closed/i);
    const audit = await hooks.auditEntries({ action: 'rtn.rollover', limit: 1 });
    expect(audit[0].amount).toBe(newAmount.toNumber());
  });

  test(title('Top-up RTN on behalf when enabled in config creates a tranche with source admin_action', Tag.high, Tag.open('T11'), Tag.spec('AdminPRD:RTN')), async ({ asPersona, hooks }) => {
    await hooks.setProductConfig({ product: 'RTN', patch: { topUpEnabled: true, topUpMode: 'NEW_TRANCHE' } });
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 3_000_000 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'ACTIVE', principal: 2_000_000, ratePct: 14, fundedDaysAgo: 10, extra: { tenorDays: 90, interestTiming: 'AT_MATURITY' } });
    const im = new InvestmentActionsPage(await asPersona('treasuryOfficer'));
    await im.openPlan(investmentId);
    const m = await im.startAction(/top-up/i);
    await m.fill(/amount/i, 1_000_000);
    await m.root().getByRole('radio', { name: /wallet/i }).check();
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await im.detail.tab('Tranches');
    await expect(im.trancheRows()).toHaveCount(2);
    await expect(im.detail.sourcePill().first()).toContainText(/admin_action|admin/i);
  });

  test(title('Top-up RTN is not offered when disabled in config (launch default)', Tag.med, Tag.open('T11'), Tag.spec('AdminPRD:RTN')), async ({ asPersona, hooks }) => {
    await hooks.setProductConfig({ product: 'RTN', patch: { topUpEnabled: false } });
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'ACTIVE', principal: 2_000_000, ratePct: 14, fundedDaysAgo: 10, extra: { tenorDays: 90 } });
    const im = new InvestmentActionsPage(await asPersona('treasuryOfficer'));
    await im.openPlan(investmentId);
    await im.detail.expectActionAbsent(/top-up/i);
  });

  const REQUIRED = 4_000_000;
  const RECEIVED = 3_000_000;
  for (const { resolution, expectState } of [
    { resolution: 'Extend window', expectState: /underfunded/i },
    { resolution: 'Release at received', expectState: /active/i },
    { resolution: 'Reverse', expectState: /cancelled|closed|reversed/i },
  ]) {
    test(title(`Handle underfunded RTN: ${resolution}`, Tag.crit, Tag.spec('AdminPRD:RTN'), Tag.spec('RTN§9')), async ({ asPersona, hooks }) => {
      const outcome = rtn.bankTransferOutcome(REQUIRED, RECEIVED, true);
      expect(outcome.state).toBe('UNDERFUNDED');
      const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
      const { investmentId, reference } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'UNDERFUNDED', principal: REQUIRED, ratePct: rtn.lookupRate(matrix, REQUIRED, 90), fundedDaysAgo: 0, extra: { tenorDays: 90 } });
      await hooks.simulateInboundTransfer({ reference, amount: RECEIVED, customerId });
      const im = new InvestmentActionsPage(await asPersona('treasuryOfficer'));
      await im.openPlan(investmentId);
      if (outcome.state === 'UNDERFUNDED') await expect(im.detail.field('shortfall')).toContainText(formatNaira(outcome.shortfall));
      const m = await im.startAction(/handle underfunded/i);
      await m.select(/resolution/i, resolution);
      await m.fill(/reason/i, `Automated test — ${resolution}`);
      await m.evidence.fillDefault();
      await m.submit();
      await m.expectApplied();
      await expect(im.detail.state()).toContainText(expectState);
      if (resolution === 'Release at received') await expect(im.detail.field('amount')).toContainText(formatNaira(RECEIVED));
      if (resolution === 'Reverse') {
        const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
        expect(audit[0].amount).toBe(RECEIVED); // refund of what was received
      }
    });
  }

  test(title('Handle duplicate booking: reversal needs dual + Compliance, refunds one placement, prominent audit', Tag.crit, Tag.spec('AdminPRD:RTN')), async ({ asPersona, hooks }) => {
    const AMOUNT = 2_000_000;
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const first = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'ACTIVE', principal: AMOUNT, ratePct: 14, fundedDaysAgo: 0, extra: { tenorDays: 90 } });
    const dup = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'ACTIVE', principal: AMOUNT, ratePct: 14, fundedDaysAgo: 0, extra: { tenorDays: 90, suspectedDuplicateOf: first.investmentId } });
    const crm = await asPersona('headOfCrm');
    const im = new InvestmentActionsPage(crm);
    await im.openPlan(dup.investmentId);
    await expect(im.duplicateFlag()).toBeVisible();
    const m = await im.startAction(/handle duplicate/i);
    await m.select(/resolution/i, 'Reverse this booking');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const q = await openApprovalQueue(await asPersona('compliance'));
    await q.open(dup.reference);
    await q.expectComplianceStepRequired();
    await q.approve('Confirmed duplicate');
    const audit = await hooks.auditEntries({ targetId: dup.investmentId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
    expect(audit[0].amount).toBe(AMOUNT);
    await im.openPlan(dup.investmentId);
    await expect(im.detail.state()).toContainText(/closed|reversed/i);
    await im.openPlan(first.investmentId);
    await expect(im.detail.state()).toContainText(/active/i);
  });

  test(title('Handle death/incapacity: death certificate evidence, Compliance approval, On-hold-death, prominent audit', Tag.crit, Tag.spec('AdminPRD:RTN')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const { investmentId, reference } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'ACTIVE', principal: 3_000_000, ratePct: 14, fundedDaysAgo: 30, extra: { tenorDays: 180 } });
    const im = new InvestmentActionsPage(await asPersona('headOfCrm'));
    await im.openPlan(investmentId);
    const m = await im.startAction(/death|incapacity/i);
    await m.submit();
    await m.expectValidationError(/death certificate|evidence/i);
    await m.evidence.pick('Signed doc');
    await m.evidence.upload(testFiles.validPdf);
    await m.evidence.reasonOnBehalf('Death certificate received from next-of-kin');
    await m.submit();
    await m.expectRoutedToApproval();

    const q = await openApprovalQueue(await asPersona('compliance'));
    await q.open(reference);
    await q.expectComplianceStepRequired();
    await q.expectEvidenceVisible();
    await q.approve('Probate process initiated');
    await im.openPlan(investmentId);
    await expect(im.detail.state()).toContainText(/on-hold-death|on hold.*death/i);
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
  });

  test(title('Waive RTN penalty: Head of CRM proposes, Compliance approves, penalty refunded, prominent audit', Tag.crit, Tag.open('T5'), Tag.spec('AdminPRD:RTN')), async ({ asPersona, hooks }) => {
    const AMOUNT = 5_000_000;
    const TENOR = 180;
    const rate = rtn.lookupRate(matrix, AMOUNT, TENOR);
    const { penalty } = rtn.forceLiquidation({ amount: AMOUNT, ratePct: rate, tenorDays: TENOR, activatedOn: addDays(new Date(), -30), asOf: new Date(), timing: 'AT_MATURITY', ladder });
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const { investmentId, reference } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'CLOSED', principal: AMOUNT, ratePct: rate, fundedDaysAgo: 30, extra: { tenorDays: TENOR, penaltyCharged: penalty.toNumber() } });
    const proposer = await asPersona('headOfCrm');
    const im = new InvestmentActionsPage(proposer);
    await im.openPlan(investmentId);
    const m = await im.startAction(/waive penalty/i);
    await m.fill(/reason/i, 'Liquidation caused by Rosabon system error');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const q = await openApprovalQueue(await asPersona('compliance'));
    await q.open(reference);
    await q.expectComplianceStepRequired();
    await expect(q.reviewModal()).toContainText(formatNaira(penalty));
    await q.approve('Waiver approved');
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
    expect(audit[0].amount).toBe(penalty.toNumber());
  });

  test(title('Roles without RTN permissions do not see RTN admin actions', Tag.high, Tag.spec('AdminPRD:RTN')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'ACTIVE', principal: 2_000_000, ratePct: 14, fundedDaysAgo: 10, extra: { tenorDays: 90 } });
    const im = new InvestmentActionsPage(await asPersona('marketing'));
    await im.openPlan(investmentId);
    await im.detail.expectActionAbsent(/force-liquidate|rollover|top-up|handle underfunded|waive penalty|death/i);
  });
});
