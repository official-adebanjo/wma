import { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/fixtures';
import { CommunicationsPage, CampaignState, CampaignChannel } from '../../pages/CommunicationsPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { asRole, closeRoleSessions } from '../../fixtures/platform-personas';
import { uid } from '../../../shared/data/factories';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Communications › Campaigns (+ Templates, Delivery log).
 * Marketing drafts/submits; Head of Marketing approves (Compliance too for sensitive segments);
 * template edits create a new version (Head of Marketing → CMO).
 *
 * Segment names are environment config: GENERAL is any non-sensitive segment, SENSITIVE one flagged
 * sensitive (e.g. customers in arrears) so Compliance sign-off is required.
 */
const SEGMENT = { GENERAL: 'All active customers', SENSITIVE: 'Customers in arrears' };
const STATES: CampaignState[] = ['Drafts', 'Awaiting approval', 'Scheduled', 'Sending', 'Sent', 'Failed'];

async function draftCampaign(page: Page, opts: { channel?: CampaignChannel; segment?: string; scheduleAt?: string } = {}) {
  const name = uid('QA Campaign');
  const comms = new CommunicationsPage(page);
  await comms.goto('Campaigns');
  await comms.newCampaign({
    name, channel: opts.channel ?? 'Email', segment: opts.segment ?? SEGMENT.GENERAL,
    subject: 'Your savings update', body: 'Hello {{first_name}}, check out REAP today.', scheduleAt: opts.scheduleAt,
  });
  await comms.saveDraft();
  return { name, comms };
}

async function submitted(page: Page, opts: Parameters<typeof draftCampaign>[1] = {}) {
  const d = await draftCampaign(page, opts);
  await d.comms.goto('Campaigns');
  await d.comms.open(d.name);
  await d.comms.sendForApproval();
  await d.comms.modal.expectRoutedToApproval();
  return d;
}

test.describe('Communications › Campaigns', () => {
  test.afterEach(closeRoleSessions);

  test(title('Campaigns list shows state filter and metric strip', Tag.med, Tag.smoke, Tag.spec('AdminPRD:Communications')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    const comms = new CommunicationsPage(page);
    await comms.goto('Campaigns');
    await expect(comms.stateFilter()).toBeVisible();
    await expect(comms.portfolio.metricCards().first()).toBeVisible();
  });

  for (const state of STATES) {
    test(title(`State filter "${state}" shows only campaigns in that state`, Tag.low, Tag.spec('AdminPRD:Communications')), async ({ asPersona }) => {
      const page = await asPersona('marketing');
      const comms = new CommunicationsPage(page);
      await comms.goto('Campaigns');
      await comms.filterState(state);
      const states = await comms.portfolio.columnValues('State');
      const expected = new RegExp(state.replace(/s$/, ''), 'i'); // "Drafts" → Draft
      for (const s of states) expect(s).toMatch(expected);
    });
  }

  test(title('Create campaign draft (Email): persists as Draft, not sent, audited', Tag.high, Tag.spec('AdminPRD:Communications')), async ({ asPersona, hooks }) => {
    const page = await asPersona('marketing');
    const { name, comms } = await draftCampaign(page);
    await comms.goto('Campaigns');
    await comms.filterState('Drafts');
    await expect(comms.row(name)).toContainText(/draft/i);
    const audit = await hooks.auditEntries({ action: 'campaign.create', limit: 1 });
    expect(audit[0]).toBeTruthy();
  });

  test(title('Use template in campaign pre-fills subject and body', Tag.med, Tag.spec('AdminPRD:Communications')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    const comms = new CommunicationsPage(page);
    await comms.goto('Campaigns');
    await comms.newCampaign({ name: uid('QA Tmpl'), channel: 'Email', segment: SEGMENT.GENERAL });
    await comms.useTemplate('Welcome');
    await expect(comms.editor().getByLabel(/subject|title/i)).not.toHaveValue('');
    await expect(comms.editor().getByLabel(/body|message/i)).not.toHaveValue('');
  });

  test(title('Preview Email renders inbox view with sample customer values', Tag.med, Tag.spec('AdminPRD:Communications')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    const comms = new CommunicationsPage(page);
    await comms.goto('Campaigns');
    await comms.newCampaign({ name: uid('QA Prev'), channel: 'Email', segment: SEGMENT.GENERAL, subject: 'Hi', body: 'Hello {{first_name}}' });
    await comms.preview();
    await expect(comms.emailInboxPreview()).toBeVisible();
    await expect(comms.emailInboxPreview()).not.toContainText('{{first_name}}');
  });

  test(title('Preview Push renders iOS and Android notifications', Tag.med, Tag.spec('AdminPRD:Communications')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    const comms = new CommunicationsPage(page);
    await comms.goto('Campaigns');
    await comms.newCampaign({ name: uid('QA Push'), channel: 'Push', segment: SEGMENT.GENERAL, subject: 'Rates up', body: 'RTN rates just went up' });
    await comms.preview();
    await expect(comms.iosPreview()).toBeVisible();
    await expect(comms.androidPreview()).toBeVisible();
  });

  test(title('Send for approval → Awaiting approval; proposer cannot self-approve; Head of Marketing approves', Tag.crit, Tag.spec('AdminPRD:Communications'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona, hooks }) => {
    const proposer = await asPersona('marketing');
    const { name, comms } = await submitted(proposer);
    await comms.goto('Campaigns');
    await comms.filterState('Awaiting approval');
    await expect(comms.row(name)).toBeVisible();

    const own = new ApprovalQueuePage(proposer);
    await own.goto();
    await own.open(new RegExp(name));
    await own.expectSelfApprovalBlocked();

    const hom = await asPersona('headOfMarketing');
    const q = new ApprovalQueuePage(hom);
    await q.goto();
    await q.open(new RegExp(name));
    await q.approve('Copy approved');
    const after = new CommunicationsPage(hom);
    await after.goto('Campaigns');
    await expect(after.row(name)).toContainText(/scheduled|sending|sent/i);
    const audit = await hooks.auditEntries({ action: 'campaign.approve', limit: 1 });
    expect(audit[0].approvers ?? []).toHaveLength(1);
  });

  test(title('Campaign to a sensitive segment requires Compliance sign-off', Tag.crit, Tag.spec('AdminPRD:Communications')), async ({ asPersona }) => {
    const proposer = await asPersona('marketing');
    const { name } = await submitted(proposer, { segment: SEGMENT.SENSITIVE });
    const compliance = await asPersona('compliance');
    const q = new ApprovalQueuePage(compliance);
    await q.goto();
    await q.open(new RegExp(name));
    await q.expectComplianceStepRequired();
  });

  test(title('Reject campaign returns it to Drafts with the reject reason', Tag.high, Tag.spec('AdminPRD:Communications')), async ({ asPersona }) => {
    const proposer = await asPersona('marketing');
    const { name } = await submitted(proposer);
    const hom = await asPersona('headOfMarketing');
    const q = new ApprovalQueuePage(hom);
    await q.goto();
    await q.open(new RegExp(name));
    await q.reject('Tone not on brand');

    const comms = new CommunicationsPage(proposer);
    await comms.goto('Campaigns');
    await comms.filterState('Drafts');
    await comms.open(name);
    await expect(comms.rejectReason()).toContainText('Tone not on brand');
  });

  test(title('Cancel scheduled campaign → Cancelled (Head of Marketing)', Tag.high, Tag.spec('AdminPRD:Communications')), async ({ asPersona }) => {
    const proposer = await asPersona('marketing');
    const sendAt = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 16);
    const { name } = await submitted(proposer, { scheduleAt: sendAt });
    const hom = await asPersona('headOfMarketing');
    const q = new ApprovalQueuePage(hom);
    await q.goto();
    await q.open(new RegExp(name));
    await q.approve('Approved for schedule');

    const comms = new CommunicationsPage(hom);
    await comms.goto('Campaigns');
    await comms.filterState('Scheduled');
    await comms.open(name);
    await comms.cancelScheduled('Campaign superseded');
    await expect(comms.detail.state()).toContainText(/cancelled/i);
  });

  test(title('Delivery log lists every message with delivery status', Tag.med, Tag.spec('AdminPRD:Communications')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    const comms = new CommunicationsPage(page);
    await comms.goto('Campaigns');
    await comms.openDeliveryLog();
    await expect(comms.deliveryLog()).toBeVisible();
    await expect(comms.deliveryLog().getByRole('columnheader', { name: /status/i })).toBeVisible();
  });

  test(title('Retry failed re-sends only to failed recipients', Tag.high, Tag.spec('AdminPRD:Communications')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    const comms = new CommunicationsPage(page);
    await comms.goto('Campaigns');
    await comms.filterState('Failed');
    test.skip((await comms.portfolio.rows().count()) === 0, 'No campaign with failed deliveries in this environment');
    await comms.portfolio.rows().first().click();
    await comms.openDeliveryLog();
    const failed = await comms.deliveryRows(/failed/i).count();
    const total = await comms.deliveryRows().count();
    expect(failed).toBeGreaterThan(0);
    const dialog = await comms.startRetryFailed();
    await expect(dialog).toContainText(new RegExp(`\\b${failed}\\b`));
    if (total !== failed) await expect(dialog).not.toContainText(new RegExp(`\\b${total}\\b recipients`));
    await comms.confirmRetry();
    await comms.modal.expectApplied();
  });

  test(title('Template edit creates a new version (old retained): Head of Marketing proposes, CMO approves', Tag.high, Tag.spec('AdminPRD:Communications')), async ({ asPersona, browser }) => {
    const hom = await asPersona('headOfMarketing');
    const comms = new CommunicationsPage(hom);
    await comms.goto('Campaigns');
    await comms.openTemplates();
    await comms.portfolio.rows().filter({ hasText: 'Welcome' }).first().click();
    const before = await comms.templateVersions().count();
    await comms.editTemplate('Welcome', `Welcome aboard {{first_name}} — rev ${Date.now()}`);
    await comms.modal.expectRoutedToApproval();

    const cmo = await asRole(browser, 'cmo');
    const q = new ApprovalQueuePage(cmo);
    await q.goto();
    await q.open(/Welcome/);
    await q.approve('New version approved');

    const after = new CommunicationsPage(cmo);
    await after.goto('Campaigns');
    await after.openTemplates();
    await after.portfolio.rows().filter({ hasText: 'Welcome' }).first().click();
    await expect(after.templateVersions()).toHaveCount(before + 1);
  });

  test(title('Roles without campaign permissions cannot create campaigns', Tag.high, Tag.spec('AdminPRD:Communications')), async ({ asPersona }) => {
    const page = await asPersona('supportAgent');
    await page.goto('/');
    const nav = page.getByTestId('nav-communications');
    if (await nav.count()) {
      await new CommunicationsPage(page).goto('Campaigns');
    }
    await expect(page.getByRole('button', { name: /new campaign/i })).toHaveCount(0);
  });
});
