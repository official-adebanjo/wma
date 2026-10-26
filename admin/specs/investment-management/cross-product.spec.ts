import { test, expect } from '../../fixtures/fixtures';
import { InvestmentActionsPage, rtnTestConfig } from '../../pages/InvestmentActionsPage';
import { openApprovalQueue } from '../../pages/approvals';
import * as reap from '../../../shared/calc/reap';
import * as rtn from '../../../shared/calc/rtn';
import { addDays, formatNaira } from '../../../shared/calc/money';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Investment Management › Cross-product investment actions.
 * Approve / reject customer withdrawal requests (reject reason from managed vocab); approve break
 * requests per product rules: REAP = 100% interest forfeiture, RTN = ladder penalty,
 * RWIN before day 30 = absolute block (approval is structurally impossible).
 */
test.describe('Investment Management › Cross-product requests', () => {
  const { matrix, ladder } = rtnTestConfig;

  test.beforeEach(async ({ hooks }) => {
    await hooks.setProductConfig({ product: 'RTN', patch: { rateMatrix: matrix, penaltyLadder: ladder } });
  });

  test(title('Withdrawals rail lists pending customer withdrawal requests', Tag.high, Tag.smoke, Tag.spec('AdminPRD:InvMgmt:CrossProduct')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const { reference } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'WITHDRAWAL_REQUESTED', principal: 2_000_000, ratePct: 14, fundedDaysAgo: 90, extra: { tenorDays: 90, interestTiming: 'AT_MATURITY' } });
    const im = new InvestmentActionsPage(await asPersona('treasuryOfficer'));
    await im.gotoState('Withdrawals');
    await im.portfolio.search(reference);
    await expect(im.portfolio.rows().filter({ hasText: reference })).toHaveCount(1);
  });

  test(title('Approve withdrawal request: evidence mandatory, executes per product rules (RTN at maturity net of WHT)', Tag.crit, Tag.open('X1'), Tag.spec('AdminPRD:InvMgmt:CrossProduct')), async ({ asPersona, hooks }) => {
    const AMOUNT = 2_000_000;
    const TENOR = 90;
    const rate = rtn.lookupRate(matrix, AMOUNT, TENOR);
    const expected = rtn.bookingProjection(AMOUNT, rate, TENOR, 'AT_MATURITY', addDays(new Date(), -TENOR));
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const { investmentId, reference } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'WITHDRAWAL_REQUESTED', principal: AMOUNT, ratePct: rate, fundedDaysAgo: TENOR, extra: { tenorDays: TENOR, interestTiming: 'AT_MATURITY' } });
    const im = new InvestmentActionsPage(await asPersona('treasuryOfficer'));
    await im.gotoState('Withdrawals');
    await im.openRequest(reference);
    const m = await im.startRequestAction('Approve');
    await expect(im.summaryLine('net-to-wallet')).toContainText(formatNaira(expected.paidAtMaturity));
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await expect(im.requestState()).toContainText(/approved|completed/i);
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].amount).toBe(expected.paidAtMaturity.toNumber());
    const notes = await hooks.latestNotifications(customerId);
    expect(notes.length).toBeGreaterThan(0);
  });

  test(title('Approve withdrawal above dual threshold routes to Approval Queue; self-approval blocked', Tag.crit, Tag.spec('AdminPRD:InvMgmt:CrossProduct'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const AMOUNT = 60_000_000;
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { reference } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'WITHDRAWAL_REQUESTED', principal: AMOUNT, ratePct: rtn.lookupRate(matrix, AMOUNT, 90), fundedDaysAgo: 90, extra: { tenorDays: 90, interestTiming: 'AT_MATURITY' } });
    const proposer = await asPersona('treasuryOfficer');
    const im = new InvestmentActionsPage(proposer);
    await im.gotoState('Withdrawals');
    await im.openRequest(reference);
    const m = await im.startRequestAction('Approve');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const own = await openApprovalQueue(proposer);
    await own.open(reference);
    await own.expectSelfApprovalBlocked();

    const q = await openApprovalQueue(await asPersona('headOfCrm'));
    await q.open(reference);
    await q.expectEvidenceVisible();
    await q.approve('Second approval for large withdrawal');
    await expect(q.row(reference)).toHaveCount(0);
  });

  test(title('Reject withdrawal request requires a managed-vocab reason; state Rejected; customer notified with reason', Tag.crit, Tag.spec('AdminPRD:InvMgmt:CrossProduct')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const { investmentId, reference } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'WITHDRAWAL_REQUESTED', principal: 2_000_000, ratePct: 14, fundedDaysAgo: 90, extra: { tenorDays: 90 } });
    const im = new InvestmentActionsPage(await asPersona('headOfCrm'));
    await im.gotoState('Withdrawals');
    await im.openRequest(reference);
    const m = await im.startRequestAction('Reject');
    await m.submit();
    await m.expectValidationError(/reason/i);
    await m.reasonCode('Destination account mismatch');
    await m.submit();
    await m.expectApplied();
    await expect(im.requestState()).toContainText(/rejected/i);
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].action).toMatch(/reject/i);
    const push = await hooks.latestNotifications(customerId);
    expect(push.some((n) => n.channel === 'PUSH' && /withdrawal was declined/i.test(n.body) && /mismatch/i.test(n.body))).toBe(true);
  });

  test(title('Approve REAP break request: principal returned, 100% accrued interest forfeited (oracle breakOutcome), plan Closed', Tag.crit, Tag.open('E6'), Tag.spec('AdminPRD:InvMgmt:CrossProduct')), async ({ asPersona, hooks }) => {
    const PRINCIPAL = 180_000;
    const DAYS = 75;
    const RATE = 12;
    const expected = reap.breakOutcome([{ amount: PRINCIPAL, on: addDays(new Date(), -DAYS) }], RATE, new Date());
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId, reference } = await hooks.seedInvestment({ customerId, product: 'REAP', state: 'BREAK_REQUESTED', principal: PRINCIPAL, ratePct: RATE, fundedDaysAgo: DAYS, extra: { tenorMonths: 12, target: 600_000 } });
    const im = new InvestmentActionsPage(await asPersona('headOfCrm'));
    await im.gotoState('Break requests');
    await im.openRequest(reference);
    const m = await im.startRequestAction('Approve');
    await expect(im.summaryLine('interest-forfeited')).toContainText(formatNaira(expected.interestForfeited));
    await expect(im.summaryLine('net-to-wallet')).toContainText(formatNaira(expected.principalReturned));
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await im.openPlan(investmentId);
    await expect(im.detail.state()).toContainText(/closed/i);
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].amount).toBe(expected.principalReturned.toNumber());
  });

  test(title('Approve RTN break request: ladder penalty applied, net = oracle forceLiquidation, placement Closed', Tag.crit, Tag.open('T5'), Tag.open('T6'), Tag.spec('AdminPRD:InvMgmt:CrossProduct')), async ({ asPersona, hooks }) => {
    const AMOUNT = 3_000_000;
    const TENOR = 120;
    const ELAPSED = 40;
    const rate = rtn.lookupRate(matrix, AMOUNT, TENOR);
    const expected = rtn.forceLiquidation({ amount: AMOUNT, ratePct: rate, tenorDays: TENOR, activatedOn: addDays(new Date(), -ELAPSED), asOf: new Date(), timing: 'AT_MATURITY', ladder });
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const { investmentId, reference } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'BREAK_REQUESTED', principal: AMOUNT, ratePct: rate, fundedDaysAgo: ELAPSED, extra: { tenorDays: TENOR, interestTiming: 'AT_MATURITY' } });
    const im = new InvestmentActionsPage(await asPersona('headOfCrm'));
    await im.gotoState('Break requests');
    await im.openRequest(reference);
    const m = await im.startRequestAction('Approve');
    await expect(im.summaryLine('penalty')).toContainText(formatNaira(expected.penalty));
    await expect(im.summaryLine('net-to-wallet')).toContainText(formatNaira(expected.netToWallet));
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    await im.openPlan(investmentId);
    await expect(im.detail.state()).toContainText(/closed|liquidated/i);
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].amount).toBe(expected.netToWallet.toNumber());
  });

  test(title('RWIN break request before day 30 is an absolute block — Approve is impossible for every role', Tag.crit, Tag.spec('AdminPRD:InvMgmt:CrossProduct'), Tag.spec('RWIN§11')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { reference } = await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'BREAK_REQUESTED', principal: 500_000, ratePct: 14, fundedDaysAgo: 12 });
    for (const persona of ['headOfCrm', 'compliance', 'superAdmin'] as const) {
      const im = new InvestmentActionsPage(await asPersona(persona));
      await im.gotoState('Break requests');
      await im.openRequest(reference);
      const approve = im.requestButton('Approve');
      if (await approve.count()) await expect(approve).toBeDisabled();
      await expect(im.requestDetail()).toContainText(/30-day|minimum holding/i);
      await expect(im.requestDetail().getByRole('button', { name: /unlock|override|break-glass/i })).toHaveCount(0);
    }
  });

  test(title('Read-only admin cannot approve or reject withdrawal requests', Tag.high, Tag.spec('AdminPRD:InvMgmt:CrossProduct')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 1, walletBalance: 0 });
    const { reference } = await hooks.seedInvestment({ customerId, product: 'RTN', state: 'WITHDRAWAL_REQUESTED', principal: 2_000_000, ratePct: 14, fundedDaysAgo: 90, extra: { tenorDays: 90 } });
    const im = new InvestmentActionsPage(await asPersona('readOnly'));
    await im.gotoState('Withdrawals');
    await im.openRequest(reference);
    await expect(im.requestButton('Approve')).toHaveCount(0);
    await expect(im.requestButton('Reject')).toHaveCount(0);
  });
});
