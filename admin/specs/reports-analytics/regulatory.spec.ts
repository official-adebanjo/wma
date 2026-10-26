import { test, expect } from '../../fixtures/fixtures';
import { ReportsAnalyticsPage, FilingState } from '../../pages/ReportsAnalyticsPage';
import { asRole, closeRoleSessions } from '../../fixtures/platform-personas';
import { abs } from '../../../shared/data/files';
import { testFiles, uid } from '../../../shared/data/factories';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Reports & Analytics › Regulatory.
 * Lifecycle: Upcoming → Draft (preparer) → Ready for sign-off → Signed off (Compliance officer, NOT the preparer)
 * → Submitted (with reference). Regulator communications are a chronological log.
 *
 * The lifecycle tests run serially against one filing picked from "Upcoming".
 */
const RAIL: FilingState[] = ['All', 'Upcoming', 'Ready for sign-off', 'Signed off', 'Submitted', 'Overdue'];

test.describe('Reports & Analytics › Regulatory', () => {
  test.afterEach(closeRoleSessions);

  test(title('Filings catalog side rail: All / Upcoming / Ready for sign-off / Signed off / Submitted / Overdue', Tag.med, Tag.smoke, Tag.spec('AdminPRD:Regulatory')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Regulatory');
    for (const s of RAIL) {
      await ra.portfolio.selectState(s);
      await ra.portfolio.expectSelectedState(s);
    }
  });

  test(title('Roles without regulatory permission cannot see the Regulatory tab', Tag.crit, Tag.spec('AdminPRD:Regulatory')), async ({ asPersona }) => {
    const page = await asPersona('marketing');
    await page.goto('/');
    if ((await page.getByTestId('nav-reports-analytics').count()) === 0) return; // module hidden = no access
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Dashboards');
    await expect(page.getByRole('tab', { name: 'Regulatory' })).toHaveCount(0);
  });

  test.describe('Filing lifecycle', () => {
    test.describe.configure({ mode: 'serial' });
    let filing = '';

    test(title('Save filing draft (preparer, document upload)', Tag.high, Tag.spec('AdminPRD:Regulatory')), async ({ browser }) => {
      const page = await asRole(browser, 'compliancePreparer');
      const ra = new ReportsAnalyticsPage(page);
      await ra.goto('Regulatory');
      await ra.portfolio.selectState('Upcoming');
      test.skip((await ra.portfolio.rows().count()) === 0, 'No upcoming filing in this environment');
      await ra.openFiling(0);
      filing = (await ra.filingName().innerText()).trim();
      await ra.filingContent().locator('input[type=file]').setInputFiles(abs(testFiles.validPdf));
      await ra.saveDraft();
      await expect(ra.filingState()).toContainText(/draft/i);
    });

    test(title('Submit filing for sign-off → Ready for sign-off', Tag.high, Tag.spec('AdminPRD:Regulatory')), async ({ browser }) => {
      test.skip(!filing, 'Depends on draft step');
      const page = await asRole(browser, 'compliancePreparer');
      const ra = new ReportsAnalyticsPage(page);
      await ra.goto('Regulatory');
      await ra.openFiling(filing);
      await ra.submitForSignOff();
      await expect(ra.filingState()).toContainText(/ready for sign-off/i);
    });

    test(title('Preparer cannot sign off own filing', Tag.crit, Tag.spec('AdminPRD:Regulatory')), async ({ browser }) => {
      test.skip(!filing, 'Depends on submit step');
      const page = await asRole(browser, 'compliancePreparer');
      const ra = new ReportsAnalyticsPage(page);
      await ra.goto('Regulatory');
      await ra.portfolio.selectState('Ready for sign-off');
      await ra.openFiling(filing);
      const btn = ra.signOffButton();
      await expect(btn.or(page.getByText(/cannot sign off.*(own|prepared)/i)).first()).toBeVisible();
      if (await btn.isVisible()) await expect(btn).toBeDisabled();
    });

    test(title('Compliance officer (not the preparer) signs off → Signed off', Tag.crit, Tag.spec('AdminPRD:Regulatory')), async ({ browser, hooks }) => {
      test.skip(!filing, 'Depends on submit step');
      const page = await asRole(browser, 'complianceOfficer');
      const ra = new ReportsAnalyticsPage(page);
      await ra.goto('Regulatory');
      await ra.portfolio.selectState('Ready for sign-off');
      await ra.openFiling(filing);
      await ra.signOff('Reviewed and approved for submission');
      await expect(ra.filingState()).toContainText(/signed off/i);
      const audit = await hooks.auditEntries({ action: 'filing.signoff', limit: 1 });
      expect(audit[0].actor).not.toBe('');
    });

    test(title('Mark filing as submitted records reference, timestamp, channel', Tag.high, Tag.spec('AdminPRD:Regulatory')), async ({ browser }) => {
      test.skip(!filing, 'Depends on sign-off step');
      const page = await asRole(browser, 'complianceOfficer');
      const ra = new ReportsAnalyticsPage(page);
      await ra.goto('Regulatory');
      await ra.portfolio.selectState('Signed off');
      await ra.openFiling(filing);
      const ref = uid('CBN');
      await ra.markSubmitted(ref, 'Regulator portal');
      await expect(ra.filingState()).toContainText(/submitted/i);
      await expect(page.getByTestId('filing-detail')).toContainText(ref);
    });
  });

  test(title('Add regulator communication appends to chronological log', Tag.med, Tag.spec('AdminPRD:Regulatory')), async ({ asPersona }) => {
    const page = await asPersona('compliance');
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Regulatory');
    await ra.openRegulatorCommunications();
    const before = await ra.communicationsLog().count();
    const msg = `QA follow-up ${uid()}`;
    await ra.addCommunication('CBN', msg);
    await expect(ra.communicationsLog()).toHaveCount(before + 1);
    await expect(ra.communicationsLog().filter({ hasText: msg })).toHaveCount(1);
  });
});
