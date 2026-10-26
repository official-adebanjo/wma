import { test, expect } from '../../fixtures/fixtures';
import { WalletManagementPage, PaymentProvider } from '../../pages/WalletManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { asRole, closeRoleSessions } from '../../fixtures/platform-personas';
import { uid } from '../../../shared/data/factories';
import { formatNaira } from '../../../shared/calc/money';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Wallet Management (Live board, Settlement, Manual ledger, Providers).
 * Money-touching actions require EvidencePanel; manual ledger entries are dual ALWAYS;
 * reversals are dual above threshold and create a reversing transaction linked to the original.
 */
test.describe('Wallet Management', () => {
  test.afterEach(closeRoleSessions);

  test(title('View live board renders real-time transfers', Tag.med, Tag.smoke, Tag.spec('AdminPRD:WalletManagement')), async ({ asPersona }) => {
    const page = await asPersona('treasuryOfficer');
    const wm = new WalletManagementPage(page);
    await wm.goto('Live board');
    await expect(wm.liveBoard()).toBeVisible();
  });

  test(title('Match inbound transfer to customer: evidence required; wallet credited as admin_recorded_offline + notification', Tag.crit, Tag.spec('AdminPRD:WalletManagement')), async ({ asPersona, hooks }) => {
    const { customerId, phone } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const reference = uid('TRF');
    const { transferId } = await hooks.simulateInboundTransfer({ reference, amount: 75_000 });
    const page = await asPersona('treasuryOfficer');
    const wm = new WalletManagementPage(page);
    await wm.goto('Live board');
    const m = await wm.startTransferAction(reference, 'Match to customer');
    await wm.pickCustomer(phone);
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();

    await wm.openTransaction(reference);
    await expect(wm.detail.sourcePill().first()).toContainText(/admin_recorded_offline/i);
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.some((n) => /credit|received/i.test(`${n.title} ${n.body}`))).toBe(true);
    const audit = await hooks.auditEntries({ targetId: transferId, limit: 1 });
    expect(audit[0].evidence).toBeTruthy();
  });

  test(title('Match inbound transfer to pre-recorded intent executes the intent (REAP contribution)', Tag.crit, Tag.spec('AdminPRD:WalletManagement')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'REAP', state: 'ACTIVE', principal: 20_000, fundedDaysAgo: 30, extra: { pendingIntent: 'CONTRIBUTION', intentAmount: 10_000 } });
    const reference = uid('TRF');
    await hooks.simulateInboundTransfer({ reference, amount: 10_000 });
    const page = await asPersona('treasuryOfficer');
    const wm = new WalletManagementPage(page);
    await wm.goto('Live board');
    const m = await wm.startTransferAction(reference, 'Match to intent');
    await wm.pickIntent(/REAP contribution/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.some((n) => /REAP contribution received/i.test(`${n.title} ${n.body}`))).toBe(true);
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].action).toMatch(/contribution|intent/i);
  });

  test(title('Escalate unmatched transfer routes it to the escalation queue', Tag.high, Tag.spec('AdminPRD:WalletManagement')), async ({ asPersona, hooks }) => {
    const reference = uid('TRF');
    const { transferId } = await hooks.simulateInboundTransfer({ reference, amount: 12_345 });
    const page = await asPersona('treasuryOfficer');
    const wm = new WalletManagementPage(page);
    await wm.goto('Live board');
    const m = await wm.startTransferAction(reference, 'Escalate');
    await m.fill(/reason/i, 'No matching customer or intent found');
    await m.submit();
    await m.expectApplied();
    await expect(wm.transferRow(reference)).toContainText(/escalated/i);
    const audit = await hooks.auditEntries({ targetId: transferId, limit: 1 });
    expect(audit[0].action).toMatch(/escalat/i);
  });

  test(title('Reverse transaction above threshold: Treasury proposes, self-approval blocked, Head of Ops approves; reversal chain linked', Tag.crit, Tag.spec('AdminPRD:WalletManagement'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const reference = uid('TRF');
    const { transferId } = await hooks.simulateInboundTransfer({ reference, amount: 4_500_000, customerId });
    const proposer = await asPersona('treasuryOfficer');
    const wm = new WalletManagementPage(proposer);
    await wm.goto('Live board');
    await wm.openTransaction(reference);
    const m = await wm.startTransactionAction(/^reverse/i);
    await m.reasonCode('Duplicate credit');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const ownQueue = new ApprovalQueuePage(proposer);
    await ownQueue.goto();
    await ownQueue.open(new RegExp(reference));
    await ownQueue.expectSelfApprovalBlocked();

    const approver = await asPersona('headOfOps');
    const q = new ApprovalQueuePage(approver);
    await q.goto();
    await q.open(new RegExp(reference));
    await q.expectEvidenceVisible();
    await q.approve('Verified duplicate');

    const check = new WalletManagementPage(approver);
    await check.goto('Live board');
    await check.openTransaction(reference);
    await expect(check.detail.state()).toContainText(/reversed/i);
    await expect(check.detail.field('reversal-chain')).toContainText(reference);
    const audit = await hooks.auditEntries({ targetId: transferId, limit: 1 });
    expect(audit[0].approvers ?? []).toHaveLength(1);
  });

  for (const provider of ['Paystack', 'Providus', 'Wema', 'Interswitch'] as PaymentProvider[]) {
    test(title(`Settlement per provider (${provider}): ledger vs provider totals and variance rendered`, Tag.med, ...(provider === 'Paystack' ? [Tag.smoke] : []), Tag.spec('AdminPRD:WalletManagement')), async ({ asPersona }) => {
      const page = await asPersona('treasuryOfficer');
      const wm = new WalletManagementPage(page);
      await wm.goto('Settlement');
      await wm.selectSettlementProvider(provider);
      await expect(wm.ledgerTotal()).toContainText('₦');
      await expect(wm.providerTotal()).toContainText('₦');
      await expect(wm.varianceTotal()).toBeVisible();
    });
  }

  test(title('Settlement view is available to Finance', Tag.med, Tag.spec('AdminPRD:WalletManagement')), async ({ browser }) => {
    const page = await asRole(browser, 'finance');
    const wm = new WalletManagementPage(page);
    await wm.goto('Settlement');
    await wm.selectSettlementProvider('Providus');
    await expect(wm.settlementSummary()).toBeVisible();
  });

  test(title('Investigate variance: resolution requires evidence and creates dispute/adjustment record', Tag.crit, Tag.spec('AdminPRD:WalletManagement')), async ({ asPersona }) => {
    const page = await asPersona('treasuryOfficer');
    const wm = new WalletManagementPage(page);
    await wm.goto('Settlement');
    await wm.selectSettlementProvider('Paystack');
    test.skip((await wm.varianceRows().count()) === 0, 'No settlement variance rows in this environment');
    const m = await wm.investigateVariance(0);
    await m.select(/resolution/i, 'Dispute');
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectApplied();
  });

  test(title('Manual ledger entry: evidence required, dual ALWAYS (even small amounts), Head of Treasury approves; source pill visible', Tag.crit, Tag.spec('AdminPRD:WalletManagement'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { customerId, phone } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const externalRef = uid('CHQ');
    const proposer = await asPersona('treasuryOfficer');
    const wm = new WalletManagementPage(proposer);
    await wm.goto('Manual ledger');
    const m = await wm.createManualEntry();
    await wm.fillManualEntry({ customer: phone, product: 'Wallet', amount: 1_000, category: 'Credit', externalRef });
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.pick('Signed doc');
    await m.evidence.upload();
    await m.evidence.reasonOnBehalf('Cheque deposit recorded offline');
    await m.submit();
    await m.expectRoutedToApproval(); // dual even at ₦1,000

    const ownQueue = new ApprovalQueuePage(proposer);
    await ownQueue.goto();
    await ownQueue.open(new RegExp(externalRef));
    await ownQueue.expectSelfApprovalBlocked();

    const approver = await asPersona('headOfTreasury');
    const q = new ApprovalQueuePage(approver);
    await q.goto();
    await q.open(new RegExp(externalRef));
    await q.expectEvidenceVisible();
    await q.approve('Cheque cleared');

    const after = new WalletManagementPage(approver);
    await after.goto('Manual ledger');
    await expect(after.manualLedgerRow(externalRef)).toContainText(formatNaira(1_000, { kobo: false }));
    await expect(after.manualLedgerRow(externalRef).getByTestId('source-pill')).toContainText(/admin_recorded_offline/i);
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.length).toBeGreaterThan(0);
  });

  test(title('Roles without manual-ledger permission cannot create entries', Tag.crit, Tag.spec('AdminPRD:WalletManagement')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    await page.goto('/');
    await expect(page.getByTestId('nav-wallet-management')).toHaveCount(0);
    await page.goto('/wallet-management/manual-ledger'); // direct URL must not expose the action either
    await expect(page.getByRole('button', { name: /create entry/i })).toHaveCount(0);
  });

  test(title('Provider catalog lists Paystack, Providus, Wema, Interswitch, NIP with health status', Tag.med, Tag.spec('AdminPRD:WalletManagement')), async ({ asPersona }) => {
    const page = await asPersona('headOfOps');
    const wm = new WalletManagementPage(page);
    await wm.goto('Providers');
    for (const p of ['Paystack', 'Providus', 'Wema', 'Interswitch', 'NIP'] as PaymentProvider[]) {
      await expect(wm.providerHealth(p)).toHaveText(/healthy|degraded|down/i);
    }
  });

  test(title('Configure critical provider: Head of Ops proposes, Compliance sign-off required before applying', Tag.crit, Tag.spec('AdminPRD:WalletManagement')), async ({ asPersona, hooks }) => {
    const proposer = await asPersona('headOfOps');
    const wm = new WalletManagementPage(proposer);
    await wm.goto('Providers');
    const m = await wm.configureProvider('NIP');
    await m.root().getByRole('checkbox', { name: /outbound transfers|capability/i }).first().click();
    await m.fill(/reason/i, 'Routing change — automated test');
    await m.submit();
    await m.expectRoutedToApproval();

    const compliance = await asPersona('compliance');
    const q = new ApprovalQueuePage(compliance);
    await q.goto();
    await q.open(/NIP/);
    await q.expectComplianceStepRequired();
    await q.approve('Compliance approved provider change');
    const audit = await hooks.auditEntries({ action: 'provider.configure', limit: 1 });
    expect(audit[0].approvers ?? []).not.toHaveLength(0);
  });

  test(title('Treasury officer cannot configure payment providers', Tag.high, Tag.spec('AdminPRD:WalletManagement')), async ({ asPersona }) => {
    const page = await asPersona('treasuryOfficer');
    const wm = new WalletManagementPage(page);
    await wm.goto('Live board');
    const providersTab = page.getByRole('tab', { name: 'Providers' });
    if (await providersTab.count()) {
      await providersTab.click();
      await wm.providerCard('Paystack').click();
    }
    await expect(page.getByRole('button', { name: /^configure/i })).toHaveCount(0);
  });
});
