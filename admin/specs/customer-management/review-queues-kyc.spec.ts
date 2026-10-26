import { test, expect } from '../../fixtures/fixtures';
import { CustomerHooks, CustomerManagementPage } from '../../pages/CustomerManagementPage';
import { Customer360Page } from '../../pages/Customer360Page';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Customer Management › Review Queues tab (KYC).
 * Approve upgrade (T1→T2, T2→T3; tier-change record source admin_action), decline with managed-vocab
 * reason (tier unchanged), request re-upload (awaiting-re-upload). Roles: KYC reviewer, Compliance, Super Admin.
 */
test.describe('Customer Management › Review Queues (KYC)', () => {
  let ch: CustomerHooks;
  // Requesting `hooks` here skips the file cleanly when QA hooks aren't configured.
  test.beforeEach(async ({ hooks }) => { void hooks; ch = await CustomerHooks.create(); });
  test.afterEach(async () => { await ch?.dispose(); });

  test(title('Open KYC review queue lists awaiting customers and filters by requirement type', Tag.high, Tag.smoke, Tag.spec('AdminPRD:CustomerMgmt:ReviewQueues')), async ({ asPersona, hooks }) => {
    const a = await hooks.seedCustomer({ tier: 1 });
    const b = await hooks.seedCustomer({ tier: 2 });
    await ch.seedKycSubmission({ customerId: a.customerId, targetTier: 2, requirement: 'BVN' });
    await ch.seedKycSubmission({ customerId: b.customerId, targetTier: 3, requirement: 'Proof of address' });
    const page = await asPersona('kycReviewer');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Review Queues');
    await expect(cm.row(a.customerId)).toBeVisible();
    await cm.filterRequirement('Proof of address');
    await expect(cm.row(b.customerId)).toBeVisible();
    await expect(cm.rows().filter({ hasText: a.customerId })).toHaveCount(0);
  });

  for (const { from, to, persona } of [
    { from: 1, to: 2, persona: 'kycReviewer' },
    { from: 2, to: 3, persona: 'compliance' },
  ] as const) {
    test(title(`Approve KYC upgrade Tier ${from} → Tier ${to}: tier changes, record source admin_action, badge updates`, Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:ReviewQueues')), async ({ asPersona, hooks }) => {
      const { customerId } = await hooks.seedCustomer({ tier: from });
      await ch.seedKycSubmission({ customerId, targetTier: to });
      const page = await asPersona(persona);
      const cm = new CustomerManagementPage(page);
      await cm.goto('Review Queues');
      await cm.openKycCase(customerId);
      await expect(cm.kycDocuments().first()).toBeVisible();
      await cm.approveKyc();
      await cm.modal.expectApplied();

      const snapshot = await ch.customer(customerId);
      expect(snapshot.tier).toBe(to);
      const changes = await ch.tierChanges(customerId);
      expect(changes[0]).toMatchObject({ from, to, source: 'admin_action' });
      const audit = await hooks.auditEntries({ targetId: customerId, limit: 1 });
      expect(audit[0].action).toMatch(/kyc.*approv|tier.*upgrade/i);

      const c360 = new Customer360Page(page);
      await c360.goto(customerId);
      await expect(c360.tierBadge()).toContainText(new RegExp(`tier\\s*${to}`, 'i'));
      const sms = await hooks.latestNotifications(customerId);
      expect(sms.some((n) => n.channel === 'SMS' && new RegExp(`tier\\s*${to}`, 'i').test(n.body))).toBe(true);
    });
  }

  test(title('Decline KYC upgrade requires a managed-vocab reason; tier unchanged; customer notified with reason', Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:ReviewQueues')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 1 });
    await ch.seedKycSubmission({ customerId, targetTier: 2, requirement: 'ID document' });
    const page = await asPersona('kycReviewer');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Review Queues');
    await cm.openKycCase(customerId);
    await cm.kycCase().getByRole('button', { name: /^decline/i }).click();
    await cm.modal.expectOpen(/decline/i);
    await cm.modal.submit();
    await cm.modal.expectValidationError(/reason/i);
    // Reason is a managed vocabulary (select), not free text.
    await expect(cm.modal.field(/reason/i)).not.toHaveAttribute('type', 'text');
    await cm.modal.reasonCode('Document illegible');
    await cm.modal.fill(/notes/i, 'Automated test — blurry ID');
    await cm.modal.submit();
    await cm.modal.expectApplied();

    const snapshot = await ch.customer(customerId);
    expect(snapshot.tier).toBe(1);
    expect(snapshot.kycState).toBe('DECLINED');
    const push = await hooks.latestNotifications(customerId);
    expect(push.some((n) => n.channel === 'PUSH' && /declined/i.test(n.body) && /illegible/i.test(n.body))).toBe(true);
  });

  test(title('Request KYC re-upload sets state awaiting-re-upload and records actor + reason', Tag.high, Tag.spec('AdminPRD:CustomerMgmt:ReviewQueues')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    await ch.seedKycSubmission({ customerId, targetTier: 3, requirement: 'Proof of address' });
    const page = await asPersona('superAdmin');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Review Queues');
    await cm.openKycCase(customerId);
    await cm.requestReupload('Proof of address');
    await cm.modal.expectApplied();
    await expect(cm.kycStatus()).toContainText(/awaiting (customer|re-upload)/i);
    expect((await ch.customer(customerId)).kycState).toBe('AWAITING_RE_UPLOAD');
    const audit = await hooks.auditEntries({ targetId: customerId, limit: 1 });
    expect(audit[0].action).toMatch(/re-?upload/i);
    expect(audit[0].actor).toBeTruthy();
  });

  for (const persona of ['supportAgent', 'treasuryOfficer', 'marketing'] as const) {
    test(title(`${persona} cannot access the KYC review queue or approve upgrades`, Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:ReviewQueues')), async ({ asPersona, hooks }) => {
      const { customerId } = await hooks.seedCustomer({ tier: 1 });
      await ch.seedKycSubmission({ customerId, targetTier: 2 });
      const page = await asPersona(persona);
      await new CustomerManagementPage(page).openModule();
      const cm = new CustomerManagementPage(page);
      await expect(cm.subTab('Review Queues')).toHaveCount(0);
      await expect(cm.approveKycButton()).toHaveCount(0);
    });
  }
});
