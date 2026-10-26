import { test, expect } from '../../fixtures/fixtures';
import { ProductManagementPage, LoanProduct } from '../../pages/ProductManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { asRole, closeRoleSessions } from '../../fixtures/platform-personas';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Product Management › Loan Products ("same actions as Investment Products").
 *   Nano          — Product Manager → CPO
 *   Payday        — Product Manager; DSR thresholds proposed by Credit Committee → CPO
 *   Personal      — variant table (dedicated Rate/Credit Committee permission), bulk comparison → CPO
 *   Public Sector — corridor table (dedicated permission), tertiary template, Compliance for corridor changes → CPO
 *   RPAWA, Study Loans — placeholders
 *
 * Retire-product test needs a disposable active loan product: QA_RETIRABLE_LOAN_PRODUCT (skipped if unset).
 */
const RETIRABLE = process.env.QA_RETIRABLE_LOAN_PRODUCT;

test.describe('Product Management › Loan Products', () => {
  test.afterEach(closeRoleSessions);

  test(title('Lists Nano, Payday, Personal, Public Sector plus RPAWA and Study Loans placeholders', Tag.med, Tag.smoke, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ asPersona }) => {
    const page = await asPersona('productManager');
    const pm = new ProductManagementPage(page);
    await pm.goto('Loan Products');
    for (const p of ['Nano', 'Payday', 'Personal', 'Public Sector'] as LoanProduct[]) await expect(pm.productCard(p)).toBeVisible();
    for (const p of ['RPAWA', 'Study Loans'] as LoanProduct[]) await expect(pm.productCard(p)).toContainText(/placeholder|coming soon/i);
  });

  test(title('Configure Nano: propagation check, PM proposes, self-approval blocked, CPO approves', Tag.crit, Tag.spec('AdminPRD:ProductManagement:Loans'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const proposer = await asPersona('productManager');
    const pm = new ProductManagementPage(proposer);
    await pm.goto('Loan Products');
    await pm.openProduct('Nano');
    await pm.startConfigure();
    await pm.setField(/reminder|days before due/i, productConfig.nano.reminderDaysBefore + 1);
    await pm.submitConfig();
    await expect(pm.propagationCheck()).toBeVisible();
    await pm.modal.confirmPropagation();
    await pm.modal.expectRoutedToApproval();

    const own = new ApprovalQueuePage(proposer);
    await own.goto();
    await own.open(/Nano/);
    await own.expectSelfApprovalBlocked();

    const cpo = await asPersona('cpo');
    const q = new ApprovalQueuePage(cpo);
    await q.goto();
    await q.open(/Nano/);
    await q.approve('Nano config approved');
    const audit = await hooks.auditEntries({ action: 'product.configure', limit: 1 });
    expect(audit[0].approvers ?? []).toHaveLength(1);
    await hooks.setProductConfig({ product: 'NANO', patch: { reminderDaysBefore: productConfig.nano.reminderDaysBefore } });
  });

  test(title('Configure Payday DSR threshold: Credit Committee proposes, CPO approves; economics are new-positions-only', Tag.crit, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ asPersona, browser }) => {
    const cc = await asRole(browser, 'creditCommittee');
    const pm = new ProductManagementPage(cc);
    await pm.goto('Loan Products');
    await pm.openProduct('Payday');
    await pm.startConfigure();
    await pm.setField(/DSR/i, productConfig.payday.salaryCapPct - 5);
    await pm.submitConfig();
    await pm.expectPropagationClass(/DSR/i, 'new-positions-only');
    await pm.modal.confirmPropagation();
    await pm.modal.expectRoutedToApproval();

    const cpo = await asPersona('cpo');
    const q = new ApprovalQueuePage(cpo);
    await q.goto();
    await q.open(/Payday/);
    await q.approve('DSR approved');
  });

  test(title('Payday DSR thresholds are not editable by Product Manager (Credit Committee only)', Tag.crit, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ asPersona }) => {
    const page = await asPersona('productManager');
    const pm = new ProductManagementPage(page);
    await pm.goto('Loan Products');
    await pm.openProduct('Payday');
    await pm.startConfigure();
    await expect(pm.configField(/DSR/i).first()).toBeDisabled();
  });

  test(title('Personal variant table: Rate Committee edits a variant rate; CPO approves', Tag.crit, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ asPersona, browser }) => {
    const rc = await asRole(browser, 'rateCommittee');
    const pm = new ProductManagementPage(rc);
    await pm.goto('Loan Products');
    await pm.openProduct('Personal');
    await pm.startConfigure();
    const [variant] = await pm.variantTable.rowNames();
    const current = Number((await pm.variantTable.cellValue(variant, 'Rate')).replace(/[^0-9.]/g, ''));
    await pm.variantTable.editCell(variant, 'Rate', current + 0.5);
    await pm.submitConfig();
    await pm.modal.confirmPropagation();
    await pm.modal.expectRoutedToApproval();

    const cpo = await asPersona('cpo');
    const q = new ApprovalQueuePage(cpo);
    await q.goto();
    await q.open(new RegExp(`Personal|${variant}`));
    await q.approve('Variant rate approved');
  });

  test(title('Personal variant bulk comparison view shows every variant side by side', Tag.med, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ browser }) => {
    const rc = await asRole(browser, 'rateCommittee');
    const pm = new ProductManagementPage(rc);
    await pm.goto('Loan Products');
    await pm.openProduct('Personal');
    const variants = await pm.variantTable.rowNames();
    await pm.variantTable.openComparison();
    for (const v of variants) await expect(pm.variantTable.comparison()).toContainText(v);
    for (const col of ['Rate', 'DTI', 'Tenor', 'Amount band']) await expect(pm.variantTable.comparison()).toContainText(new RegExp(col, 'i'));
  });

  test(title('Personal variant table is read-only without the dedicated permission (Product Manager)', Tag.crit, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ asPersona }) => {
    const page = await asPersona('productManager');
    const pm = new ProductManagementPage(page);
    await pm.goto('Loan Products');
    await pm.openProduct('Personal');
    const [variant] = await pm.variantTable.rowNames();
    const cell = pm.variantTable.row(variant).getByRole('cell').nth(1);
    await cell.dblclick();
    await expect(cell.getByRole('spinbutton').or(cell.getByRole('textbox'))).toHaveCount(0);
  });

  test(title('Public Sector corridor change: Rate Committee proposes, Compliance sign-off required, CPO approves', Tag.crit, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ asPersona, browser, hooks }) => {
    const rc = await asRole(browser, 'rateCommittee');
    const pm = new ProductManagementPage(rc);
    await pm.goto('Loan Products');
    await pm.openProduct('Public Sector');
    await pm.startConfigure();
    const [corridor] = await pm.corridorTable.rowNames();
    const dti = Number((await pm.corridorTable.cellValue(corridor, 'DTI')).replace(/[^0-9.]/g, ''));
    await pm.corridorTable.editCell(corridor, 'DTI', Math.max(1, dti - 1));
    await pm.submitConfig();
    await pm.modal.confirmPropagation();
    await pm.modal.expectRoutedToApproval();

    const compliance = await asPersona('compliance');
    const cq = new ApprovalQueuePage(compliance);
    await cq.goto();
    await cq.open(new RegExp(`Public Sector|${corridor}`));
    await cq.expectComplianceStepRequired();
    await cq.approve('Compliance OK for corridor');

    const cpo = await asPersona('cpo');
    const q = new ApprovalQueuePage(cpo);
    await q.goto();
    await q.open(new RegExp(`Public Sector|${corridor}`));
    await q.approve('Corridor approved');
    const audit = await hooks.auditEntries({ action: 'product.configure', limit: 1 });
    expect((audit[0].approvers ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test(title('Public Sector tertiary template creates a new institution-specific corridor pre-filled from template', Tag.high, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ browser }) => {
    const rc = await asRole(browser, 'rateCommittee');
    const pm = new ProductManagementPage(rc);
    await pm.goto('Loan Products');
    await pm.openProduct('Public Sector');
    await pm.startConfigure();
    await pm.corridorTable.newFromTemplate();
    await pm.modal.expectOpen();
    await pm.modal.select(/template/i, 'Tertiary');
    await pm.modal.fill(/institution/i, `QA University ${Date.now() % 1000}`);
    await expect(pm.modal.field(/payroll system/i)).not.toHaveValue('');
  });

  test(title('Public Sector corridor table is read-only for Product Manager', Tag.high, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ asPersona }) => {
    const page = await asPersona('productManager');
    const pm = new ProductManagementPage(page);
    await pm.goto('Loan Products');
    await pm.openProduct('Public Sector');
    await expect(page.getByRole('button', { name: /new corridor from template|use template/i })).toHaveCount(0);
  });

  test(title('Activate seeded loan product/variant after CPO approval', Tag.high, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ asPersona }) => {
    const proposer = await asPersona('productManager');
    const pm = new ProductManagementPage(proposer);
    await pm.goto('Loan Products');
    test.skip((await pm.seededCards().count()) === 0, 'No seeded loan product pending activation');
    const name = (await pm.seededCards().first().getByRole('heading').first().innerText()).trim();
    await pm.openProduct(name);
    const m = await pm.startAction(/^activate/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();
    const cpo = await asPersona('cpo');
    const q = new ApprovalQueuePage(cpo);
    await q.goto();
    await q.open(new RegExp(name));
    await q.approve('Activate');
  });

  test(title('Retire loan product: CPO proposes, Board approves; new bookings blocked', Tag.crit, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ asPersona, browser, hooks }) => {
    test.skip(!RETIRABLE, 'Set QA_RETIRABLE_LOAN_PRODUCT to a disposable active loan product');
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const cpo = await asPersona('cpo');
    const pm = new ProductManagementPage(cpo);
    await pm.goto('Loan Products');
    await pm.openProduct(RETIRABLE!);
    const m = await pm.startAction(/^retire/i);
    await m.reasonCode('Product sunset');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();
    const board = await asRole(browser, 'board');
    const q = new ApprovalQueuePage(board);
    await q.goto();
    await q.open(new RegExp(RETIRABLE!));
    await q.approve('Board approves');
    await expect(await pm.bookingOption(customerId, RETIRABLE!, 'loan')).toBeDisabled();
  });

  test(title('Payday change history shows old + new + actor + timestamp', Tag.med, Tag.spec('AdminPRD:ProductManagement:Loans')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const pm = new ProductManagementPage(page);
    await pm.goto('Loan Products');
    await pm.openProduct('Payday');
    await pm.openChangeHistory();
    for (const col of ['Old', 'New', 'Actor', 'Timestamp']) {
      await expect(page.getByTestId('change-history').getByRole('columnheader', { name: new RegExp(col, 'i') })).toBeVisible();
    }
  });
});
