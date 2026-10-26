import { test, expect } from '../../fixtures/fixtures';
import { CustomerHooks, CustomerManagementPage, prdPersona } from '../../pages/CustomerManagementPage';
import { openApprovalQueue } from '../../pages/approvals';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Customer Management › Auto Grants tab + Screening tab.
 * Auto Grants: read-only feed + drill-in (Compliance, Ops leads, Super Admin).
 * Screening: hits with confidence; Clear (false positive, reason), Escalate to Compliance (Screening reviewer),
 * Freeze account (Compliance; Dual + Compliance) → money movement and login blocked.
 */
test.describe('Customer Management › Auto Grants', () => {
  let ch: CustomerHooks;
  // Requesting `hooks` here skips the file cleanly when QA hooks aren't configured.
  test.beforeEach(async ({ hooks }) => { void hooks; ch = await CustomerHooks.create(); });
  test.afterEach(async () => { await ch?.dispose(); });

  test(title('View Auto Grants feed is read-only and lists automatic tier grants', Tag.med, Tag.smoke, Tag.spec('AdminPRD:CustomerMgmt:AutoGrants')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    await ch.seedAutoGrant({ customerId, tier: 2, systems: ['NIBSS BVN', 'NIMC NIN'] });
    const page = await asPersona('headOfOps');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Auto Grants');
    await expect(cm.row(customerId)).toBeVisible();
    await cm.expectReadOnlyFeed();
  });

  test(title('Drill into auto grant shows tier granted, timestamp, verification systems and customer', Tag.med, Tag.spec('AdminPRD:CustomerMgmt:AutoGrants')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    await ch.seedAutoGrant({ customerId, tier: 2, systems: ['NIBSS BVN'] });
    const page = await asPersona('compliance');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Auto Grants');
    await cm.openGrant(customerId);
    await expect(cm.grantDetail().getByTestId('field-tier-granted')).toContainText(/tier\s*2/i);
    await expect(cm.grantDetail().getByTestId('field-timestamp')).not.toBeEmpty();
    await expect(cm.grantDetail().getByTestId('field-verification-systems')).toContainText(/NIBSS/i);
    await expect(cm.grantDetail()).toContainText(customerId);
  });

  test(title('Support agent does not see the Auto Grants tab', Tag.high, Tag.spec('AdminPRD:CustomerMgmt:AutoGrants')), async ({ asPersona }) => {
    const page = await asPersona('supportAgent');
    await new CustomerManagementPage(page).openModule();
    await expect(new CustomerManagementPage(page).subTab('Auto Grants')).toHaveCount(0);
  });
});

test.describe('Customer Management › Screening', () => {
  let ch: CustomerHooks;
  test.beforeEach(async ({ hooks }) => { void hooks; ch = await CustomerHooks.create(); });
  test.afterEach(async () => { await ch?.dispose(); });

  test(title('View screening hits lists sanctions/PEP hits with confidence scores', Tag.high, Tag.smoke, Tag.spec('AdminPRD:CustomerMgmt:Screening')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    await ch.seedScreeningHit({ customerId, list: 'PEP', confidencePct: 87 });
    const page = await asPersona('compliance');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Screening');
    const row = cm.row(customerId);
    await expect(row).toContainText(/PEP/);
    await expect(cm.confidenceCell(row)).toContainText(/87\s*%/);
  });

  test(title('Clear screening hit as false positive requires a reason and records the resolution', Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:Screening')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    const { hitId } = await ch.seedScreeningHit({ customerId, list: 'SANCTIONS', confidencePct: 62 });
    const page = await asPersona('compliance');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Screening');
    await cm.openHit(customerId);
    const m = await cm.startHitAction('Clear');
    await m.submit();
    await m.expectValidationError(/reason/i);
    await m.fill(/reason/i, 'False positive — DOB and nationality do not match list entry');
    await m.submit();
    await m.expectApplied();
    await expect(cm.hitState()).toContainText(/cleared/i);
    const hit = await ch.screeningHit(hitId);
    expect(hit.state).toBe('CLEARED');
    expect(hit.resolution?.reason).toMatch(/false positive/i);
  });

  test(title('Escalate screening hit (Screening reviewer) routes to the Compliance escalation queue', Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:Screening')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    const { hitId } = await ch.seedScreeningHit({ customerId, list: 'SANCTIONS', confidencePct: 91 });
    const page = await asPersona(prdPersona.screeningReviewer);
    const cm = new CustomerManagementPage(page);
    await cm.goto('Screening');
    await cm.openHit(customerId);
    const m = await cm.startHitAction('Escalate');
    await m.fill(/context/i, 'High-confidence sanctions match — needs Compliance decision');
    await m.submit();
    await m.expectApplied();
    await expect(cm.hitState()).toContainText(/escalated/i);
    expect((await ch.screeningHit(hitId)).state).toBe('ESCALATED');

    const compliance = await asPersona('compliance');
    const cmc = new CustomerManagementPage(compliance);
    await cmc.goto('Screening');
    await cmc.filter(/state/i, 'Escalated');
    await expect(cmc.row(customerId)).toBeVisible();
  });

  test(title('Freeze account from screening: evidence mandatory, dual + Compliance, self-approval blocked, login blocked', Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:Screening'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 250_000 });
    await ch.seedScreeningHit({ customerId, list: 'SANCTIONS', confidencePct: 98 });
    const proposer = await asPersona('compliance');
    const cm = new CustomerManagementPage(proposer);
    await cm.goto('Screening');
    await cm.openHit(customerId);
    const m = await cm.startHitAction('Freeze account');
    await m.fill(/reason/i, 'Confirmed sanctions match');
    await m.submit();
    await m.expectValidationError(/evidence/i);
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();
    expect((await ch.customer(customerId)).accountState).toBe('ACTIVE'); // nothing applied before approval

    const own = await openApprovalQueue(proposer);
    await own.open(customerId);
    await own.expectSelfApprovalBlocked();

    const approver = await asPersona('superAdmin');
    const q = await openApprovalQueue(approver);
    await q.open(customerId);
    await q.expectComplianceStepRequired();
    await q.expectEvidenceVisible();
    await q.approve('Second-admin approval of sanctions freeze');

    const snapshot = await ch.customer(customerId);
    expect(snapshot.accountState).toBe('FROZEN');
    expect(snapshot.loginBlocked).toBe(true);
    const audit = await hooks.auditEntries({ targetId: customerId, limit: 1 });
    expect(audit[0].approvers?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  test(title('Screening reviewer cannot freeze; support agent cannot see the Screening tab', Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:Screening')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    await ch.seedScreeningHit({ customerId, list: 'PEP', confidencePct: 70 });
    const reviewer = await asPersona(prdPersona.screeningReviewer);
    const cm = new CustomerManagementPage(reviewer);
    await cm.goto('Screening');
    await cm.openHit(customerId);
    await expect(cm.hitAction('Freeze account')).toHaveCount(0);

    const support = await asPersona('supportAgent');
    await new CustomerManagementPage(support).openModule();
    await expect(new CustomerManagementPage(support).subTab('Screening')).toHaveCount(0);
  });
});
