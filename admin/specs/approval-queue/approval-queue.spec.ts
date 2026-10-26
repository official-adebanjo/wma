import { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/fixtures';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { SettingsPage } from '../../pages/SettingsPage';
import { WalletManagementPage } from '../../pages/WalletManagementPage';
import { Portfolio } from '../../pages/components';
import { uid } from '../../../shared/data/factories';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Pending Approvals (Approval Queue).
 * Review modal shows details + evidence + initiator; Approve executes the action's apply callback;
 * Reject returns to proposer with reason; Withdraw is proposer-only; self-approval blocked;
 * per-item .approve permission enforced.
 *
 * Representative item: "Add reason code" (Compliance proposes → Head of Ops approves) — cheap and its
 * apply callback is directly observable in Settings › Reason Codes.
 */
const VOCAB = 'Decline reasons';

async function proposeReasonCode(compliance: Page) {
  const value = uid('QA reason');
  const s = new SettingsPage(compliance);
  await s.goto('Reason Codes');
  await s.openVocabulary(VOCAB);
  await s.addValue(value);
  await s.modal.expectRoutedToApproval();
  return value;
}

test.describe('Pending Approvals (Approval Queue)', () => {
  test(title('Queue renders with state side rail and filters', Tag.med, Tag.smoke, Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona }) => {
    const page = await asPersona('headOfOps');
    const q = new ApprovalQueuePage(page);
    await q.goto();
    const p = new Portfolio(page);
    await expect(p.rail()).toBeVisible();
    await expect(p.filterRow()).toBeVisible();
  });

  test(title('Module filter narrows the queue', Tag.low, Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona }) => {
    const compliance = await asPersona('compliance');
    const value = await proposeReasonCode(compliance);
    const ops = await asPersona('headOfOps');
    const q = new ApprovalQueuePage(ops);
    await q.goto();
    const p = new Portfolio(ops);
    await p.filter('Module', 'Settings');
    await expect(q.row(new RegExp(value))).toBeVisible();
    for (const m of await p.columnValues('Module')) expect(m).toMatch(/settings/i);
  });

  test(title('Review modal shows action details, evidence and initiator', Tag.crit, Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const { phone } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const ref = uid('CHQ');
    const treasury = await asPersona('treasuryOfficer');
    const wm = new WalletManagementPage(treasury);
    await wm.goto('Manual ledger');
    const m = await wm.createManualEntry();
    await wm.fillManualEntry({ customer: phone, product: 'Wallet', amount: 2_500, category: 'Credit', externalRef: ref });
    await m.evidence.fillDefault();
    await m.submit();
    await m.expectRoutedToApproval();

    const hot = await asPersona('headOfTreasury');
    const q = new ApprovalQueuePage(hot);
    await q.goto();
    await q.open(new RegExp(ref));
    await expect(q.reviewModal()).toContainText(ref);
    await expect(q.reviewModal()).toContainText(/2,500/);
    await q.expectEvidenceVisible();
    await q.expectInitiator(/treasury/i);
    await q.reject('Test cleanup — not a real entry');
  });

  test(title('Self-approval is blocked for the proposer', Tag.crit, Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona }) => {
    const compliance = await asPersona('compliance');
    const value = await proposeReasonCode(compliance);
    const q = new ApprovalQueuePage(compliance);
    await q.goto();
    await q.open(new RegExp(value));
    await q.expectSelfApprovalBlocked();
    await q.withdraw('Test cleanup');
  });

  test(title('Approve executes the apply callback (reason code becomes available)', Tag.crit, Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const compliance = await asPersona('compliance');
    const value = await proposeReasonCode(compliance);
    const s = new SettingsPage(compliance);
    await s.goto('Reason Codes');
    await s.openVocabulary(VOCAB);
    await expect(s.vocabularyValues().filter({ hasText: value })).toHaveCount(0); // not applied yet

    const ops = await asPersona('headOfOps');
    const q = new ApprovalQueuePage(ops);
    await q.goto();
    await q.open(new RegExp(value));
    await q.approve('Approved');
    await expect(q.row(new RegExp(value))).toHaveCount(0);

    await s.goto('Reason Codes');
    await s.openVocabulary(VOCAB);
    await expect(s.vocabularyValues().filter({ hasText: value })).toHaveCount(1);
    const audit = await hooks.auditEntries({ action: 'reason_code.add', limit: 1 });
    expect(audit[0].approvers ?? []).toHaveLength(1);
  });

  test(title('Reject returns the action to the proposer as Rejected with the reason', Tag.crit, Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona }) => {
    const compliance = await asPersona('compliance');
    const value = await proposeReasonCode(compliance);
    const ops = await asPersona('headOfOps');
    const q = new ApprovalQueuePage(ops);
    await q.goto();
    await q.open(new RegExp(value));
    await q.reject('Duplicate of an existing reason');

    const own = new ApprovalQueuePage(compliance);
    await own.goto();
    const p = new Portfolio(compliance);
    await p.selectState('Rejected');
    await expect(own.row(new RegExp(value))).toContainText(/rejected/i);
    await expect(own.row(new RegExp(value))).toContainText(/duplicate of an existing reason/i);
  });

  test(title('Withdraw is proposer-only; proposer withdraw returns item to drafts as Withdrawn', Tag.high, Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona }) => {
    const compliance = await asPersona('compliance');
    const value = await proposeReasonCode(compliance);

    const ops = await asPersona('headOfOps');
    const approverView = new ApprovalQueuePage(ops);
    await approverView.goto();
    await approverView.open(new RegExp(value));
    await expect(approverView.reviewModal().getByRole('button', { name: /^withdraw$/i })).toHaveCount(0);

    const own = new ApprovalQueuePage(compliance);
    await own.goto();
    await own.open(new RegExp(value));
    await own.withdraw('Raised in error');
    const p = new Portfolio(compliance);
    await p.selectState('Withdrawn');
    await expect(own.row(new RegExp(value))).toContainText(/withdrawn/i);
  });

  test(title('Per-item .approve permission enforced: persona without it cannot approve', Tag.crit, Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona }) => {
    const compliance = await asPersona('compliance');
    const value = await proposeReasonCode(compliance);
    const page = await asPersona('marketing');
    await page.goto('/');
    if ((await page.getByTestId('nav-pending-approvals').count()) === 0) return; // no .approve on anything → no queue
    const q = new ApprovalQueuePage(page);
    await q.goto();
    const row = q.row(new RegExp(value));
    if ((await row.count()) === 0) return; // item filtered out for this persona
    await q.open(new RegExp(value));
    await expect(q.reviewModal().getByRole('button', { name: /^approve$/i })).toBeDisabled();
  });
});
