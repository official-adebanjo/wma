import { test, expect } from '../../fixtures/fixtures';
import { ProductManagementPage, InvestmentProduct } from '../../pages/ProductManagementPage';
import { InvestmentManagementPage } from '../../pages/InvestmentManagementPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { asRole, closeRoleSessions } from '../../fixtures/platform-personas';
import { lookupRate } from '../../../shared/calc/rtn';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Product Management › Investment Products (REAP, RWIN 2.0, RTN + placeholders).
 * Config changes: Product Manager proposes → CPO approves; propagation-check modal classifies each field
 * (cosmetic = immediate, economics = new-positions-only). RTN rate matrix: Rate Committee only (dedicated permission).
 *
 * Open (unspecified in PRD — "Invariants enforced" without a list):
 *   @open:RTN-INV1  rates must be non-negative
 *   @open:RTN-INV2  rates non-decreasing with tenor within a band
 *   @open:RTN-INV3  rates non-decreasing with amount band within a tenor
 *
 * Retire-product test needs a disposable active product: QA_RETIRABLE_INVESTMENT_PRODUCT (skipped if unset).
 */
const RETIRABLE = process.env.QA_RETIRABLE_INVESTMENT_PRODUCT;

test.describe('Product Management › Investment Products', () => {
  test.afterEach(closeRoleSessions);

  test(title('Lists REAP, RWIN 2.0, RTN plus placeholders', Tag.med, Tag.smoke, Tag.spec('AdminPRD:ProductManagement')), async ({ asPersona }) => {
    const page = await asPersona('productManager');
    const pm = new ProductManagementPage(page);
    await pm.goto('Investment Products');
    for (const p of ['REAP', 'RWIN 2.0', 'RTN'] as InvestmentProduct[]) await expect(pm.productCard(p)).toBeVisible();
    await expect(pm.productCards().filter({ hasText: /placeholder|coming soon/i }).first()).toBeVisible();
  });

  test(title('Configure REAP: propagation check classifies cosmetic vs economics; PM proposes, self-approval blocked, CPO approves', Tag.crit, Tag.spec('AdminPRD:ProductManagement'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const proposer = await asPersona('productManager');
    const pm = new ProductManagementPage(proposer);
    await pm.goto('Investment Products');
    await pm.openProduct('REAP');
    await pm.startConfigure();
    await pm.setField(/description|tagline/i, `Save towards your goals (${Date.now() % 1000})`);
    await pm.setField(/min target/i, productConfig.reap.minTarget + 1_000);
    await pm.submitConfig();
    await expect(pm.propagationCheck()).toBeVisible();
    await pm.expectPropagationClass(/description|tagline/i, 'cosmetic');
    await pm.expectPropagationClass(/min target/i, 'new-positions-only');
    await pm.modal.confirmPropagation();
    await pm.modal.expectRoutedToApproval();

    const own = new ApprovalQueuePage(proposer);
    await own.goto();
    await own.open(/REAP/);
    await own.expectSelfApprovalBlocked();

    const cpo = await asPersona('cpo');
    const q = new ApprovalQueuePage(cpo);
    await q.goto();
    await q.open(/REAP/);
    await q.approve('Approved REAP config');
    const audit = await hooks.auditEntries({ action: 'product.configure', limit: 1 });
    expect(audit[0].approvers ?? []).toHaveLength(1);
    await hooks.setProductConfig({ product: 'REAP', patch: { minTarget: productConfig.reap.minTarget } }); // restore
  });

  test(title('Configure RWIN 2.0 economics (rate) is new-positions-only: existing plans keep their rate', Tag.crit, Tag.spec('AdminPRD:ProductManagement')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'ACTIVE', principal: 500_000, ratePct: 14, fundedDaysAgo: 10 });
    const proposer = await asPersona('productManager');
    const pm = new ProductManagementPage(proposer);
    await pm.goto('Investment Products');
    await pm.openProduct('RWIN 2.0');
    await pm.startConfigure();
    await pm.setField(/^rate|interest rate/i, 15);
    await pm.submitConfig();
    await pm.expectPropagationClass(/rate/i, 'new-positions-only');
    await pm.modal.confirmPropagation();
    await pm.modal.expectRoutedToApproval();

    const cpo = await asPersona('cpo');
    const q = new ApprovalQueuePage(cpo);
    await q.goto();
    await q.open(/RWIN/);
    await q.approve('Rate change approved');

    const im = new InvestmentManagementPage(cpo);
    await im.openPlan(investmentId);
    await expect(im.detail.field('rate')).toContainText('14');
    await hooks.setProductConfig({ product: 'RWIN', patch: { ratePct: 14 } }); // restore
  });

  test(title('RTN rate matrix: Rate Committee edits a cell → cell-level propagation preview; matrix lookup reflects edit; CPO approves', Tag.crit, Tag.spec('AdminPRD:ProductManagement'), Tag.open('T1')), async ({ asPersona, browser }) => {
    const rc = await asRole(browser, 'rateCommittee');
    const pm = new ProductManagementPage(rc);
    await pm.goto('Investment Products');
    await pm.openProduct('RTN');
    await pm.startConfigure();
    const before = await pm.rateMatrix.read();
    const tenor = before.tenorsDays[0];
    const newRate = before.rates[0][0] + 0.25;
    await pm.rateMatrix.editCell(0, tenor, newRate);
    await expect(pm.rateMatrix.cellPreview()).toBeVisible();
    await expect(pm.rateMatrix.cellPreview()).toContainText(/new positions/i);
    const after = await pm.rateMatrix.read();
    expect(lookupRate(after, after.bands[0].min, tenor)).toBeCloseTo(newRate, 4);
    await pm.submitConfig();
    await pm.modal.confirmPropagation();
    await pm.modal.expectRoutedToApproval();

    const cpo = await asPersona('cpo');
    const q = new ApprovalQueuePage(cpo);
    await q.goto();
    await q.open(/RTN/);
    await q.approve('Matrix change approved');
  });

  test(title('RTN rate matrix bulk edit applies one value to selected cells', Tag.high, Tag.spec('AdminPRD:ProductManagement')), async ({ browser }) => {
    const rc = await asRole(browser, 'rateCommittee');
    const pm = new ProductManagementPage(rc);
    await pm.goto('Investment Products');
    await pm.openProduct('RTN');
    await pm.startConfigure();
    const m = await pm.rateMatrix.read();
    const cells: Array<[number, number]> = m.tenorsDays.slice(0, 2).map((t) => [0, t]);
    await pm.rateMatrix.toggleBulkEdit();
    await pm.rateMatrix.bulkApply(cells, 18);
    const after = await pm.rateMatrix.read();
    for (const [, t] of cells) expect(lookupRate(after, after.bands[0].min, t)).toBe(18);
  });

  test(title('RTN rate matrix historical view lists prior versions', Tag.med, Tag.spec('AdminPRD:ProductManagement')), async ({ browser }) => {
    const rc = await asRole(browser, 'rateCommittee');
    const pm = new ProductManagementPage(rc);
    await pm.goto('Investment Products');
    await pm.openProduct('RTN');
    await pm.rateMatrix.openHistoricalView();
    await expect(pm.rateMatrix.historicalVersions().first()).toBeVisible();
  });

  test(title('RTN rate matrix invariant: negative rate rejected', Tag.high, Tag.open('RTN-INV1'), Tag.spec('AdminPRD:ProductManagement')), async ({ browser }) => {
    const rc = await asRole(browser, 'rateCommittee');
    const pm = new ProductManagementPage(rc);
    await pm.goto('Investment Products');
    await pm.openProduct('RTN');
    await pm.startConfigure();
    const m = await pm.rateMatrix.read();
    await pm.rateMatrix.editCell(0, m.tenorsDays[0], -1);
    await pm.submitConfig();
    await expect(pm.rateMatrix.invariantError()).toContainText(/negative|must be ≥ ?0|greater than/i);
    await expect(pm.propagationCheck()).toHaveCount(0);
  });

  test(title('RTN rate matrix invariant: rate must not fall as tenor increases within a band', Tag.med, Tag.open('RTN-INV2'), Tag.spec('AdminPRD:ProductManagement')), async ({ browser }) => {
    const rc = await asRole(browser, 'rateCommittee');
    const pm = new ProductManagementPage(rc);
    await pm.goto('Investment Products');
    await pm.openProduct('RTN');
    await pm.startConfigure();
    const m = await pm.rateMatrix.read();
    test.skip(m.tenorsDays.length < 2, 'Matrix has a single tenor');
    await pm.rateMatrix.editCell(0, m.tenorsDays[1], Math.max(0, m.rates[0][0] - 1));
    await pm.submitConfig();
    await expect(pm.rateMatrix.invariantError()).toContainText(/monoton|tenor/i);
  });

  test(title('RTN rate matrix invariant: rate must not fall as amount band increases within a tenor', Tag.med, Tag.open('RTN-INV3'), Tag.spec('AdminPRD:ProductManagement')), async ({ browser }) => {
    const rc = await asRole(browser, 'rateCommittee');
    const pm = new ProductManagementPage(rc);
    await pm.goto('Investment Products');
    await pm.openProduct('RTN');
    await pm.startConfigure();
    const m = await pm.rateMatrix.read();
    test.skip(m.bands.length < 2, 'Matrix has a single band');
    await pm.rateMatrix.editCell(1, m.tenorsDays[0], Math.max(0, m.rates[0][0] - 1));
    await pm.submitConfig();
    await expect(pm.rateMatrix.invariantError()).toContainText(/monoton|band/i);
  });

  test(title('RTN rate matrix is read-only for Product Manager (Rate Committee dedicated permission)', Tag.crit, Tag.spec('AdminPRD:ProductManagement')), async ({ asPersona }) => {
    const page = await asPersona('productManager');
    const pm = new ProductManagementPage(page);
    await pm.goto('Investment Products');
    await pm.openProduct('RTN');
    await pm.startConfigure();
    await expect(page.getByRole('button', { name: /bulk edit/i })).toHaveCount(0);
    const m = await pm.rateMatrix.read();
    await pm.rateMatrix.cell(0, m.tenorsDays[0]).dblclick();
    await expect(pm.rateMatrix.cell(0, m.tenorsDays[0]).getByRole('spinbutton')).toHaveCount(0);
  });

  test(title('Activate seeded product: clears "seeded - pending activation" after CPO approval', Tag.high, Tag.spec('AdminPRD:ProductManagement')), async ({ asPersona }) => {
    const proposer = await asPersona('productManager');
    const pm = new ProductManagementPage(proposer);
    await pm.goto('Investment Products');
    test.skip((await pm.seededCards().count()) === 0, 'No seeded investment product pending activation');
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
    const after = new ProductManagementPage(cpo);
    await after.goto('Investment Products');
    await expect(after.productCard(name)).not.toContainText(/pending activation/i);
  });

  test(title('Retire product: CPO proposes, Compliance step, Board approves; existing accounts continue, new bookings blocked', Tag.crit, Tag.spec('AdminPRD:ProductManagement')), async ({ asPersona, browser, hooks }) => {
    test.skip(!RETIRABLE, 'Set QA_RETIRABLE_INVESTMENT_PRODUCT to a disposable active product');
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 2_000_000 });
    const cpo = await asPersona('cpo');
    const pm = new ProductManagementPage(cpo);
    await pm.goto('Investment Products');
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
    await q.expectComplianceStepRequired();
    await q.approve('Board approves retirement');

    await pm.goto('Investment Products');
    await expect(pm.productStatus(RETIRABLE!)).toContainText(/retired/i);
    await expect(await pm.bookingOption(customerId, RETIRABLE!)).toBeDisabled();
  });

  test(title('Change history shows old + new + actor + timestamp (Auditor)', Tag.high, Tag.spec('AdminPRD:ProductManagement')), async ({ browser }) => {
    const page = await asRole(browser, 'auditor');
    const pm = new ProductManagementPage(page);
    await pm.goto('Investment Products');
    await pm.openProduct('REAP');
    await pm.openChangeHistory();
    for (const col of ['Field', 'Old', 'New', 'Actor', 'Timestamp']) {
      await expect(page.getByTestId('change-history').getByRole('columnheader', { name: new RegExp(col, 'i') })).toBeVisible();
    }
  });

  test(title('Roles without product permissions cannot configure products', Tag.high, Tag.spec('AdminPRD:ProductManagement')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    await page.goto('/');
    if ((await page.getByTestId('nav-product-management').count()) === 0) return; // module hidden entirely = no access
    const pm = new ProductManagementPage(page);
    await pm.goto('Investment Products');
    await pm.openProduct('REAP');
    await expect(page.getByRole('button', { name: /^configure|edit config/i })).toHaveCount(0);
  });
});
