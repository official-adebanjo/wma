import { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/fixtures';
import { CommunicationsPage, BannerState, BannerType } from '../../pages/CommunicationsPage';
import { ApprovalQueuePage } from '../../pages/ApprovalQueuePage';
import { asRole, closeRoleSessions } from '../../fixtures/platform-personas';
import { abs } from '../../../shared/data/files';
import { testFiles, uid } from '../../../shared/data/factories';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Communications › Discovery Banners.
 * Send for approval is ALWAYS dual; ending a live banner early is dual (Head of Marketing → Marketing Ops).
 */
const SEGMENT = 'All active customers';
const STATES: BannerState[] = ['Drafts', 'Awaiting approval', 'Scheduled', 'Live', 'Ended'];
const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function draftBanner(page: Page, type: BannerType = 'Content-only', startOffset = 0) {
  const name = uid('QA Banner');
  const comms = new CommunicationsPage(page);
  await comms.goto('Discovery Banners');
  await comms.newBanner({
    title: name, type, segment: SEGMENT, priority: 1, startDate: isoDate(startOffset), endDate: isoDate(startOffset + 14),
    body: type === 'Content-only' ? 'Grow your savings with REAP' : undefined,
    image: type === 'Image' ? abs(testFiles.validJpg) : undefined,
  });
  await comms.saveDraft();
  return { name, comms };
}

async function approvedLive(page: Page, approver: Page) {
  const { name, comms } = await draftBanner(page);
  await comms.goto('Discovery Banners');
  await comms.open(name);
  await comms.sendForApproval();
  const q = new ApprovalQueuePage(approver);
  await q.goto();
  await q.open(new RegExp(name));
  await q.approve('Go live');
  return name;
}

test.describe('Communications › Discovery Banners', () => {
  test.afterEach(closeRoleSessions);

  test(title('Banner list renders with state filter', Tag.med, Tag.smoke, Tag.spec('AdminPRD:Communications:Banners')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    const comms = new CommunicationsPage(page);
    await comms.goto('Discovery Banners');
    await expect(comms.stateFilter()).toBeVisible();
    await expect(comms.portfolio.table()).toBeVisible();
  });

  for (const state of STATES) {
    test(title(`Banner state filter "${state}"`, Tag.low, Tag.spec('AdminPRD:Communications:Banners')), async ({ asPersona }) => {
      const page = await asPersona('marketing');
      const comms = new CommunicationsPage(page);
      await comms.goto('Discovery Banners');
      await comms.filterState(state);
      for (const s of await comms.portfolio.columnValues('State')) expect(s).toMatch(new RegExp(state.replace(/s$/, ''), 'i'));
    });
  }

  for (const type of ['Content-only', 'Image'] as BannerType[]) {
    test(title(`Create ${type} banner draft with segment, priority and active dates`, Tag.high, Tag.spec('AdminPRD:Communications:Banners')), async ({ asPersona, hooks }) => {
      const page = await asPersona('marketing');
      const { name, comms } = await draftBanner(page, type);
      await comms.goto('Discovery Banners');
      await comms.filterState('Drafts');
      await expect(comms.row(name)).toContainText(/draft/i);
      const audit = await hooks.auditEntries({ action: 'banner.create', limit: 1 });
      expect(audit[0]).toBeTruthy();
    });
  }

  test(title('Preview on device renders iOS and Android side-by-side', Tag.med, Tag.spec('AdminPRD:Communications:Banners')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    const { name, comms } = await draftBanner(page, 'Image');
    await comms.goto('Discovery Banners');
    await comms.open(name);
    await comms.previewOnDevice();
    await expect(comms.iosPreview()).toBeVisible();
    await expect(comms.androidPreview()).toBeVisible();
    const ios = await comms.iosPreview().boundingBox();
    const android = await comms.androidPreview().boundingBox();
    expect(ios && android && Math.abs(ios.y - android.y) < 40).toBeTruthy(); // side-by-side
  });

  test(title('Send for approval is always dual; proposer cannot self-approve; Head of Marketing approves → Live/Scheduled', Tag.crit, Tag.spec('AdminPRD:Communications:Banners'), Tag.spec('AdminPRD:ApprovalQueue')), async ({ asPersona }) => {
    const proposer = await asPersona('marketing');
    const { name, comms } = await draftBanner(proposer);
    await comms.goto('Discovery Banners');
    await comms.open(name);
    await comms.sendForApproval();
    await comms.modal.expectRoutedToApproval();

    const own = new ApprovalQueuePage(proposer);
    await own.goto();
    await own.open(new RegExp(name));
    await own.expectSelfApprovalBlocked();

    const hom = await asPersona('headOfMarketing');
    const q = new ApprovalQueuePage(hom);
    await q.goto();
    await q.open(new RegExp(name));
    await q.approve('Approved');
    const after = new CommunicationsPage(hom);
    await after.goto('Discovery Banners');
    await expect(after.row(name)).toContainText(/live|scheduled/i);
  });

  test(title('Reject banner returns to Drafts with reason', Tag.high, Tag.spec('AdminPRD:Communications:Banners')), async ({ asPersona }) => {
    const proposer = await asPersona('marketing');
    const { name, comms } = await draftBanner(proposer, 'Content-only', 2);
    await comms.goto('Discovery Banners');
    await comms.open(name);
    await comms.sendForApproval();
    const hom = await asPersona('headOfMarketing');
    const q = new ApprovalQueuePage(hom);
    await q.goto();
    await q.open(new RegExp(name));
    await q.reject('Image too busy');
    await comms.goto('Discovery Banners');
    await comms.filterState('Drafts');
    await comms.open(name);
    await expect(comms.rejectReason()).toContainText('Image too busy');
  });

  test(title('End live banner early: dual (Head of Marketing → Marketing Ops) → Ended', Tag.high, Tag.spec('AdminPRD:Communications:Banners')), async ({ asPersona, browser }) => {
    const marketing = await asPersona('marketing');
    const hom = await asPersona('headOfMarketing');
    const name = await approvedLive(marketing, hom);

    const comms = new CommunicationsPage(hom);
    await comms.goto('Discovery Banners');
    await comms.filterState('Live');
    await comms.open(name);
    await comms.endEarly('Promotion withdrawn');
    await comms.modal.expectRoutedToApproval();
    await expect(comms.detail.state()).toContainText(/live/i); // still live until approved

    const ops = await asRole(browser, 'marketingOps');
    const q = new ApprovalQueuePage(ops);
    await q.goto();
    await q.open(new RegExp(name));
    await q.approve('End early approved');
    const after = new CommunicationsPage(ops);
    await after.goto('Discovery Banners');
    await after.filterState('Ended');
    await expect(after.row(name)).toBeVisible();
  });

  test(title('Banner analytics shows impressions and CTR', Tag.low, Tag.spec('AdminPRD:Communications:Banners')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    const comms = new CommunicationsPage(page);
    await comms.goto('Discovery Banners');
    await comms.filterState('Live');
    test.skip((await comms.portfolio.rows().count()) === 0, 'No live banner in this environment');
    await comms.portfolio.rows().first().click();
    await expect(comms.analytics()).toContainText(/impressions/i);
    await expect(comms.analytics()).toContainText(/CTR/i);
  });

  test(title('Marketing cannot end a live banner early (Head of Marketing only)', Tag.high, Tag.spec('AdminPRD:Communications:Banners')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    const comms = new CommunicationsPage(page);
    await comms.goto('Discovery Banners');
    await comms.filterState('Live');
    test.skip((await comms.portfolio.rows().count()) === 0, 'No live banner in this environment');
    await comms.portfolio.rows().first().click();
    await comms.detail.expectActionAbsent(/end early/i);
  });
});
