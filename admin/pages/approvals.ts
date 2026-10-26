import { Page } from '@playwright/test';
import { ApprovalQueuePage } from './ApprovalQueuePage';

/**
 * Opens Pending Approvals for a persona page. asPersona pages start on about:blank, so land on
 * the portal shell first (ApprovalQueuePage.goto navigates via the sidebar).
 */
export async function openApprovalQueue(page: Page): Promise<ApprovalQueuePage> {
  if (page.url() === 'about:blank') await page.goto('/');
  const q = new ApprovalQueuePage(page);
  await q.goto();
  return q;
}
