import { test, expect } from '../../fixtures/fixtures';
import { TransactionsLedgerPage, TransactionReference, transactionReferenceFields } from '../../pages/TransactionsLedgerPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { expectCsvExport } from '../../pages/components';
import { asRole, closeRoleSessions } from '../../fixtures/platform-personas';
import { uid } from '../../../shared/data/factories';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Transactions & Ledger (Transaction Monitor, Reversals & Adjustments, Cashback Ledger, Billers).
 * Viewing a transaction and exporting the list are themselves audited.
 */
test.describe('Transactions & Ledger', () => {
  test.afterEach(closeRoleSessions);

  test(title('Transaction Monitor renders master ledger with filter row', Tag.med, Tag.smoke, Tag.spec('AdminPRD:TransactionsLedger')), async ({ asPersona }) => {
    const page = await asPersona('treasuryOfficer');
    const tl = new TransactionsLedgerPage(page);
    await tl.goto('Transaction Monitor');
    await expect(tl.portfolio.filterRow()).toBeVisible();
    await expect(tl.portfolio.table()).toBeVisible();
  });

  test(title('Filter row narrows the monitor to the searched reference', Tag.med, Tag.spec('AdminPRD:TransactionsLedger')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const reference = uid('TXN');
    await hooks.simulateInboundTransfer({ reference, amount: 25_000, customerId });
    const page = await asPersona('treasuryOfficer');
    const tl = new TransactionsLedgerPage(page);
    await tl.goto('Transaction Monitor');
    await tl.portfolio.search(reference);
    await expect(tl.portfolio.rows()).toHaveCount(1);
    await expect(tl.portfolio.rows().first()).toContainText(reference);
  });

  test(title('Drill into transaction shows every reference ID and writes a "transaction viewed" audit entry', Tag.crit, Tag.spec('AdminPRD:TransactionsLedger')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const reference = uid('TXN');
    const { transferId } = await hooks.simulateInboundTransfer({ reference, amount: 40_000, customerId });
    const page = await asPersona('treasuryOfficer');
    const tl = new TransactionsLedgerPage(page);
    await tl.goto('Transaction Monitor');
    await tl.openTransaction(reference);
    for (const ref of Object.keys(transactionReferenceFields) as TransactionReference[]) {
      await expect(tl.reference(ref), `${ref} must be rendered`).toBeVisible();
    }
    await expect(tl.reference('Transaction ID')).not.toBeEmpty();
    const audit = await hooks.auditEntries({ targetId: transferId, action: 'transaction.viewed', limit: 1 });
    expect(audit).toHaveLength(1);
  });

  test(title('Export CSV uses current filter and is audited', Tag.crit, Tag.spec('AdminPRD:TransactionsLedger')), async ({ asPersona, hooks }) => {
    const page = await asPersona('treasuryOfficer');
    const tl = new TransactionsLedgerPage(page);
    await tl.goto('Transaction Monitor');
    await tl.portfolio.filter('Type', 'Credit');
    await expectCsvExport(page, () => tl.exportCsvButton().click(), /transaction id/i);
    const audit = await hooks.auditEntries({ action: 'transaction.export', limit: 1 });
    expect(audit[0]).toBeTruthy();
  });

  test(title('Roles without export permission do not get Export CSV', Tag.high, Tag.spec('AdminPRD:TransactionsLedger')), async ({ asPersona }) => {
    const page = await asPersona('readOnly');
    const tl = new TransactionsLedgerPage(page);
    await tl.goto('Transaction Monitor');
    await expect(tl.exportCsvButton()).toHaveCount(0);
  });

  test(title('Reversals & Adjustments ledger visible to Head of Treasury', Tag.med, Tag.spec('AdminPRD:TransactionsLedger')), async ({ asPersona }) => {
    const page = await asPersona('headOfTreasury');
    const tl = new TransactionsLedgerPage(page);
    await tl.goto('Reversals & Adjustments');
    await expect(tl.portfolio.table()).toBeVisible();
  });

  test(title('Propose reversal from detail view: dual approval, self-approval blocked, reversal appears linked in ledger', Tag.crit, Tag.spec('AdminPRD:TransactionsLedger'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const reference = uid('TXN');
    await hooks.simulateInboundTransfer({ reference, amount: 3_500_000, customerId });
    const proposer = await asPersona('treasuryOfficer');
    const tl = new TransactionsLedgerPage(proposer);
    await tl.goto('Transaction Monitor');
    await tl.openTransaction(reference);
    const m = await tl.startAction(/^reverse/i);
    await m.submit();
    await m.expectValidationError(/reason|evidence/i);
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
    await q.approve('Approved reversal');

    const ledger = new TransactionsLedgerPage(approver);
    await ledger.goto('Transaction Monitor');
    await ledger.openTransaction(reference);
    await expect(ledger.reference('Reversal chain')).not.toHaveText(/^\s*[-—]?\s*$/);
  });

  test(title('Cashback ledger lists events by customer, product, source', Tag.low, Tag.spec('AdminPRD:TransactionsLedger')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    const tl = new TransactionsLedgerPage(page);
    await tl.goto('Cashback Ledger');
    for (const col of ['Customer', 'Product', 'Source']) await expect(tl.portfolio.table().getByRole('columnheader', { name: new RegExp(col, 'i') })).toBeVisible();
  });

  test(title('Biller catalog lists DSTV, PHCN, MTN, Airtel', Tag.med, Tag.spec('AdminPRD:TransactionsLedger')), async ({ asPersona }) => {
    const page = await asPersona('headOfOps');
    const tl = new TransactionsLedgerPage(page);
    await tl.goto('Billers');
    for (const b of ['DSTV', 'PHCN', 'MTN', 'Airtel']) await expect(tl.billerRow(b)).toBeVisible();
  });

  test(title('Add biller: Head of Ops proposes, CTO approves (dual); catalog updated', Tag.high, Tag.spec('AdminPRD:TransactionsLedger')), async ({ asPersona, browser, hooks }) => {
    const name = uid('QA Biller');
    const proposer = await asPersona('headOfOps');
    const tl = new TransactionsLedgerPage(proposer);
    await tl.goto('Billers');
    const m = await tl.addBiller();
    await m.fill(/name/i, name);
    await m.select(/category/i, 'Cable TV');
    await m.fill(/biller code|code/i, name.toUpperCase());
    await m.submit();
    await m.expectRoutedToApproval();
    await tl.goto('Billers');
    await expect(tl.billerRow(name)).toHaveCount(0); // not applied before approval

    const cto = await asRole(browser, 'cto');
    const q = new ApprovalQueuePage(cto);
    await q.goto();
    await q.open(new RegExp(name));
    await q.expectInitiator(/./);
    await q.approve('Biller onboarding approved');
    const after = new TransactionsLedgerPage(cto);
    await after.goto('Billers');
    await expect(after.billerRow(name)).toBeVisible();
    const audit = await hooks.auditEntries({ action: 'biller.add', limit: 1 });
    expect(audit[0].approvers ?? []).toHaveLength(1);
  });

  test(title('Edit biller (DSTV) routes to approval; Head of Ops cannot approve own change', Tag.high, Tag.spec('AdminPRD:TransactionsLedger')), async ({ asPersona }) => {
    const proposer = await asPersona('headOfOps');
    const tl = new TransactionsLedgerPage(proposer);
    await tl.goto('Billers');
    const m = await tl.configureBiller('DSTV');
    await m.fill(/display name/i, `DSTV ${Date.now() % 1000}`);
    await m.submit();
    await m.expectRoutedToApproval();
    const q = new ApprovalQueuePage(proposer);
    await q.goto();
    await q.open(/DSTV/);
    await q.expectSelfApprovalBlocked();
    await q.withdraw('Test cleanup');
  });

  test(title('Treasury officer cannot add or configure billers', Tag.high, Tag.spec('AdminPRD:TransactionsLedger')), async ({ asPersona }) => {
    const page = await asPersona('treasuryOfficer');
    const tl = new TransactionsLedgerPage(page);
    await tl.goto('Transaction Monitor');
    const billersTab = page.getByRole('tab', { name: 'Billers' });
    if (await billersTab.count()) await billersTab.click();
    await expect(page.getByRole('button', { name: /add biller|configure/i })).toHaveCount(0);
  });
});
