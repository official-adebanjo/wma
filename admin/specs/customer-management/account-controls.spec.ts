import { test, expect } from '../../fixtures/fixtures';
import { CustomerHooks, CustomerManagementPage } from '../../pages/CustomerManagementPage';
import { openApprovalQueue } from '../../pages/approvals';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Customer Management › Account Controls tab.
 * View restrictions (Compliance, Head of Ops, Super Admin); Lift (Compliance / Head of Ops, Dual + Compliance);
 * Update scope e.g. full freeze → withdrawal-only (Compliance, Dual + Compliance); restriction history.
 */
test.describe('Customer Management › Account Controls', () => {
  let ch: CustomerHooks;
  // Requesting `hooks` here skips the file cleanly when QA hooks aren't configured.
  test.beforeEach(async ({ hooks }) => { void hooks; ch = await CustomerHooks.create(); });
  test.afterEach(async () => { await ch?.dispose(); });

  test(title('View account controls lists customers with active restrictions and their scope', Tag.high, Tag.smoke, Tag.spec('AdminPRD:CustomerMgmt:AccountControls')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    await ch.seedRestriction({ customerId, scope: 'FULL_FREEZE', reason: 'Fraud investigation' });
    const page = await asPersona('headOfOps');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Account Controls');
    await expect(cm.row(customerId)).toContainText(/full freeze/i);
  });

  test(title('Lift restriction: evidence mandatory, Head of Ops proposes, Compliance signs off, customer notified', Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:AccountControls'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 100_000 });
    await ch.seedRestriction({ customerId, scope: 'FULL_FREEZE', reason: 'Fraud investigation' });
    const proposer = await asPersona('headOfOps');
    const cm = new CustomerManagementPage(proposer);
    await cm.goto('Account Controls');
    await cm.openRestriction(customerId);
    const m = await cm.startRestrictionAction('Lift');
    await m.fill(/reason/i, 'Investigation closed — no wrongdoing');
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();
    expect((await ch.customer(customerId)).restrictions.some((r) => r.state === 'ACTIVE')).toBe(true);

    const own = await openApprovalQueue(proposer);
    await own.open(customerId);
    await own.expectSelfApprovalBlocked();

    const compliance = await asPersona('compliance');
    const q = await openApprovalQueue(compliance);
    await q.open(customerId);
    await q.expectComplianceStepRequired();
    await q.approve('Compliance sign-off: lift restriction');

    const snapshot = await ch.customer(customerId);
    expect(snapshot.restrictions.filter((r) => r.state === 'ACTIVE')).toHaveLength(0);
    expect(snapshot.loginBlocked).toBe(false);
    const push = await hooks.latestNotifications(customerId);
    expect(push.some((n) => n.channel === 'PUSH' && /restriction has been lifted/i.test(n.body))).toBe(true);
  });

  test(title('Update restriction scope full freeze → withdrawal-only after dual + Compliance approval', Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:AccountControls')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    await ch.seedRestriction({ customerId, scope: 'FULL_FREEZE' });
    const proposer = await asPersona('compliance');
    const cm = new CustomerManagementPage(proposer);
    await cm.goto('Account Controls');
    await cm.openRestriction(customerId);
    await expect(cm.restrictionScope()).toContainText(/full freeze/i);
    const m = await cm.startRestrictionAction('Update restriction');
    await m.select(/scope/i, 'Withdrawal-only');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const approver = await asPersona('superAdmin');
    const q = await openApprovalQueue(approver);
    await q.open(customerId);
    await q.expectComplianceStepRequired();
    await q.approve('Approve scope reduction');

    const snapshot = await ch.customer(customerId);
    expect(snapshot.restrictions.find((r) => r.state === 'ACTIVE')?.scope).toMatch(/WITHDRAWAL_ONLY/i);
    await cm.goto('Account Controls');
    await cm.openRestriction(customerId);
    await expect(cm.restrictionScope()).toContainText(/withdrawal-only/i);
  });

  test(title('View restriction history shows past restrictions with duration, reason and actors', Tag.med, Tag.spec('AdminPRD:CustomerMgmt:AccountControls')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    await ch.seedRestriction({ customerId, scope: 'WITHDRAWAL_ONLY', reason: 'Disputed transfer', history: 2 });
    const page = await asPersona('compliance');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Account Controls');
    await cm.openRestriction(customerId);
    const rows = cm.restrictionHistoryRows();
    await expect(rows).toHaveCount(3);
    for (const col of [/duration/i, /reason/i, /actor|by/i]) {
      await expect(page.getByTestId('restriction-history').getByRole('columnheader', { name: col })).toBeVisible();
    }
  });

  test(title('Update restriction is Compliance-only: Head of Ops sees Lift but not Update', Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:AccountControls')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    await ch.seedRestriction({ customerId, scope: 'FULL_FREEZE' });
    const page = await asPersona('headOfOps');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Account Controls');
    await cm.openRestriction(customerId);
    await expect(cm.restrictionAction('Lift')).toBeVisible();
    await expect(cm.restrictionAction('Update restriction')).toHaveCount(0);
  });

  test(title('Support agent and Treasury officer cannot see Account Controls', Tag.high, Tag.spec('AdminPRD:CustomerMgmt:AccountControls')), async ({ asPersona }) => {
    for (const p of ['supportAgent', 'treasuryOfficer'] as const) {
      const page = await asPersona(p);
      await new CustomerManagementPage(page).openModule();
      await expect(new CustomerManagementPage(page).subTab('Account Controls')).toHaveCount(0);
    }
  });
});
