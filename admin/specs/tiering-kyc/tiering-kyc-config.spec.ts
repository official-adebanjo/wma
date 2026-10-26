import { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/fixtures';
import { TieringKycPage } from '../../pages/TieringKycPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { Customer360Page } from '../../pages/Customer360Page';
import { asRole, closeRoleSessions } from '../../fixtures/platform-personas';
import { tierLimits, Tier } from '../../../shared/config/env';
import { formatNaira } from '../../../shared/calc/money';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Tiering & KYC + Account Tiering & KYC Spec V4 §1 (tier limits).
 *   Configure tier          — Head of Ops → Compliance (dual)
 *   KYC requirement         — Compliance → CTO
 *   KYC provider            — Head of Ops → CTO
 *   Manual tier grant       — dual + Compliance for high tiers; tier grant record carries a prominent flag
 */
const naira = (v: number) => formatNaira(v, { kobo: false });

async function proposeTierDaily(page: Page, tier: Tier, value: number) {
  const tk = new TieringKycPage(page);
  await tk.goto('Tiers');
  const m = await tk.edit(`Tier ${tier}`);
  await m.fill(/daily/i, value);
  await m.fill(/reason/i, 'Automated tier-limit test');
  await m.submit();
  await m.expectRoutedToApproval();
}

async function approveAs(page: Page, matching: RegExp, note = 'Approved') {
  const q = new ApprovalQueuePage(page);
  await q.goto();
  await q.open(matching);
  await q.approve(note);
}

test.describe('Tiering & KYC configuration', () => {
  test.afterEach(closeRoleSessions);

  test(title('Tier limits match Spec V4 §1 (T1 ₦300,000 / ₦20,000; T2–T3 ₦5,000,000 / ₦20,000,000)', Tag.crit, Tag.smoke, Tag.spec('KYC-V4§1'), Tag.spec('AdminPRD:TieringKYC')), async ({ asPersona }) => {
    const page = await asPersona('headOfOps');
    const tk = new TieringKycPage(page);
    await tk.goto('Tiers');
    for (const t of [1, 2, 3] as const) {
      await expect(tk.tierLimit(t, 'single')).toContainText(naira(tierLimits[t].singleTransfer));
      await expect(tk.tierLimit(t, 'daily')).toContainText(naira(tierLimits[t].dailyTransfer));
    }
  });

  test(title('Configure tier limit: Head of Ops proposes, not applied until Compliance approves, self-approval blocked', Tag.crit, Tag.spec('AdminPRD:TieringKYC'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona }) => {
    const original = tierLimits[2].dailyTransfer;
    const changed = original + 1_000_000;
    const ops = await asPersona('headOfOps');
    await proposeTierDaily(ops, 2, changed);
    const tk = new TieringKycPage(ops);
    await tk.goto('Tiers');
    await expect(tk.tierLimit(2, 'daily')).toContainText(naira(original)); // pending, not applied

    const own = new ApprovalQueuePage(ops);
    await own.goto();
    await own.open(/Tier 2/);
    await own.expectSelfApprovalBlocked();

    const compliance = await asPersona('compliance');
    await approveAs(compliance, /Tier 2/, 'Limit change approved');
    await tk.goto('Tiers');
    await expect(tk.tierLimit(2, 'daily')).toContainText(naira(changed));

    // restore Spec V4 value through the same dual path
    await proposeTierDaily(ops, 2, original);
    await approveAs(compliance, /Tier 2/, 'Restore spec value');
    await tk.goto('Tiers');
    await expect(tk.tierLimit(2, 'daily')).toContainText(naira(original));
  });

  test(title('Configure tier product eligibility routes to dual approval', Tag.high, Tag.spec('AdminPRD:TieringKYC')), async ({ asPersona }) => {
    const ops = await asPersona('headOfOps');
    const tk = new TieringKycPage(ops);
    await tk.goto('Tiers');
    const m = await tk.edit('Tier 1');
    await tk.eligibilityToggle('RTN').click();
    await m.fill(/reason/i, 'Eligibility test');
    await m.submit();
    await m.expectRoutedToApproval();
    const q = new ApprovalQueuePage(ops);
    await q.goto();
    await q.open(/Tier 1/);
    await q.withdraw('Test cleanup');
  });

  test(title('Configure KYC requirement (method, auto-verifiable, freshness window): Compliance proposes, CTO approves', Tag.high, Tag.spec('AdminPRD:TieringKYC')), async ({ asPersona, browser, hooks }) => {
    const compliance = await asPersona('compliance');
    const tk = new TieringKycPage(compliance);
    await tk.goto('KYC Requirements');
    const m = await tk.edit(/proof of address|utility bill/i);
    await m.select(/verification method/i, 'Manual review');
    await tk.autoVerifiable().uncheck();
    await m.fill(/freshness window/i, 90);
    await m.submit();
    await m.expectRoutedToApproval();

    const cto = await asRole(browser, 'cto');
    await approveAs(cto, /proof of address|utility bill/i, 'KYC requirement approved');
    const audit = await hooks.auditEntries({ action: 'kyc.requirement.configure', limit: 1 });
    expect(audit[0].approvers ?? []).toHaveLength(1);
  });

  test(title('Configure KYC provider (NIBSS): Head of Ops proposes, CTO approves', Tag.high, Tag.spec('AdminPRD:TieringKYC')), async ({ asPersona, browser }) => {
    const ops = await asPersona('headOfOps');
    const tk = new TieringKycPage(ops);
    await tk.goto('Providers');
    await expect(tk.item('NIMC')).toBeVisible();
    const m = await tk.edit('NIBSS');
    await m.fill(/timeout/i, 30);
    await m.submit();
    await m.expectRoutedToApproval();
    const cto = await asRole(browser, 'cto');
    await approveAs(cto, /NIBSS/, 'Provider timeout approved');
  });

  test(title('Manual tier grant requires evidence', Tag.crit, Tag.spec('AdminPRD:TieringKYC')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 1 });
    const page = await asPersona('kycReviewer');
    const tk = new TieringKycPage(page);
    const m = await tk.startGrantTier(customerId);
    await m.select(/tier/i, 'Tier 2');
    await m.fill(/reason/i, 'Docs verified offline');
    await m.submit();
    await m.expectValidationError(/evidence/i);
  });

  test(title('Manual grant to high tier (Tier 3): dual + Compliance; tier badge updated with prominent manual-override flag', Tag.crit, Tag.spec('AdminPRD:TieringKYC')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    const proposer = await asPersona('kycReviewer');
    const tk = new TieringKycPage(proposer);
    const m = await tk.startGrantTier(customerId);
    await m.select(/tier/i, 'Tier 3');
    await m.fill(/reason/i, 'Advanced verification completed offline');
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const compliance = await asPersona('compliance');
    const q = new ApprovalQueuePage(compliance);
    await q.goto();
    await q.open(/Tier 3|tier grant/i);
    await q.expectComplianceStepRequired();
    await q.expectEvidenceVisible();
    await q.approve('High-tier grant approved');

    const c360 = new Customer360Page(compliance);
    await c360.goto(customerId);
    await expect(c360.tierBadge()).toContainText(/3/);
    await expect(new TieringKycPage(compliance).manualOverrideFlag()).toBeVisible();
    const audit = await hooks.auditEntries({ targetId: customerId, limit: 1 });
    expect(audit[0].prominent).toBe(true);
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.some((n) => /tier/i.test(`${n.title} ${n.body}`))).toBe(true);
  });

  test(title('Roles without tiering permissions cannot edit tier configuration', Tag.crit, Tag.spec('AdminPRD:TieringKYC')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    await page.goto('/');
    if ((await page.getByTestId('nav-tiering-kyc').count()) === 0) return; // module hidden = no access
    const tk = new TieringKycPage(page);
    await tk.goto('Tiers');
    await tk.item('Tier 1').click();
    await expect(page.getByRole('button', { name: /^edit|configure/i })).toHaveCount(0);
  });
});
